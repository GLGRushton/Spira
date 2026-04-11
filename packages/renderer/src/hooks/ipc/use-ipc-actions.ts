import { useShallow } from "zustand/react/shallow";
import { useAudioStore } from "../../stores/audio-store.js";
import { useChatStore } from "../../stores/chat-store.js";
import { useConnectionStore } from "../../stores/connection-store.js";
import { useMcpStore } from "../../stores/mcp-store.js";
import { usePermissionStore } from "../../stores/permission-store.js";
import { useRoomStore } from "../../stores/room-store.js";
import { useSettingsStore } from "../../stores/settings-store.js";
import { useStationStore } from "../../stores/station-store.js";
import { useSubagentStore } from "../../stores/subagent-store.js";
import { useUpgradeStore } from "../../stores/upgrade-store.js";
import { useVisionStore } from "../../stores/vision-store.js";
import type { ChatHandlerActions } from "./register-chat-handlers.js";
import type { UiHandlerActions } from "./register-ui-handlers.js";

type StationIpcActions = {
  hydrateStations: (stations: import("@spira/shared").StationSummary[]) => void;
  upsertStation: (station: import("@spira/shared").StationSummary) => void;
  ensureStation: (stationId: string, defaults?: { conversationId?: string | null; title?: string | null }) => void;
  removeStation: (stationId: string) => void;
  setActiveStation: (stationId: string) => void;
  setStationConversation: (stationId: string, conversationId: string | null, title?: string | null) => void;
  setStationState: (stationId: string, state: import("@spira/shared").AssistantState) => void;
  markStationActivity: (stationId: string, updatedAt?: number) => void;
};

type ChatIpcActions = Pick<
  ChatHandlerActions,
  | "addToolCall"
  | "addUserMessage"
  | "appendDelta"
  | "abortStreamingMessage"
  | "clearStreamingState"
  | "completeMessage"
  | "ensureStationSession"
  | "finaliseMessage"
  | "hydrateConversation"
  | "removeStationSession"
  | "setAborting"
  | "setActiveConversation"
  | "setResetConfirming"
  | "setResetting"
  | "setSessionNotice"
  | "startAssistantMessage"
  | "updateToolResult"
>;

type RoomIpcActions = Pick<
  ChatHandlerActions &
    UiHandlerActions & {
      syncRoomsFromServers: (servers: import("@spira/shared").McpServerStatus[]) => void;
      pruneRoomFlights: () => void;
    },
  | "clearRoomState"
  | "handleRoomToolCall"
  | "handleSubagentCompleted"
  | "handleSubagentDelta"
  | "handleSubagentError"
  | "handleSubagentLockAcquired"
  | "handleSubagentLockDenied"
  | "handleSubagentLockReleased"
  | "handleSubagentStarted"
  | "handleSubagentStatus"
  | "handleSubagentToolCall"
  | "handleSubagentToolResult"
  | "pruneRoomFlights"
  | "syncRoomsFromServers"
>;

type ConnectionIpcActions = Pick<ChatHandlerActions & UiHandlerActions, "setConnectionStatus">;
type McpIpcActions = Pick<UiHandlerActions, "setServers">;
type SubagentIpcActions = Pick<UiHandlerActions, "setSubagentCatalog">;
type PermissionIpcActions = Pick<
  ChatHandlerActions & UiHandlerActions,
  "addPermissionRequest" | "clearPermissionRequests" | "removePermissionRequest"
>;
type SettingsIpcActions = Pick<UiHandlerActions, "applySettings">;
type UpgradeIpcActions = Pick<
  ChatHandlerActions & UiHandlerActions,
  "clearBanner" | "clearProtocolMismatch" | "setProtocolMismatch" | "showUpgradeProposal" | "showUpgradeStatus"
>;
type VisionIpcActions = Pick<
  ChatHandlerActions & UiHandlerActions,
  "clearActiveCapture" | "clearAllActiveCaptures" | "setActiveCapture"
>;

