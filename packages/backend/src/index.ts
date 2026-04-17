import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  type ConversationMessageRecord,
  type ConversationRecord,
  type ConversationSummary,
  SPIRA_MEMORY_DB_PATH_ENV,
  SpiraMemoryDatabase,
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
import { DEFAULT_STATION_ID, StationRegistry } from "./copilot/station-registry.js";
import { McpClientPool } from "./mcp/client-pool.js";
import { McpRegistry } from "./mcp/registry.js";
import { McpToolAggregator } from "./mcp/tool-aggregator.js";
import { fetchGitHubIdentity } from "./missions/github-identity.js";
import { MissionServiceRegistry } from "./missions/service-registry.js";
import { type GenerateCommitDraftInput, TicketRunService } from "./missions/ticket-runs.js";
import { ProjectRegistry } from "./projects/registry.js";
import { WsServer } from "./server.js";
import { SubagentRegistry } from "./subagent/registry.js";
import { resolveAppPath } from "./util/app-paths.js";
import { ConfigError, SpiraError, toErrorPayload } from "./util/errors.js";
import { SpiraEventBus } from "./util/event-bus.js";
import { createLogger } from "./util/logger.js";
import { setUnrefTimeout } from "./util/timers.js";
import { AudioCapture } from "./voice/audio-capture.js";
import { VoicePipeline } from "./voice/pipeline.js";
import { WhisperSttProvider } from "./voice/stt.js";
import { TtsPlaybackService } from "./voice/tts-playback-service.js";
import { NullWakeWordProvider } from "./voice/wake-word-null.js";
import { OpenWakeWordProvider } from "./voice/wake-word-openwakeword.js";
import { PorcupineWakeWordProvider, type WakeWordProvider } from "./voice/wake-word.js";
import { WsTransport } from "./ws-transport.js";
import {
  MANAGED_YOUTRACK_BUILTIN_DOMAIN_IDS,
  MANAGED_YOUTRACK_BUILTIN_SERVER_IDS,
  buildYouTrackBuiltinMcpServers,
  buildYouTrackBuiltinSubagents,
} from "./youtrack/builtin.js";
import { YouTrackService } from "./youtrack/service.js";

const logger = createLogger("backend");

let server: WsServer | null = null;
let bus: SpiraEventBus | null = null;
let stationRegistry: StationRegistry | null = null;
let mcpRegistry: McpRegistry | null = null;
let subagentRegistry: SubagentRegistry | null = null;
let transport: WsTransport | null = null;
let unsubscribeTransport: (() => void) | null = null;
let voicePipeline: VoicePipeline | null = null;
let ttsPlayback: TtsPlaybackService | null = null;
let backendEnv: Env | null = null;
let voiceConfiguration: VoiceConfiguration | null = null;
let wakeWordEnabled = true;
let speechEnabled = true;
let memoryDb: SpiraMemoryDatabase | null = null;
let youTrackService: YouTrackService | null = null;
let projectRegistry: ProjectRegistry | null = null;
let ticketRunService: TicketRunService | null = null;
let missionServiceRegistry: MissionServiceRegistry | null = null;

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

const buildMissionStationId = (runId: string): string => `mission:${runId}`;

const MISSION_WORKTREE_DIRECTORY_NAME = ".spira-worktrees";

const resolveMissionStationWorkingDirectory = (
  worktrees: ReadonlyArray<GenerateCommitDraftInput["run"]["worktrees"][number]>,
): string | null => {
  const firstWorktree = worktrees[0];
  if (!firstWorktree) {
    return null;
  }

  const parents = [...new Set(worktrees.map((worktree) => path.dirname(worktree.worktreePath)))];
  if (parents.length === 1 && path.basename(parents[0] ?? "") !== MISSION_WORKTREE_DIRECTORY_NAME) {
    return parents[0] ?? firstWorktree.worktreePath;
  }

  return firstWorktree.worktreePath;
};

const formatMissionStationWorktrees = (
  worktrees: ReadonlyArray<GenerateCommitDraftInput["run"]["worktrees"][number]>,
): string => worktrees.map((worktree) => `- ${worktree.repoRelativePath}: ${worktree.worktreePath}`).join("\n");

const buildMissionStationInstructions = (
  runId: string,
  ticketId: string,
  worktrees: ReadonlyArray<GenerateCommitDraftInput["run"]["worktrees"][number]>,
): string => {
  const workingDirectory = resolveMissionStationWorkingDirectory(worktrees) ?? "unknown";
  return [
    `You are operating as the dedicated Missions command station for ticket ${ticketId}.`,
    `The working directory for this station is the mission workspace at ${workingDirectory}. Stay inside it unless the user explicitly asks otherwise.`,
    `Repositories in scope:\n${formatMissionStationWorktrees(worktrees)}`,
    `Mission services are managed through Spira. Use spira_list_mission_services with run_id "${runId}" to inspect profiles, spira_start_mission_service to launch tracked services, and spira_stop_mission_service to stop them.`,
    "Treat this as an iterative coding mission: preserve context between prompts, keep the mission workspace reviewable, and report unfinished edges plainly.",
  ].join("\n");
};

