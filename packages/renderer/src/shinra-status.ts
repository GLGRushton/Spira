import type {
  AssistantState,
  ConnectionStatus,
  PermissionRequestPayload,
  SpiraUiAssistantDockSummary,
  SpiraUiView,
} from "@spira/shared";
import type { ChatMessage, ToolCallEntry } from "./stores/chat-store.js";
import type { AgentRoom } from "./stores/room-store.js";
import type { UpgradeBannerState } from "./stores/upgrade-store.js";
import { classifyToolName, shouldDisplayToolName } from "./tool-display.js";

const ACTIVE_TOOL_STATUSES = new Set<ToolCallEntry["status"]>(["pending", "running"]);
const ACTIVE_AGENT_ROOM_STATUSES = new Set<AgentRoom["status"]>(["launching", "active"]);

const WORKING_STATE_COPY: Partial<Record<AssistantState, string>> = {
  listening: "Listening for input",
  transcribing: "Transcribing audio",
  thinking: "Deciding the next move",
  speaking: "Delivering response",
  error: "Attention required",
};

const DELEGATION_TOOL_NAMES = new Set([
  "task",
  "read_agent",
  "write_agent",
  "stop_agent",
  "list_agents",
  "read_subagent",
  "write_subagent",
  "stop_subagent",
  "list_subagents",
]);
const ACTION_TOOL_NAMES = new Set([
  "apply_patch",
  "powershell",
  "write_file",
  "write_powershell",
  "stop_powershell",
  "sql",
]);
const LEARNING_TOOL_PREFIXES = ["spira_memory_"];
const UPGRADE_TOOL_NAMES = new Set(["spira_propose_upgrade"]);

const clampText = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;

const formatLabel = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

const formatToolName = (toolName: string): string =>
  toolName
    .split(/[_-]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const uniq = (values: Array<string | undefined>, limit = 3): string[] =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value)))).slice(0, limit);

const summarizeToolDetail = (details?: string): string | undefined => {
  if (!details) {
    return undefined;
  }

  const firstLine = details
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .find(Boolean);
  if (!firstLine || firstLine.startsWith("{") || firstLine.startsWith("[")) {
    return undefined;
  }

  return clampText(firstLine.replace(/[.;:,]+$/, ""), 88);
};

const findLastMatchingIndex = (messages: ChatMessage[], predicate: (message: ChatMessage) => boolean): number => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (predicate(messages[index])) {
      return index;
    }
  }

  return -1;
};

const getLatestAssistantMessage = (messages: ChatMessage[]): ChatMessage | undefined => {
  const trailingMessage = messages.at(-1);
  if (trailingMessage?.role === "assistant") {
    return trailingMessage;
  }

  return [...messages].reverse().find((message) => message.role === "assistant");
};

const getLatestActiveToolCalls = (message?: ChatMessage): ToolCallEntry[] =>
  [...(message?.toolCalls ?? [])]
    .reverse()
    .filter((entry) => shouldDisplayToolName(entry.name) && ACTIVE_TOOL_STATUSES.has(entry.status));

const summarizeResponsePreview = (content: string): string | undefined => {
  const normalized = normalizeWhitespace(content);
  return normalized ? clampText(normalized, 220) : undefined;
};

const getLatestActiveAgentRoom = (agentRooms: AgentRoom[]): AgentRoom | undefined =>
  [...agentRooms]
    .filter((room) => ACTIVE_AGENT_ROOM_STATUSES.has(room.status))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];

const getUpgradeSummary = (upgradeBanner: UpgradeBannerState | null | undefined): string | undefined => {
  if (!upgradeBanner) {
    return undefined;
  }

  return summarizeResponsePreview(`${upgradeBanner.title}. ${upgradeBanner.message}`);
};

const isApplyingUpgrade = (
  connectionStatus: ConnectionStatus,
  upgradeBanner: UpgradeBannerState | null | undefined,
): boolean =>
  connectionStatus === "upgrading" ||
  upgradeBanner?.dismissible === false ||
  normalizeWhitespace(upgradeBanner?.title ?? "").toLowerCase() === "applying upgrade";

const summarizeCaptureTool = (toolName: string): string => {
  const normalized = toolName.toLowerCase();
  if (normalized.includes("screen")) {
    return "Inspecting the current screen";
  }
  if (normalized.includes("screenshot")) {
    return "Capturing a fresh screenshot";
  }
  if (normalized.includes("ocr")) {
    return "Reading visible text from the screen";
  }

  return `Inspecting with ${formatToolName(toolName)}`;
};

export type ShinraPresencePhase =
  | "idle"
  | "listening"
  | "transcribing"
  | "planning"
  | "investigating"
  | "acting"
  | "delegating"
  | "waiting"
  | "upgrading"
  | "learning"
  | "reporting"
  | "error";

