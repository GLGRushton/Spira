import { randomUUID } from "node:crypto";
import type {
  ClientMessage,
  ConnectionStatus,
  ConversationSearchMatch,
  ServerMessage,
  StoredConversation,
  StoredConversationSummary,
} from "@spira/shared";
import { PROTOCOL_VERSION } from "@spira/shared";
import type { BrowserWindow, IpcMainEvent } from "electron";
import { ipcMain } from "electron";
import WebSocket from "ws";
import { updateTrayMuteState } from "./tray.js";

interface IpcBridgeOptions {
  onConnectionStatusChange?: (status: ConnectionStatus) => void;
  onBackendHello?: () => void;
  onRendererReady?: () => void;
  rendererBuildId?: string;
  isUpgrading?: () => boolean;
}

const REPLAYABLE_SERVER_MESSAGES = new Set<ServerMessage["type"]>(["mcp:status"]);
const CONVERSATION_REQUEST_TIMEOUT_MS = 10_000;

type ConversationRequestMessage = Extract<ClientMessage, { requestId: string }>;
type ConversationResponseMessage =
  | Extract<ServerMessage, { type: "conversation:recent:result" }>
  | Extract<ServerMessage, { type: "conversation:list:result" }>
  | Extract<ServerMessage, { type: "conversation:get:result" }>
  | Extract<ServerMessage, { type: "conversation:search:result" }>
  | Extract<ServerMessage, { type: "conversation:mark-viewed:result" }>
  | Extract<ServerMessage, { type: "conversation:archive:result" }>
  | Extract<ServerMessage, { type: "conversation:request-error" }>;

