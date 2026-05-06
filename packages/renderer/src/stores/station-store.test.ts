import type { StationSummary } from "@spira/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { PRIMARY_STATION_ID, useStationStore } from "./station-store.js";

const createStationSummary = (overrides: Partial<StationSummary> = {}): StationSummary => ({
  stationId: PRIMARY_STATION_ID,
  conversationId: null,
  label: "Primary",
  title: null,
  state: "idle",
  createdAt: 1,
  updatedAt: 1,
  isStreaming: false,
  ...overrides,
});

const resetStationStore = (): void => {
  useStationStore.setState(
    {
      activeStationId: PRIMARY_STATION_ID,
      stations: {
        [PRIMARY_STATION_ID]: {
          ...createStationSummary(),
          hasUnread: false,
        },
      },
    },
    false,
  );
};

describe("station-store", () => {
  beforeEach(() => {
    resetStationStore();
  });

  it("hydrates work-session summaries into station view state", () => {
    useStationStore.getState().hydrateStations([
      createStationSummary({
        workSession: {
          mode: "work-session",
          active: true,
          sessionId: "work-1",
          phase: "discover",
          summary: "Tracing repository entry points.",
          updatedAt: 2,
        },
      }),
    ]);

    expect(useStationStore.getState().stations[PRIMARY_STATION_ID]).toMatchObject({
      workSession: {
        mode: "work-session",
        active: true,
        phase: "discover",
        summary: "Tracing repository entry points.",
      },
    });
  });
});
