import { createMissionView, type MissionUiRoom, type SpiraUiRootView, type SpiraUiView } from "@spira/shared";
import { create } from "zustand";

interface MissionFlashMessage {
  tone: "notice" | "error";
  message: string;
}

interface NavigationStore {
  activeView: SpiraUiView;
  missionRooms: Record<string, MissionUiRoom>;
  missionFlashByRun: Record<string, MissionFlashMessage | undefined>;
  setView: (view: SpiraUiView) => void;
  navigate: (view: SpiraUiRootView) => void;
  backToShip: () => void;
  openPrimaryBridge: () => void;
  openMcpServer: (serverId: string) => void;
  openAgentRoom: (roomId: `agent:${string}`) => void;
  openMission: (runId: string, room?: MissionUiRoom) => void;
  setMissionRoom: (runId: string, room: MissionUiRoom) => void;
  setMissionFlash: (runId: string, flash: MissionFlashMessage) => void;
  clearMissionFlash: (runId: string) => void;
  pruneMissionRooms: (activeRunIds: string[]) => void;
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  activeView: "ship",
  missionRooms: {},
  missionFlashByRun: {},
  setView: (activeView) => {
    set({ activeView });
  },
  navigate: (view) => {
    set({ activeView: view });
  },
  backToShip: () => {
    set({ activeView: "ship" });
  },
  openPrimaryBridge: () => {
    set({ activeView: "bridge" });
  },
  openMcpServer: (serverId) => {
    set({ activeView: `mcp:${serverId}` });
  },
  openAgentRoom: (roomId) => {
    set({ activeView: roomId });
  },
  openMission: (runId, room) => {
    set((state) => {
      const resolvedRoom = room ?? state.missionRooms[runId] ?? "details";
      return {
        activeView: createMissionView(runId),
        missionRooms: {
          ...state.missionRooms,
          [runId]: resolvedRoom,
        },
      };
    });
  },
  setMissionRoom: (runId, room) => {
    set((state) => ({
      missionRooms: {
        ...state.missionRooms,
        [runId]: room,
      },
    }));
  },
  setMissionFlash: (runId, flash) => {
    set((state) => ({
      missionFlashByRun: {
        ...state.missionFlashByRun,
        [runId]: flash,
      },
    }));
  },
  clearMissionFlash: (runId) => {
    set((state) => {
      const nextMissionFlashByRun = { ...state.missionFlashByRun };
      delete nextMissionFlashByRun[runId];
      return { missionFlashByRun: nextMissionFlashByRun };
    });
  },
  pruneMissionRooms: (activeRunIds) => {
    const activeRunIdSet = new Set(activeRunIds);
    set((state) => ({
      missionRooms: Object.fromEntries(
        Object.entries(state.missionRooms).filter(([runId]) => activeRunIdSet.has(runId)),
      ),
      missionFlashByRun: Object.fromEntries(
        Object.entries(state.missionFlashByRun).filter(([runId]) => activeRunIdSet.has(runId)),
      ),
    }));
  },
}));
