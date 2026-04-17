import { PROTOCOL_VERSION } from "@spira/shared";
import { PENDING_ASSISTANT_ID, useChatStore } from "../../stores/chat-store.js";
import { useMcpStore } from "../../stores/mcp-store.js";
import { useSettingsStore } from "../../stores/settings-store.js";
import { PRIMARY_STATION_ID } from "../../stores/station-store.js";
import { useUpgradeStore } from "../../stores/upgrade-store.js";
import { clearRendererTransientState, resetStationTransientState } from "./reset-transient-state.js";
import type { IpcStationTrackerMap } from "./session-tracker.js";
import { getIpcStationTracker } from "./session-tracker.js";

export interface ChatHandlerActions {
  hydrateConversation: (conversation: import("@spira/shared").StoredConversation | null, stationId?: string) => void;
  ensureStationSession: (stationId?: string) => void;
  removeStationSession: (stationId: string) => void;
  setAssistantState: (state: import("@spira/shared").AssistantState, stationId?: string) => void;
  addUserMessage: (text: string, stationId?: string) => void;
  startAssistantMessage: (id: string, stationId?: string) => void;
  appendDelta: (id: string, delta: string, stationId?: string) => void;
  finaliseMessage: (id: string, content: string, autoSpeak?: boolean, stationId?: string) => void;
  completeMessage: (id: string, stationId?: string) => void;
  abortStreamingMessage: (stationId?: string) => void;
  clearStreamingState: (stationId?: string) => void;
  addToolCall: (
    messageId: string,
    entry: import("../../stores/chat-store.js").ToolCallEntry,
    stationId?: string,
  ) => void;
  updateToolResult: (messageId: string, toolName: string, result: unknown, stationId?: string) => void;
  setActiveConversation: (conversationId: string | null, title?: string | null, stationId?: string) => void;
  setAborting: (isAborting: boolean, stationId?: string) => void;
  setResetConfirming: (isResetConfirming: boolean, stationId?: string) => void;
  setResetting: (isResetting: boolean, stationId?: string) => void;
  setSessionNotice: (notice: import("../../stores/chat-store.js").ChatSessionNotice | null, stationId?: string) => void;
  hydrateStations: (stations: import("@spira/shared").StationSummary[]) => void;
  upsertStation: (station: import("@spira/shared").StationSummary) => void;
  setStationConversation: (stationId: string, conversationId: string | null, title?: string | null) => void;
  setActiveStation: (stationId: string) => void;
  removeStation: (stationId: string) => void;
  markStationActivity: (stationId: string, updatedAt?: number) => void;
  clearRoomState: (stationId?: string) => void;
  handleRoomToolCall: (
    payload: {
      callId: string;
      name: string;
      status: import("@spira/shared").ToolCallStatus;
      args?: unknown;
      details?: string;
    },
    servers: ReturnType<typeof useMcpStore.getState>["servers"],
    stationId?: string,
  ) => void;
  clearPermissionRequests: () => void;
  clearAllActiveCaptures: (stationId?: string) => void;
  setActiveCapture: (callId: string, toolName: string, args?: unknown, stationId?: string) => void;
  clearActiveCapture: (callId: string, stationId?: string) => void;
  clearBanner: () => void;
  setConnectionStatus: (status: import("@spira/shared").ConnectionStatus) => void;
  setProtocolMismatch: (protocolVersion: number, backendBuildId: string) => void;
  clearProtocolMismatch: () => void;
  requestStationList: () => void;
}

const resolveStationId = (stationId?: string): string => stationId ?? PRIMARY_STATION_ID;

const CHAT_DELTA_BATCH_WINDOW_MS = 16;

interface PendingChatDelta {
  conversationId: string;
  stationId: string;
  delta: string;
}

export interface ChatDeltaBatcher {
  enqueue: (conversationId: string, delta: string, stationId: string) => void;
  flushConversation: (conversationId: string, stationId: string) => void;
  flushStation: (stationId: string) => void;
  dropConversation: (conversationId: string, stationId: string) => void;
  dropStation: (stationId: string) => void;
  clear: () => void;
}

const getPendingChatDeltaKey = (conversationId: string, stationId: string): string =>
  `${stationId}\u0000${conversationId}`;

