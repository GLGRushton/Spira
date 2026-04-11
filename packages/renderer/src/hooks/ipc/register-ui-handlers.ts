import { setSpiraUiControlReady } from "../../automation/control-runtime.js";
import { useConnectionStore } from "../../stores/connection-store.js";
import { clearRendererTransientState } from "./reset-transient-state.js";

export interface UiHandlerActions {
  setServers: (servers: import("@spira/shared").McpServerStatus[]) => void;
  setSubagentCatalog: (agents: import("@spira/shared").SubagentDomain[]) => void;
  syncRoomsFromServers: (servers: import("@spira/shared").McpServerStatus[]) => void;
  addPermissionRequest: (payload: import("@spira/shared").PermissionRequestPayload) => void;
  removePermissionRequest: (requestId: string) => void;
  showUpgradeProposal: (proposal: import("@spira/shared").UpgradeProposal, message: string) => void;
  showUpgradeStatus: (status: import("@spira/shared").UpgradeStatus) => void;
  setAudioLevel: (level: number) => void;
  setTtsAmplitude: (amplitude: number) => void;
  applySettings: (settings: Partial<import("../../stores/settings-store.js").SettingsState>) => void;
  setConnectionStatus: (status: import("@spira/shared").ConnectionStatus) => void;
  clearStreamingState: (stationId?: string) => void;
  setAborting: (value: boolean, stationId?: string) => void;
  setResetConfirming: (value: boolean, stationId?: string) => void;
  setResetting: (value: boolean, stationId?: string) => void;
  clearPermissionRequests: () => void;
  clearAllActiveCaptures: (stationId?: string) => void;
  clearRoomState: (stationId?: string) => void;
  handleSubagentStarted: (event: import("@spira/shared").SubagentStartedEvent, stationId?: string) => void;
  handleSubagentToolCall: (event: import("@spira/shared").SubagentToolCallEvent, stationId?: string) => void;
  handleSubagentToolResult: (event: import("@spira/shared").SubagentToolResultEvent, stationId?: string) => void;
  handleSubagentDelta: (event: import("@spira/shared").SubagentDeltaEvent, stationId?: string) => void;
  handleSubagentStatus: (event: import("@spira/shared").SubagentStatusEvent, stationId?: string) => void;
  handleSubagentCompleted: (event: import("@spira/shared").SubagentCompletedEvent, stationId?: string) => void;
  handleSubagentError: (event: import("@spira/shared").SubagentErrorEvent, stationId?: string) => void;
  handleSubagentLockAcquired: (event: import("@spira/shared").SubagentLockAcquiredEvent, stationId?: string) => void;
  handleSubagentLockDenied: (event: import("@spira/shared").SubagentLockDeniedEvent, stationId?: string) => void;
  handleSubagentLockReleased: (event: import("@spira/shared").SubagentLockReleasedEvent, stationId?: string) => void;
}

export const registerUiHandlers = (actions: UiHandlerActions): Array<() => void> => [
  window.electronAPI.onUpgradeProposal(({ proposal, message }) => {
    actions.showUpgradeProposal(proposal, message);
  }),
  window.electronAPI.onUpgradeStatus((message) => {
    if (message.scope === "backend-reload") {
      const currentConnectionStatus = useConnectionStore.getState().status;
      if (message.status === "applying") {
        actions.setConnectionStatus("upgrading");
      } else if (message.status === "completed" && currentConnectionStatus === "upgrading") {
        actions.setConnectionStatus("connecting");
      } else if (message.status === "failed") {
        actions.setConnectionStatus("disconnected");
      }
    }
    actions.showUpgradeStatus(message);
  }),
  window.electronAPI.onPermissionRequest((payload) => {
    actions.addPermissionRequest(payload);
  }),
  window.electronAPI.onPermissionComplete(({ requestId }) => {
    actions.removePermissionRequest(requestId);
  }),
  window.electronAPI.onMcpStatus((servers) => {
    actions.setServers(servers);
    actions.syncRoomsFromServers(servers);
  }),
  window.electronAPI.onSubagentCatalog((agents) => {
    actions.setSubagentCatalog(agents);
  }),
  window.electronAPI.onAudioLevel((level) => {
    actions.setAudioLevel(level);
  }),
  window.electronAPI.onTtsAmplitude((amplitude) => {
    actions.setTtsAmplitude(amplitude);
  }),
  window.electronAPI.onSettingsCurrent((settings) => {
    actions.applySettings(settings);
  }),
  window.electronAPI.onConnectionStatus((status) => {
    actions.setConnectionStatus(status);
    if (status !== "connected") {
      clearRendererTransientState(actions);
    }
  }),
  window.electronAPI.onMessage((message) => {
    switch (message.type) {
      case "subagent:started":
        actions.handleSubagentStarted(message.event, message.stationId);
        break;
      case "subagent:tool-call":
        actions.handleSubagentToolCall(message.event, message.stationId);
        break;
      case "subagent:tool-result":
        actions.handleSubagentToolResult(message.event, message.stationId);
        break;
      case "subagent:delta":
        actions.handleSubagentDelta(message.event, message.stationId);
        break;
      case "subagent:status":
        actions.handleSubagentStatus(message.event, message.stationId);
        break;
      case "subagent:completed":
        actions.handleSubagentCompleted(message.event, message.stationId);
        break;
      case "subagent:error":
        actions.handleSubagentError(message.event, message.stationId);
        break;
      case "subagent:lock-acquired":
        actions.handleSubagentLockAcquired(message.event, message.stationId);
        break;
      case "subagent:lock-denied":
        actions.handleSubagentLockDenied(message.event, message.stationId);
        break;
      case "subagent:lock-released":
        actions.handleSubagentLockReleased(message.event, message.stationId);
        break;
      default:
        break;
    }
  }),
];

export const activateSpiraUiRuntime = (): (() => void) => {
  setSpiraUiControlReady(true);
  return () => {
    setSpiraUiControlReady(false);
  };
};
