import { useChatStore } from "../../stores/chat-store.js";
import { useRoomStore } from "../../stores/room-store.js";
import { useVisionStore } from "../../stores/vision-store.js";

export const clearClientSessionUi = (): void => {
  if (useChatStore.getState().isStreaming) {
    return;
  }

  window.electronAPI.send({ type: "tts:stop" });
  useChatStore.getState().clearMessages();
  useRoomStore.getState().clearAll();
  useVisionStore.getState().clearAllActiveCaptures();
  useChatStore.getState().setDraft("");
};