const emitPendingChatDeltas = (
  pending: PendingChatDelta[],
  actions: Pick<ChatHandlerActions, "appendDelta" | "markStationActivity">,
): void => {
  if (pending.length === 0) {
    return;
  }

  const touchedStations = new Set<string>();
  for (const entry of pending) {
    actions.appendDelta(entry.conversationId, entry.delta, entry.stationId);
    touchedStations.add(entry.stationId);
  }
  for (const stationId of touchedStations) {
    actions.markStationActivity(stationId);
  }
};

export const createChatDeltaBatcher = (
  actions: Pick<ChatHandlerActions, "appendDelta" | "markStationActivity">,
): ChatDeltaBatcher => {
  const pending = new Map<string, PendingChatDelta>();
  let flushTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  const clearFlushTimer = () => {
    if (flushTimer === null) {
      return;
    }
    globalThis.clearTimeout(flushTimer);
    flushTimer = null;
  };

  const scheduleFlush = () => {
    if (flushTimer !== null) {
      return;
    }
    flushTimer = globalThis.setTimeout(() => {
      flushTimer = null;
      const entries = [...pending.values()];
      pending.clear();
      emitPendingChatDeltas(entries, actions);
    }, CHAT_DELTA_BATCH_WINDOW_MS);
  };

  const takePendingEntries = (predicate: (entry: PendingChatDelta) => boolean): PendingChatDelta[] => {
    const matches: PendingChatDelta[] = [];
    for (const [key, entry] of pending.entries()) {
      if (!predicate(entry)) {
        continue;
      }
      pending.delete(key);
      matches.push(entry);
    }
    if (pending.size === 0) {
      clearFlushTimer();
    }
    return matches;
  };

  return {
    enqueue: (conversationId, delta, stationId) => {
      const key = getPendingChatDeltaKey(conversationId, stationId);
      const existing = pending.get(key);
      pending.set(
        key,
        existing
          ? {
              ...existing,
              delta: `${existing.delta}${delta}`,
            }
          : {
              conversationId,
              stationId,
              delta,
            },
      );
      scheduleFlush();
    },
    flushConversation: (conversationId, stationId) => {
      emitPendingChatDeltas(
        takePendingEntries((entry) => entry.conversationId === conversationId && entry.stationId === stationId),
        actions,
      );
    },
    flushStation: (stationId) => {
      emitPendingChatDeltas(
        takePendingEntries((entry) => entry.stationId === stationId),
        actions,
      );
    },
    dropConversation: (conversationId, stationId) => {
      takePendingEntries((entry) => entry.conversationId === conversationId && entry.stationId === stationId);
    },
    dropStation: (stationId) => {
      takePendingEntries((entry) => entry.stationId === stationId);
    },
    clear: () => {
      pending.clear();
      clearFlushTimer();
    },
  };
};

