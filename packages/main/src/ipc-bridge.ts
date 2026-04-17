import { randomUUID } from "node:crypto";
import type {
  CancelTicketRunWorkResult,
  ClientMessage,
  CommitTicketRunResult,
  CompleteTicketRunResult,
  ConnectionStatus,
  ContinueTicketRunWorkResult,
  ConversationSearchMatch,
  CreateTicketRunPullRequestResult,
  GenerateTicketRunCommitDraftResult,
  MissionServiceSnapshot,
  ProjectRepoMappingsSnapshot,
  RetryTicketRunSyncResult,
  ServerMessage,
  SetTicketRunCommitDraftResult,
  StartTicketRunRequest,
  StartTicketRunResult,
  StartTicketRunWorkResult,
  StoredConversation,
  StoredConversationSummary,
  SyncTicketRunRemoteResult,
  TicketRunGitStateResult,
  TicketRunSnapshot,
  YouTrackProjectSummary,
  YouTrackStateMapping,
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

const REPLAYABLE_SERVER_MESSAGES = new Set<ServerMessage["type"]>([
  "mcp:status",
  "subagent:catalog",
  "missions:runs:updated",
]);
const DEFAULT_BACKEND_REQUEST_TIMEOUT_MS = 10_000;
const MISSION_GIT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_PENDING_MESSAGES = 200;

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
  | Extract<ClientMessage, { type: "youtrack:projects:search" }>
  | Extract<ClientMessage, { type: "youtrack:state-mapping:set" }>;
type YouTrackResponseMessage =
  | Extract<ServerMessage, { type: "youtrack:status:result" }>
  | Extract<ServerMessage, { type: "youtrack:tickets:list:result" }>
  | Extract<ServerMessage, { type: "youtrack:projects:search:result" }>
  | Extract<ServerMessage, { type: "youtrack:state-mapping:set:result" }>
  | Extract<ServerMessage, { type: "youtrack:request-error" }>;
type ProjectRequestMessage =
  | Extract<ClientMessage, { type: "projects:snapshot:get" }>
  | Extract<ClientMessage, { type: "projects:workspace-root:set" }>
  | Extract<ClientMessage, { type: "projects:mapping:set" }>;
type ProjectResponseMessage =
  | Extract<ServerMessage, { type: "projects:snapshot:result" }>
  | Extract<ServerMessage, { type: "projects:request-error" }>;
type MissionsRequestMessage =
  | Extract<ClientMessage, { type: "missions:runs:get" }>
  | Extract<ClientMessage, { type: "missions:ticket-run:start" }>
  | Extract<ClientMessage, { type: "missions:ticket-run:sync" }>
  | Extract<ClientMessage, { type: "missions:ticket-run:work:start" }>
  | Extract<ClientMessage, { type: "missions:ticket-run:work:continue" }>
  | Extract<ClientMessage, { type: "missions:ticket-run:work:cancel" }>
  | Extract<ClientMessage, { type: "missions:ticket-run:complete" }>
  | Extract<ClientMessage, { type: "missions:ticket-run:git-state:get" }>
  | Extract<ClientMessage, { type: "missions:ticket-run:commit-draft:generate" }>
  | Extract<ClientMessage, { type: "missions:ticket-run:commit-draft:set" }>
  | Extract<ClientMessage, { type: "missions:ticket-run:commit" }>
  | Extract<ClientMessage, { type: "missions:ticket-run:publish" }>
  | Extract<ClientMessage, { type: "missions:ticket-run:push" }>
  | Extract<ClientMessage, { type: "missions:ticket-run:pull-request:create" }>
  | Extract<ClientMessage, { type: "missions:ticket-run:services:get" }>
  | Extract<ClientMessage, { type: "missions:ticket-run:service:start" }>
  | Extract<ClientMessage, { type: "missions:ticket-run:service:stop" }>;
type MissionsResponseMessage =
  | Extract<ServerMessage, { type: "missions:runs:result" }>
  | Extract<ServerMessage, { type: "missions:ticket-run:start:result" }>
  | Extract<ServerMessage, { type: "missions:ticket-run:sync:result" }>
  | Extract<ServerMessage, { type: "missions:ticket-run:work:start:result" }>
  | Extract<ServerMessage, { type: "missions:ticket-run:work:continue:result" }>
  | Extract<ServerMessage, { type: "missions:ticket-run:work:cancel:result" }>
  | Extract<ServerMessage, { type: "missions:ticket-run:complete:result" }>
  | Extract<ServerMessage, { type: "missions:ticket-run:git-state:result" }>
  | Extract<ServerMessage, { type: "missions:ticket-run:commit-draft:generate:result" }>
  | Extract<ServerMessage, { type: "missions:ticket-run:commit-draft:set:result" }>
  | Extract<ServerMessage, { type: "missions:ticket-run:commit:result" }>
  | Extract<ServerMessage, { type: "missions:ticket-run:publish:result" }>
  | Extract<ServerMessage, { type: "missions:ticket-run:push:result" }>
  | Extract<ServerMessage, { type: "missions:ticket-run:pull-request:create:result" }>
  | Extract<ServerMessage, { type: "missions:ticket-run:services:get:result" }>
  | Extract<ServerMessage, { type: "missions:ticket-run:service:start:result" }>
  | Extract<ServerMessage, { type: "missions:ticket-run:service:stop:result" }>
  | Extract<ServerMessage, { type: "missions:request-error" }>;
type BackendRequestMessage =
  | ConversationRequestMessage
  | YouTrackRequestMessage
  | ProjectRequestMessage
  | MissionsRequestMessage;
type BackendResponseMessage =
  | ConversationResponseMessage
  | YouTrackResponseMessage
  | ProjectResponseMessage
  | MissionsResponseMessage;

interface IpcBridgeRequest {
  expectedType: BackendResponseMessage["type"];
  resolve: (value: BackendResponseMessage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface PendingOutboundMessage {
  serialized: string;
  onDropped?: (reason: "overflow" | "generation-change") => void;
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
  setYouTrackStateMapping(enabled: boolean, mapping: YouTrackStateMapping): Promise<YouTrackStatusSummary>;
  getProjectRepoMappings(): Promise<ProjectRepoMappingsSnapshot>;
  setProjectWorkspaceRoot(workspaceRoot: string | null): Promise<ProjectRepoMappingsSnapshot>;
  setProjectRepoMapping(projectKey: string, repoRelativePaths: string[]): Promise<ProjectRepoMappingsSnapshot>;
  getTicketRuns(): Promise<TicketRunSnapshot>;
  startTicketRun(ticket: StartTicketRunRequest): Promise<StartTicketRunResult>;
  retryTicketRunSync(runId: string): Promise<RetryTicketRunSyncResult>;
  startTicketRunWork(runId: string): Promise<StartTicketRunWorkResult>;
  continueTicketRunWork(runId: string, prompt?: string): Promise<ContinueTicketRunWorkResult>;
  cancelTicketRunWork(runId: string): Promise<CancelTicketRunWorkResult>;
  completeTicketRun(runId: string): Promise<CompleteTicketRunResult>;
  getTicketRunGitState(runId: string, repoRelativePath?: string): Promise<TicketRunGitStateResult>;
  generateTicketRunCommitDraft(runId: string, repoRelativePath?: string): Promise<GenerateTicketRunCommitDraftResult>;
  setTicketRunCommitDraft(
    runId: string,
    message: string,
    repoRelativePath?: string,
  ): Promise<SetTicketRunCommitDraftResult>;
  commitTicketRun(runId: string, message: string, repoRelativePath?: string): Promise<CommitTicketRunResult>;
  publishTicketRun(runId: string, repoRelativePath?: string): Promise<SyncTicketRunRemoteResult>;
  pushTicketRun(runId: string, repoRelativePath?: string): Promise<SyncTicketRunRemoteResult>;
  createTicketRunPullRequest(runId: string, repoRelativePath?: string): Promise<CreateTicketRunPullRequestResult>;
  getTicketRunServices(runId: string): Promise<MissionServiceSnapshot>;
  startTicketRunService(runId: string, profileId: string): Promise<MissionServiceSnapshot>;
  stopTicketRunService(runId: string, serviceId: string): Promise<MissionServiceSnapshot>;
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
    message.type === "youtrack:state-mapping:set:result" ||
    message.type === "youtrack:request-error" ||
    message.type === "projects:snapshot:result" ||
    message.type === "projects:request-error" ||
    message.type === "missions:runs:result" ||
    message.type === "missions:ticket-run:start:result" ||
    message.type === "missions:ticket-run:sync:result" ||
    message.type === "missions:ticket-run:work:start:result" ||
    message.type === "missions:ticket-run:work:continue:result" ||
    message.type === "missions:ticket-run:work:cancel:result" ||
    message.type === "missions:ticket-run:complete:result" ||
    message.type === "missions:ticket-run:git-state:result" ||
    message.type === "missions:ticket-run:commit-draft:generate:result" ||
    message.type === "missions:ticket-run:commit-draft:set:result" ||
    message.type === "missions:ticket-run:commit:result" ||
    message.type === "missions:ticket-run:publish:result" ||
    message.type === "missions:ticket-run:push:result" ||
    message.type === "missions:ticket-run:pull-request:create:result" ||
    message.type === "missions:ticket-run:services:get:result" ||
    message.type === "missions:ticket-run:service:start:result" ||
    message.type === "missions:ticket-run:service:stop:result" ||
    message.type === "missions:request-error");

export function setupIpcBridge(
  win: BrowserWindow,
  backendPort: number,
  options: IpcBridgeOptions = {},
): IpcBridgeHandle {
  const pending: PendingOutboundMessage[] = [];
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
    enqueuePendingMessage({ serialized });
  };

  const clearPendingRequest = (requestId: string) => {
    const request = pendingRequests.get(requestId);
    if (!request) {
      return;
    }

    clearTimeout(request.timer);
    pendingRequests.delete(requestId);
  };

  const enqueuePendingMessage = (entry: PendingOutboundMessage) => {
    if (pending.length >= MAX_PENDING_MESSAGES) {
      pending.shift()?.onDropped?.("overflow");
    }

    pending.push(entry);
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
    timeoutMs = DEFAULT_BACKEND_REQUEST_TIMEOUT_MS,
  ): Promise<Extract<BackendResponseMessage, { type: TType }>> =>
    new Promise<Extract<BackendResponseMessage, { type: TType }>>((resolve, reject) => {
      if (disposed) {
        reject(new Error("IPC bridge is no longer available."));
        return;
      }

      const timer = setTimeout(() => {
        pendingRequests.delete(message.requestId);
        reject(new Error("Timed out waiting for the backend response."));
      }, timeoutMs);

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

      enqueuePendingMessage({
        serialized,
        onDropped: (reason) => {
          clearPendingRequest(message.requestId);
          reject(
            new Error(
              reason === "generation-change"
                ? "Backend restarted before the queued request could be sent."
                : "Backend request queue filled while disconnected.",
            ),
          );
        },
      });
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
            parsed.type === "projects:request-error" ||
            parsed.type === "missions:request-error"
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
          for (const message of pending) {
            message.onDropped?.("generation-change");
          }
          pending.length = 0;
        }
        lastBackendGeneration = parsed.generation;
        socketReady = true;
        reconnectAttempt = 0;
        emitConnectionStatus("connected");
        for (const message of pending) {
          socket?.send(message.serialized);
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
    setYouTrackStateMapping: (enabled, mapping) =>
      requestBackend(
        {
          type: "youtrack:state-mapping:set",
          requestId: randomUUID(),
          enabled,
          mapping,
        },
        "youtrack:state-mapping:set:result",
      ).then((response) => response.status),
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
    getTicketRuns: () =>
      requestBackend(
        {
          type: "missions:runs:get",
          requestId: randomUUID(),
        },
        "missions:runs:result",
      ).then((response) => response.snapshot),
    startTicketRun: (ticket) =>
      requestBackend(
        {
          type: "missions:ticket-run:start",
          requestId: randomUUID(),
          ticket,
        },
        "missions:ticket-run:start:result",
      ).then((response) => response.result),
    retryTicketRunSync: (runId) =>
      requestBackend(
        {
          type: "missions:ticket-run:sync",
          requestId: randomUUID(),
          runId,
        },
        "missions:ticket-run:sync:result",
      ).then((response) => response.result),
    startTicketRunWork: (runId) =>
      requestBackend(
        {
          type: "missions:ticket-run:work:start",
          requestId: randomUUID(),
          runId,
        },
        "missions:ticket-run:work:start:result",
      ).then((response) => response.result),
    continueTicketRunWork: (runId, prompt) =>
      requestBackend(
        {
          type: "missions:ticket-run:work:continue",
          requestId: randomUUID(),
          runId,
          ...(prompt !== undefined ? { prompt } : {}),
        },
        "missions:ticket-run:work:continue:result",
      ).then((response) => response.result),
    cancelTicketRunWork: (runId) =>
      requestBackend(
        {
          type: "missions:ticket-run:work:cancel",
          requestId: randomUUID(),
          runId,
        },
        "missions:ticket-run:work:cancel:result",
      ).then((response) => response.result),
    completeTicketRun: (runId) =>
      requestBackend(
        {
          type: "missions:ticket-run:complete",
          requestId: randomUUID(),
          runId,
        },
        "missions:ticket-run:complete:result",
      ).then((response) => response.result),
    getTicketRunGitState: (runId, repoRelativePath) =>
      requestBackend(
        {
          type: "missions:ticket-run:git-state:get",
          requestId: randomUUID(),
          runId,
          ...(repoRelativePath ? { repoRelativePath } : {}),
        },
        "missions:ticket-run:git-state:result",
        MISSION_GIT_REQUEST_TIMEOUT_MS,
      ).then((response) => response.result),
    generateTicketRunCommitDraft: (runId, repoRelativePath) =>
      requestBackend(
        {
          type: "missions:ticket-run:commit-draft:generate",
          requestId: randomUUID(),
          runId,
          ...(repoRelativePath ? { repoRelativePath } : {}),
        },
        "missions:ticket-run:commit-draft:generate:result",
        MISSION_GIT_REQUEST_TIMEOUT_MS,
      ).then((response) => response.result),
    setTicketRunCommitDraft: (runId, message, repoRelativePath) =>
      requestBackend(
        {
          type: "missions:ticket-run:commit-draft:set",
          requestId: randomUUID(),
          runId,
          message,
          ...(repoRelativePath ? { repoRelativePath } : {}),
        },
        "missions:ticket-run:commit-draft:set:result",
      ).then((response) => response.result),
    commitTicketRun: (runId, message, repoRelativePath) =>
      requestBackend(
        {
          type: "missions:ticket-run:commit",
          requestId: randomUUID(),
          runId,
          message,
          ...(repoRelativePath ? { repoRelativePath } : {}),
        },
        "missions:ticket-run:commit:result",
      ).then((response) => response.result),
    publishTicketRun: (runId, repoRelativePath) =>
      requestBackend(
        {
          type: "missions:ticket-run:publish",
          requestId: randomUUID(),
          runId,
          ...(repoRelativePath ? { repoRelativePath } : {}),
        },
        "missions:ticket-run:publish:result",
      ).then((response) => response.result),
    pushTicketRun: (runId, repoRelativePath) =>
      requestBackend(
        {
          type: "missions:ticket-run:push",
          requestId: randomUUID(),
          runId,
          ...(repoRelativePath ? { repoRelativePath } : {}),
        },
        "missions:ticket-run:push:result",
      ).then((response) => response.result),
    createTicketRunPullRequest: (runId, repoRelativePath) =>
      requestBackend(
        {
          type: "missions:ticket-run:pull-request:create",
          requestId: randomUUID(),
          runId,
          ...(repoRelativePath ? { repoRelativePath } : {}),
        },
        "missions:ticket-run:pull-request:create:result",
      ).then((response) => response.result),
    getTicketRunServices: (runId) =>
      requestBackend(
        {
          type: "missions:ticket-run:services:get",
          requestId: randomUUID(),
          runId,
        },
        "missions:ticket-run:services:get:result",
      ).then((response) => response.services),
    startTicketRunService: (runId, profileId) =>
      requestBackend(
        {
          type: "missions:ticket-run:service:start",
          requestId: randomUUID(),
          runId,
          profileId,
        },
        "missions:ticket-run:service:start:result",
      ).then((response) => response.services),
    stopTicketRunService: (runId, serviceId) =>
      requestBackend(
        {
          type: "missions:ticket-run:service:stop",
          requestId: randomUUID(),
          runId,
          serviceId,
        },
        "missions:ticket-run:service:stop:result",
      ).then((response) => response.services),
  };
}
