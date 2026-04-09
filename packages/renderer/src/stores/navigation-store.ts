import type { SpiraUiRootView, SpiraUiView } from "@spira/shared";
import { create } from "zustand";

interface NavigationStore {
  activeView: SpiraUiView;
  setView: (view: SpiraUiView) => void;
  navigate: (view: SpiraUiRootView) => void;
  backToShip: () => void;
  openMcpServer: (serverId: string) => void;
  openAgentRoom: (roomId: `agent:${string}`) => void;
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  activeView: "ship",
  setView: (activeView) => {
    set({ activeView });
  },
  navigate: (view) => {
    set({ activeView: view });
  },
  backToShip: () => {
    set({ activeView: "ship" });
  },
  openMcpServer: (serverId) => {
    set({ activeView: `mcp:${serverId}` });
  },
  openAgentRoom: (roomId) => {
    set({ activeView: roomId });
  },
}));
