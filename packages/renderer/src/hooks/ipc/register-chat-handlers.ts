import { PROTOCOL_VERSION } from "@spira/shared";
import { PENDING_ASSISTANT_ID, useChatStore } from "../../stores/chat-store.js";
import { useMcpStore } from "../../stores/mcp-store.js";
import { useSettingsStore } from "../../stores/settings-store.js";
import { useUpgradeStore } from "../../stores/upgrade-store.js";
import type { IpcSessionTracker } from "./session-tracker.js";

interface ChatHandlerActions {
  hydrateConversation: (conversation: import("@spira/shared").StoredConversation | null) => void;
  setAssistantState: (state: import("@spira/shared").AssistantState) => void;
  addUserMessage: (text: string) => void;
  startAssistantMessage: (id: string) => void;
  appendDelta: (id: string, delta: string) => void;
  finaliseMessage: (id: string, content: string, autoSpeak?: boolean) => void;
  completeMessage: (id: string) => void;
  abortStreamingMessage: () => void;
  clearStreamingState: () => void;
  addToolCall: (messageId: string, entry: import("../../stores/chat-store.js").ToolCallEntry) => void;
  updateToolResult: (messageId: string, toolName: string, result: unknown) => void;
  setAborting: (isAborting: boolean) => void;
  setResetConfirming: (isResetConfirming: boolean) => void;
  setResetting: (isResetting: boolean) => void;
  setSessionNotice: (notice: import("../../stores/chat-store.js").ChatSessionNotice | null) => void;
  clearRoomState: () => void;
  handleRoomToolCall: (
    payload: {
      callId: string;
      name: string;
      status: import("@spira/shared").ToolCallStatus;
      args?: unknown;
      details?: string;
    },
    servers: ReturnType<typeof useMcpStore.getState>["servers"],
  ) => void;
  clearPermissionRequests: () => void;
  clearAllActiveCaptures: () => void;
  setActiveCapture: (callId: string, toolName: string, args?: unknown) => void;
  clearActiveCapture: (callId: string) => void;
  clearBanner: () => void;
  setConnectionStatus: (status: import("@spira/shared").ConnectionStatus) => void;
  setProtocolMismatch: (protocolVersion: number, backendBuildId: string) => void;
  clearProtocolMismatch: () => void;
}

