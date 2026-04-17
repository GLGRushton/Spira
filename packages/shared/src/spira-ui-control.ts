import type { AssistantState } from "./assistant-state.js";
import type { ConnectionStatus } from "./electron-api.js";
import type { McpServerConfig, McpServerUpdateConfig } from "./mcp-types.js";
import type { McpServerStatus } from "./mcp-types.js";
import type { PermissionRequestPayload, TtsProvider, UserSettings } from "./protocol.js";
import type { SubagentCreateConfig } from "./subagent-types.js";
import type { SubagentDomain } from "./subagent-types.js";
import type { SubagentDomainId } from "./subagent-types.js";
import type { UpgradeScope } from "./upgrade.js";

export const SPIRA_UI_CONTROL_BRIDGE_VERSION = 1;
export const SPIRA_UI_ROOT_VIEWS = [
  "ship",
  "operations",
  "bridge",
  "barracks",
  "mcp",
  "agents",
  "projects",
  "settings",
] as const;
export type SpiraUiRootView = (typeof SPIRA_UI_ROOT_VIEWS)[number];
export const MISSION_UI_ROOMS = ["bridge", "details", "changes", "actions", "processes"] as const;
export type MissionUiRoom = (typeof MISSION_UI_ROOMS)[number];
export type SpiraMissionView = `mission:${string}`;
export type SpiraUiView = SpiraUiRootView | `mcp:${string}` | `agent:${string}` | SpiraMissionView;

export const isMissionView = (view: string): view is SpiraMissionView => view.startsWith("mission:");

export const createMissionView = (runId: string): SpiraMissionView => `mission:${runId}`;

export const getMissionRunIdFromView = (view: string): string | null =>
  isMissionView(view) ? view.slice("mission:".length) : null;

export const SPIRA_UI_ACTION_TYPES = [
  "navigate",
  "back",
  "open-mcp-server",
  "open-agent-room",
  "open-mission",
  "set-draft",
  "focus-composer",
  "send-chat",
  "abort-chat",
  "reset-chat",
  "update-settings",
  "toggle-wake-word",
  "toggle-spoken-replies",
  "set-tts-provider",
  "respond-permission",
  "respond-upgrade",
  "add-mcp-server",
  "update-mcp-server",
  "create-subagent",
  "update-subagent",
] as const;
export type SpiraUiActionType = (typeof SPIRA_UI_ACTION_TYPES)[number];

export const SPIRA_UI_WAIT_CONDITION_TYPES = [
  "active-view",
  "assistant-state",
  "connection-status",
  "streaming",
  "permission-request",
  "upgrade-banner",
  "mcp-server-state",
  "agent-room",
] as const;
export type SpiraUiWaitConditionType = (typeof SPIRA_UI_WAIT_CONDITION_TYPES)[number];

export interface SpiraUiMessageSummary {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  autoSpeak?: boolean;
  isStreaming?: boolean;
  wasAborted?: boolean;
}

export interface SpiraUiChatSummary {
  draft: string;
  isStreaming: boolean;
  isAborting: boolean;
  isResetConfirming: boolean;
  isResetting: boolean;
  messageCount: number;
  lastUserMessage?: SpiraUiMessageSummary;
  lastAssistantMessage?: SpiraUiMessageSummary;
  awaitingQuestion?: SpiraUiMessageSummary;
}

export interface SpiraUiChatTranscript {
  messages: SpiraUiMessageSummary[];
}

export interface SpiraUiAssistantDockSummary {
  visible: boolean;
  expanded: boolean;
  workSummary?: string;
  responsePreview?: string;
  phaseLabel?: string;
  indicators?: string[];
}

export interface SpiraUiAgentRoomSummary {
  roomId: `agent:${string}`;
  label: string;
  caption: string;
  status: "launching" | "active" | "idle" | "error";
  kind?: "agent" | "subagent";
  domainId?: SubagentDomainId;
  runId?: string;
  attempt?: number;
  createdAt: number;
  updatedAt: number;
  sourceCallId?: string;
  agentId?: string;
  lastToolName?: string;
  detail?: string;
  activeToolCount: number;
}

export interface SpiraUiWindowSummary {
  title: string;
  focused: boolean;
  visible: boolean;
}

export interface SpiraUiUpgradeBannerSummary {
  kind: "info" | "warning" | "error" | "success";
  title: string;
  message: string;
  proposalId?: string;
  scope?: UpgradeScope;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
  dismissible?: boolean;
}