const buildCommitDraftPrompt = ({ run, gitState }: GenerateCommitDraftInput): string => {
  const fileSummary = gitState.files
    .map((file) => {
      const delta =
        file.additions !== null || file.deletions !== null
          ? ` (+${file.additions ?? 0} / -${file.deletions ?? 0})`
          : "";
      return `- [${file.status}] ${file.path}${delta}`;
    })
    .join("\n");
  const patchSummary = gitState.files
    .slice(0, 6)
    .map((file) => `${file.path}\n${file.patch}`)
    .join("\n\n")
    .slice(0, 24_000);
  const latestAttempt = run.attempts.at(-1)?.summary?.trim();
  return [
    `Write only a git commit message for ticket ${run.ticketId}: ${run.ticketSummary}.`,
    "Return plain text only. No code fences. No commentary.",
    `Format exactly as: feat(${run.ticketId}): summary, then a blank line, then up to 6 '- bullet' detail lines.`,
    "Keep the summary concise and the bullets concrete.",
    `Repository: ${gitState.repoRelativePath}`,
    `Branch: ${gitState.branchName}`,
    latestAttempt ? `Last mission summary: ${latestAttempt}` : "Last mission summary: unavailable.",
    "Changed files:",
    fileSummary || "- No tracked file changes were detected.",
    patchSummary ? `Diff excerpts:\n${patchSummary}` : "No diff excerpts were available.",
  ].join("\n\n");
};

