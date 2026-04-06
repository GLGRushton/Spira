import { parseEnv } from "@spira/shared";
import { ZodError } from "zod";
import { WsServer } from "./server.js";
import { ConfigError } from "./util/errors.js";
import { SpiraEventBus } from "./util/event-bus.js";
import { createLogger } from "./util/logger.js";
import { WsTransport } from "./ws-transport.js";

const logger = createLogger("backend");

let server: WsServer | null = null;
let bus: SpiraEventBus | null = null;
let transport: WsTransport | null = null;
let unsubscribeTransport: (() => void) | null = null;
let shuttingDown = false;

const shutdown = (signal: NodeJS.Signals | "manual") => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, "Shutting down backend");
  unsubscribeTransport?.();
  transport?.close();
  bus?.removeAllListeners();
  unsubscribeTransport = null;
  transport = null;
  server = null;
  bus = null;
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

  logger.info({ port: env.SPIRA_PORT, nodeEnv: process.env.NODE_ENV ?? "development" }, "Starting Spira backend");

  bus = new SpiraEventBus();
  server = new WsServer(bus, env.SPIRA_PORT);
  transport = new WsTransport(server);

  unsubscribeTransport = transport.onMessage((message) => {
    if (message.type === "ping") {
      transport?.send({ type: "pong" });
      return;
    }

    logger.debug({ message }, "Received client message");
  });

  server.start();
  logger.info("Spira backend ready");
};

try {
  bootstrap();
} catch (error) {
  const wrapped = error instanceof ConfigError ? error : new ConfigError("Failed to start backend", error);
  logger.error({ error: wrapped }, wrapped.message);
  shutdown("manual");
  process.exit(1);
}

process.on("message", (msg: unknown) => {
  if (msg && typeof msg === "object" && (msg as { type?: string }).type === "shutdown") {
    shutdown("manual");
    process.exit(0);
  }
});

process.on("SIGINT", () => {
  shutdown("SIGINT");
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
  process.exit(0);
});