type IpcActionGroups = {
  audio: Pick<UiHandlerActions, "setAudioLevel" | "setTtsAmplitude">;
  chat: ChatIpcActions;
  connection: ConnectionIpcActions;
  mcp: McpIpcActions;
  subagent: SubagentIpcActions;
  permission: PermissionIpcActions;
  room: RoomIpcActions;
  settings: SettingsIpcActions;
  station: StationIpcActions;
  upgrade: UpgradeIpcActions;
  vision: VisionIpcActions;
};

export const useIpcActions = (): IpcActionGroups => {
  const station = useStationStore(
    useShallow((store) => ({
      hydrateStations: store.hydrateStations,
      upsertStation: store.upsertStation,
      ensureStation: store.ensureStation,
      removeStation: store.removeStation,
      setActiveStation: store.setActiveStation,
      setStationConversation: store.setStationConversation,
      setStationState: store.setStationState,
      markStationActivity: store.markActivity,
    })),
  );
  const chat = useChatStore(
    useShallow((store) => ({
      addUserMessage: store.addUserMessage,
      ensureStationSession: store.ensureStationSession,
      removeStationSession: store.removeStationSession,
      hydrateConversation: store.hydrateConversation,
      startAssistantMessage: store.startAssistantMessage,
      appendDelta: store.appendDelta,
      finaliseMessage: store.finaliseMessage,
      completeMessage: store.completeMessage,
      abortStreamingMessage: store.abortStreamingMessage,
      clearStreamingState: store.clearStreamingState,
      addToolCall: store.addToolCall,
      updateToolResult: store.updateToolResult,
      setActiveConversation: store.setActiveConversation,
      setAborting: store.setAborting,
      setResetConfirming: store.setResetConfirming,
      setResetting: store.setResetting,
      setSessionNotice: store.setSessionNotice,
    })),
  );
  const mcp = useMcpStore(
    useShallow((store) => ({
      setServers: store.setServers,
    })),
  );
  const room = useRoomStore(
    useShallow((store) => ({
      clearRoomState: store.clearAll,
      syncRoomsFromServers: store.syncServers,
      handleRoomToolCall: store.handleToolCall,
      handleSubagentStarted: store.handleSubagentStarted,
      handleSubagentToolCall: store.handleSubagentToolCall,
      handleSubagentToolResult: store.handleSubagentToolResult,
      handleSubagentDelta: store.handleSubagentDelta,
      handleSubagentStatus: store.handleSubagentStatus,
      handleSubagentCompleted: store.handleSubagentCompleted,
      handleSubagentError: store.handleSubagentError,
      handleSubagentLockAcquired: store.handleSubagentLockAcquired,
      handleSubagentLockDenied: store.handleSubagentLockDenied,
      handleSubagentLockReleased: store.handleSubagentLockReleased,
      pruneRoomFlights: store.pruneFlights,
    })),
  );
  const subagent = useSubagentStore(
    useShallow((store) => ({
      setSubagentCatalog: store.setAgents,
    })),
  );
  const audio = useAudioStore(
    useShallow((store) => ({
      setAudioLevel: store.setAudioLevel,
      setTtsAmplitude: store.setTtsAmplitude,
    })),
  );
  const settings = useSettingsStore(
    useShallow((store) => ({
      applySettings: store.applySettings,
    })),
  );
  const connection = useConnectionStore(
    useShallow((store) => ({
      setConnectionStatus: store.setStatus,
    })),
  );
  const permission = usePermissionStore(
    useShallow((store) => ({
      addPermissionRequest: store.addRequest,
      removePermissionRequest: store.removeRequest,
      clearPermissionRequests: store.clearRequests,
    })),
  );
  const vision = useVisionStore(
    useShallow((store) => ({
      setActiveCapture: store.setActiveCapture,
      clearActiveCapture: store.clearActiveCapture,
      clearAllActiveCaptures: store.clearAllActiveCaptures,
    })),
  );
  const upgrade = useUpgradeStore(
    useShallow((store) => ({
      clearBanner: store.clearBanner,
      setProtocolMismatch: store.setProtocolMismatch,
      clearProtocolMismatch: store.clearProtocolMismatch,
      showUpgradeProposal: store.showProposal,
      showUpgradeStatus: store.showStatus,
    })),
  );

  return {
    audio,
    chat,
    connection,
    mcp,
    subagent,
    permission,
    room,
    settings,
    station,
    upgrade,
    vision,
  };
};