const summarizeToolCall = (
  toolCall: ToolCallEntry,
): {
  phase: ShinraPresencePhase;
  phaseLabel: string;
  workSummary: string;
  indicators: string[];
} => {
  const toolLabel = formatToolName(toolCall.name);
  const detailSummary = summarizeToolDetail(toolCall.details);
  const toolCategory = classifyToolName(toolCall.name);

  if (UPGRADE_TOOL_NAMES.has(toolCall.name)) {
    return {
      phase: "upgrading",
      phaseLabel: "Upgrading",
      workSummary: detailSummary ?? "Preparing a self-upgrade",
      indicators: uniq(["Self-upgrade", toolLabel]),
    };
  }

  if (LEARNING_TOOL_PREFIXES.some((prefix) => toolCall.name.startsWith(prefix))) {
    return {
      phase: "learning",
      phaseLabel: "Learning",
      workSummary: detailSummary ?? "Updating continuity and operational memory",
      indicators: uniq(["Memory", toolLabel]),
    };
  }

  if (toolCall.name.startsWith("delegate_to_") || DELEGATION_TOOL_NAMES.has(toolCall.name)) {
    return {
      phase: "delegating",
      phaseLabel: "Delegating",
      workSummary: detailSummary ?? "Dispatching specialist agents",
      indicators: uniq(["Subagents", toolLabel]),
    };
  }

  if (
    ACTION_TOOL_NAMES.has(toolCall.name) ||
    toolCall.name.startsWith("write_") ||
    toolCall.name.startsWith("system_")
  ) {
    return {
      phase: "acting",
      phaseLabel: "Acting",
      workSummary: detailSummary ?? "Making changes on the machine",
      indicators: uniq(["Machine access", toolLabel]),
    };
  }

  if (toolCategory === "vision" || toolCall.name.startsWith("spira_ui_")) {
    return {
      phase: "acting",
      phaseLabel: "Acting",
      workSummary: detailSummary ?? `Operating through ${toolLabel}`,
      indicators: uniq(["UI control", toolLabel]),
    };
  }

  if (toolCategory === "inspect" || toolCategory === "research") {
    return {
      phase: "investigating",
      phaseLabel: "Investigating",
      workSummary: detailSummary ?? "Reading code, tools, and machine state",
      indicators: uniq(["Investigation", toolLabel]),
    };
  }

  return {
    phase: "planning",
    phaseLabel: "Planning",
    workSummary: detailSummary ?? `Working through ${toolLabel}`,
    indicators: uniq([toolLabel]),
  };
};

export interface ShinraStatusContext {
  phase: ShinraPresencePhase;
  phaseLabel: string;
  lastAssistantMessage?: ChatMessage;
  hasCurrentResponse: boolean;
  isResponseState: boolean;
  workSummary?: string;
  indicators: string[];
  statusLine: string;
}

