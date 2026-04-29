import type { ToolCallStatus } from "./chat-types.js";

export const SUBAGENT_DOMAIN_IDS = ["windows", "spira", "nexus", "data-entry", "code-review"] as const;
export type BuiltinSubagentDomainId = (typeof SUBAGENT_DOMAIN_IDS)[number];
export type SubagentDomainId = string;
export const SUBAGENT_SCOPE_IDS = [...SUBAGENT_DOMAIN_IDS, "shinra"] as const;
export type SubagentScopeId = SubagentDomainId | "shinra";

export type SubagentSource = "builtin" | "user";

export interface SubagentDomain {
  id: SubagentDomainId;
  label: string;
  description?: string;
  serverIds: string[];
  allowedToolNames?: string[] | null;
  allowHostTools?: boolean;
  delegationToolName: string;
  allowWrites: boolean;
  systemPrompt: string;
  ready?: boolean;
  source?: SubagentSource;
}

export type SubagentCreateConfig = Omit<SubagentDomain, "id" | "source" | "delegationToolName"> & {
  id?: string;
  delegationToolName?: string;
};

export const SUBAGENT_DOMAINS: readonly SubagentDomain[] = [
  {
    id: "windows",
    label: "Windows Agent",
    description: "Handles desktop control, system inspection, and visual reads across the host machine.",
    serverIds: ["windows-system", "windows-ui", "vision"],
    allowedToolNames: null,
    delegationToolName: "delegate_to_windows",
    allowWrites: true,
    systemPrompt: "",
    ready: true,
    source: "builtin",
  },
  {
    id: "spira",
    label: "Spira Agent",
    description: "Works the live Spira interface and reports what the ship is doing from inside the app.",
    serverIds: ["spira-ui"],
    allowedToolNames: null,
    delegationToolName: "delegate_to_spira",
    allowWrites: true,
    systemPrompt: "",
    ready: true,
    source: "builtin",
  },
  {
    id: "nexus",
    label: "Nexus Agent",
    description: "Searches Nexus Mods, inspects listings, and gathers mod file details for game research.",
    serverIds: ["nexus-mods"],
    allowedToolNames: null,
    delegationToolName: "delegate_to_nexus",
    allowWrites: true,
    systemPrompt: "",
    ready: true,
    source: "builtin",
  },
  {
    id: "data-entry",
    label: "Data Entry Agent",
    description:
      "Creates and inspects custom MCP servers and custom subagents inside Spira's built-in data entry lane.",
    serverIds: ["spira-data-entry"],
    allowedToolNames: null,
    delegationToolName: "delegate_to_data_entry",
    allowWrites: true,
    systemPrompt: "",
    ready: true,
    source: "builtin",
  },
  {
    id: "code-review",
    label: "Code Review Agent",
    description: "Reviews repository code with host tools when exact model selection matters.",
    serverIds: [],
    allowedToolNames: null,
    allowHostTools: true,
    delegationToolName: "delegate_to_code_review",
    allowWrites: false,
    systemPrompt:
      "Perform repository review and investigation work with the host tools available to you. Stay read-only unless the caller explicitly requests a write-capable lane instead.",
    ready: true,
    source: "builtin",
  },
] as const;

export interface SubagentDelegationArgs {
  task: string;
  context?: string;
  model?: string;
  allowWrites?: boolean;
  mode?: "sync" | "background";
}

export interface SubagentArtifact {
  kind: string;
  id: string;
  label?: string;
  path?: string;
  metadata?: Record<string, unknown>;
}

export interface NormalizedStateChange {
  scope: SubagentScopeId;
  targetType: string;
  targetId: string;
  action: string;
  toolName?: string;
  serverId?: string;
  before?: unknown;
  after?: unknown;
}

export interface SubagentErrorRecord {
  code?: string;
  message: string;
  details?: string;
}

export interface SubagentResultPayload {
  summary: string;
  payload?: Record<string, unknown> | null;
}

export interface SubagentToolCallRecord {
  callId: string;
  toolName: string;
  serverId?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  status: ToolCallStatus;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  details?: string;
}

export type SubagentEnvelopeStatus = "completed" | "failed" | "partial";

export type SubagentRunStatus = "running" | "idle" | SubagentEnvelopeStatus | "cancelled" | "expired";

