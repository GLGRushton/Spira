import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  type ConversationMessageRecord,
  type ConversationRecord,
  type ConversationSummary,
  SPIRA_MEMORY_DB_PATH_ENV,
  SpiraMemoryDatabase,
  type UpsertToolCallInput,
} from "@spira/memory-db";
import {
  type ClientMessage,
  type ConversationMessage,
  type ConversationSearchMatch,
  type Env,
  PROTOCOL_VERSION,
  type StoredConversation,
  type StoredConversationSummary,
  type UpgradeProposal,
  type UserSettings,
  parseEnv,
} from "@spira/shared";
import { ZodError } from "zod";
import { buildContinuityPreamble, buildConversationMemoryContent } from "./copilot/continuity.js";
import { CopilotSessionManager } from "./copilot/session-manager.js";
import { McpClientPool } from "./mcp/client-pool.js";
import { McpRegistry } from "./mcp/registry.js";
import { McpToolAggregator } from "./mcp/tool-aggregator.js";
import { WsServer } from "./server.js";
import { resolveAppPath } from "./util/app-paths.js";
import { ConfigError, SpiraError, toErrorPayload } from "./util/errors.js";
import { SpiraEventBus } from "./util/event-bus.js";
import { createLogger } from "./util/logger.js";
import { AudioCapture } from "./voice/audio-capture.js";
import { VoicePipeline } from "./voice/pipeline.js";
import { WhisperSttProvider } from "./voice/stt.js";
import { TtsPlaybackService } from "./voice/tts-playback-service.js";
import { NullWakeWordProvider } from "./voice/wake-word-null.js";
import { OpenWakeWordProvider } from "./voice/wake-word-openwakeword.js";
import { PorcupineWakeWordProvider, type WakeWordProvider } from "./voice/wake-word.js";
import { WsTransport } from "./ws-transport.js";

const logger = createLogger("backend");

let server: WsServer | null = null;
let bus: SpiraEventBus | null = null;
let copilotManager: CopilotSessionManager | null = null;
let mcpRegistry: McpRegistry | null = null;
let transport: WsTransport | null = null;
let unsubscribeTransport: (() => void) | null = null;
let voicePipeline: VoicePipeline | null = null;
let ttsPlayback: TtsPlaybackService | null = null;
let backendEnv: Env | null = null;
let voiceConfiguration: VoiceConfiguration | null = null;
let wakeWordEnabled = true;
let speechEnabled = true;
let memoryDb: SpiraMemoryDatabase | null = null;
let activeConversationId: string | null = null;
const pendingToolCalls = new Map<string, Omit<UpsertToolCallInput, "messageId">>();

const BACKEND_BUILD_ID = process.env.SPIRA_BUILD_ID?.trim() || "dev";
const BACKEND_GENERATION = Number(process.env.SPIRA_GENERATION ?? "0");
let shuttingDown = false;
const pendingUpgradeProposalResponses = new Map<
  string,
  {
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }
>();
const VOICE_ACKNOWLEDGEMENTS = ["On it.", "Understood.", "Right away.", "Heard you."] as const;
const SESSION_STATE_SESSION_ID_KEY = "copilot-session-id";
const SESSION_STATE_CONVERSATION_ID_KEY = "active-conversation-id";
const CONVERSATION_MEMORY_PREFIX = "conversation-summary:";

const pickVoiceAcknowledgement = (text: string): string => {
  const normalizedLength = text.trim().length;
  return VOICE_ACKNOWLEDGEMENTS[normalizedLength % VOICE_ACKNOWLEDGEMENTS.length] ?? VOICE_ACKNOWLEDGEMENTS[0];
};

