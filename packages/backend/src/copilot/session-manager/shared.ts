import type { ModelProviderId, SubagentRunHandle, SubagentRunSnapshot, WorkSessionPhase } from "@spira/shared";
import type { ProviderId, ProviderPermissionRequest, ProviderPermissionResult } from "../../provider/types.js";
import type { AssistantError } from "../../util/errors.js";

export const SESSION_INIT_TIMEOUT_MS = 20_000;
export const TURN_FIRST_ACTIVITY_TIMEOUT_MS = 120_000;
export const TURN_ACTIVITY_TIMEOUT_MS = 120_000;
export const TURN_HARD_TIMEOUT_MS = 15 * 60_000;
export const TURN_WATCHDOG_POLL_MS = 1_000;
export const PERMISSION_REQUEST_TIMEOUT_MS = 60_000;
export const REVIEW_STALL_TIMEOUT_MS = 5 * 60_000;

export const WORK_SESSION_WORKFLOW_PHASES: WorkSessionPhase[] = [
  "classify",
  "discover",
  "summarise",
  "plan",
  "implement",
  "validate",
];

export const ALL_PROVIDER_IDS: ProviderId[] = [
  "copilot",
  "azure-openai",
  "azure-openai-escalation",
  "openai",
  "openai-escalation",
] satisfies ModelProviderId[];

export interface SessionPersistence {
  load(): string | null;
  save(sessionId: string | null): void;
}

export interface ManagedSubagentLaunch {
  handle: SubagentRunHandle;
  completion: Promise<SubagentRunSnapshot | null>;
}

export type ReportedAssistantError = AssistantError & { reportedToClient?: boolean };

export type PendingPermissionRequest = {
  resolve: (result: ProviderPermissionResult) => void;
  timeout: NodeJS.Timeout;
};

export type ActiveTurnWatchdog = {
  promptEpoch: number;
  startedAt: number;
  lastActivityAt: number;
  firstActivityAt: number | null;
};

export const getPermissionToolName = (request: ProviderPermissionRequest): string | null =>
  "toolName" in request && typeof request.toolName === "string" ? request.toolName : null;

export const isVisionPermissionRequest = (
  request: ProviderPermissionRequest,
): request is ProviderPermissionRequest & {
  kind: "mcp";
  serverName: string;
  toolName: string;
  toolTitle?: string;
  args?: Record<string, unknown>;
  readOnly?: boolean;
} => {
  const toolName = getPermissionToolName(request);
  return request.kind === "mcp" && toolName !== null && toolName.startsWith("vision_");
};

export const isMissionServicePermissionRequest = (
  request: ProviderPermissionRequest,
): request is ProviderPermissionRequest & {
  kind: "custom-tool";
  toolName: "spira_start_mission_service" | "spira_stop_mission_service" | "spira_run_mission_proof";
  toolCallId?: string;
  args?: Record<string, unknown>;
} =>
  request.kind === "custom-tool" &&
  (() => {
    const toolName = getPermissionToolName(request);
    return (
      toolName === "spira_start_mission_service" ||
      toolName === "spira_stop_mission_service" ||
      toolName === "spira_run_mission_proof"
    );
  })();

export const getMissionServiceToolTitle = (toolName: string): string => {
  switch (toolName) {
    case "spira_start_mission_service":
      return "Start mission service";
    case "spira_stop_mission_service":
      return "Stop mission service";
    case "spira_run_mission_proof":
      return "Run mission proof";
    default:
      return toolName;
  }
};

export const INTERACTIVE_HOST_TOOL_NAMES = new Set([
  "write_file",
  "apply_patch",
  "powershell",
  "write_powershell",
  "stop_powershell",
  "spira_escalate_session",
  "spira_session_set_plan",
  "spira_session_set_scratchpad",
  "spira_session_set_context",
]);

export const WORK_SESSION_IMPLEMENTATION_TOOL_NAMES = new Set(["apply_patch", "write_file"]);

export const WORK_SESSION_VALIDATION_COMMAND_TOKENS = new Set([
  "vitest",
  "jest",
  "mocha",
  "ava",
  "tap",
  "playwright",
  "cypress",
  "eslint",
  "biome",
  "tsc",
  "test",
  "tests",
  "lint",
  "typecheck",
  "build",
  "compile",
  "check",
]);

export const WORK_SESSION_MAX_IMPLEMENTATION_ATTEMPTS = 5;
export const WORK_SESSION_MAX_REPEAT_FAILURES = 2;

export type WorkSessionToolCompletion = {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  success: boolean;
  result: unknown;
  errorMessage: string | null;
};

export const HOST_TOOL_MISSION_ACTIONS = new Map<string, "load-context" | "repo-read" | "repo-write">([
  ["view", "repo-read"],
  ["glob", "repo-read"],
  ["rg", "repo-read"],
  ["read_powershell", "repo-read"],
  ["list_powershell", "repo-read"],
  ["spira_session_get_plan", "load-context"],
  ["spira_session_get_scratchpad", "load-context"],
  ["spira_session_get_context", "load-context"],
  ["write_file", "repo-write"],
  ["apply_patch", "repo-write"],
  ["powershell", "repo-write"],
  ["write_powershell", "repo-write"],
  ["stop_powershell", "repo-write"],
  ["spira_session_set_plan", "repo-write"],
  ["spira_session_set_scratchpad", "repo-write"],
  ["spira_session_set_context", "repo-write"],
]);

export const isInteractiveHostToolPermissionRequest = (
  request: ProviderPermissionRequest,
): request is ProviderPermissionRequest & {
  kind: "custom-tool";
  toolName: string;
  toolCallId?: string;
  args?: Record<string, unknown>;
} => request.kind === "custom-tool" && INTERACTIVE_HOST_TOOL_NAMES.has(getPermissionToolName(request) ?? "");
