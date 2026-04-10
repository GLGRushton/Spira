import {
  type AssistantState,
  type ClientMessage,
  type McpServerStatus,
  PROTOCOL_VERSION,
  type ServerMessage,
  type VoicePipelineState,
} from "@spira/shared";
import WebSocket, { WebSocketServer } from "ws";
import type { EventMap, SpiraEventBus } from "./util/event-bus.js";
import { createLogger } from "./util/logger.js";

const logger = createLogger("ws-server");
const mapVoiceStateToAssistantState = (state: VoicePipelineState): AssistantState => state;

export class WsServer {
  private server: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private readonly busListeners: Array<() => void>;
  private readonly toolCalls = new Map<string, { name: string; args: Record<string, unknown> }>();
  private voiceMuted = false;

  constructor(
    private readonly bus: SpiraEventBus,
    private readonly port = 9720,
    private readonly generation = 0,
    private readonly buildId = "dev",
    private readonly getMcpStatuses: () => McpServerStatus[] = () => [],
  ) {
    this.busListeners = [
      this.registerBusHandler("state:change", (_previous, current) => {
        this.send({ type: "state:change", state: current });
      }),
      this.registerBusHandler("copilot:delta", (messageId, delta) => {
        this.send({ type: "chat:token", token: delta, conversationId: messageId });
      }),
      this.registerBusHandler("copilot:response-end", ({ messageId, text, timestamp, autoSpeak }) => {
        this.send({
          type: "chat:message",
          message: {
            id: messageId,
            role: "assistant",
            content: text,
            timestamp,
            autoSpeak,
          },
        });
        this.send({ type: "chat:complete", conversationId: messageId, messageId });
      }),
      this.registerBusHandler("chat:assistant-message", ({ id, text, timestamp, autoSpeak }) => {
        this.send({
          type: "chat:message",
          message: {
            id,
            role: "assistant",
            content: text,
            timestamp,
            autoSpeak,
          },
        });
        this.send({ type: "chat:complete", conversationId: id, messageId: id });
      }),
      this.registerBusHandler("copilot:error", (code, message, details, source) => {
        this.toolCalls.clear();
        this.send({ type: "error", code, message, details, source });
      }),
      this.registerBusHandler("copilot:tool-call", (callId, toolName, args) => {
        this.toolCalls.set(callId, { name: toolName, args });
        this.send({ type: "tool:call", callId, name: toolName, status: "running", args });
      }),
      this.registerBusHandler("copilot:tool-result", (callId, result) => {
        const toolCall = this.toolCalls.get(callId) ?? { name: "unknown", args: {} };
        this.toolCalls.delete(callId);
        this.send({
          type: "tool:call",
          callId,
          name: toolCall.name,
          status: "success",
          args: toolCall.args,
          details: typeof result === "string" ? result : JSON.stringify(result),
        });
      }),
      this.registerBusHandler("copilot:permission-request", (request) => {
        this.send({ type: "permission:request", request });
      }),
      this.registerBusHandler("copilot:permission-complete", (requestId, result) => {
        this.send({ type: "permission:complete", requestId, result });
      }),
      this.registerBusHandler("mcp:servers-changed", (servers) => {
        this.send({ type: "mcp:status", servers });
      }),
      this.registerBusHandler("voice:pipeline", ({ state }) => {
        this.send({ type: "state:change", state: mapVoiceStateToAssistantState(state) });
      }),
      this.registerBusHandler("voice:muted", ({ muted }) => {
        this.voiceMuted = muted;
        this.send({ type: "voice:muted", muted });
      }),
      this.registerBusHandler("audio:level", ({ level }) => {
        this.send({ type: "audio:level", level });
      }),
      this.registerBusHandler("tts:amplitude", ({ amplitude }) => {
        this.send({ type: "tts:amplitude", amplitude });
      }),
      this.registerBusHandler("tts:audio", ({ audioBase64, mimeType }) => {
        this.send({ type: "tts:audio", audioBase64, mimeType });
      }),
      this.registerBusHandler("voice:transcript", ({ text }) => {
        this.send({ type: "voice:transcript", text });
      }),
      this.registerBusHandler("subagent:started", (event) => {
        this.send({ type: "subagent:started", event });
      }),
      this.registerBusHandler("subagent:tool-call", (event) => {
        this.send({ type: "subagent:tool-call", event });
      }),
      this.registerBusHandler("subagent:tool-result", (event) => {
        this.send({ type: "subagent:tool-result", event });
      }),
      this.registerBusHandler("subagent:delta", (event) => {
        this.send({ type: "subagent:delta", event });
      }),
      this.registerBusHandler("subagent:status", (event) => {
        this.send({ type: "subagent:status", event });
      }),
      this.registerBusHandler("subagent:completed", (event) => {
        this.send({ type: "subagent:completed", event });
      }),
      this.registerBusHandler("subagent:error", (event) => {
        this.send({ type: "subagent:error", event });
      }),
      this.registerBusHandler("subagent:lock-acquired", (event) => {
        this.send({ type: "subagent:lock-acquired", event });
      }),
      this.registerBusHandler("subagent:lock-denied", (event) => {
        this.send({ type: "subagent:lock-denied", event });
      }),
      this.registerBusHandler("subagent:lock-released", (event) => {
        this.send({ type: "subagent:lock-released", event });
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
    this.send({
      type: "backend:hello",
      generation: this.generation,
      protocolVersion: PROTOCOL_VERSION,
      backendBuildId: this.buildId,
    });
    this.send({ type: "voice:muted", muted: this.voiceMuted });
    this.send({ type: "mcp:status", servers: this.getMcpStatuses() });

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
      this.send({
        type: "error",
        code: "INVALID_MESSAGE",
        message: "Invalid client message payload",
        details: String(error),
        source: "transport",
      });
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