export const getShinraStatusContext = ({
  assistantState,
  isStreaming,
  messages,
  connectionStatus = "connected",
  permissionRequests = [],
  activeCaptures = [],
  agentRooms = [],
  upgradeBanner = null,
  isAborting = false,
  isResetting = false,
}: {
  assistantState: AssistantState;
  isStreaming: boolean;
  messages: ChatMessage[];
  connectionStatus?: ConnectionStatus;
  permissionRequests?: PermissionRequestPayload[];
  activeCaptures?: Array<{ toolName: string; args?: unknown }>;
  agentRooms?: AgentRoom[];
  upgradeBanner?: UpgradeBannerState | null;
  isAborting?: boolean;
  isResetting?: boolean;
}): ShinraStatusContext => {
  const lastAssistantMessage = getLatestAssistantMessage(messages);
  const lastAssistantIndex = lastAssistantMessage
    ? findLastMatchingIndex(messages, (message) => message.id === lastAssistantMessage.id)
    : -1;
  const lastUserIndex = findLastMatchingIndex(messages, (message) => message.role === "user");
  const isResponseState = assistantState === "thinking" || assistantState === "speaking" || isStreaming;
  const hasCurrentResponse = Boolean(lastAssistantMessage?.content.trim()) && lastAssistantIndex > lastUserIndex;
  const activeToolCalls = getLatestActiveToolCalls(lastAssistantMessage);
  const primaryToolCall = activeToolCalls[0];
  const activeAgentRoom = getLatestActiveAgentRoom(agentRooms);
  const activePermission = permissionRequests[0];
  const activeCapture = activeCaptures[0];
  const toolLabels = activeToolCalls.map((toolCall) => formatToolName(toolCall.name));

  let phase: ShinraPresencePhase = "idle";
  let phaseLabel = "Idle";
  let workSummary = WORKING_STATE_COPY[assistantState] ?? "Standing by";
  let indicators: string[] = [];

  if (connectionStatus === "disconnected") {
    phase = "waiting";
    phaseLabel = "Disconnected";
    workSummary = "Waiting for the backend link to return";
    indicators = ["Bridge offline"];
  } else if (connectionStatus === "connecting") {
    phase = "waiting";
    phaseLabel = "Connecting";
    workSummary = "Re-establishing the bridge to Spira";
    indicators = ["Handshake in progress"];
  } else if (isApplyingUpgrade(connectionStatus, upgradeBanner)) {
    phase = "upgrading";
    phaseLabel = "Upgrading";
    workSummary = getUpgradeSummary(upgradeBanner) ?? "Applying a self-upgrade";
    indicators = uniq(["Self-upgrade", upgradeBanner?.scope ? formatToolName(upgradeBanner.scope) : undefined]);
  } else if (assistantState === "error") {
    phase = "error";
    phaseLabel = "Error";
    workSummary = WORKING_STATE_COPY.error ?? "Attention required";
  } else if (isResetting) {
    phase = "waiting";
    phaseLabel = "Resetting";
    workSummary = "Preparing a fresh conversation";
    indicators = ["Session reset"];
  } else if (isAborting) {
    phase = "waiting";
    phaseLabel = "Stopping";
    workSummary = "Stopping the current response";
    indicators = ["Abort requested"];
  } else if (activePermission) {
    phase = "waiting";
    phaseLabel = "Waiting";
    workSummary = `Awaiting approval for ${activePermission.toolTitle}`;
    indicators = uniq([
      "Permission boundary",
      activePermission.serverName,
      activePermission.readOnly ? "Read-only request" : "Write-capable request",
    ]);
  } else if (activeCapture) {
    phase = "investigating";
    phaseLabel = "Investigating";
    workSummary = summarizeCaptureTool(activeCapture.toolName);
    indicators = uniq(["Desktop awareness", formatToolName(activeCapture.toolName)]);
  } else if (activeAgentRoom) {
    phase = "delegating";
    phaseLabel = "Delegating";
    workSummary = activeAgentRoom.detail
      ? clampText(normalizeWhitespace(activeAgentRoom.detail), 110)
      : `Directing ${activeAgentRoom.label}`;
    indicators = uniq([
      activeAgentRoom.label,
      activeAgentRoom.caption,
      activeAgentRoom.lastToolName ? formatToolName(activeAgentRoom.lastToolName) : undefined,
    ]);
  } else if (primaryToolCall) {
    const toolPresence = summarizeToolCall(primaryToolCall);
    phase = toolPresence.phase;
    phaseLabel = toolPresence.phaseLabel;
    workSummary =
      toolPresence.workSummary ??
      `${primaryToolCall.status === "pending" ? "Queueing" : "Running"} ${formatToolName(primaryToolCall.name)}`;
    indicators = uniq([
      activeToolCalls.length > 1 ? `${activeToolCalls.length} live tools` : "1 live tool",
      ...toolPresence.indicators,
      ...toolLabels,
    ]);
  } else if (assistantState === "speaking" || (isStreaming && hasCurrentResponse)) {
    phase = "reporting";
    phaseLabel = "Reporting";
    workSummary = "Delivering the current response";
    indicators = ["Live reply"];
  } else if (assistantState === "thinking") {
    phase = "planning";
    phaseLabel = "Planning";
    workSummary = WORKING_STATE_COPY.thinking ?? "Deciding the next move";
  } else if (assistantState === "transcribing") {
    phase = "transcribing";
    phaseLabel = "Transcribing";
    workSummary = WORKING_STATE_COPY.transcribing ?? "Transcribing audio";
  } else if (assistantState === "listening") {
    phase = "listening";
    phaseLabel = "Listening";
    workSummary = WORKING_STATE_COPY.listening ?? "Listening for input";
  } else if (assistantState === "idle") {
    phase = "idle";
    phaseLabel = formatLabel(assistantState);
    workSummary = "Standing by";
  }

  return {
    phase,
    phaseLabel,
    lastAssistantMessage,
    hasCurrentResponse,
    isResponseState,
    workSummary,
    indicators,
    statusLine: `${phaseLabel} - ${workSummary ?? "Standing by"}`,
  };
};

export const buildAssistantDockSummary = ({
  activeView,
  assistantState,
  isStreaming,
  messages,
  connectionStatus = "connected",
  permissionRequests = [],
  activeCaptures = [],
  agentRooms = [],
  upgradeBanner = null,
  isAborting = false,
  isResetting = false,
}: {
  activeView: SpiraUiView;
  assistantState: AssistantState;
  isStreaming: boolean;
  messages: ChatMessage[];
  connectionStatus?: ConnectionStatus;
  permissionRequests?: PermissionRequestPayload[];
  activeCaptures?: Array<{ toolName: string; args?: unknown }>;
  agentRooms?: AgentRoom[];
  upgradeBanner?: UpgradeBannerState | null;
  isAborting?: boolean;
  isResetting?: boolean;
}): SpiraUiAssistantDockSummary => {
  const context = getShinraStatusContext({
    assistantState,
    isStreaming,
    messages,
    connectionStatus,
    permissionRequests,
    activeCaptures,
    agentRooms,
    upgradeBanner,
    isAborting,
    isResetting,
  });
  const visible = activeView !== "bridge";

  return {
    visible,
    expanded: visible && context.isResponseState && context.hasCurrentResponse,
    workSummary: context.workSummary,
    responsePreview: context.hasCurrentResponse
      ? summarizeResponsePreview(context.lastAssistantMessage?.content ?? "")
      : undefined,
    phaseLabel: context.phaseLabel,
    indicators: context.indicators,
  };
};