export const registerChatHandlers = (tracker: IpcSessionTracker, actions: ChatHandlerActions): Array<() => void> => [
  window.electronAPI.onStateChange((state) => {
    actions.setAssistantState(state);
  }),
  window.electronAPI.onChatDelta(({ conversationId, token }) => {
    if (conversationId !== tracker.activeAssistantMessageId) {
      tracker.activeAssistantMessageId = conversationId;
      if (tracker.toolCallMessageIds.size > 0) {
        for (const [callId, mappedMessageId] of tracker.toolCallMessageIds.entries()) {
          if (mappedMessageId === PENDING_ASSISTANT_ID) {
            tracker.toolCallMessageIds.set(callId, conversationId);
          }
        }
      }
      actions.startAssistantMessage(conversationId);
    }

    actions.appendDelta(conversationId, token);
  }),
  window.electronAPI.onChatMessage((message) => {
    if (message.role === "assistant") {
      actions.finaliseMessage(message.id, message.content, message.autoSpeak);
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
      actions.addUserMessage(message.content);
    }
  }),
  window.electronAPI.onChatComplete(({ messageId }) => {
    actions.completeMessage(messageId);
    actions.setAborting(false);
    if (tracker.activeAssistantMessageId === messageId) {
      tracker.activeAssistantMessageId = null;
    }
  }),
  window.electronAPI.onChatAbortComplete(() => {
    actions.abortStreamingMessage();
    actions.setAborting(false);
    tracker.activeAssistantMessageId = null;
    tracker.toolCallMessageIds.clear();
    actions.clearAllActiveCaptures();
    actions.clearRoomState();
  }),
  window.electronAPI.onChatResetComplete(() => {
    actions.hydrateConversation(null);
    actions.setSessionNotice(null);
    actions.setResetting(false);
  }),
  window.electronAPI.onChatNewSessionComplete(({ preservedToMemory }) => {
    actions.hydrateConversation(null);
    actions.setSessionNotice({
      kind: preservedToMemory ? "info" : "warning",
      message: preservedToMemory
        ? "Started a fresh chat. The previous conversation was preserved in archive memory."
        : "Started a fresh chat. No prior conversation context was added to memory.",
    });
    actions.setResetting(false);
  }),
  window.electronAPI.onToolCall((payload) => {
    const messageId = tracker.activeAssistantMessageId ?? PENDING_ASSISTANT_ID;
    if (payload.name.startsWith("vision_")) {
      if (payload.status === "running" || payload.status === "pending") {
        actions.setActiveCapture(payload.callId, payload.name, payload.args);
      } else {
        actions.clearActiveCapture(payload.callId);
      }
    }

    const shouldDisplayToolName = (name: string): boolean => name !== "report_intent";
    if (!shouldDisplayToolName(payload.name)) {
      return;
    }

    if (payload.status === "running" || payload.status === "pending") {
      tracker.toolCallMessageIds.set(payload.callId, messageId);
      actions.startAssistantMessage(messageId);
      actions.addToolCall(messageId, {
        callId: payload.callId,
        name: payload.name,
        args: payload.args ?? {},
        details: payload.details,
        status: payload.status,
      });
      actions.handleRoomToolCall(payload, useMcpStore.getState().servers);
      return;
    }

    const mappedMessageId = tracker.toolCallMessageIds.get(payload.callId) ?? messageId;
    actions.updateToolResult(mappedMessageId, payload.name, {
      callId: payload.callId,
      status: payload.status,
      value: payload.details,
    });
    actions.handleRoomToolCall(payload, useMcpStore.getState().servers);
    tracker.toolCallMessageIds.delete(payload.callId);
  }),
  window.electronAPI.onVoiceTranscript((text) => {
    actions.addUserMessage(text);
  }),
  window.electronAPI.onMessage((message) => {
    if (message.type === "backend:hello") {
      const hadVisibleMessages = useChatStore.getState().messages.length > 0;
      const generationChanged = tracker.backendGeneration !== null && tracker.backendGeneration !== message.generation;
      actions.clearStreamingState();
      actions.setAborting(false);
      actions.setResetConfirming(false);
      actions.setResetting(false);
      actions.clearPermissionRequests();
      actions.clearAllActiveCaptures();
      actions.clearRoomState();
      if (useUpgradeStore.getState().banner?.proposalId) {
        actions.clearBanner();
      }
      tracker.lastAutoSpokenMessageId = null;
      if (message.protocolVersion === PROTOCOL_VERSION) {
        actions.clearProtocolMismatch();
      } else {
        actions.setProtocolMismatch(message.protocolVersion, message.backendBuildId);
      }
      if (hadVisibleMessages && (tracker.backendGeneration === null || generationChanged)) {
        actions.setSessionNotice({
          kind: "warning",
          message: "The renderer reconnected to Shinra. Backend context may no longer match the visible transcript.",
        });
      }
      tracker.backendGeneration = message.generation;
      tracker.activeAssistantMessageId = null;
      tracker.toolCallMessageIds.clear();
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
  }),
  window.electronAPI.onError((error) => {
    console.error(`[Spira:${error.source ?? "unknown"}:${error.code}] ${error.message}`, error);
    if (error.details) {
      console.error(error.details);
    }
    if (error.source !== "tts") {
      actions.setAssistantState("error");
      actions.setAborting(false);
      actions.setResetConfirming(false);
      actions.setResetting(false);
      actions.clearStreamingState();
      tracker.activeAssistantMessageId = null;
      tracker.toolCallMessageIds.clear();
    }
    if (error.code === "BACKEND_SOCKET_ERROR" || error.code === "BACKEND_CRASHED") {
      actions.setConnectionStatus("disconnected");
      actions.clearPermissionRequests();
      actions.clearAllActiveCaptures();
      actions.clearRoomState();
    }
  }),
];