const loadEnvFromFile = () => {
  try {
    process.loadEnvFile(resolveAppPath(".env"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
};

const createEnv = (): Env => {
  loadEnvFromFile();
  try {
    return parseEnv();
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ConfigError("Invalid backend environment configuration", error);
    }
    throw error;
  }
};

type VoiceConfiguration = Pick<UserSettings, "whisperModel" | "wakeWordProvider" | "openWakeWordThreshold">;

const getVoiceConfiguration = (env: Env, settings: Partial<UserSettings> = {}): VoiceConfiguration => ({
  whisperModel: settings.whisperModel ?? voiceConfiguration?.whisperModel ?? env.WHISPER_MODEL,
  wakeWordProvider: settings.wakeWordProvider ?? voiceConfiguration?.wakeWordProvider ?? env.WAKE_WORD_PROVIDER,
  openWakeWordThreshold:
    settings.openWakeWordThreshold ?? voiceConfiguration?.openWakeWordThreshold ?? env.OPENWAKEWORD_THRESHOLD,
});

const setActiveConversation = (conversationId: string | null): void => {
  activeConversationId = conversationId;
  memoryDb?.setSessionState(SESSION_STATE_CONVERSATION_ID_KEY, conversationId);
};

const ensureActiveConversation = (timestamp: number, preferredTitle?: string, preferredId?: string): string | null => {
  if (!memoryDb) {
    return null;
  }

  if (preferredId) {
    setActiveConversation(preferredId);
  }

  if (!activeConversationId) {
    setActiveConversation(
      memoryDb.createConversation({
        id: preferredId,
        title: preferredTitle,
        createdAt: timestamp,
      }),
    );
  }

  return activeConversationId;
};

const rememberConversationContext = (conversationId: string | null): boolean => {
  if (!memoryDb || !conversationId) {
    return false;
  }

  const conversation = memoryDb.getConversation(conversationId);
  if (!conversation) {
    return false;
  }

  const content = buildConversationMemoryContent(conversation);
  if (!content) {
    return false;
  }

  memoryDb.remember({
    id: `${CONVERSATION_MEMORY_PREFIX}${conversationId}`,
    category: "task-context",
    content,
    sourceConversationId: conversationId,
    sourceMessageId: conversation.messages.at(-1)?.id ?? null,
  });
  return true;
};

const getContinuityPreamble = (text: string, conversationId?: string): string | null =>
  buildContinuityPreamble({
    database: memoryDb,
    query: text,
    conversationId: conversationId ?? activeConversationId,
  });

const persistUserMessage = (text: string, timestamp: number, conversationId?: string): void => {
  const activeId = ensureActiveConversation(timestamp, undefined, conversationId);
  if (!memoryDb || !activeId) {
    return;
  }

  memoryDb.appendMessage({
    id: `user-${randomUUID()}`,
    conversationId: activeId,
    role: "user",
    content: text,
    timestamp,
  });
};

const persistPendingToolCalls = (messageId: string): void => {
  if (!memoryDb) {
    return;
  }

  for (const toolCall of pendingToolCalls.values()) {
    memoryDb.upsertToolCall({
      messageId,
      ...toolCall,
    });
  }
  pendingToolCalls.clear();
};

const persistAssistantMessage = (
  id: string,
  text: string,
  timestamp: number,
  options: { autoSpeak?: boolean; wasAborted?: boolean } = {},
): void => {
  const conversationId = ensureActiveConversation(timestamp);
  if (!memoryDb || !conversationId) {
    return;
  }

  memoryDb.appendMessage({
    id,
    conversationId,
    role: "assistant",
    content: text,
    timestamp,
    autoSpeak: options.autoSpeak,
    wasAborted: options.wasAborted,
  });
  persistPendingToolCalls(id);
};

const mapStoredConversationMessage = (message: ConversationMessageRecord): ConversationMessage | null => {
  if (message.role !== "user" && message.role !== "assistant") {
    return null;
  }

  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    wasAborted: message.wasAborted,
    autoSpeak: message.autoSpeak,
    toolCalls: message.toolCalls.map((toolCall) => ({
      callId: toolCall.callId ?? undefined,
      name: toolCall.name,
      args: toolCall.args,
      result: toolCall.result,
      status: toolCall.status ?? undefined,
      details: toolCall.details ?? undefined,
    })),
  };
};

const mapStoredConversationSummary = (conversation: ConversationSummary): StoredConversationSummary => ({
  id: conversation.id,
  title: conversation.title,
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
  lastMessageAt: conversation.lastMessageAt,
  lastViewedAt: conversation.lastViewedAt,
  messageCount: conversation.messageCount,
});

const mapStoredConversation = (conversation: ConversationRecord | null): StoredConversation | null => {
  if (!conversation) {
    return null;
  }

  return {
    ...mapStoredConversationSummary(conversation),
    messages: conversation.messages.flatMap((message) => {
      const mapped = mapStoredConversationMessage(message);
      return mapped ? [mapped] : [];
    }),
  };
};

const sameVoiceConfiguration = (left: VoiceConfiguration, right: VoiceConfiguration): boolean =>
  left.whisperModel === right.whisperModel &&
  left.wakeWordProvider === right.wakeWordProvider &&
  left.openWakeWordThreshold === right.openWakeWordThreshold;

const createWakeWordProvider = (env: Env, config: VoiceConfiguration): WakeWordProvider => {
  if (config.wakeWordProvider === "none") {
    return new NullWakeWordProvider();
  }

  if (config.wakeWordProvider === "porcupine") {
    if (!env.PICOVOICE_ACCESS_KEY?.trim()) {
      logger.warn("Wake-word provider is set to porcupine but PICOVOICE_ACCESS_KEY is missing; wake word disabled");
      return new NullWakeWordProvider();
    }

    const wakeWordModelPath = env.WAKE_WORD_MODEL ? resolveAppPath(env.WAKE_WORD_MODEL) : undefined;
    if (wakeWordModelPath && !existsSync(wakeWordModelPath)) {
      logger.warn({ wakeWordModelPath }, "Wake word model file not found; falling back to built-in Porcupine keyword");
    }

    return new PorcupineWakeWordProvider(
      {
        accessKey: env.PICOVOICE_ACCESS_KEY,
        keyword: "porcupine",
        keywordPath: wakeWordModelPath && existsSync(wakeWordModelPath) ? wakeWordModelPath : undefined,
      },
      logger,
    );
  }

  return new OpenWakeWordProvider(
    {
      runtimeDir: env.OPENWAKEWORD_RUNTIME_DIR,
      workerPath: env.OPENWAKEWORD_WORKER_PATH,
      modelPath: env.OPENWAKEWORD_MODEL_PATH,
      modelName: env.OPENWAKEWORD_MODEL_NAME,
      threshold: config.openWakeWordThreshold,
    },
    logger,
  );
};

const createConfiguredVoicePipeline = async (env: Env, config: VoiceConfiguration): Promise<VoicePipeline> => {
  if (!bus) {
    throw new Error("Voice pipeline requires an initialized event bus");
  }

  const capture = new AudioCapture({}, logger);
  const wakeWord = createWakeWordProvider(env, config);
  const stt = new WhisperSttProvider(config.whisperModel, logger);
  const pipeline = new VoicePipeline(capture, wakeWord, stt, bus, logger);
  await pipeline.start();
  pipeline.setMuted(!wakeWordEnabled);
  return pipeline;
};

const applyVoiceConfiguration = async (settings: Partial<UserSettings>): Promise<void> => {
  if (!backendEnv) {
    return;
  }

  const nextConfiguration = getVoiceConfiguration(backendEnv, settings);
  const previousConfiguration = voiceConfiguration ?? getVoiceConfiguration(backendEnv);
  if (sameVoiceConfiguration(previousConfiguration, nextConfiguration)) {
    voiceConfiguration = nextConfiguration;
    return;
  }

  const previousPipeline = voicePipeline;
  if (previousPipeline) {
    await previousPipeline.stop();
    voicePipeline = null;
  }

  try {
    voicePipeline = await createConfiguredVoicePipeline(backendEnv, nextConfiguration);
    voiceConfiguration = nextConfiguration;
  } catch (error) {
    try {
      voicePipeline = await createConfiguredVoicePipeline(backendEnv, previousConfiguration);
      voiceConfiguration = previousConfiguration;
    } catch (restoreError) {
      voicePipeline = null;
      logger.error({ error: restoreError }, "Failed to restore the previous voice configuration");
    }
    throw error;
  }
};

const requestUpgradeProposal = async (proposal: UpgradeProposal): Promise<void> => {
  if (!process.send) {
    throw new Error("Upgrade proposals are unavailable without a parent process");
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingUpgradeProposalResponses.delete(proposal.proposalId);
      reject(new Error("Timed out waiting for upgrade proposal acknowledgement"));
    }, 10_000);

    pendingUpgradeProposalResponses.set(proposal.proposalId, {
      resolve: () => {
        clearTimeout(timeout);
        resolve();
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
      timeout,
    });

    process.send?.({
      type: "upgrade:propose",
      proposal,
    });
  });
};

