import type { RuntimeConfigSummary } from "@spira/shared";
import { create } from "zustand";

interface RuntimeConfigState {
  summary: RuntimeConfigSummary | null;
  setSummary: (summary: RuntimeConfigSummary) => void;
}

export const useRuntimeConfigStore = create<RuntimeConfigState>((set) => ({
  summary: null,
  setSummary: (summary) => set({ summary }),
}));

if (typeof window !== "undefined") {
  void window.electronAPI
    .getRuntimeConfig()
    .then((summary) => {
      useRuntimeConfigStore.getState().setSummary(summary);
    })
    .catch((error) => {
      console.error("[Spira:runtime-config-load]", error);
    });
}