export interface SubagentRunHandle {
  agent_id: string;
  runId: string;
  roomId: `agent:${string}`;
  domain: SubagentDomainId;
  status: "running";
  startedAt: number;
}

export interface SubagentRunSnapshot {
  agent_id: string;
  runId: string;
  roomId: `agent:${string}`;
  domain: SubagentDomainId;
  task: string;
  requestedModel?: string;
  observedModel?: string;
  status: SubagentRunStatus;
  allowWrites?: boolean;
  workingDirectory?: string;
  providerSessionId?: string;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  summary?: string;
  followupNeeded?: boolean;
  expiresAt?: number;
  activeToolCalls?: SubagentToolCallRecord[];
  toolCalls?: SubagentToolCallRecord[];
  envelope?: SubagentEnvelope;
}

export interface SubagentEnvelope {
  runId: string;
  domain: SubagentDomainId;
  task: string;
  status: SubagentEnvelopeStatus;
  /** Number of automatic retries already consumed before this envelope was emitted. */
  retryCount: number;
  startedAt: number;
  /** For partial envelopes, this records when the partial result was emitted. */
  completedAt: number;
  /** For partial envelopes, this is measured to the emission time rather than final teardown. */
  durationMs: number;
  followupNeeded: boolean;
  summary: SubagentResultPayload["summary"];
  artifacts: SubagentArtifact[];
  stateChanges: NormalizedStateChange[];
  toolCalls: SubagentToolCallRecord[];
  errors: SubagentErrorRecord[];
  payload?: SubagentResultPayload["payload"];
}

export interface SubagentWriteIntentRequest {
  intentId: string;
  runId: string;
  domain: SubagentDomainId;
  targetType: string;
  targetId: string;
  action: string;
  toolName: string;
  serverId?: string;
  requestedAt: number;
  expiresAt: number;
}

export interface SubagentWriteIntentGrant {
  intentId: string;
  runId: string;
  grantedAt: number;
  expiresAt: number;
}

export interface SubagentWriteIntentDenial {
  intentId: string;
  runId: string;
  deniedAt: number;
  reason: string;
  conflictingRunId?: string;
}

export interface SubagentStartedEvent {
  runId: string;
  roomId: `agent:${string}`;
  domain: SubagentDomainId;
  label?: string;
  task: string;
  /** One-indexed attempt counter so the first execution is attempt 1. */
  attempt: number;
  startedAt: number;
  allowWrites: boolean;
}

export interface SubagentToolCallEvent {
  runId: string;
  roomId: `agent:${string}`;
  callId: string;
  toolName: string;
  serverId?: string;
  args?: Record<string, unknown>;
  startedAt: number;
}

export interface SubagentToolResultEvent {
  runId: string;
  roomId: `agent:${string}`;
  callId: string;
  toolName: string;
  serverId?: string;
  status: ToolCallStatus;
  result?: unknown;
  details?: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
}

export interface SubagentDeltaEvent {
  runId: string;
  roomId: `agent:${string}`;
  messageId: string;
  delta: string;
}

export interface SubagentStatusEvent {
  runId: string;
  roomId: `agent:${string}`;
  domain: SubagentDomainId;
  label?: string;
  status: SubagentRunStatus;
  occurredAt: number;
  summary?: string;
  expiresAt?: number;
}

export interface SubagentCompletedEvent {
  runId: string;
  roomId: `agent:${string}`;
  domain: SubagentDomainId;
  label?: string;
  completedAt: number;
  envelope: SubagentEnvelope;
}

export interface SubagentErrorEvent {
  runId: string;
  roomId: `agent:${string}`;
  domain: SubagentDomainId;
  label?: string;
  attempt: number;
  error: SubagentErrorRecord;
  willRetry: boolean;
  occurredAt: number;
}

export interface SubagentLockAcquiredEvent {
  roomId: `agent:${string}`;
  runId: string;
  request: SubagentWriteIntentRequest;
  grant: SubagentWriteIntentGrant;
}

export interface SubagentLockDeniedEvent {
  roomId: `agent:${string}`;
  runId: string;
  request: SubagentWriteIntentRequest;
  denial: SubagentWriteIntentDenial;
}

export interface SubagentLockReleasedEvent {
  roomId: `agent:${string}`;
  intentId: string;
  runId: string;
  releasedAt: number;
}
