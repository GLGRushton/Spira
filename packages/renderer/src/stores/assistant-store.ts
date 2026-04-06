import type { AssistantState } from "@spira/shared";
import { create } from "zustand";

interface AssistantStore {
  state: AssistantState;
  setState: (state: AssistantState) => void;
}

export const useAssistantStore = create<AssistantStore>((set) => ({
  state: "idle",
  setState: (state) => {
    set({ state });
  },
}));
