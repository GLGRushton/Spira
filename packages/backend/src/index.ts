import { existsSync } from "node:fs";
import { type ClientMessage, type Env, parseEnv } from "@spira/shared";
import { ZodError } from "zod";
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
import { AudioPlayback } from "./voice/audio-playback.js";
import { VoicePipeline } from "./voice/pipeline.js";
import { WhisperSttProvider } from "./voice/stt.js";
import { PiperTtsProvider } from "./voice/tts-piper.js";
import { TtsPlaybackService } from "./voice/tts-playback-service.js";
import { ElevenLabsTtsProvider } from "./voice/tts.js";
import { WakeWordDetector } from "./voice/wake-word.js";
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
let voiceEnabled = false;
let shuttingDown = false;

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
  transport?.close();
  bus?.removeAllListeners();

  unsubscribeTransport = null;
  copilotManager = null;
  mcpRegistry = null;
  transport = null;
  voicePipeline = null;
  ttsPlayback = null;
  voiceEnabled = false;
  server = null;
  bus = null;
};

const handleClientMessage = async (message: ClientMessage): Promise<void> => {
  if (message.type === "ping") {
    transport?.send({ type: "pong" });
    return;
  }

  if (message.type === "chat:send") {
    try {
      await copilotManager?.sendMessage(message.text);
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

  if (message.type === "chat:clear") {
    ttsPlayback?.stop();
    try {
      await copilotManager?.clearSession();
    } catch (error) {
      logger.error({ err: error, messageType: message.type }, "Failed to clear chat session");
      transport?.send({
        type: "error",
        ...toErrorPayload(error, "UNKNOWN_ERROR", "Failed to clear chat session", "copilot"),
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

    try {
      if (voiceEnabled) {
        await voicePipeline.stop();
        voiceEnabled = false;
      } else {
        await voicePipeline.start();
        voiceEnabled = true;
      }
    } catch (error) {
      logger.warn({ error }, "Failed to toggle voice pipeline");
    }
    return;
  }

  if (message.type === "settings:update") {
    ttsPlayback?.updateSettings(message.settings);
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

    if (!voiceEnabled) {
      try {
        await voicePipeline.start();
        voiceEnabled = true;
      } catch (error) {
        logger.warn({ error }, "Unable to start voice pipeline for push-to-talk");
        return;
      }
    }

    if (message.active) {
      voicePipeline.activatePushToTalk();
    } else {
      voicePipeline.deactivatePushToTalk();
    }
    return;
  }

  if (message.type === "voice:mute") {
    voicePipeline?.setMuted(true);
    return;
  }

  if (message.type === "voice:unmute") {
    voicePipeline?.setMuted(false);
    return;
  }

  logger.debug({ message }, "Received client message");
};

const bootstrap = async () => {
  const env = createEnv();

  logger.info({ nodeEnv: process.env.NODE_ENV ?? "development", port: env.SPIRA_PORT }, "Starting Spira backend");

  bus = new SpiraEventBus();
  server = new WsServer(bus, env.SPIRA_PORT);
  transport = new WsTransport(server);
  const pool = new McpClientPool(bus, logger);
  const aggregator = new McpToolAggregator(pool);
  mcpRegistry = new McpRegistry(bus, logger, pool);
  copilotManager = new CopilotSessionManager(bus, env, aggregator);
  ttsPlayback = new TtsPlaybackService(env, bus, logger);

  bus.on("voice:transcript", ({ text }) => {
    void copilotManager?.sendMessage(text).catch((error) => {
      logger.error({ err: error, transcriptLength: text.length }, "Failed to forward voice transcript to Copilot");
      transport?.send({
        type: "error",
        ...toErrorPayload(error, "UNKNOWN_ERROR", "Failed to forward voice transcript to GitHub Copilot", "copilot"),
      });
    });
  });

  bus.on("transport:client-disconnected", () => {
    copilotManager?.cancelPendingPermissionRequests();
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

  if (!env.PICOVOICE_ACCESS_KEY?.trim()) {
    logger.warn("PICOVOICE_ACCESS_KEY is missing; voice pipeline disabled");
  } else {
    try {
      const capture = new AudioCapture({}, logger);
      const wakeWordModelPath = env.WAKE_WORD_MODEL ? resolveAppPath(env.WAKE_WORD_MODEL) : undefined;
      const piperModelPath = env.PIPER_MODEL ? resolveAppPath(env.PIPER_MODEL) : "";
      if (wakeWordModelPath && !existsSync(wakeWordModelPath)) {
        logger.warn({ wakeWordModelPath }, "Wake word model file not found; falling back to built-in keyword");
      }
      const wakeWord = new WakeWordDetector(
        {
          accessKey: env.PICOVOICE_ACCESS_KEY,
          keyword: "porcupine",
          keywordPath: wakeWordModelPath && existsSync(wakeWordModelPath) ? wakeWordModelPath : undefined,
        },
        logger,
      );
      const stt = new WhisperSttProvider(env.WHISPER_MODEL, logger);
      const tts = env.ELEVENLABS_API_KEY
        ? new ElevenLabsTtsProvider(
            {
              apiKey: env.ELEVENLABS_API_KEY,
              voiceId: env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM",
            },
            logger,
          )
        : new PiperTtsProvider(env.PIPER_EXECUTABLE ?? "piper", piperModelPath, logger);
      const playback = new AudioPlayback(logger);

      voicePipeline = new VoicePipeline(capture, wakeWord, stt, tts, playback, bus, logger);
      await voicePipeline.start();
      voiceEnabled = true;
    } catch (error) {
      voicePipeline = null;
      voiceEnabled = false;
      logger.warn({ error }, "Voice pipeline initialization failed; continuing without voice");
    }
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