const shutdown = async (signal: NodeJS.Signals | "manual") => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, "Shutting down backend");

  unsubscribeTransport?.();
  await voicePipeline?.stop();
  ttsPlayback?.dispose();
  await copilotManager?.shutdown();
  await mcpRegistry?.shutdown();
  memoryDb?.close();
  transport?.close();
  bus?.removeAllListeners();

  unsubscribeTransport = null;
  copilotManager = null;
  mcpRegistry = null;
  transport = null;
  voicePipeline = null;
  ttsPlayback = null;
  backendEnv = null;
  voiceConfiguration = null;
  wakeWordEnabled = true;
  speechEnabled = true;
  memoryDb = null;
  activeConversationId = null;
  server = null;
  bus = null;
};

const handleClientMessage = async (message: ClientMessage): Promise<void> => {
  if (message.type === "ping" || message.type === "handshake") {
    transport?.send({
      type: "pong",
      protocolVersion: PROTOCOL_VERSION,
      backendBuildId: BACKEND_BUILD_ID,
    });
    if (message.type === "handshake" && message.protocolVersion !== PROTOCOL_VERSION) {
      logger.warn(
        {
          rendererProtocolVersion: message.protocolVersion,
          backendProtocolVersion: PROTOCOL_VERSION,
          rendererBuildId: message.rendererBuildId,
          backendBuildId: BACKEND_BUILD_ID,
        },
        "Renderer protocol version mismatch",
      );
    }
    return;
  }

  if (message.type === "conversation:recent:get") {
    transport?.send({
      type: "conversation:recent:result",
      requestId: message.requestId,
      conversation: mapStoredConversation(memoryDb?.getMostRecentConversation() ?? null),
    });
    return;
  }

  if (message.type === "conversation:list") {
    const limit = typeof message.limit === "number" ? message.limit : 30;
    const offset = typeof message.offset === "number" ? message.offset : 0;
    transport?.send({
      type: "conversation:list:result",
      requestId: message.requestId,
      conversations: (memoryDb?.listConversations(limit, offset) ?? []).map(mapStoredConversationSummary),
    });
    return;
  }

  if (message.type === "conversation:get") {
    transport?.send({
      type: "conversation:get:result",
      requestId: message.requestId,
      conversation: mapStoredConversation(memoryDb?.getConversation(message.conversationId) ?? null),
    });
    return;
  }

  if (message.type === "conversation:search") {
    const limit = typeof message.limit === "number" ? message.limit : 20;
    const matches: ConversationSearchMatch[] = memoryDb?.searchConversationMessages(message.query, limit) ?? [];
    transport?.send({
      type: "conversation:search:result",
      requestId: message.requestId,
      matches,
    });
    return;
  }

  if (message.type === "conversation:mark-viewed") {
    transport?.send({
      type: "conversation:mark-viewed:result",
      requestId: message.requestId,
      success: memoryDb?.markConversationViewed(message.conversationId) ?? false,
    });
    return;
  }

  if (message.type === "conversation:archive") {
    transport?.send({
      type: "conversation:archive:result",
      requestId: message.requestId,
      success: memoryDb?.archiveConversation(message.conversationId) ?? false,
    });
    return;
  }

  if (message.type === "chat:send") {
    try {
      if (message.conversationId && message.conversationId !== activeConversationId) {
        await copilotManager?.clearSession();
        pendingToolCalls.clear();
        setActiveConversation(message.conversationId);
      }
      const continuityPreamble = getContinuityPreamble(message.text, message.conversationId);
      persistUserMessage(message.text, Date.now(), message.conversationId);
      await copilotManager?.sendMessage(message.text, { continuityPreamble });
    } catch (error) {
      logger.error(
        { err: error, messageType: message.type, textLength: message.text.length },
        "Copilot chat request failed",
      );
      const alreadyReported =
        error instanceof SpiraError && (error as { reportedToClient?: boolean }).reportedToClient === true;

      if (!alreadyReported) {
        transport?.send({
          type: "error",
          ...toErrorPayload(error, "UNKNOWN_ERROR", "Failed to send message to GitHub Copilot", "copilot"),
        });
      }
    }
    return;
  }

  if (message.type === "chat:abort") {
    ttsPlayback?.stop();
    try {
      await copilotManager?.abortResponse();
      // Keep the archive clean: partial aborted assistant turns remain a transient UI artifact
      // unless Copilot emitted a finalized assistant message before the abort landed.
      pendingToolCalls.clear();
      transport?.send({ type: "chat:abort-complete" });
    } catch (error) {
      logger.error({ err: error, messageType: message.type }, "Failed to abort chat response");
      transport?.send({
        type: "error",
        ...toErrorPayload(error, "UNKNOWN_ERROR", "Failed to stop the current response", "copilot"),
      });
    }
    return;
  }

  if (message.type === "chat:reset") {
    ttsPlayback?.stop();
    try {
      await copilotManager?.clearSession();
      pendingToolCalls.clear();
      setActiveConversation(null);
      transport?.send({ type: "chat:reset-complete" });
    } catch (error) {
      logger.error({ err: error, messageType: message.type }, "Failed to clear chat session");
      transport?.send({
        type: "error",
        ...toErrorPayload(error, "UNKNOWN_ERROR", "Failed to clear chat session", "copilot"),
      });
    }
    return;
  }

  if (message.type === "chat:new-session") {
    ttsPlayback?.stop();
    try {
      const previousConversationId = message.conversationId ?? activeConversationId;
      const preservedToMemory = rememberConversationContext(previousConversationId);
      await copilotManager?.clearSession();
      pendingToolCalls.clear();
      setActiveConversation(null);
      transport?.send({ type: "chat:new-session-complete", preservedToMemory });
    } catch (error) {
      logger.error({ err: error, messageType: message.type }, "Failed to start a new chat session");
      transport?.send({
        type: "error",
        ...toErrorPayload(error, "UNKNOWN_ERROR", "Failed to start a new chat session", "copilot"),
      });
    }
    return;
  }

  if (message.type === "mcp:add-server") {
    try {
      await mcpRegistry?.addServer(message.config);
    } catch (error) {
      logger.error({ err: error, serverId: message.config.id }, "Failed to add MCP server");
      transport?.send({
        type: "error",
        ...toErrorPayload(error, "MCP_ADD_FAILED", `Failed to add MCP server ${message.config.name}`, "mcp"),
      });
    }
    return;
  }

  if (message.type === "mcp:remove-server") {
    try {
      await mcpRegistry?.removeServer(message.serverId);
    } catch (error) {
      logger.error({ err: error, serverId: message.serverId }, "Failed to remove MCP server");
      transport?.send({
        type: "error",
        ...toErrorPayload(error, "MCP_REMOVE_FAILED", `Failed to remove MCP server ${message.serverId}`, "mcp"),
      });
    }
    return;
  }

  if (message.type === "mcp:set-enabled") {
    try {
      await mcpRegistry?.setServerEnabled(message.serverId, message.enabled);
    } catch (error) {
      logger.error(
        { err: error, serverId: message.serverId, enabled: message.enabled },
        "Failed to update MCP server state",
      );
      transport?.send({
        type: "error",
        ...toErrorPayload(
          error,
          "MCP_UPDATE_FAILED",
          `Failed to ${message.enabled ? "enable" : "disable"} MCP server ${message.serverId}`,
          "mcp",
        ),
      });
    }
    return;
  }

  if (message.type === "tts:speak") {
    try {
      await ttsPlayback?.speak(message.text);
    } catch (error) {
      logger.error(
        { err: error, messageType: message.type, textLength: message.text.length },
        "Chat TTS synthesis failed",
      );
      transport?.send({
        type: "error",
        ...toErrorPayload(error, "UNKNOWN_ERROR", "Failed to synthesize chat speech", "tts"),
      });
    }
    return;
  }

  if (message.type === "tts:stop") {
    ttsPlayback?.stop();
    return;
  }

  if (message.type === "voice:toggle") {
    if (!voicePipeline) {
      logger.warn("Voice pipeline is unavailable");
      return;
    }

    wakeWordEnabled = !wakeWordEnabled;
    voicePipeline.setMuted(!wakeWordEnabled);
    return;
  }

  if (message.type === "settings:update") {
    try {
      ttsPlayback?.updateSettings(message.settings);
      if (typeof message.settings.voiceEnabled === "boolean") {
        speechEnabled = message.settings.voiceEnabled;
        if (!speechEnabled) {
          ttsPlayback?.stop();
        }
      }
      if (typeof message.settings.wakeWordEnabled === "boolean") {
        wakeWordEnabled = message.settings.wakeWordEnabled;
        voicePipeline?.setMuted(!wakeWordEnabled);
      }
      if (
        typeof message.settings.whisperModel === "string" ||
        typeof message.settings.wakeWordProvider === "string" ||
        typeof message.settings.openWakeWordThreshold === "number"
      ) {
        await applyVoiceConfiguration(message.settings);
      }
    } catch (error) {
      logger.error({ err: error, messageType: message.type }, "Failed to apply updated voice settings");
      transport?.send({
        type: "error",
        ...toErrorPayload(error, "VOICE_SETTINGS_UPDATE_FAILED", "Failed to apply updated voice settings", "voice"),
      });
    }
    return;
  }

  if (message.type === "permission:respond") {
    const handled = copilotManager?.resolvePermissionRequest(message.requestId, message.approved) ?? false;
    if (!handled) {
      logger.warn({ requestId: message.requestId }, "Received response for unknown permission request");
    }
    return;
  }

  if (message.type === "voice:push-to-talk") {
    if (!voicePipeline) {
      return;
    }

    if (message.active) {
      voicePipeline.activatePushToTalk();
    } else {
      voicePipeline.deactivatePushToTalk();
    }
    return;
  }

  if (message.type === "voice:mute") {
    wakeWordEnabled = false;
    voicePipeline?.setMuted(true);
    return;
  }

  if (message.type === "voice:unmute") {
    wakeWordEnabled = true;
    voicePipeline?.setMuted(false);
    return;
  }

  logger.debug({ message }, "Received client message");
};

