import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../../stores/chat-store.js";
import { clearRendererTransientState } from "./reset-transient-state.js";

describe("clearRendererTransientState", () => {
  const restoreSnapshot = () => {
    useChatStore.setState(
      {
        sessions: {},
      },
      false,
    );
  };

  afterEach(() => {
    restoreSnapshot();
  });

  it("resets transient UI state for every known station before clearing shared state", () => {
    useChatStore.getState().ensureStationSession("alpha");
    useChatStore.getState().ensureStationSession("beta");
    const expectedStationIds = Object.keys(useChatStore.getState().sessions);

    const actions = {
      clearStreamingState: vi.fn(),
      setAborting: vi.fn(),
      setResetConfirming: vi.fn(),
      setResetting: vi.fn(),
      clearPermissionRequests: vi.fn(),
      clearAllActiveCaptures: vi.fn(),
      clearRoomState: vi.fn(),
    };

    clearRendererTransientState(actions);

    expect(actions.clearStreamingState).toHaveBeenCalledTimes(expectedStationIds.length);
    for (const stationId of expectedStationIds) {
      expect(actions.clearStreamingState).toHaveBeenCalledWith(stationId);
      expect(actions.setAborting).toHaveBeenCalledWith(false, stationId);
      expect(actions.setResetConfirming).toHaveBeenCalledWith(false, stationId);
      expect(actions.setResetting).toHaveBeenCalledWith(false, stationId);
    }
    expect(actions.clearPermissionRequests).toHaveBeenCalledTimes(1);
    expect(actions.clearAllActiveCaptures).toHaveBeenCalledTimes(1);
    expect(actions.clearRoomState).toHaveBeenCalledTimes(1);
  });
});
