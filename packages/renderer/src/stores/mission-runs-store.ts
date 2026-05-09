import type { TicketRunMissionEventSummary, TicketRunSnapshot, TicketRunSummary } from "@spira/shared";
import { create } from "zustand";

const EMPTY_RUN_SNAPSHOT: TicketRunSnapshot = {
  runs: [],
};

/**
 * Phase 1.1 — live mission event buffer per run. Bounded so the store stays small;
 * the controller's existing on-demand timeline fetch is the cold path for full history.
 */
const LIVE_EVENT_BUFFER_LIMIT = 20;

interface MissionRunsStore {
  snapshot: TicketRunSnapshot;
  isLoading: boolean;
  error: string | null;
  hasLoaded: boolean;
  /**
   * Per-run buffer of the most recent mission events pushed live by the backend
   * (Phase 1.1 telemetry events: attempt-action, attempt-shell-command, attempt-awaiting-permission,
   * attempt-permission-resolved). Newest first; capped at LIVE_EVENT_BUFFER_LIMIT entries per run.
   */
  liveEventsByRun: Record<string, TicketRunMissionEventSummary[]>;
  setSnapshot: (snapshot: TicketRunSnapshot) => void;
  /**
   * Phase 0.3 — apply a per-run delta to the existing snapshot.
   * Replaces the run with the matching ID; appends if missing. Either way,
   * keeps every other run in place so the renderer doesn't re-render the world.
   */
  setRun: (run: TicketRunSummary) => void;
  /**
   * Phase 1.1 — buffer a live mission event into the per-run rolling list.
   */
  pushLiveEvent: (event: TicketRunMissionEventSummary) => void;
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
  liveEventsByRun: {},
  setSnapshot: (snapshot) => {
    set({
      snapshot,
      error: null,
      hasLoaded: true,
    });
  },
  setRun: (run) => {
    set((state) => {
      const index = state.snapshot.runs.findIndex((existing) => existing.runId === run.runId);
      const nextRuns =
        index === -1
          ? [...state.snapshot.runs, run]
          : [...state.snapshot.runs.slice(0, index), run, ...state.snapshot.runs.slice(index + 1)];
      return {
        snapshot: { ...state.snapshot, runs: nextRuns },
        error: null,
        hasLoaded: true,
      };
    });
  },
  pushLiveEvent: (event) => {
    set((state) => {
      const existing = state.liveEventsByRun[event.runId] ?? [];
      // Newest-first; cap to keep memory bounded. The on-demand timeline fetch in
      // useMissionRunController is the cold path for full history.
      const nextEvents = [event, ...existing].slice(0, LIVE_EVENT_BUFFER_LIMIT);
      return {
        liveEventsByRun: { ...state.liveEventsByRun, [event.runId]: nextEvents },
      };
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
