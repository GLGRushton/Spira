import type { AssistantState, ClientMessage, ServerMessage, VoicePipelineState } from "@spira/shared";
import WebSocket, { WebSocketServer } from "ws";
import type { EventMap, SpiraEventBus } from "./util/event-bus.js";
import { createLogger } from "./util/logger.js";

const logger = createLogger("ws-server");
const mapVoiceStateToAssistantState = (state: VoicePipelineState): AssistantState => state;

export class WsServer {
  private server: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private readonly busListeners: Array<() => void>;
  private readonly toolCallNames = new Map<string, string>();

  constructor(
    private readonly bus: SpiraEventBus,
    private readonly port = 9720,
  ) {
    this.busListeners = [
      this.registerBusHandler("state:change", (_previous, current) => {
        this.send({ type: "state:change", state: current });
      }),
      this.registerBusHandler("copilot:delta", (messageId, delta) => {
        this.send({ type: "chat:token", token: delta, conversationId: messageId });
      }),
      this.registerBusHandler("copilot:response-end", ({ messageId, text }) => {
        this.send({
          type: "chat:message",
          message: {
            id: messageId,
            role: "assistant",
            content: text,
            timestamp: Date.now(),
          },
        });
        this.send({ type: "chat:complete", conversationId: messageId, messageId });
      }),
      this.registerBusHandler("copilot:error", (code, message) => {
        this.toolCallNames.clear();
        this.send({ type: "error", code, message });
      }),
      this.registerBusHandler("copilot:tool-call", (callId, toolName) => {
        this.toolCallNames.set(callId, toolName);
        this.send({ type: "tool:call", callId, name: toolName, status: "running" });
      }),
      this.registerBusHandler("copilot:tool-result", (callId, result) => {
        const toolName = this.toolCallNames.get(callId) ?? "unknown";
        this.toolCallNames.delete(callId);
        this.send({
          type: "tool:call",
          callId,
          name: toolName,
          status: "success",
          details: typeof result === "string" ? result : JSON.stringify(result),
        });
      }),
      this.registerBusHandler("mcp:servers-changed", (servers) => {
        this.send({ type: "mcp:status", servers });
      }),
      this.registerBusHandler("voice:pipeline", ({ state }) => {
        this.send({ type: "state:change", state: mapVoiceStateToAssistantState(state) });
      }),
      this.registerBusHandler("audio:level", ({ level }) => {
        this.send({ type: "audio:level", level });
      }),
      this.registerBusHandler("tts:amplitude", ({ amplitude }) => {
        this.send({ type: "tts:amplitude", amplitude });
      }),
      this.registerBusHandler("voice:transcript", ({ text }) => {
        this.send({ type: "voice:transcript", text });
      }),
    ];
  }

  start(): void {
    if (this.server) {
      return;
    }

    this.server = new WebSocketServer({ port: this.port });
    this.server.once("error", (error) => {
      logger.fatal({ error, port: this.port }, "WebSocket server failed to bind — exiting");
      process.exit(1);
    });
    this.server.on("listening", () => {
      this.server?.removeAllListeners("error");
      this.server?.on("error", (error) => {
        logger.error({ error, port: this.port }, "WebSocket server error");
      });
      logger.info({ port: this.port }, "WebSocket server listening");
    });
    this.server.on("connection", (socket) => this.handleConnection(socket));
  }

  stop(): void {
    if (this.client) {
      this.client.close(1001, "Server shutting down");
      this.client = null;
    }

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    for (const unsubscribe of this.busListeners) {
      unsubscribe();
    }
    this.busListeners.length = 0;
    logger.info("WebSocket server stopped");
  }

  send(message: ServerMessage): void {
    if (!this.client || this.client.readyState !== WebSocket.OPEN) {
      return;
    }

    this.client.send(JSON.stringify(message));
  }

  onMessage(handler: (message: ClientMessage) => void): () => void {
    this.bus.on("transport:client-message", handler);
    return () => {
      this.bus.off("transport:client-message", handler);
    };
  }

  private handleConnection(socket: WebSocket): void {
    if (this.client && this.client !== socket) {
      this.client.close(4000, "Superseded by a newer client");
    }

    this.client = socket;
    this.bus.emit("transport:client-connected");
    logger.info("Renderer connected");

    socket.on("message", (raw) => {
      const parsed = this.parseClientMessage(raw.toString());
      if (!parsed) {
        return;
      }
      this.bus.emit("transport:client-message", parsed);
    });

    socket.on("close", (_code, reasonBuffer) => {
      const reason = reasonBuffer.toString() || "Client disconnected";
      if (this.client === socket) {
        this.client = null;
      }
      this.bus.emit("transport:client-disconnected", reason);
      logger.info({ reason }, "Renderer disconnected");
    });

    socket.on("error", (error) => {
      logger.error({ error }, "Renderer socket error");
    });
  }

  private parseClientMessage(raw: string): ClientMessage | null {
    try {
      return JSON.parse(raw) as ClientMessage;
    } catch (error) {
      logger.warn({ error, raw }, "Ignoring invalid client payload");
      this.send({ type: "error", code: "INVALID_MESSAGE", message: "Invalid client message payload" });
      return null;
    }
  }

  private registerBusHandler<K extends keyof EventMap>(event: K, listener: (...args: EventMap[K]) => void): () => void {
    this.bus.on(event, listener);
    return () => {
      this.bus.off(event, listener);
    };
  }
}
