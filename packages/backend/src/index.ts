import { type ClientMessage, parseEnv } from "@spira/shared";
import { ZodError } from "zod";
import { CopilotSessionManager } from "./copilot/session-manager.js";
import { WsServer } from "./server.js";
import { ConfigError, SpiraError } from "./util/errors.js";
import { SpiraEventBus } from "./util/event-bus.js";
import { createLogger } from "./util/logger.js";
import { WsTransport } from "./ws-transport.js";

const logger = createLogger("backend");

let server: WsServer | null = null;
let bus: SpiraEventBus | null = null;
let copilotManager: CopilotSessionManager | null = null;
let transport: WsTransport | null = null;
let unsubscribeTransport: (() => void) | null = null;
let shuttingDown = false;

const shutdown = async (signal: NodeJS.Signals | "manual") => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, "Shutting down backend");

  unsubscribeTransport?.();
  await copilotManager?.shutdown();
  transport?.close();
  bus?.removeAllListeners();

  unsubscribeTransport = null;
  copilotManager = null;
  transport = null;
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
      const alreadyReported =
        error instanceof SpiraError && (error as { reportedToClient?: boolean }).reportedToClient === true;

      if (!alreadyReported) {
        transport?.send({
          type: "error",
          code: error instanceof SpiraError ? error.code : "UNKNOWN_ERROR",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return;
  }

  if (message.type === "chat:clear") {
    try {
      await copilotManager?.clearSession();
    } catch (error) {
      transport?.send({
        type: "error",
        code: error instanceof SpiraError ? error.code : "UNKNOWN_ERROR",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  logger.debug({ message }, "Received client message");
};

const bootstrap = () => {
  const env = (() => {
    try {
      return parseEnv();
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ConfigError("Invalid backend environment configuration", error);
      }
      throw error;
    }
  })();

  logger.info({ nodeEnv: process.env.NODE_ENV ?? "development", port: env.SPIRA_PORT }, "Starting Spira backend");

  bus = new SpiraEventBus();
  server = new WsServer(bus, env.SPIRA_PORT);
  transport = new WsTransport(server);
  copilotManager = new CopilotSessionManager(bus, env);

  unsubscribeTransport = transport.onMessage((message) => {
    handleClientMessage(message).catch((error) => {
      logger.error({ error }, "Unhandled error in message handler");
      transport?.send({ type: "error", code: "UNKNOWN_ERROR", message: String(error) });
    });
  });

  server.start();
  logger.info("Spira backend ready");
};

try {
  bootstrap();
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
