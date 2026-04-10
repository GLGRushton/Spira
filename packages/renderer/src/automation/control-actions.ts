import type { SpiraUiAction, SpiraUiSnapshot } from "@spira/shared";
import { PENDING_ASSISTANT_ID, createChatEntityId, getChatSession, useChatStore } from "../stores/chat-store.js";
import { useMcpStore } from "../stores/mcp-store.js";
import { useNavigationStore } from "../stores/navigation-store.js";
import { usePermissionStore } from "../stores/permission-store.js";
import { useRoomStore } from "../stores/room-store.js";
import { useSettingsStore } from "../stores/settings-store.js";
import { useStationStore } from "../stores/station-store.js";
import { useUpgradeStore } from "../stores/upgrade-store.js";
import { useVisionStore } from "../stores/vision-store.js";
import { buildSpiraUiSnapshot } from "./control-snapshot.js";

const clearUi = (): void => {
  const activeStationId = useStationStore.getState().activeStationId;
  if (getChatSession(useChatStore.getState(), activeStationId).isStreaming) {
    throw new Error("Cannot clear the UI while the assistant is streaming.");
  }

  window.electronAPI.send({ type: "tts:stop" });
  useChatStore.getState().clearMessages(activeStationId);
  useRoomStore.getState().clearAll(activeStationId);
  useVisionStore.getState().clearAllActiveCaptures(activeStationId);
  useChatStore.getState().setDraft("", activeStationId);
};

const updateSettings = async (settings: Parameters<typeof window.electronAPI.setSettings>[0]): Promise<void> => {
  useSettingsStore.getState().applySettings(settings);
  await window.electronAPI.setSettings(settings);
  window.electronAPI.updateSettings(settings);
};

export const performSpiraUiAction = async (action: SpiraUiAction): Promise<SpiraUiSnapshot> => {
  switch (action.type) {
    case "navigate":
      useNavigationStore.getState().navigate(action.view);
      return buildSpiraUiSnapshot();
    case "back":
      useNavigationStore.getState().backToShip();
      return buildSpiraUiSnapshot();
    case "open-mcp-server": {
      const serverExists = useMcpStore.getState().servers.some((server) => server.id === action.serverId);
      if (!serverExists) {
        throw new Error(`Unknown MCP server "${action.serverId}".`);
      }
      useNavigationStore.getState().openMcpServer(action.serverId);
      return buildSpiraUiSnapshot();
    }
    case "open-agent-room": {
      const roomExists = useRoomStore.getState().agentRooms.some((room) => room.roomId === action.roomId);
      if (!roomExists) {
        throw new Error(`Unknown agent room "${action.roomId}".`);
      }
      useNavigationStore.getState().openAgentRoom(action.roomId);
      return buildSpiraUiSnapshot();
    }
    case "set-draft": {
      const chat = useChatStore.getState();
      const activeStationId = useStationStore.getState().activeStationId;
      const session = getChatSession(chat, activeStationId);
      chat.setDraft(action.append ? `${session.draft}${action.draft}` : action.draft, activeStationId);
      return buildSpiraUiSnapshot();
    }
    case "focus-composer":
      useChatStore.getState().requestComposerFocus(useStationStore.getState().activeStationId);
      return buildSpiraUiSnapshot();
    case "send-chat": {
      const chat = useChatStore.getState();
      const activeStationId = useStationStore.getState().activeStationId;
      const session = getChatSession(chat, activeStationId);
      const nextText = (action.text ?? session.draft).trim();
      if (!nextText) {
        throw new Error("Cannot send an empty chat message.");
      }
      if (session.isStreaming || session.isResetting) {
        throw new Error("Chat is busy and cannot accept a new message right now.");
      }

      chat.addUserMessage(nextText, activeStationId);
      chat.setSessionNotice(null, activeStationId);
      chat.startAssistantMessage(PENDING_ASSISTANT_ID, activeStationId);
      const conversationId = session.activeConversationId ?? createChatEntityId();
      if (!session.activeConversationId) {
        chat.setActiveConversation(conversationId, null, activeStationId);
        useStationStore.getState().setStationConversation(activeStationId, conversationId, null);
      }
      window.electronAPI.sendMessage(nextText, conversationId, activeStationId);
      chat.setDraft("", activeStationId);
      return buildSpiraUiSnapshot();
    }
    case "abort-chat": {
      const chat = useChatStore.getState();
      const activeStationId = useStationStore.getState().activeStationId;
      const session = getChatSession(chat, activeStationId);
      if (session.isStreaming && !session.isAborting) {
        chat.setAborting(true, activeStationId);
        window.electronAPI.abortChat(activeStationId);
      }
      return buildSpiraUiSnapshot();
    }
    case "reset-chat": {
      const chat = useChatStore.getState();
      const activeStationId = useStationStore.getState().activeStationId;
      const session = getChatSession(chat, activeStationId);
      if (session.isStreaming) {
        throw new Error("Cannot reset chat while the assistant is streaming.");
      }

      chat.setResetConfirming(false, activeStationId);
      chat.setSessionNotice(null, activeStationId);
      chat.setResetting(true, activeStationId);
      clearUi();
      useStationStore.getState().setStationConversation(activeStationId, null, null);
      window.electronAPI.resetChat(activeStationId);
      return buildSpiraUiSnapshot();
    }
    case "update-settings":
      await updateSettings(action.settings);
      return buildSpiraUiSnapshot();
    case "toggle-wake-word": {
      const settings = useSettingsStore.getState();
      const nextEnabled = !settings.wakeWordEnabled;
      settings.setWakeWordEnabled(nextEnabled);
      window.electronAPI.updateSettings({ wakeWordEnabled: nextEnabled });
      return buildSpiraUiSnapshot();
    }
    case "toggle-spoken-replies": {
      const settings = useSettingsStore.getState();
      const nextEnabled = !settings.voiceEnabled;
      settings.setVoiceEnabled(nextEnabled);
      window.electronAPI.updateSettings({ voiceEnabled: nextEnabled });
      return buildSpiraUiSnapshot();
    }
    case "set-tts-provider":
      await updateSettings({ ttsProvider: action.provider });
      return buildSpiraUiSnapshot();
    case "respond-permission":
      window.electronAPI.send({
        type: "permission:respond",
        requestId: action.requestId,
        approved: action.approved,
      });
      usePermissionStore.getState().removeRequest(action.requestId);
      return buildSpiraUiSnapshot();
    case "respond-upgrade":
      await window.electronAPI.respondToUpgradeProposal(action.proposalId, action.approved);
      if (!action.approved && useUpgradeStore.getState().banner?.proposalId === action.proposalId) {
        useUpgradeStore.getState().clearBanner();
      }
      return buildSpiraUiSnapshot();
    default: {
      const exhaustiveCheck: never = action;
      throw new Error(`Unsupported UI action: ${String(exhaustiveCheck)}`);
    }
  }
};