const bootstrap = async () => {
  const env = createEnv();
  backendEnv = env;
  voiceConfiguration = getVoiceConfiguration(env);

  logger.info({ nodeEnv: process.env.NODE_ENV ?? "development", port: env.SPIRA_PORT }, "Starting Spira backend");

  bus = new SpiraEventBus();
  const pool = new McpClientPool(bus, logger);
  const aggregator = new McpToolAggregator(pool);
  mcpRegistry = new McpRegistry(bus, logger, pool);
  const memoryDbPath = process.env[SPIRA_MEMORY_DB_PATH_ENV];
  if (typeof memoryDbPath === "string" && memoryDbPath.trim()) {
    memoryDb = SpiraMemoryDatabase.open(memoryDbPath.trim());
    setActiveConversation(memoryDb.getSessionState(SESSION_STATE_CONVERSATION_ID_KEY));
  } else {
    logger.warn(
      { envKey: SPIRA_MEMORY_DB_PATH_ENV },
      "Memory database path is unset; conversation persistence disabled",
    );
  }
  server = new WsServer(
    bus,
    env.SPIRA_PORT,
    BACKEND_GENERATION,
    BACKEND_BUILD_ID,
    () => mcpRegistry?.getStatus() ?? [],
  );
  transport = new WsTransport(server);
  copilotManager = new CopilotSessionManager(
    bus,
    env,
    aggregator,
    requestUpgradeProposal,
    async () => {
      if (!mcpRegistry) {
        throw new Error("MCP registry is unavailable");
      }

      await mcpRegistry.reloadFromDisk();
    },
    {
      sessionPersistence: memoryDb
        ? {
            load: () => memoryDb?.getSessionState(SESSION_STATE_SESSION_ID_KEY) ?? null,
            save: (sessionId) => {
              memoryDb?.setSessionState(SESSION_STATE_SESSION_ID_KEY, sessionId);
            },
          }
        : null,
    },
  );
  ttsPlayback = new TtsPlaybackService(env, bus, logger);

  bus.on("voice:transcript", ({ text }) => {
    const continuityPreamble = getContinuityPreamble(text);
    persistUserMessage(text, Date.now());
    const acknowledgement = pickVoiceAcknowledgement(text);
    bus?.emit("chat:assistant-message", {
      id: `voice-ack-${randomUUID()}`,
      text: acknowledgement,
      timestamp: Date.now(),
      autoSpeak: true,
      persist: false,
    });

    void copilotManager?.sendVoiceMessage(text, { continuityPreamble }).catch((error) => {
      logger.error({ err: error, transcriptLength: text.length }, "Failed to forward voice transcript to Copilot");
      transport?.send({
        type: "error",
        ...toErrorPayload(error, "UNKNOWN_ERROR", "Failed to forward voice transcript to GitHub Copilot", "copilot"),
      });
    });
  });

  bus.on("chat:assistant-message", ({ id, text, timestamp, autoSpeak, persist }) => {
    if (persist === false) {
      return;
    }
    persistAssistantMessage(id, text, timestamp, { autoSpeak });
  });

  bus.on("copilot:response-end", ({ messageId, text, timestamp, autoSpeak }) => {
    persistAssistantMessage(messageId, text, timestamp, { autoSpeak });
  });

  bus.on("copilot:tool-call", (callId, toolName, args) => {
    pendingToolCalls.set(callId, {
      callId,
      name: toolName,
      args,
      status: "running",
    });
  });

  bus.on("copilot:tool-result", (callId, result) => {
    const existing = pendingToolCalls.get(callId);
    pendingToolCalls.set(callId, {
      callId,
      name: existing?.name ?? "unknown",
      args: existing?.args ?? {},
      result,
      status: "success",
      details: typeof result === "string" ? result : undefined,
    });
  });

  bus.on("copilot:error", () => {
    pendingToolCalls.clear();
  });

  bus.on("transport:client-disconnected", () => {
    copilotManager?.cancelPendingPermissionRequests();
    pendingToolCalls.clear();
  });

  unsubscribeTransport = transport.onMessage((message) => {
    handleClientMessage(message).catch((error) => {
      logger.error({ err: error, clientMessage: message }, "Unhandled error in message handler");
      transport?.send({
        type: "error",
        ...toErrorPayload(error, "UNKNOWN_ERROR", "Unhandled backend error", "backend"),
      });
    });
  });

  await mcpRegistry.initialize();

  try {
    voicePipeline = await createConfiguredVoicePipeline(env, voiceConfiguration);
  } catch (error) {
    voicePipeline = null;
    wakeWordEnabled = false;
    logger.warn({ error }, "Voice pipeline initialization failed; continuing without voice");
  }

  server.start();
  logger.info("Spira backend ready");
};

