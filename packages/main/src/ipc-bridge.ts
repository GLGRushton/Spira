import { randomUUID } from "node:crypto";
import type {
  ClientMessage,
  ConnectionStatus,
  ConversationSearchMatch,
  ProjectRepoMappingsSnapshot,
  ServerMessage,
  StoredConversation,
  StoredConversationSummary,
  YouTrackProjectSummary,
  YouTrackStatusSummary,
  YouTrackTicketSummary,
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

const REPLAYABLE_SERVER_MESSAGES = new Set<ServerMessage["type"]>(["mcp:status", "subagent:catalog"]);
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
type YouTrackRequestMessage =
  | Extract<ClientMessage, { type: "youtrack:status:get" }>
  | Extract<ClientMessage, { type: "youtrack:tickets:list" }>
  | Extract<ClientMessage, { type: "youtrack:projects:search" }>;
type YouTrackResponseMessage =
  | Extract<ServerMessage, { type: "youtrack:status:result" }>
  | Extract<ServerMessage, { type: "youtrack:tickets:list:result" }>
  | Extract<ServerMessage, { type: "youtrack:projects:search:result" }>
  | Extract<ServerMessage, { type: "youtrack:request-error" }>;
type ProjectRequestMessage =
  | Extract<ClientMessage, { type: "projects:snapshot:get" }>
  | Extract<ClientMessage, { type: "projects:workspace-root:set" }>
  | Extract<ClientMessage, { type: "projects:mapping:set" }>;
type ProjectResponseMessage =
  | Extract<ServerMessage, { type: "projects:snapshot:result" }>
  | Extract<ServerMessage, { type: "projects:request-error" }>;
type BackendRequestMessage = ConversationRequestMessage | YouTrackRequestMessage | ProjectRequestMessage;
type BackendResponseMessage = ConversationResponseMessage | YouTrackResponseMessage | ProjectResponseMessage;

interface IpcBridgeRequest {
  expectedType: BackendResponseMessage["type"];
  resolve: (value: BackendResponseMessage) => void;
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
  getYouTrackStatus(enabled: boolean): Promise<YouTrackStatusSummary>;
  listYouTrackTickets(enabled: boolean, limit?: number): Promise<YouTrackTicketSummary[]>;
  searchYouTrackProjects(enabled: boolean, query: string, limit?: number): Promise<YouTrackProjectSummary[]>;
  getProjectRepoMappings(): Promise<ProjectRepoMappingsSnapshot>;
  setProjectWorkspaceRoot(workspaceRoot: string | null): Promise<ProjectRepoMappingsSnapshot>;
  setProjectRepoMapping(projectKey: string, repoRelativePaths: string[]): Promise<ProjectRepoMappingsSnapshot>;
}

const isBackendResponseMessage = (message: ServerMessage): message is BackendResponseMessage =>
  typeof (message as { requestId?: unknown }).requestId === "string" &&
  (message.type === "conversation:recent:result" ||
    message.type === "conversation:list:result" ||
    message.type === "conversation:get:result" ||
    message.type === "conversation:search:result" ||
    message.type === "conversation:mark-viewed:result" ||
    message.type === "conversation:archive:result" ||
    message.type === "conversation:request-error" ||
    message.type === "youtrack:status:result" ||
    message.type === "youtrack:tickets:list:result" ||
    message.type === "youtrack:projects:search:result" ||
    message.type === "youtrack:request-error" ||
    message.type === "projects:snapshot:result" ||
    message.type === "projects:request-error");

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
  const pendingRequests = new Map<string, IpcBridgeRequest>();

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

  const clearPendingRequest = (requestId: string) => {
    const request = pendingRequests.get(requestId);
    if (!request) {
      return;
    }

    clearTimeout(request.timer);
    pendingRequests.delete(requestId);
  };

  const rejectPendingRequests = (error: Error) => {
    for (const [requestId, request] of pendingRequests.entries()) {
      clearTimeout(request.timer);
      pendingRequests.delete(requestId);
      request.reject(error);
    }
  };

  const requestBackend = <TType extends BackendResponseMessage["type"]>(
    message: BackendRequestMessage,
    expectedType: TType,
  ): Promise<Extract<BackendResponseMessage, { type: TType }>> =>
    new Promise<Extract<BackendResponseMessage, { type: TType }>>((resolve, reject) => {
      if (disposed) {
        reject(new Error("IPC bridge is no longer available."));
        return;
      }

      const timer = setTimeout(() => {
        pendingRequests.delete(message.requestId);
        reject(new Error("Timed out waiting for the backend response."));
      }, CONVERSATION_REQUEST_TIMEOUT_MS);

      pendingRequests.set(message.requestId, {
        expectedType,
        resolve: (value) => resolve(value as Extract<BackendResponseMessage, { type: TType }>),
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

      if (isBackendResponseMessage(parsed)) {
        const request = pendingRequests.get(parsed.requestId);
        if (request) {
          clearPendingRequest(parsed.requestId);
          if (
            parsed.type === "conversation:request-error" ||
            parsed.type === "youtrack:request-error" ||
            parsed.type === "projects:request-error"
          ) {
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

          request.resolve(parsed as Extract<BackendResponseMessage, { type: typeof request.expectedType }>);
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
      rejectPendingRequests(new Error("Backend disconnected before the pending request completed."));
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
    rejectPendingRequests(new Error("IPC bridge disposed while waiting for a backend request response."));
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.close();
    }
  };

  return {
    dispose,
    getRecentConversation: () =>
      requestBackend(
        {
          type: "conversation:recent:get",
          requestId: randomUUID(),
        },
        "conversation:recent:result",
      ).then((response) => response.conversation),
    listConversations: (limit, offset) =>
      requestBackend(
        {
          type: "conversation:list",
          requestId: randomUUID(),
          limit,
          offset,
        },
        "conversation:list:result",
      ).then((response) => response.conversations),
    getConversation: (conversationId) =>
      requestBackend(
        {
          type: "conversation:get",
          requestId: randomUUID(),
          conversationId,
        },
        "conversation:get:result",
      ).then((response) => response.conversation),
    searchConversations: (query, limit) =>
      requestBackend(
        {
          type: "conversation:search",
          requestId: randomUUID(),
          query,
          limit,
        },
        "conversation:search:result",
      ).then((response) => response.matches),
    markConversationViewed: (conversationId) =>
      requestBackend(
        {
          type: "conversation:mark-viewed",
          requestId: randomUUID(),
          conversationId,
        },
        "conversation:mark-viewed:result",
      ).then((response) => response.success),
    archiveConversation: (conversationId) =>
      requestBackend(
        {
          type: "conversation:archive",
          requestId: randomUUID(),
          conversationId,
        },
        "conversation:archive:result",
      ).then((response) => response.success),
    getYouTrackStatus: (enabled) =>
      requestBackend(
        {
          type: "youtrack:status:get",
          requestId: randomUUID(),
          enabled,
        },
        "youtrack:status:result",
      ).then((response) => response.status),
    listYouTrackTickets: (enabled, limit) =>
      requestBackend(
        {
          type: "youtrack:tickets:list",
          requestId: randomUUID(),
          enabled,
          limit,
        },
        "youtrack:tickets:list:result",
      ).then((response) => response.tickets),
    searchYouTrackProjects: (enabled, query, limit) =>
      requestBackend(
        {
          type: "youtrack:projects:search",
          requestId: randomUUID(),
          enabled,
          query,
          limit,
        },
        "youtrack:projects:search:result",
      ).then((response) => response.projects),
    getProjectRepoMappings: () =>
      requestBackend(
        {
          type: "projects:snapshot:get",
          requestId: randomUUID(),
        },
        "projects:snapshot:result",
      ).then((response) => response.snapshot),
    setProjectWorkspaceRoot: (workspaceRoot) =>
      requestBackend(
        {
          type: "projects:workspace-root:set",
          requestId: randomUUID(),
          workspaceRoot,
        },
        "projects:snapshot:result",
      ).then((response) => response.snapshot),
    setProjectRepoMapping: (projectKey, repoRelativePaths) =>
      requestBackend(
        {
          type: "projects:mapping:set",
          requestId: randomUUID(),
          projectKey,
          repoRelativePaths,
        },
        "projects:snapshot:result",
      ).then((response) => response.snapshot),
  };
}
