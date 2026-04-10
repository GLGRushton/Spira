import {
  PROTOCOL_VERSION,
  SPIRA_UI_CONTROL_BRIDGE_VERSION,
  SPIRA_UI_ROOT_VIEWS,
  type SpiraUiChatTranscript,
  type SpiraUiMessageSummary,
  type SpiraUiSnapshot,
} from "@spira/shared";
import { buildAssistantDockSummary } from "../shinra-status.js";
import { getAwaitingAssistantQuestion, getChatSession, useChatStore } from "../stores/chat-store.js";
import { useConnectionStore } from "../stores/connection-store.js";
import { useMcpStore } from "../stores/mcp-store.js";
import { useNavigationStore } from "../stores/navigation-store.js";
import { usePermissionStore } from "../stores/permission-store.js";
import { useRoomStore } from "../stores/room-store.js";
import { useSettingsStore } from "../stores/settings-store.js";
import { getStation, useStationStore } from "../stores/station-store.js";
import { useUpgradeStore } from "../stores/upgrade-store.js";
import { useVisionStore } from "../stores/vision-store.js";

const toMessageSummary = (message: {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  autoSpeak?: boolean;
  isStreaming?: boolean;
  wasAborted?: boolean;
}): SpiraUiMessageSummary => ({
  id: message.id,
  role: message.role,
  content: message.content,
  timestamp: message.timestamp,
  autoSpeak: message.autoSpeak,
  isStreaming: message.isStreaming,
  wasAborted: message.wasAborted,
});

export const buildSpiraUiChatTranscript = (limit = 100): SpiraUiChatTranscript => {
  const activeStationId = useStationStore.getState().activeStationId;
  const chat = getChatSession(useChatStore.getState(), activeStationId);
  return {
    messages: chat.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-Math.max(1, limit))
      .map((message) => toMessageSummary(message)),
  };
};

export const buildSpiraUiSnapshot = (): SpiraUiSnapshot => {
  const activeStationId = useStationStore.getState().activeStationId;
  const chat = getChatSession(useChatStore.getState(), activeStationId);
  const awaitingQuestion = getAwaitingAssistantQuestion(chat.messages);
  const lastUserMessage = [...chat.messages].reverse().find((message) => message.role === "user");
  const lastAssistantMessage = [...chat.messages].reverse().find((message) => message.role === "assistant");
  const upgrade = useUpgradeStore.getState();
  const room = useRoomStore.getState();
  const settings = useSettingsStore.getState();
  const activeView = useNavigationStore.getState().activeView;
  const assistantState = getStation(useStationStore.getState(), activeStationId).state;

  return {
    bridgeVersion: SPIRA_UI_CONTROL_BRIDGE_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    activeView,
    rootViews: [...SPIRA_UI_ROOT_VIEWS],
    window: {
      title: document.title || "Spira",
      focused: document.hasFocus(),
      visible: document.visibilityState === "visible",
    },
    assistantState,
    connectionStatus: useConnectionStore.getState().status,
    settings: {
      voiceEnabled: settings.voiceEnabled,
      wakeWordEnabled: settings.wakeWordEnabled,
      ttsProvider: settings.ttsProvider,
      whisperModel: settings.whisperModel,
      wakeWordProvider: settings.wakeWordProvider,
      openWakeWordThreshold: settings.openWakeWordThreshold,
      elevenLabsVoiceId: settings.elevenLabsVoiceId,
      theme: settings.theme,
    },
    permissions: usePermissionStore
      .getState()
      .requests.filter((request) => (request.stationId ?? activeStationId) === activeStationId),
    upgradeBanner: upgrade.banner ? { ...upgrade.banner } : null,
    protocolBanner: upgrade.protocolBanner ? { ...upgrade.protocolBanner } : null,
    mcpServers: [...useMcpStore.getState().servers],
    agentRooms: room.agentRooms
      .filter((agentRoom) => agentRoom.stationId === activeStationId)
      .map((agentRoom) => ({ ...agentRoom })),
    chat: {
      draft: chat.draft,
      isStreaming: chat.isStreaming,
      isAborting: chat.isAborting,
      isResetConfirming: chat.isResetConfirming,
      isResetting: chat.isResetting,
      messageCount: chat.messages.length,
      lastUserMessage: lastUserMessage ? toMessageSummary(lastUserMessage) : undefined,
      lastAssistantMessage: lastAssistantMessage ? toMessageSummary(lastAssistantMessage) : undefined,
      awaitingQuestion: awaitingQuestion ? toMessageSummary(awaitingQuestion) : undefined,
    },
    assistantDock: buildAssistantDockSummary({
      activeView,
      assistantState,
      connectionStatus: useConnectionStore.getState().status,
      isStreaming: chat.isStreaming,
      messages: chat.messages,
      permissionRequests: usePermissionStore
        .getState()
        .requests.filter((request) => (request.stationId ?? activeStationId) === activeStationId),
      activeCaptures: useVisionStore
        .getState()
        .activeCaptures.filter((capture) => capture.stationId === activeStationId),
      agentRooms: room.agentRooms.filter((agentRoom) => agentRoom.stationId === activeStationId),
      upgradeBanner: upgrade.banner ?? upgrade.protocolBanner,
      isAborting: chat.isAborting,
      isResetting: chat.isResetting,
    }),
  };
};
