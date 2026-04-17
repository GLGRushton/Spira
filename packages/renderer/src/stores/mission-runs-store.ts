import type { TicketRunSnapshot, TicketRunSummary } from "@spira/shared";
import { create } from "zustand";

const EMPTY_RUN_SNAPSHOT: TicketRunSnapshot = {
  runs: [],
};

interface MissionRunsStore {
  snapshot: TicketRunSnapshot;
  isLoading: boolean;
  error: string | null;
  hasLoaded: boolean;
  setSnapshot: (snapshot: TicketRunSnapshot) => void;
  refresh: () => Promise<void>;
}

export const getMissionRunById = (snapshot: TicketRunSnapshot, runId: string): TicketRunSummary | null =>
  snapshot.runs.find((run) => run.runId === runId) ?? null;

export const getMissionRunByStationId = (snapshot: TicketRunSnapshot, stationId: string): TicketRunSummary | null =>
  snapshot.runs.find((run) => run.stationId === stationId) ?? null;

export const useMissionRunsStore = create<MissionRunsStore>((set) => ({
  snapshot: EMPTY_RUN_SNAPSHOT,
  isLoading: false,
  error: null,
  hasLoaded: false,
  setSnapshot: (snapshot) => {
    set({
      snapshot,
      error: null,
      hasLoaded: true,
    });
  },
  refresh: async () => {
    set((state) => ({
      isLoading: !state.hasLoaded,
      error: null,
    }));

    try {
      const snapshot = await window.electronAPI.getTicketRuns();
      set({
        snapshot,
        isLoading: false,
        error: null,
        hasLoaded: true,
      });
    } catch (error) {
      console.error("Failed to load mission runs", error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : "Failed to load mission runs.",
        hasLoaded: true,
      });
    }
  },
}));
