import type { PermissionRequestPayload } from "@spira/shared";
import { create } from "zustand";

interface PermissionStore {
  requests: PermissionRequestPayload[];
  addRequest: (request: PermissionRequestPayload) => void;
  removeRequest: (requestId: string) => void;
  clearRequests: () => void;
}

export const usePermissionStore = create<PermissionStore>((set) => ({
  requests: [],
  addRequest: (request) => {
    set((state) => {
      const existingIndex = state.requests.findIndex((entry) => entry.requestId === request.requestId);
      if (existingIndex >= 0) {
        return {
          requests: state.requests.map((entry, index) => (index === existingIndex ? request : entry)),
        };
      }

      return {
        requests: [...state.requests, request],
      };
    });
  },
  removeRequest: (requestId) => {
    set((state) => ({
      requests: state.requests.filter((request) => request.requestId !== requestId),
    }));
  },
  clearRequests: () => {
    set({ requests: [] });
  },
}));