export interface SpiraUiSnapshot {
  bridgeVersion: number;
  protocolVersion: number;
  activeView: SpiraUiView;
  activeMissionRoom?: MissionUiRoom;
  rootViews: SpiraUiRootView[];
  window: SpiraUiWindowSummary;
  assistantState: AssistantState;
  connectionStatus: ConnectionStatus;
  settings: UserSettings;
  permissions: PermissionRequestPayload[];
  upgradeBanner: SpiraUiUpgradeBannerSummary | null;
  protocolBanner: SpiraUiUpgradeBannerSummary | null;
  mcpServers: McpServerStatus[];
  subagents: SubagentDomain[];
  agentRooms: SpiraUiAgentRoomSummary[];
  chat: SpiraUiChatSummary;
  assistantDock: SpiraUiAssistantDockSummary;
}

export type SpiraUiCreateSubagentConfig = SubagentCreateConfig;

export interface SpiraUiCapabilities {
  bridgeVersion: number;
  rootViews: SpiraUiRootView[];
  actionTypes: SpiraUiActionType[];
  waitConditionTypes: SpiraUiWaitConditionType[];
}

export type SpiraUiAction =
  | { type: "navigate"; view: SpiraUiRootView }
  | { type: "back" }
  | { type: "open-mcp-server"; serverId: string }
  | { type: "open-agent-room"; roomId: `agent:${string}` }
  | { type: "open-mission"; runId: string; room?: MissionUiRoom }
  | { type: "set-draft"; draft: string; append?: boolean }
  | { type: "focus-composer" }
  | { type: "send-chat"; text?: string }
  | { type: "abort-chat" }
  | { type: "reset-chat" }
  | { type: "update-settings"; settings: Partial<UserSettings> }
  | { type: "toggle-wake-word" }
  | { type: "toggle-spoken-replies" }
  | { type: "set-tts-provider"; provider: TtsProvider }
  | { type: "respond-permission"; requestId: string; approved: boolean }
  | { type: "respond-upgrade"; proposalId: string; approved: boolean }
  | { type: "add-mcp-server"; config: McpServerConfig }
  | { type: "update-mcp-server"; serverId: string; patch: McpServerUpdateConfig }
  | { type: "create-subagent"; config: SpiraUiCreateSubagentConfig }
  | {
      type: "update-subagent";
      agentId: string;
      patch: Partial<Omit<SubagentDomain, "id" | "source" | "delegationToolName">>;
    };

export type SpiraUiWaitCondition =
  | { type: "active-view"; view: SpiraUiView }
  | { type: "assistant-state"; state: AssistantState }
  | { type: "connection-status"; status: ConnectionStatus }
  | { type: "streaming"; value: boolean }
  | { type: "permission-request"; present: boolean; requestId?: string; toolName?: string }
  | { type: "upgrade-banner"; present: boolean; proposalId?: string }
  | { type: "mcp-server-state"; serverId: string; state: McpServerStatus["state"] }
  | { type: "agent-room"; roomId: `agent:${string}`; present: boolean };

export type SpiraUiBridgeCommand =
  | { kind: "ping" }
  | { kind: "get-capabilities" }
  | { kind: "get-snapshot" }
  | { kind: "get-chat-messages"; limit?: number }
  | { kind: "perform-action"; action: SpiraUiAction }
  | { kind: "wait-for"; condition: SpiraUiWaitCondition; timeoutMs?: number; pollIntervalMs?: number };

export type SpiraUiBridgeResult =
  | { type: "pong"; capabilities: SpiraUiCapabilities }
  | { type: "capabilities"; capabilities: SpiraUiCapabilities }
  | { type: "snapshot"; snapshot: SpiraUiSnapshot }
  | { type: "chat-messages"; transcript: SpiraUiChatTranscript }
  | { type: "action-result"; action: SpiraUiActionType; snapshot: SpiraUiSnapshot }
  | { type: "wait-result"; condition: SpiraUiWaitCondition; elapsedMs: number; snapshot: SpiraUiSnapshot };

export interface SpiraUiBridgeError {
  code:
    | "AUTH_FAILED"
    | "INVALID_REQUEST"
    | "WINDOW_UNAVAILABLE"
    | "RENDERER_UNAVAILABLE"
    | "UNSUPPORTED_ACTION"
    | "WAIT_TIMEOUT"
    | "BRIDGE_UNAVAILABLE"
    | "INTERNAL_ERROR";
  message: string;
  details?: string;
}

export type SpiraUiBridgeResponse =
  | { requestId: string; ok: true; data: SpiraUiBridgeResult }
  | { requestId: string; ok: false; error: SpiraUiBridgeError };

export type SpiraUiBridgeRequest = SpiraUiBridgeCommand & {
  requestId: string;
  token: string;
};

export interface SpiraUiBridgeDiscovery {
  version: number;
  port: number;
  token: string;
  pid: number;
}