try {
  await bootstrap();
} catch (error) {
  const wrapped = error instanceof ConfigError ? error : new ConfigError("Failed to start backend", error);
  logger.error({ error: wrapped }, wrapped.message);
  void shutdown("manual").finally(() => {
    process.exit(1);
  });
}

process.on("message", (message: unknown) => {
  if (message && typeof message === "object" && (message as { type?: string }).type === "shutdown") {
    void shutdown("manual").finally(() => {
      process.exit(0);
    });
    return;
  }

  if (
    message &&
    typeof message === "object" &&
    (message as { type?: string }).type === "upgrade:proposal-response" &&
    typeof (message as { proposalId?: unknown }).proposalId === "string"
  ) {
    const response = message as {
      proposalId: string;
      accepted: boolean;
      reason?: string;
    };
    const pending = pendingUpgradeProposalResponses.get(response.proposalId);
    if (!pending) {
      return;
    }

    pendingUpgradeProposalResponses.delete(response.proposalId);
    clearTimeout(pending.timeout);
    if (response.accepted) {
      pending.resolve();
      return;
    }

    pending.reject(new Error(response.reason ?? "Upgrade proposal was rejected"));
  }
});

process.on("SIGINT", () => {
  void shutdown("SIGINT").finally(() => {
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM").finally(() => {
    process.exit(0);
  });
});
