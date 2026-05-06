import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyChatSessionState, useChatStore } from "../stores/chat-store.js";
import { useConnectionStore } from "../stores/connection-store.js";
import { useNavigationStore } from "../stores/navigation-store.js";
import { PRIMARY_STATION_ID, useStationStore } from "../stores/station-store.js";
import { buildSpiraUiContext, buildSpiraUiSnapshot } from "./control-snapshot.js";

const resetStores = (): void => {
  useStationStore.setState(
    {
      activeStationId: PRIMARY_STATION_ID,
      stations: {
        [PRIMARY_STATION_ID]: {
          stationId: PRIMARY_STATION_ID,
          conversationId: null,
          label: "Primary",
          title: null,
          state: "idle",
          createdAt: 1,
          updatedAt: 1,
          isStreaming: false,
          hasUnread: false,
        },
      },
    },
    false,
  );
  useChatStore.setState(
    {
      sessions: {
        [PRIMARY_STATION_ID]: createEmptyChatSessionState(),
      },
    },
    false,
  );
  useConnectionStore.setState({ status: "connected" }, false);
  useNavigationStore.setState({ activeView: "bridge", missionRooms: {}, missionFlashByRun: {} }, false);
};

describe("control-snapshot", () => {
  beforeEach(() => {
    resetStores();
    vi.stubGlobal("document", {
      title: "Spira",
      hasFocus: () => true,
      visibilityState: "visible",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes the active station work-session summary in the UI snapshot and context", () => {
    useStationStore.getState().upsertStation({
      stationId: PRIMARY_STATION_ID,
      conversationId: null,
      label: "Primary",
      title: null,
      state: "thinking",
      createdAt: 1,
      updatedAt: 2,
      isStreaming: false,
      workSession: {
        mode: "work-session",
        active: true,
        sessionId: "work-42",
        phase: "summarise",
        summary: "Condensing repository findings into a brief.",
        updatedAt: 2,
      },
    });

    expect(buildSpiraUiSnapshot()).toMatchObject({
      assistantState: "thinking",
      workSession: {
        mode: "work-session",
        active: true,
        phase: "summarise",
        summary: "Condensing repository findings into a brief.",
      },
    });
    expect(buildSpiraUiContext()).toMatchObject({
      assistantState: "thinking",
      workSession: {
        mode: "work-session",
        active: true,
        phase: "summarise",
      },
    });
  });
});
