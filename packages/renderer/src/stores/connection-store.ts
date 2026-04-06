import type { ConnectionStatus } from "@spira/shared";
import { create } from "zustand";

interface ConnectionStore {
  status: ConnectionStatus;
  setStatus: (status: ConnectionStatus) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  status: "connecting",
  setStatus: (status) => {
    set({ status });
  },
}));
