import type { SubagentDomain } from "@spira/shared";
import { create } from "zustand";

interface SubagentStore {
  agents: SubagentDomain[];
  setAgents: (agents: SubagentDomain[]) => void;
}

export const useSubagentStore = create<SubagentStore>((set) => ({
  agents: [],
  setAgents: (agents) => {
    set({ agents });
  },
}));
