import type { StationId } from "@spira/shared";
import { getChatSession, useChatStore } from "../../stores/chat-store.js";
import { useRoomStore } from "../../stores/room-store.js";
import { useVisionStore } from "../../stores/vision-store.js";

export const clearClientSessionUi = (stationId?: StationId): void => {
  if (getChatSession(useChatStore.getState(), stationId).isStreaming) {
    return;
  }

  window.electronAPI.send({ type: "tts:stop" });
  useChatStore.getState().clearMessages(stationId);
  useRoomStore.getState().clearAll(stationId);
  useVisionStore.getState().clearAllActiveCaptures(stationId);
  useChatStore.getState().setDraft("", stationId);
};
