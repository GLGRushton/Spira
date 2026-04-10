import type { ToolCallStatus } from "./chat-types.js";

export const SUBAGENT_DOMAIN_IDS = ["windows", "spira", "nexus"] as const;
export type SubagentDomainId = (typeof SUBAGENT_DOMAIN_IDS)[number];
export const SUBAGENT_SCOPE_IDS = [...SUBAGENT_DOMAIN_IDS, "shinra"] as const;
export type SubagentScopeId = (typeof SUBAGENT_SCOPE_IDS)[number];

export interface SubagentDomain {
  id: SubagentDomainId;
  label: string;
  serverIds: string[];
  delegationToolName: string;
  allowWrites: boolean;
  systemPrompt: string;
}

export const SUBAGENT_DOMAINS: readonly SubagentDomain[] = [
  {
    id: "windows",
    label: "Windows Agent",
    serverIds: ["windows-system", "windows-ui", "vision"],
    delegationToolName: "delegate_to_windows",
    allowWrites: true,
    systemPrompt: "",
  },
  {
    id: "spira",
    label: "Spira Agent",
    serverIds: ["spira-ui"],
    delegationToolName: "delegate_to_spira",
    allowWrites: true,
    systemPrompt: "",
  },
  {
    id: "nexus",
    label: "Nexus Agent",
    serverIds: ["nexus-mods"],
    delegationToolName: "delegate_to_nexus",
    allowWrites: true,
    systemPrompt: "",
  },
] as const;

export interface SubagentDelegationArgs {
  task: string;
  context?: string;
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
  status: SubagentRunStatus;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  summary?: string;
  followupNeeded?: boolean;
  expiresAt?: number;
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
  status: SubagentRunStatus;
  occurredAt: number;
  summary?: string;
  expiresAt?: number;
}

export interface SubagentCompletedEvent {
  runId: string;
  roomId: `agent:${string}`;
  domain: SubagentDomainId;
  completedAt: number;
  envelope: SubagentEnvelope;
}

export interface SubagentErrorEvent {
  runId: string;
  roomId: `agent:${string}`;
  domain: SubagentDomainId;
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
