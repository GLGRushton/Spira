import type { McpServerStatus } from "@spira/shared";
import { create } from "zustand";

interface McpStore {
  servers: McpServerStatus[];
  setServers: (servers: McpServerStatus[]) => void;
}

export const useMcpStore = create<McpStore>((set) => ({
  servers: [],
  setServers: (servers) => {
    set({ servers });
  },
}));