export const registerChatHandlers = (
  trackers: IpcStationTrackerMap,
  runtimeState: { backendGeneration: number | null },
  actions: ChatHandlerActions,
): Array<() => void> => {
  const chatDeltaBatcher = createChatDeltaBatcher(actions);

  return [
    window.electronAPI.onStateChange(({ state, stationId }) => {
      actions.setAssistantState(state, resolveStationId(stationId));
    }),
    window.electronAPI.onChatDelta(({ conversationId, token, stationId }) => {
      const resolvedStationId = resolveStationId(stationId);
      const tracker = getIpcStationTracker(trackers, resolvedStationId);
      if (conversationId !== tracker.activeAssistantMessageId) {
        tracker.activeAssistantMessageId = conversationId;
        if (tracker.toolCallMessageIds.size > 0) {
          for (const [callId, mappedMessageId] of tracker.toolCallMessageIds.entries()) {
            if (mappedMessageId === PENDING_ASSISTANT_ID) {
              tracker.toolCallMessageIds.set(callId, conversationId);
            }
          }
        }
        actions.startAssistantMessage(conversationId, resolvedStationId);
      }

      chatDeltaBatcher.enqueue(conversationId, token, resolvedStationId);
    }),
    window.electronAPI.onChatMessage(({ message, stationId }) => {
      const resolvedStationId = resolveStationId(stationId);
      const tracker = getIpcStationTracker(trackers, resolvedStationId);
      if (message.role === "assistant") {
        chatDeltaBatcher.dropConversation(message.id, resolvedStationId);
        actions.markStationActivity(resolvedStationId, message.timestamp);
        actions.finaliseMessage(message.id, message.content, message.autoSpeak, resolvedStationId);
        if (
          useSettingsStore.getState().voiceEnabled &&
          message.autoSpeak !== false &&
          message.content.trim() &&
          tracker.lastAutoSpokenMessageId !== message.id
        ) {
          tracker.lastAutoSpokenMessageId = message.id;
          window.electronAPI.send({ type: "tts:speak", text: message.content });
        }
        tracker.activeAssistantMessageId = null;
        return;
      }

      if (message.role === "user") {
        actions.markStationActivity(resolvedStationId, message.timestamp);
        actions.addUserMessage(message.content, resolvedStationId);
      }
    }),
    window.electronAPI.onChatComplete(({ messageId, stationId }) => {
      const resolvedStationId = resolveStationId(stationId);
      const tracker = getIpcStationTracker(trackers, resolvedStationId);
      chatDeltaBatcher.flushConversation(messageId, resolvedStationId);
      actions.completeMessage(messageId, resolvedStationId);
      actions.setAborting(false, resolvedStationId);
      if (tracker.activeAssistantMessageId === messageId) {
        tracker.activeAssistantMessageId = null;
      }
    }),
    window.electronAPI.onChatAbortComplete(({ stationId }) => {
      const resolvedStationId = resolveStationId(stationId);
      const tracker = getIpcStationTracker(trackers, resolvedStationId);
      chatDeltaBatcher.flushStation(resolvedStationId);
      actions.abortStreamingMessage(resolvedStationId);
      actions.setAborting(false, resolvedStationId);
      tracker.activeAssistantMessageId = null;
      tracker.toolCallMessageIds.clear();
      actions.clearAllActiveCaptures(resolvedStationId);
      actions.clearRoomState(resolvedStationId);
    }),
    window.electronAPI.onChatResetComplete(({ stationId }) => {
      const resolvedStationId = resolveStationId(stationId);
      chatDeltaBatcher.dropStation(resolvedStationId);
      actions.hydrateConversation(null, resolvedStationId);
      actions.setSessionNotice(null, resolvedStationId);
      actions.setResetting(false, resolvedStationId);
    }),
    window.electronAPI.onChatNewSessionComplete(({ preservedToMemory, stationId }) => {
      const resolvedStationId = resolveStationId(stationId);
      chatDeltaBatcher.dropStation(resolvedStationId);
      actions.hydrateConversation(null, resolvedStationId);
      actions.setSessionNotice(
        {
          kind: preservedToMemory ? "info" : "warning",
          message: preservedToMemory
            ? "Started a fresh chat. The previous conversation was preserved in archive memory."
            : "Started a fresh chat. No prior conversation context was added to memory.",
        },
        resolvedStationId,
      );
      actions.setResetting(false, resolvedStationId);
    }),
    window.electronAPI.onToolCall((payload) => {
      const resolvedStationId = resolveStationId(payload.stationId);
      const tracker = getIpcStationTracker(trackers, resolvedStationId);
      const messageId = tracker.activeAssistantMessageId ?? PENDING_ASSISTANT_ID;
      if (payload.name.startsWith("vision_")) {
        if (payload.status === "running" || payload.status === "pending") {
          actions.setActiveCapture(payload.callId, payload.name, payload.args, resolvedStationId);
        } else {
          actions.clearActiveCapture(payload.callId, resolvedStationId);
        }
      }

      const shouldDisplayToolName = (name: string): boolean => name !== "report_intent";
      if (!shouldDisplayToolName(payload.name)) {
        return;
      }

      if (payload.status === "running" || payload.status === "pending") {
        tracker.toolCallMessageIds.set(payload.callId, messageId);
        actions.markStationActivity(resolvedStationId);
        actions.startAssistantMessage(messageId, resolvedStationId);
        actions.addToolCall(
          messageId,
          {
            callId: payload.callId,
            name: payload.name,
            args: payload.args ?? {},
            details: payload.details,
            status: payload.status,
          },
          resolvedStationId,
        );
        actions.handleRoomToolCall(payload, useMcpStore.getState().servers, resolvedStationId);
        return;
      }

      const mappedMessageId = tracker.toolCallMessageIds.get(payload.callId) ?? messageId;
      actions.markStationActivity(resolvedStationId);
      actions.updateToolResult(
        mappedMessageId,
        payload.name,
        {
          callId: payload.callId,
          status: payload.status,
          value: payload.details,
        },
        resolvedStationId,
      );
      actions.handleRoomToolCall(payload, useMcpStore.getState().servers, resolvedStationId);
      tracker.toolCallMessageIds.delete(payload.callId);
    }),
    window.electronAPI.onVoiceTranscript((text) => {
      actions.addUserMessage(text, PRIMARY_STATION_ID);
    }),
    window.electronAPI.onMessage((message) => {
      if (message.type === "backend:hello") {
        const hadVisibleMessages = Object.values(useChatStore.getState().sessions).some(
          (session) => session.messages.length > 0,
        );
        const generationChanged =
          runtimeState.backendGeneration !== null && runtimeState.backendGeneration !== message.generation;
        chatDeltaBatcher.clear();
        clearRendererTransientState(actions);
        if (useUpgradeStore.getState().banner?.proposalId) {
          actions.clearBanner();
        }
        if (message.protocolVersion === PROTOCOL_VERSION) {
          actions.clearProtocolMismatch();
        } else {
          actions.setProtocolMismatch(message.protocolVersion, message.backendBuildId);
        }
        if (hadVisibleMessages && (runtimeState.backendGeneration === null || generationChanged)) {
          for (const stationId of Object.keys(useChatStore.getState().sessions)) {
            actions.setSessionNotice(
              {
                kind: "warning",
                message:
                  "The renderer reconnected to Shinra. Backend context may no longer match the visible transcript.",
              },
              stationId,
            );
          }
        }
        runtimeState.backendGeneration = message.generation;
        for (const tracker of trackers.values()) {
          tracker.lastAutoSpokenMessageId = null;
          tracker.activeAssistantMessageId = null;
          tracker.toolCallMessageIds.clear();
        }
        actions.requestStationList();
        return;
      }

      if (message.type === "pong") {
        if (message.protocolVersion === PROTOCOL_VERSION) {
          actions.clearProtocolMismatch();
        } else {
          actions.setProtocolMismatch(message.protocolVersion, message.backendBuildId);
        }
        return;
      }

      if (message.type === "station:list:result") {
        actions.hydrateStations(message.stations);
        for (const station of message.stations) {
          actions.ensureStationSession(station.stationId);
          actions.setStationConversation(station.stationId, station.conversationId, station.title);
        }
        return;
      }

      if (message.type === "station:created") {
        actions.upsertStation(message.station);
        actions.ensureStationSession(message.station.stationId);
        actions.setStationConversation(
          message.station.stationId,
          message.station.conversationId,
          message.station.title,
        );
        actions.setActiveStation(message.station.stationId);
        return;
      }

      if (message.type === "station:closed") {
        chatDeltaBatcher.dropStation(message.stationId);
        actions.removeStation(message.stationId);
        actions.removeStationSession(message.stationId);
        trackers.delete(message.stationId);
      }
    }),
    window.electronAPI.onError((error) => {
      const resolvedStationId = resolveStationId(error.stationId);
      const tracker = getIpcStationTracker(trackers, resolvedStationId);
      console.error(`[Spira:${error.source ?? "unknown"}:${error.code}] ${error.message}`, error);
      if (error.details) {
        console.error(error.details);
      }
      const affectsAssistantState = error.source !== "tts" && error.source !== "mcp" && error.source !== "subagent";
      if (affectsAssistantState) {
        chatDeltaBatcher.flushStation(resolvedStationId);
        actions.setAssistantState("error", resolvedStationId);
        resetStationTransientState(actions, resolvedStationId);
        tracker.activeAssistantMessageId = null;
        tracker.toolCallMessageIds.clear();
      }
      if (error.code === "BACKEND_SOCKET_ERROR" || error.code === "BACKEND_CRASHED" || error.code === "BACKEND_FATAL") {
        actions.setConnectionStatus("disconnected");
        actions.clearPermissionRequests();
        actions.clearAllActiveCaptures();
        actions.clearRoomState();
      }
    }),
    () => {
      chatDeltaBatcher.clear();
    },
  ];
};
