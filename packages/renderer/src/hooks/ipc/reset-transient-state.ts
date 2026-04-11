import { useChatStore } from "../../stores/chat-store.js";

type RendererTransientStateActions = {
  clearStreamingState: (stationId?: string) => void;
  setAborting: (value: boolean, stationId?: string) => void;
  setResetConfirming: (value: boolean, stationId?: string) => void;
  setResetting: (value: boolean, stationId?: string) => void;
  clearPermissionRequests: () => void;
  clearAllActiveCaptures: (stationId?: string) => void;
  clearRoomState: (stationId?: string) => void;
};

export const resetStationTransientState = (
  actions: Pick<
    RendererTransientStateActions,
    "clearStreamingState" | "setAborting" | "setResetConfirming" | "setResetting"
  >,
  stationId: string,
): void => {
  actions.clearStreamingState(stationId);
  actions.setAborting(false, stationId);
  actions.setResetConfirming(false, stationId);
  actions.setResetting(false, stationId);
};

export const clearRendererTransientState = (actions: RendererTransientStateActions): void => {
  for (const stationId of Object.keys(useChatStore.getState().sessions)) {
    resetStationTransientState(actions, stationId);
  }

  actions.clearPermissionRequests();
  actions.clearAllActiveCaptures();
  actions.clearRoomState();
};