interface IpcBridgeRequest {
  expectedType: ConversationResponseMessage["type"];
  resolve: (value: ConversationResponseMessage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface IpcBridgeHandle {
  dispose(): void;
  getRecentConversation(): Promise<StoredConversation | null>;
  listConversations(limit?: number, offset?: number): Promise<StoredConversationSummary[]>;
  getConversation(conversationId: string): Promise<StoredConversation | null>;
  searchConversations(query: string, limit?: number): Promise<ConversationSearchMatch[]>;
  markConversationViewed(conversationId: string): Promise<boolean>;
  archiveConversation(conversationId: string): Promise<boolean>;
}

const isConversationResponseMessage = (message: ServerMessage): message is ConversationResponseMessage =>
  typeof (message as { requestId?: unknown }).requestId === "string" &&
  (message.type === "conversation:recent:result" ||
    message.type === "conversation:list:result" ||
    message.type === "conversation:get:result" ||
    message.type === "conversation:search:result" ||
    message.type === "conversation:mark-viewed:result" ||
    message.type === "conversation:archive:result" ||
    message.type === "conversation:request-error");

export function setupIpcBridge(
  win: BrowserWindow,
  backendPort: number,
  options: IpcBridgeOptions = {},
): IpcBridgeHandle {
  const pending: string[] = [];
  const rendererBuildId = options.rendererBuildId ?? "dev";
  const handshakeMessage = JSON.stringify({
    type: "handshake",
    protocolVersion: PROTOCOL_VERSION,
    rendererBuildId,
  } satisfies ClientMessage);

  let socket: WebSocket | null = null;
  let socketReady = false;
  let disposed = false;
  let reconnectAttempt = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let lastBackendGeneration: number | null = null;
  const latestServerMessages = new Map<ServerMessage["type"], ServerMessage>();
  const pendingConversationRequests = new Map<string, IpcBridgeRequest>();

  const emitConnectionStatus = (status: ConnectionStatus) => {
    options.onConnectionStatusChange?.(status);
    if (!win.isDestroyed()) {
      win.webContents.send("spira:connection-status", status);
    }
  };

  const handleRendererMessage = (_event: IpcMainEvent, message: ClientMessage) => {
    if (message.type === "ping") {
      options.onRendererReady?.();
    }

    const serialized = JSON.stringify(message);
    if (socketReady && socket?.readyState === WebSocket.OPEN) {
      socket.send(serialized);
      return;
    }
    pending.push(serialized);
  };

  const clearPendingConversationRequest = (requestId: string) => {
    const request = pendingConversationRequests.get(requestId);
    if (!request) {
      return;
    }

    clearTimeout(request.timer);
    pendingConversationRequests.delete(requestId);
  };

  const rejectPendingConversationRequests = (error: Error) => {
    for (const [requestId, request] of pendingConversationRequests.entries()) {
      clearTimeout(request.timer);
      pendingConversationRequests.delete(requestId);
      request.reject(error);
    }
  };

  const requestConversation = <TType extends ConversationResponseMessage["type"]>(
    message: ConversationRequestMessage,
    expectedType: TType,
  ): Promise<Extract<ConversationResponseMessage, { type: TType }>> =>
    new Promise<Extract<ConversationResponseMessage, { type: TType }>>((resolve, reject) => {
      if (disposed) {
        reject(new Error("IPC bridge is no longer available."));
        return;
      }

      const timer = setTimeout(() => {
        pendingConversationRequests.delete(message.requestId);
        reject(new Error("Timed out waiting for the conversation archive response."));
      }, CONVERSATION_REQUEST_TIMEOUT_MS);

      pendingConversationRequests.set(message.requestId, {
        expectedType,
        resolve: (value) => resolve(value as Extract<ConversationResponseMessage, { type: TType }>),
        reject,
        timer,
      });

      const serialized = JSON.stringify(message);
      if (socketReady && socket?.readyState === WebSocket.OPEN) {
        socket.send(serialized);
        return;
      }

      pending.push(serialized);
    });

  const forwardToRenderer = (message: ServerMessage) => {
    if (message.type === "voice:muted") {
      updateTrayMuteState(message.muted);
    }

    if (REPLAYABLE_SERVER_MESSAGES.has(message.type)) {
      latestServerMessages.set(message.type, message);
    }

    if (!win.isDestroyed()) {
      win.webContents.send("spira:from-backend", message);
    }
  };

  const replayLatestServerMessages = () => {
    if (win.isDestroyed()) {
      return;
    }

    for (const message of latestServerMessages.values()) {
      win.webContents.send("spira:from-backend", message);
    }
  };

  const clearReconnectTimer = () => {
    if (!reconnectTimer) {
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const scheduleReconnect = () => {
    if (disposed || win.isDestroyed()) {
      return;
    }

    clearReconnectTimer();
    const delay = Math.min(250 * 2 ** reconnectAttempt, 2_000);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (disposed || win.isDestroyed()) {
      return;
    }

    emitConnectionStatus("connecting");
    socketReady = false;
    socket = new WebSocket(`ws://127.0.0.1:${backendPort}`);

    socket.once("open", () => {
      socket?.send(handshakeMessage);
    });

    socket.on("message", (raw) => {
      let parsed: ServerMessage;
      try {
        parsed = JSON.parse(raw.toString()) as ServerMessage;
      } catch {
        return;
      }

      if (isConversationResponseMessage(parsed)) {
        const request = pendingConversationRequests.get(parsed.requestId);
        if (request) {
          clearPendingConversationRequest(parsed.requestId);
          if (parsed.type === "conversation:request-error") {
            request.reject(new Error(parsed.message));
            return;
          }

          if (parsed.type !== request.expectedType) {
            request.reject(
              new Error(
                `Received ${parsed.type} while waiting for ${request.expectedType}. Conversation bridge desynced.`,
              ),
            );
            return;
          }

          request.resolve(parsed as Extract<ConversationResponseMessage, { type: typeof request.expectedType }>);
          return;
        }
      }

      if (parsed.type === "backend:hello") {
        if (lastBackendGeneration !== null && parsed.generation !== lastBackendGeneration) {
          pending.length = 0;
        }
        lastBackendGeneration = parsed.generation;
        socketReady = true;
        reconnectAttempt = 0;
        emitConnectionStatus("connected");
        for (const message of pending) {
          socket?.send(message);
        }
        pending.length = 0;
      }

      forwardToRenderer(parsed);
      if (parsed.type === "backend:hello") {
        options.onBackendHello?.();
      }
    });

    socket.on("error", () => {
      socketReady = false;
    });

    socket.on("close", () => {
      socketReady = false;
      socket = null;
      rejectPendingConversationRequests(new Error("Backend disconnected before the archive request completed."));
      if (disposed) {
        return;
      }
      emitConnectionStatus(options.isUpgrading?.() ? "upgrading" : "disconnected");
      scheduleReconnect();
    });
  };

  ipcMain.on("spira:to-backend", handleRendererMessage);
  win.webContents.on("did-finish-load", replayLatestServerMessages);
  connect();

  const dispose = () => {
    disposed = true;
    clearReconnectTimer();
    ipcMain.off("spira:to-backend", handleRendererMessage);
    win.webContents.off("did-finish-load", replayLatestServerMessages);
    socketReady = false;
    rejectPendingConversationRequests(
      new Error("IPC bridge disposed while waiting for a conversation archive response."),
    );
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.close();
    }
  };

  return {
    dispose,
    getRecentConversation: () =>
      requestConversation(
        {
          type: "conversation:recent:get",
          requestId: randomUUID(),
        },
        "conversation:recent:result",
      ).then((response) => response.conversation),
    listConversations: (limit, offset) =>
      requestConversation(
        {
          type: "conversation:list",
          requestId: randomUUID(),
          limit,
          offset,
        },
        "conversation:list:result",
      ).then((response) => response.conversations),
    getConversation: (conversationId) =>
      requestConversation(
        {
          type: "conversation:get",
          requestId: randomUUID(),
          conversationId,
        },
        "conversation:get:result",
      ).then((response) => response.conversation),
    searchConversations: (query, limit) =>
      requestConversation(
        {
          type: "conversation:search",
          requestId: randomUUID(),
          query,
          limit,
        },
        "conversation:search:result",
      ).then((response) => response.matches),
    markConversationViewed: (conversationId) =>
      requestConversation(
        {
          type: "conversation:mark-viewed",
          requestId: randomUUID(),
          conversationId,
        },
        "conversation:mark-viewed:result",
      ).then((response) => response.success),
    archiveConversation: (conversationId) =>
      requestConversation(
        {
          type: "conversation:archive",
          requestId: randomUUID(),
          conversationId,
        },
        "conversation:archive:result",
      ).then((response) => response.success),
  };
}