const restoreMissionStations = (registry: StationRegistry, database: SpiraMemoryDatabase | null): void => {
  if (!database) {
    return;
  }

  for (const run of database.listTicketRuns()) {
    if (!run.stationId || (run.status !== "working" && run.status !== "awaiting-review")) {
      continue;
    }

    const workingDirectory = resolveMissionStationWorkingDirectory(run.worktrees);
    if (
      !workingDirectory ||
      !existsSync(workingDirectory) ||
      run.worktrees.some((worktree) => !existsSync(worktree.worktreePath))
    ) {
      continue;
    }

    registry.createStation({
      stationId: run.stationId,
      label: `Mission ${run.ticketId}`,
      additionalInstructions: buildMissionStationInstructions(run.runId, run.ticketId, run.worktrees),
      workingDirectory,
      allowUpgradeTools: false,
    });
  }
};

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
    const timeout = setUnrefTimeout(() => {
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

const clearPendingUpgradeProposalResponses = (reason: Error): void => {
  for (const [proposalId, pending] of pendingUpgradeProposalResponses.entries()) {
    clearTimeout(pending.timeout);
    pendingUpgradeProposalResponses.delete(proposalId);
    pending.reject(reason);
  }
};

const shutdown = async (signal: NodeJS.Signals | "manual") => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, "Shutting down backend");

  clearPendingUpgradeProposalResponses(new Error("Backend is shutting down"));
  ticketRunService?.dispose();
  ticketRunService = null;
  await missionServiceRegistry?.dispose();
  missionServiceRegistry = null;
  unsubscribeTransport?.();
  await voicePipeline?.stop();
  ttsPlayback?.dispose();
  await stationRegistry?.shutdown();
  await mcpRegistry?.shutdown();
  memoryDb?.close();
  transport?.close();
  bus?.removeAllListeners();

  unsubscribeTransport = null;
  stationRegistry = null;
  mcpRegistry = null;
  transport = null;
  voicePipeline = null;
  ttsPlayback = null;
  backendEnv = null;
  voiceConfiguration = null;
  wakeWordEnabled = true;
  speechEnabled = true;
  memoryDb = null;
  youTrackService = null;
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

  if (message.type === "station:create") {
    const station = stationRegistry?.createStation({ label: message.label });
    if (station) {
      transport?.send({ type: "station:created", station });
    }
    return;
  }

  if (message.type === "station:close") {
    const closed = await stationRegistry?.closeStation(message.stationId);
    if (closed) {
      transport?.send({ type: "station:closed", stationId: message.stationId });
      return;
    }

    transport?.send({
      type: "error",
      stationId: message.stationId,
      ...toErrorPayload(
        new Error(`Unable to close station ${message.stationId}.`),
        "STATION_CLOSE_FAILED",
        `Failed to close station ${message.stationId}`,
        "backend",
      ),
    });
    return;
  }

  if (message.type === "station:list") {
    transport?.send({
      type: "station:list:result",
      requestId: message.requestId,
      stations: stationRegistry?.listStations() ?? [],
    });
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

  if (message.type === "youtrack:status:get") {
    if (!youTrackService) {
      transport?.send({
        type: "youtrack:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("YouTrack service is unavailable."),
          "YOUTRACK_UNAVAILABLE",
          "YouTrack service is unavailable.",
          "youtrack",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "youtrack:status:result",
        requestId: message.requestId,
        status: await youTrackService.getStatus(message.enabled),
      });
    } catch (error) {
      logger.error({ err: error, requestId: message.requestId }, "Failed to get YouTrack status");
      transport?.send({
        type: "youtrack:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "YOUTRACK_STATUS_FAILED", "Failed to get YouTrack status.", "youtrack"),
      });
    }
    return;
  }

  if (message.type === "youtrack:tickets:list") {
    if (!youTrackService) {
      transport?.send({
        type: "youtrack:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("YouTrack service is unavailable."),
          "YOUTRACK_UNAVAILABLE",
          "YouTrack service is unavailable.",
          "youtrack",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "youtrack:tickets:list:result",
        requestId: message.requestId,
        tickets: await youTrackService.listAssignedTickets(message.enabled, message.limit),
      });
    } catch (error) {
      logger.error({ err: error, requestId: message.requestId }, "Failed to list assigned YouTrack tickets");
      transport?.send({
        type: "youtrack:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "YOUTRACK_TICKETS_FAILED", "Failed to list assigned YouTrack tickets.", "youtrack"),
      });
    }
    return;
  }

  if (message.type === "youtrack:projects:search") {
    if (!youTrackService) {
      transport?.send({
        type: "youtrack:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("YouTrack service is unavailable."),
          "YOUTRACK_UNAVAILABLE",
          "YouTrack service is unavailable.",
          "youtrack",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "youtrack:projects:search:result",
        requestId: message.requestId,
        projects: await youTrackService.searchProjects(message.enabled, message.query, message.limit),
      });
    } catch (error) {
      logger.error({ err: error, requestId: message.requestId }, "Failed to search YouTrack projects");
      transport?.send({
        type: "youtrack:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "YOUTRACK_PROJECT_SEARCH_FAILED", "Failed to search YouTrack projects.", "youtrack"),
      });
    }
    return;
  }

  if (message.type === "youtrack:state-mapping:set") {
    if (!youTrackService) {
      transport?.send({
        type: "youtrack:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("YouTrack service is unavailable."),
          "YOUTRACK_UNAVAILABLE",
          "YouTrack service is unavailable.",
          "youtrack",
        ),
      });
      return;
    }

    if (!memoryDb) {
      transport?.send({
        type: "youtrack:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("YouTrack state mapping persistence is unavailable."),
          "YOUTRACK_MAPPING_PERSISTENCE_UNAVAILABLE",
          "YouTrack state mapping persistence is unavailable.",
          "youtrack",
        ),
      });
      return;
    }

    try {
      const validatedMapping = await youTrackService.validateStateMapping(message.mapping);
      memoryDb.setYouTrackStateMapping(validatedMapping);
      youTrackService.setStateMapping(validatedMapping);
      transport?.send({
        type: "youtrack:state-mapping:set:result",
        requestId: message.requestId,
        status: await youTrackService.getStatus(message.enabled),
      });
    } catch (error) {
      logger.error({ err: error, requestId: message.requestId }, "Failed to save YouTrack state mapping");
      transport?.send({
        type: "youtrack:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "YOUTRACK_STATE_MAPPING_FAILED", "Failed to save YouTrack state mapping.", "youtrack"),
      });
    }
    return;
  }

  if (message.type === "projects:snapshot:get") {
    if (!projectRegistry) {
      transport?.send({
        type: "projects:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Project registry is unavailable."),
          "PROJECTS_UNAVAILABLE",
          "Project registry is unavailable.",
          "projects",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "projects:snapshot:result",
        requestId: message.requestId,
        snapshot: await projectRegistry.getSnapshot(),
      });
    } catch (error) {
      logger.error({ err: error, requestId: message.requestId }, "Failed to get project mappings");
      transport?.send({
        type: "projects:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "PROJECTS_READ_FAILED", "Failed to get project mappings.", "projects"),
      });
    }
    return;
  }

  if (message.type === "projects:workspace-root:set") {
    if (!projectRegistry) {
      transport?.send({
        type: "projects:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Project registry is unavailable."),
          "PROJECTS_UNAVAILABLE",
          "Project registry is unavailable.",
          "projects",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "projects:snapshot:result",
        requestId: message.requestId,
        snapshot: await projectRegistry.setWorkspaceRoot(message.workspaceRoot),
      });
    } catch (error) {
      logger.error({ err: error, requestId: message.requestId }, "Failed to update workspace root");
      transport?.send({
        type: "projects:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "PROJECTS_WORKSPACE_FAILED", "Failed to update workspace root.", "projects"),
      });
    }
    return;
  }

  if (message.type === "projects:mapping:set") {
    if (!projectRegistry) {
      transport?.send({
        type: "projects:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Project registry is unavailable."),
          "PROJECTS_UNAVAILABLE",
          "Project registry is unavailable.",
          "projects",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "projects:snapshot:result",
        requestId: message.requestId,
        snapshot: await projectRegistry.setProjectMapping(message.projectKey, message.repoRelativePaths),
      });
    } catch (error) {
      logger.error({ err: error, requestId: message.requestId }, "Failed to update project repo mapping");
      transport?.send({
        type: "projects:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "PROJECTS_MAPPING_FAILED", "Failed to update project repo mapping.", "projects"),
      });
    }
    return;
  }

  if (message.type === "missions:runs:get") {
    if (!ticketRunService) {
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Ticket run service is unavailable."),
          "MISSIONS_UNAVAILABLE",
          "Missions ticket runs are unavailable.",
          "missions",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "missions:runs:result",
        requestId: message.requestId,
        snapshot: await ticketRunService.getSnapshot(),
      });
    } catch (error) {
      logger.error({ err: error, requestId: message.requestId }, "Failed to get Missions ticket runs");
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "MISSIONS_RUNS_FAILED", "Failed to load Missions ticket runs.", "missions"),
      });
    }
    return;
  }

  if (message.type === "missions:ticket-run:start") {
    if (!ticketRunService) {
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Ticket run service is unavailable."),
          "MISSIONS_UNAVAILABLE",
          "Missions ticket runs are unavailable.",
          "missions",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "missions:ticket-run:start:result",
        requestId: message.requestId,
        result: await ticketRunService.startRun(message.ticket),
      });
    } catch (error) {
      logger.error(
        { err: error, requestId: message.requestId, ticketId: message.ticket.ticketId },
        "Failed to start ticket run",
      );
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "MISSIONS_RUN_START_FAILED", "Failed to start this Missions ticket run.", "missions"),
      });
    }
    return;
  }

  if (message.type === "missions:ticket-run:sync") {
    if (!ticketRunService) {
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Ticket run service is unavailable."),
          "MISSIONS_UNAVAILABLE",
          "Missions ticket runs are unavailable.",
          "missions",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "missions:ticket-run:sync:result",
        requestId: message.requestId,
        result: await ticketRunService.retryRunSync(message.runId),
      });
    } catch (error) {
      logger.error(
        { err: error, requestId: message.requestId, runId: message.runId },
        "Failed to retry ticket run sync",
      );
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "MISSIONS_RUN_SYNC_FAILED", "Failed to retry this Missions ticket sync.", "missions"),
      });
    }
    return;
  }

  if (message.type === "missions:ticket-run:work:start") {
    if (!ticketRunService) {
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Ticket run service is unavailable."),
          "MISSIONS_UNAVAILABLE",
          "Missions ticket runs are unavailable.",
          "missions",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "missions:ticket-run:work:start:result",
        requestId: message.requestId,
        result: await ticketRunService.startWork(message.runId),
      });
    } catch (error) {
      logger.error({ err: error, requestId: message.requestId, runId: message.runId }, "Failed to start mission work");
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "MISSIONS_WORK_START_FAILED", "Failed to start this mission work pass.", "missions"),
      });
    }
    return;
  }

  if (message.type === "missions:ticket-run:work:continue") {
    if (!ticketRunService) {
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Ticket run service is unavailable."),
          "MISSIONS_UNAVAILABLE",
          "Missions ticket runs are unavailable.",
          "missions",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "missions:ticket-run:work:continue:result",
        requestId: message.requestId,
        result: await ticketRunService.continueWork(message.runId, message.prompt),
      });
    } catch (error) {
      logger.error(
        { err: error, requestId: message.requestId, runId: message.runId },
        "Failed to continue mission work",
      );
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          error,
          "MISSIONS_WORK_CONTINUE_FAILED",
          "Failed to continue this mission work pass.",
          "missions",
        ),
      });
    }
    return;
  }

  if (message.type === "missions:ticket-run:work:cancel") {
    if (!ticketRunService) {
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Ticket run service is unavailable."),
          "MISSIONS_UNAVAILABLE",
          "Missions ticket runs are unavailable.",
          "missions",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "missions:ticket-run:work:cancel:result",
        requestId: message.requestId,
        result: await ticketRunService.cancelWork(message.runId),
      });
    } catch (error) {
      logger.error({ err: error, requestId: message.requestId, runId: message.runId }, "Failed to cancel mission work");
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "MISSIONS_WORK_CANCEL_FAILED", "Failed to cancel this mission work pass.", "missions"),
      });
    }
    return;
  }

  if (message.type === "missions:ticket-run:complete") {
    if (!ticketRunService) {
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Ticket run service is unavailable."),
          "MISSIONS_UNAVAILABLE",
          "Missions ticket runs are unavailable.",
          "missions",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "missions:ticket-run:complete:result",
        requestId: message.requestId,
        result: await ticketRunService.completeRun(message.runId),
      });
    } catch (error) {
      logger.error({ err: error, requestId: message.requestId, runId: message.runId }, "Failed to complete mission");
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "MISSIONS_COMPLETE_FAILED", "Failed to mark this mission complete.", "missions"),
      });
    }
    return;
  }

  if (message.type === "missions:ticket-run:git-state:get") {
    if (!ticketRunService) {
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Ticket run service is unavailable."),
          "MISSIONS_UNAVAILABLE",
          "Missions ticket runs are unavailable.",
          "missions",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "missions:ticket-run:git-state:result",
        requestId: message.requestId,
        result: await ticketRunService.getGitState(message.runId, message.repoRelativePath),
      });
    } catch (error) {
      logger.error(
        { err: error, requestId: message.requestId, runId: message.runId },
        "Failed to load mission git state",
      );
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "MISSIONS_GIT_STATE_FAILED", "Failed to load mission git state.", "missions"),
      });
    }
    return;
  }

  if (message.type === "missions:ticket-run:commit-draft:generate") {
    if (!ticketRunService) {
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Ticket run service is unavailable."),
          "MISSIONS_UNAVAILABLE",
          "Missions ticket runs are unavailable.",
          "missions",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "missions:ticket-run:commit-draft:generate:result",
        requestId: message.requestId,
        result: await ticketRunService.generateCommitDraft(message.runId, message.repoRelativePath),
      });
    } catch (error) {
      logger.error(
        { err: error, requestId: message.requestId, runId: message.runId },
        "Failed to generate commit draft",
      );
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          error,
          "MISSIONS_COMMIT_DRAFT_FAILED",
          "Failed to generate a mission commit draft.",
          "missions",
        ),
      });
    }
    return;
  }

  if (message.type === "missions:ticket-run:commit-draft:set") {
    if (!ticketRunService) {
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Ticket run service is unavailable."),
          "MISSIONS_UNAVAILABLE",
          "Missions ticket runs are unavailable.",
          "missions",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "missions:ticket-run:commit-draft:set:result",
        requestId: message.requestId,
        result: await ticketRunService.setCommitDraft(message.runId, message.message, message.repoRelativePath),
      });
    } catch (error) {
      logger.error({ err: error, requestId: message.requestId, runId: message.runId }, "Failed to save commit draft");
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          error,
          "MISSIONS_COMMIT_DRAFT_SAVE_FAILED",
          "Failed to save the mission commit draft.",
          "missions",
        ),
      });
    }
    return;
  }

  if (message.type === "missions:ticket-run:commit") {
    if (!ticketRunService) {
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Ticket run service is unavailable."),
          "MISSIONS_UNAVAILABLE",
          "Missions ticket runs are unavailable.",
          "missions",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "missions:ticket-run:commit:result",
        requestId: message.requestId,
        result: await ticketRunService.commitRun(message.runId, message.message, message.repoRelativePath),
      });
    } catch (error) {
      logger.error(
        { err: error, requestId: message.requestId, runId: message.runId },
        "Failed to commit mission changes",
      );
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "MISSIONS_COMMIT_FAILED", "Failed to commit this mission worktree.", "missions"),
      });
    }
    return;
  }

  if (message.type === "missions:ticket-run:publish") {
    if (!ticketRunService) {
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Ticket run service is unavailable."),
          "MISSIONS_UNAVAILABLE",
          "Missions ticket runs are unavailable.",
          "missions",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "missions:ticket-run:publish:result",
        requestId: message.requestId,
        result: await ticketRunService.publishRun(message.runId, message.repoRelativePath),
      });
    } catch (error) {
      logger.error(
        { err: error, requestId: message.requestId, runId: message.runId },
        "Failed to publish mission branch",
      );
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "MISSIONS_PUBLISH_FAILED", "Failed to publish this mission branch.", "missions"),
      });
    }
    return;
  }

  if (message.type === "missions:ticket-run:push") {
    if (!ticketRunService) {
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Ticket run service is unavailable."),
          "MISSIONS_UNAVAILABLE",
          "Missions ticket runs are unavailable.",
          "missions",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "missions:ticket-run:push:result",
        requestId: message.requestId,
        result: await ticketRunService.pushRun(message.runId, message.repoRelativePath),
      });
    } catch (error) {
      logger.error({ err: error, requestId: message.requestId, runId: message.runId }, "Failed to push mission branch");
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "MISSIONS_PUSH_FAILED", "Failed to push this mission branch.", "missions"),
      });
    }
    return;
  }

  if (message.type === "missions:ticket-run:pull-request:create") {
    if (!ticketRunService) {
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Ticket run service is unavailable."),
          "MISSIONS_UNAVAILABLE",
          "Missions ticket runs are unavailable.",
          "missions",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "missions:ticket-run:pull-request:create:result",
        requestId: message.requestId,
        result: await ticketRunService.createPullRequest(message.runId, message.repoRelativePath),
      });
    } catch (error) {
      logger.error(
        { err: error, requestId: message.requestId, runId: message.runId },
        "Failed to open mission pull request",
      );
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          error,
          "MISSIONS_PULL_REQUEST_FAILED",
          "Failed to open this mission pull request.",
          "missions",
        ),
      });
    }
    return;
  }

  if (message.type === "missions:ticket-run:services:get") {
    if (!missionServiceRegistry) {
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Mission service registry is unavailable."),
          "MISSIONS_SERVICES_UNAVAILABLE",
          "Mission services are unavailable.",
          "missions",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "missions:ticket-run:services:get:result",
        requestId: message.requestId,
        services: await missionServiceRegistry.getSnapshot(message.runId),
      });
    } catch (error) {
      logger.error(
        { err: error, requestId: message.requestId, runId: message.runId },
        "Failed to get mission services",
      );
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "MISSIONS_SERVICES_GET_FAILED", "Failed to load mission services.", "missions"),
      });
    }
    return;
  }

  if (message.type === "missions:ticket-run:service:start") {
    if (!missionServiceRegistry) {
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Mission service registry is unavailable."),
          "MISSIONS_SERVICES_UNAVAILABLE",
          "Mission services are unavailable.",
          "missions",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "missions:ticket-run:service:start:result",
        requestId: message.requestId,
        services: await missionServiceRegistry.startService(message.runId, message.profileId),
      });
    } catch (error) {
      logger.error(
        { err: error, requestId: message.requestId, runId: message.runId, profileId: message.profileId },
        "Failed to start mission service",
      );
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "MISSIONS_SERVICE_START_FAILED", "Failed to start this mission service.", "missions"),
      });
    }
    return;
  }

  if (message.type === "missions:ticket-run:service:stop") {
    if (!missionServiceRegistry) {
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(
          new Error("Mission service registry is unavailable."),
          "MISSIONS_SERVICES_UNAVAILABLE",
          "Mission services are unavailable.",
          "missions",
        ),
      });
      return;
    }

    try {
      transport?.send({
        type: "missions:ticket-run:service:stop:result",
        requestId: message.requestId,
        services: await missionServiceRegistry.stopService(message.runId, message.serviceId),
      });
    } catch (error) {
      logger.error(
        { err: error, requestId: message.requestId, runId: message.runId, serviceId: message.serviceId },
        "Failed to stop mission service",
      );
      transport?.send({
        type: "missions:request-error",
        requestId: message.requestId,
        ...toErrorPayload(error, "MISSIONS_SERVICE_STOP_FAILED", "Failed to stop this mission service.", "missions"),
      });
    }
    return;
  }

  if (message.type === "chat:send") {
    try {
      await stationRegistry?.sendMessage(message.text, {
        stationId: message.stationId,
        conversationId: message.conversationId,
      });
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
          stationId: message.stationId,
          ...toErrorPayload(error, "UNKNOWN_ERROR", "Failed to send message to GitHub Copilot", "copilot"),
        });
      }
    }
    return;
  }

  if (message.type === "chat:abort") {
    ttsPlayback?.stop();
    try {
      await stationRegistry?.abortStation(message.stationId);
      transport?.send({ type: "chat:abort-complete", stationId: message.stationId ?? DEFAULT_STATION_ID });
    } catch (error) {
      logger.error({ err: error, messageType: message.type }, "Failed to abort chat response");
      transport?.send({
        type: "error",
        stationId: message.stationId,
        ...toErrorPayload(error, "UNKNOWN_ERROR", "Failed to stop the current response", "copilot"),
      });
    }
    return;
  }

  if (message.type === "chat:reset") {
    ttsPlayback?.stop();
    try {
      await stationRegistry?.resetStation(message.stationId);
      transport?.send({ type: "chat:reset-complete", stationId: message.stationId ?? DEFAULT_STATION_ID });
    } catch (error) {
      logger.error({ err: error, messageType: message.type }, "Failed to clear chat session");
      transport?.send({
        type: "error",
        stationId: message.stationId,
        ...toErrorPayload(error, "UNKNOWN_ERROR", "Failed to clear chat session", "copilot"),
      });
    }
    return;
  }

  if (message.type === "chat:new-session") {
    ttsPlayback?.stop();
    try {
      const preservedToMemory =
        (await stationRegistry?.startNewSession(message.stationId, message.conversationId)) ?? false;
      transport?.send({
        type: "chat:new-session-complete",
        preservedToMemory,
        stationId: message.stationId ?? DEFAULT_STATION_ID,
      });
    } catch (error) {
      logger.error({ err: error, messageType: message.type }, "Failed to start a new chat session");
      transport?.send({
        type: "error",
        stationId: message.stationId,
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

  if (message.type === "mcp:update-server") {
    try {
      await mcpRegistry?.updateServer(message.serverId, message.patch);
    } catch (error) {
      logger.error({ err: error, serverId: message.serverId }, "Failed to update MCP server");
      transport?.send({
        type: "error",
        ...toErrorPayload(error, "MCP_UPDATE_FAILED", `Failed to update MCP server ${message.serverId}`, "mcp"),
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

  if (message.type === "subagent:create") {
    try {
      subagentRegistry?.createCustom(message.config);
    } catch (error) {
      logger.error(
        { err: error, agentId: message.config.id, label: message.config.label },
        "Failed to create subagent",
      );
      transport?.send({
        type: "error",
        ...toErrorPayload(error, "SUBAGENT_CREATE_FAILED", "Failed to create subagent", "subagent"),
      });
    }
    return;
  }

  if (message.type === "subagent:update") {
    try {
      subagentRegistry?.updateCustom(message.agentId, message.patch);
    } catch (error) {
      logger.error({ err: error, agentId: message.agentId }, "Failed to update subagent");
      transport?.send({
        type: "error",
        ...toErrorPayload(error, "SUBAGENT_UPDATE_FAILED", `Failed to update subagent ${message.agentId}`, "subagent"),
      });
    }
    return;
  }

  if (message.type === "subagent:remove") {
    try {
      subagentRegistry?.removeCustom(message.agentId);
    } catch (error) {
      logger.error({ err: error, agentId: message.agentId }, "Failed to remove subagent");
      transport?.send({
        type: "error",
        ...toErrorPayload(error, "SUBAGENT_REMOVE_FAILED", `Failed to remove subagent ${message.agentId}`, "subagent"),
      });
    }
    return;
  }

  if (message.type === "subagent:set-ready") {
    try {
      subagentRegistry?.setReady(message.agentId, message.ready);
    } catch (error) {
      logger.error(
        { err: error, agentId: message.agentId, ready: message.ready },
        "Failed to update subagent readiness",
      );
      transport?.send({
        type: "error",
        ...toErrorPayload(
          error,
          "SUBAGENT_READY_FAILED",
          `Failed to update readiness for subagent ${message.agentId}`,
          "subagent",
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
    const handled = stationRegistry?.resolvePermissionRequest(message.requestId, message.approved) ?? false;
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
  const memoryDbPath = process.env[SPIRA_MEMORY_DB_PATH_ENV];
  if (typeof memoryDbPath === "string" && memoryDbPath.trim()) {
    memoryDb = SpiraMemoryDatabase.open(memoryDbPath.trim());
  } else {
    logger.warn(
      { envKey: SPIRA_MEMORY_DB_PATH_ENV },
      "Memory database path is unset; conversation persistence disabled",
    );
  }
  youTrackService = new YouTrackService(env, logger);
  const savedYouTrackStateMapping = memoryDb?.getYouTrackStateMapping() ?? null;
  if (savedYouTrackStateMapping) {
    youTrackService.setStateMapping(savedYouTrackStateMapping);
  }
  const pool = new McpClientPool(bus, logger);
  const aggregator = new McpToolAggregator(pool);
  const builtInYouTrackServers = buildYouTrackBuiltinMcpServers(env);
  const builtInYouTrackSubagents = buildYouTrackBuiltinSubagents(env);
  projectRegistry = new ProjectRegistry(memoryDb);
  ticketRunService = new TicketRunService({
    memoryDb,
    projectRegistry,
    youTrackService,
    logger,
    bus,
    launchMissionPass: async ({ run, prompt }) => {
      if (!stationRegistry) {
        throw new ConfigError("Mission station manager is unavailable.");
      }
      const workingDirectory = resolveMissionStationWorkingDirectory(run.worktrees);
      if (!workingDirectory) {
        throw new ConfigError(`Ticket ${run.ticketId} does not have a managed worktree.`);
      }
      const missingWorktrees = run.worktrees.filter((worktree) => !existsSync(worktree.worktreePath));
      if (missingWorktrees.length > 0) {
        throw new ConfigError(
          `Ticket ${run.ticketId} is missing managed worktrees for ${missingWorktrees
            .map((worktree) => worktree.repoRelativePath)
            .join(", ")}. Recreate the run before starting work.`,
        );
      }
      if (!existsSync(workingDirectory)) {
        throw new ConfigError(
          `Ticket ${run.ticketId} mission workspace is missing at ${workingDirectory}. Recreate the run before starting work.`,
        );
      }
      const stationId = run.stationId ?? buildMissionStationId(run.runId);
      stationRegistry.createStation({
        stationId,
        label: `Mission ${run.ticketId}`,
        additionalInstructions: buildMissionStationInstructions(run.runId, run.ticketId, run.worktrees),
        workingDirectory,
        allowUpgradeTools: false,
      });

      return {
        stationId,
        reusedLiveAttempt: run.stationId === stationId,
        completion: stationRegistry.sendMessageAndAwaitResponse(prompt, { stationId }).then((response) => ({
          status: "completed" as const,
          summary: response.text.trim() || "Mission pass completed.",
        })),
      };
    },
    cancelMissionPass: async (stationId) => {
      if (!stationRegistry) {
        throw new ConfigError("Mission station manager is unavailable.");
      }
      await stationRegistry.abortStation(stationId);
    },
    closeMissionStation: async (stationId) => {
      if (!stationRegistry) {
        throw new ConfigError("Mission station manager is unavailable.");
      }
      const closed = await stationRegistry.closeStation(stationId);
      if (closed) {
        transport?.send({ type: "station:closed", stationId });
      }
    },
    stopRunServices: async (runId) => {
      await missionServiceRegistry?.stopRunServices(runId);
    },
    generateCommitDraft: async (input) => {
      if (!stationRegistry) {
        throw new ConfigError("Mission station manager is unavailable.");
      }
      const existingStationId = input.run.stationId;
      const temporaryStationId = existingStationId ? null : `mission-commit:${input.run.runId}`;
      if (temporaryStationId) {
        stationRegistry.createStation({
          stationId: temporaryStationId,
          label: `Commit ${input.run.ticketId}`,
          additionalInstructions:
            "You are drafting a commit message only. Do not modify files, do not run write actions, and do not respond with anything except the commit message text.",
          workingDirectory: input.gitState.worktreePath,
          allowUpgradeTools: false,
        });
      }

      try {
        const response = await stationRegistry.sendMessageAndAwaitResponse(buildCommitDraftPrompt(input), {
          stationId: existingStationId ?? temporaryStationId ?? undefined,
        });
        return response.text;
      } finally {
        if (temporaryStationId) {
          await stationRegistry.closeStation(temporaryStationId).catch((error) => {
            logger.warn(
              { err: error, stationId: temporaryStationId },
              "Failed to close temporary commit draft station",
            );
          });
        }
      }
    },
    resolveMissionGitIdentity: async () => fetchGitHubIdentity(env.MISSION_GITHUB_TOKEN?.trim() ?? "", logger),
    getMissionGitToken: () => env.MISSION_GITHUB_TOKEN?.trim() ?? null,
  });
  missionServiceRegistry = new MissionServiceRegistry({
    ticketRunService,
    logger,
    bus,
  });
  mcpRegistry = new McpRegistry(
    bus,
    logger,
    pool,
    memoryDb,
    builtInYouTrackServers,
    MANAGED_YOUTRACK_BUILTIN_SERVER_IDS,
  );
  subagentRegistry = new SubagentRegistry(bus, memoryDb, builtInYouTrackSubagents, MANAGED_YOUTRACK_BUILTIN_DOMAIN_IDS);
  server = new WsServer(
    bus,
    env.SPIRA_PORT,
    BACKEND_GENERATION,
    BACKEND_BUILD_ID,
    () => mcpRegistry?.getStatus() ?? [],
    () => subagentRegistry?.listAll() ?? [],
  );
  subagentRegistry.initialize();
  transport = new WsTransport(server);
  stationRegistry = new StationRegistry({
    rootBus: bus,
    env,
    toolAggregator: aggregator,
    transport,
    memoryDb,
    subagentRegistry,
    listMissionServices: async (runId) => {
      if (!missionServiceRegistry) {
        throw new ConfigError("Mission services are unavailable.");
      }
      return missionServiceRegistry.getSnapshot(runId);
    },
    startMissionService: async (runId, profileId) => {
      if (!missionServiceRegistry) {
        throw new ConfigError("Mission services are unavailable.");
      }
      return missionServiceRegistry.startService(runId, profileId);
    },
    stopMissionService: async (runId, serviceId) => {
      if (!missionServiceRegistry) {
        throw new ConfigError("Mission services are unavailable.");
      }
      return missionServiceRegistry.stopService(runId, serviceId);
    },
    requestUpgradeProposal,
    applyHotCapabilityUpgrade: async () => {
      if (!mcpRegistry) {
        throw new Error("MCP registry is unavailable");
      }

      await mcpRegistry.reloadFromDisk();
    },
  });
  stationRegistry.createStation({ stationId: DEFAULT_STATION_ID, label: "Primary" });
  ticketRunService?.recoverInterruptedWork();
  restoreMissionStations(stationRegistry, memoryDb);
  ttsPlayback = new TtsPlaybackService(env, bus, logger);

  bus.on("voice:transcript", ({ text }) => {
    const acknowledgement = pickVoiceAcknowledgement(text);
    stationRegistry?.emitAssistantMessage(DEFAULT_STATION_ID, acknowledgement, {
      messageId: `voice-ack-${randomUUID()}`,
      timestamp: Date.now(),
      autoSpeak: true,
      persist: false,
    });

    void stationRegistry?.sendVoiceMessage(DEFAULT_STATION_ID, text).catch((error) => {
      logger.error({ err: error, transcriptLength: text.length }, "Failed to forward voice transcript to Copilot");
      transport?.send({
        type: "error",
        ...toErrorPayload(error, "UNKNOWN_ERROR", "Failed to forward voice transcript to GitHub Copilot", "copilot"),
      });
    });
  });

  bus.on("transport:client-disconnected", () => {
    stationRegistry?.handleClientDisconnected();
  });

  bus.on("missions:runs-changed", (snapshot) => {
    transport?.send({
      type: "missions:runs:updated",
      snapshot,
    });
  });
  bus.on("missions:ticket-run:services-changed", (services) => {
    transport?.send({
      type: "missions:ticket-run:services:updated",
      services,
    });
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
