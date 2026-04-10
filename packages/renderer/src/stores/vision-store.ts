import type { StationId } from "@spira/shared";
import { create } from "zustand";

interface VisionStore {
  activeCaptures: Array<{ stationId: StationId; callId: string; toolName: string; args?: unknown }>;
  setActiveCapture: (callId: string, toolName: string, args?: unknown, stationId?: StationId) => void;
  clearActiveCapture: (callId: string, stationId?: StationId) => void;
  clearAllActiveCaptures: (stationId?: StationId) => void;
}

const DEFAULT_STATION_ID = "primary";
const resolveStationId = (stationId?: StationId): StationId => stationId ?? DEFAULT_STATION_ID;

export const useVisionStore = create<VisionStore>((set) => ({
  activeCaptures: [],
  setActiveCapture: (callId, toolName, args, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) => {
      const existingIndex = state.activeCaptures.findIndex(
        (capture) => capture.callId === callId && capture.stationId === resolvedStationId,
      );
      if (existingIndex >= 0) {
        return {
          activeCaptures: state.activeCaptures.map((capture, index) =>
            index === existingIndex ? { stationId: resolvedStationId, callId, toolName, args } : capture,
          ),
        };
      }

      return {
        activeCaptures: [...state.activeCaptures, { stationId: resolvedStationId, callId, toolName, args }],
      };
    });
  },
  clearActiveCapture: (callId, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) => ({
      activeCaptures: state.activeCaptures.filter(
        (capture) => capture.callId !== callId || capture.stationId !== resolvedStationId,
      ),
    }));
  },
  clearAllActiveCaptures: (stationId) => {
    if (!stationId) {
      set({ activeCaptures: [] });
      return;
    }

    const resolvedStationId = resolveStationId(stationId);
    set((state) => ({
      activeCaptures: state.activeCaptures.filter((capture) => capture.stationId !== resolvedStationId),
    }));
  },
}));
