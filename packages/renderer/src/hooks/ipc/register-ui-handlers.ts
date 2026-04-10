import { setSpiraUiControlReady } from "../../automation/control-runtime.js";
import { useConnectionStore } from "../../stores/connection-store.js";

interface UiHandlerActions {
  setServers: (servers: import("@spira/shared").McpServerStatus[]) => void;
  syncRoomsFromServers: (servers: import("@spira/shared").McpServerStatus[]) => void;
  addPermissionRequest: (payload: import("@spira/shared").PermissionRequestPayload) => void;
  removePermissionRequest: (requestId: string) => void;
  showUpgradeProposal: (proposal: import("@spira/shared").UpgradeProposal, message: string) => void;
  showUpgradeStatus: (status: import("@spira/shared").UpgradeStatus) => void;
  setAudioLevel: (level: number) => void;
  setTtsAmplitude: (amplitude: number) => void;
  applySettings: (settings: Partial<import("../../stores/settings-store.js").SettingsState>) => void;
  setConnectionStatus: (status: import("@spira/shared").ConnectionStatus) => void;
  clearStreamingState: () => void;
  setAborting: (value: boolean) => void;
  setResetConfirming: (value: boolean) => void;
  setResetting: (value: boolean) => void;
  clearPermissionRequests: () => void;
  clearAllActiveCaptures: () => void;
  clearRoomState: () => void;
  handleSubagentStarted: (event: import("@spira/shared").SubagentStartedEvent) => void;
  handleSubagentToolCall: (event: import("@spira/shared").SubagentToolCallEvent) => void;
  handleSubagentToolResult: (event: import("@spira/shared").SubagentToolResultEvent) => void;
  handleSubagentDelta: (event: import("@spira/shared").SubagentDeltaEvent) => void;
  handleSubagentStatus: (event: import("@spira/shared").SubagentStatusEvent) => void;
  handleSubagentCompleted: (event: import("@spira/shared").SubagentCompletedEvent) => void;
  handleSubagentError: (event: import("@spira/shared").SubagentErrorEvent) => void;
  handleSubagentLockAcquired: (event: import("@spira/shared").SubagentLockAcquiredEvent) => void;
  handleSubagentLockDenied: (event: import("@spira/shared").SubagentLockDeniedEvent) => void;
  handleSubagentLockReleased: (event: import("@spira/shared").SubagentLockReleasedEvent) => void;
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
      actions.clearStreamingState();
      actions.setAborting(false);
      actions.setResetConfirming(false);
      actions.setResetting(false);
      actions.clearPermissionRequests();
      actions.clearAllActiveCaptures();
      actions.clearRoomState();
    }
  }),
  window.electronAPI.onMessage((message) => {
    switch (message.type) {
      case "subagent:started":
        actions.handleSubagentStarted(message.event);
        break;
      case "subagent:tool-call":
        actions.handleSubagentToolCall(message.event);
        break;
      case "subagent:tool-result":
        actions.handleSubagentToolResult(message.event);
        break;
      case "subagent:delta":
        actions.handleSubagentDelta(message.event);
        break;
      case "subagent:status":
        actions.handleSubagentStatus(message.event);
        break;
      case "subagent:completed":
        actions.handleSubagentCompleted(message.event);
        break;
      case "subagent:error":
        actions.handleSubagentError(message.event);
        break;
      case "subagent:lock-acquired":
        actions.handleSubagentLockAcquired(message.event);
        break;
      case "subagent:lock-denied":
        actions.handleSubagentLockDenied(message.event);
        break;
      case "subagent:lock-released":
        actions.handleSubagentLockReleased(message.event);
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
