import { create } from "zustand";

interface VisionStore {
  activeCaptures: Array<{ callId: string; toolName: string; args?: unknown }>;
  setActiveCapture: (callId: string, toolName: string, args?: unknown) => void;
  clearActiveCapture: (callId: string) => void;
  clearAllActiveCaptures: () => void;
}

export const useVisionStore = create<VisionStore>((set) => ({
  activeCaptures: [],
  setActiveCapture: (callId, toolName, args) => {
    set((state) => {
      const existingIndex = state.activeCaptures.findIndex((capture) => capture.callId === callId);
      if (existingIndex >= 0) {
        return {
          activeCaptures: state.activeCaptures.map((capture, index) =>
            index === existingIndex ? { callId, toolName, args } : capture,
          ),
        };
      }

      return {
        activeCaptures: [...state.activeCaptures, { callId, toolName, args }],
      };
    });
  },
  clearActiveCapture: (callId) => {
    set((state) => ({
      activeCaptures: state.activeCaptures.filter((capture) => capture.callId !== callId),
    }));
  },
  clearAllActiveCaptures: () => {
    set({ activeCaptures: [] });
  },
}));
