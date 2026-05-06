import type {
  AssistantState,
  McpServerConfig,
  McpServerSource,
  ModelProviderId,
  PermissionRequestPayload,
  SubagentDomain,
  SubagentRunSnapshot,
  SubagentSource,
  TicketRunAttemptStatus,
  TicketRunCleanupState,
  TicketRunMissionClassification,
  TicketRunMissionClassificationKind,
  TicketRunMissionPhase,
  TicketRunMissionPlan,
  TicketRunMissionProofArtifactMode,
  TicketRunMissionProofLevel,
  TicketRunMissionProofPreflightStatus,
  TicketRunMissionValidationKind,
  TicketRunMissionValidationStatus,
  TicketRunPreviousPassContext,
  TicketRunProofArtifactKind,
  TicketRunProofRunStatus,
  TicketRunProofStatus,
  TicketRunStatus,
  TicketRunSubmoduleParentRef,
} from "@spira/shared";

export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export const MEMORY_ENTRY_CATEGORIES = ["user-preference", "fact", "task-context", "correction"] as const;
export const REPO_INTELLIGENCE_ENTRY_TYPES = ["briefing", "pitfall", "example"] as const;
export const REPO_INTELLIGENCE_ENTRY_SOURCES = ["builtin", "user", "learned"] as const;
export const VALIDATION_PROFILE_KINDS = ["build", "unit-test", "lint", "typecheck"] as const;
export const RUNTIME_PERMISSION_REQUEST_STATUSES = ["pending", "approved", "denied", "expired"] as const;
export const RUNTIME_HOST_RESOURCE_STATUSES = [
  "running",
  "idle",
  "completed",
  "failed",
  "unrecoverable",
  "cancelled",
] as const;

export type ConversationRole = "user" | "assistant" | "system";
export type MemoryEntryCategory = (typeof MEMORY_ENTRY_CATEGORIES)[number];
export type RepoIntelligenceEntryType = (typeof REPO_INTELLIGENCE_ENTRY_TYPES)[number];
export type RepoIntelligenceEntrySource = (typeof REPO_INTELLIGENCE_ENTRY_SOURCES)[number];
export type ValidationProfileKind = (typeof VALIDATION_PROFILE_KINDS)[number];
export type RuntimePermissionRequestStatus = (typeof RUNTIME_PERMISSION_REQUEST_STATUSES)[number];
export type RuntimeHostResourceStatus = (typeof RUNTIME_HOST_RESOURCE_STATUSES)[number];

export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessageAt: number | null;
  lastViewedAt: number | null;
}

export interface ConversationToolCallRecord {
  callId: string | null;
  name: string;
  args: unknown;
  result: unknown;
  status: "pending" | "running" | "success" | "error" | null;
  details: string | null;
}

export interface ConversationMessageRecord {
  id: string;
  conversationId: string;
  role: ConversationRole;
  content: string;
  model: string | null;
  timestamp: number;
  wasAborted: boolean;
  autoSpeak: boolean;
  toolCalls: ConversationToolCallRecord[];
}

export interface ConversationRecord extends ConversationSummary {
  messages: ConversationMessageRecord[];
}

export interface ConversationSearchResult {
  conversationId: string;
  conversationTitle: string | null;
  messageId: string;
  role: ConversationRole;
  timestamp: number;
  snippet: string;
  score: number;
}

export interface MemoryEntryRecord {
  id: string;
  category: MemoryEntryCategory;
  content: string;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateConversationInput {
  id?: string;
  title?: string | null;
  createdAt?: number;
}

export interface AppendConversationMessageInput {
  id: string;
  conversationId: string;
  role: ConversationRole;
  content: string;
  model?: string | null;
  timestamp: number;
  wasAborted?: boolean;
  autoSpeak?: boolean;
}

export interface UpsertToolCallInput {
  messageId: string;
  callId?: string | null;
  name: string;
  args?: unknown;
  result?: unknown;
  status?: "pending" | "running" | "success" | "error";
  details?: string | null;
}

export interface RememberMemoryInput {
  id?: string;
  category?: MemoryEntryCategory;
  content: string;
  sourceConversationId?: string | null;
  sourceMessageId?: string | null;
  createdAt?: number;
}

export interface UpdateMemoryInput {
  memoryId: string;
  category?: MemoryEntryCategory;
  content?: string;
}

export interface OpenSpiraMemoryDatabaseOptions {
  readonly?: boolean;
}

export interface RuntimePermissionRequestRecord {
  requestId: string;
  stationId: string | null;
  payload: PermissionRequestPayload;
  status: RuntimePermissionRequestStatus;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}

export interface UpsertRuntimePermissionRequestInput {
  requestId: string;
  stationId?: string | null;
  payload: PermissionRequestPayload;
  createdAt?: number;
}

export interface RuntimeSubagentRunRecord {
  runId: string;
  stationId: string | null;
  snapshot: SubagentRunSnapshot;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
}

export interface UpsertRuntimeSubagentRunInput {
  runId: string;
  stationId?: string | null;
  snapshot: SubagentRunSnapshot;
  createdAt?: number;
}

export interface PersistedProviderUsageRecord {
  id: number;
  provider: ModelProviderId;
  stationId: string | null;
  runId: string | null;
  sessionId: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  latencyMs: number | null;
  observedAt: number;
  source: "provider" | "estimated" | "unknown";
}

export interface PersistedStationRecord {
  stationId: string;
  label: string;
  workingDirectory: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertPersistedStationInput {
  stationId: string;
  label: string;
  workingDirectory?: string | null;
  createdAt?: number;
}

export interface RuntimeStationToolCallRecord {
  callId: string;
  toolName: string;
  args: unknown;
  startedAt: number;
}

export interface RuntimeStationStateRecord {
  stationId: string;
  state: AssistantState;
  promptInFlight: boolean;
  providerId: ModelProviderId | null;
  activeSessionId: string | null;
  hostManifestHash: string | null;
  providerProjectionHash: string | null;
  activeToolCalls: RuntimeStationToolCallRecord[];
  abortRequestedAt: number | null;
  recoveryMessage: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertRuntimeStationStateInput {
  stationId: string;
  state: AssistantState;
  promptInFlight: boolean;
  providerId?: ModelProviderId | null;
  activeSessionId?: string | null;
  hostManifestHash?: string | null;
  providerProjectionHash?: string | null;
  activeToolCalls?: RuntimeStationToolCallRecord[];
  abortRequestedAt?: number | null;
  recoveryMessage?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface AppendProviderUsageRecordInput {
  provider: PersistedProviderUsageRecord["provider"];
  stationId?: string | null;
  runId?: string | null;
  sessionId?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  estimatedCostUsd?: number | null;
  latencyMs?: number | null;
  observedAt?: number;
  source: PersistedProviderUsageRecord["source"];
}

export interface PersistedRuntimeSessionRecord {
  runtimeSessionId: string;
  stationId: string | null;
  runId: string | null;
  kind: "station" | "subagent" | "background";
  contract: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertRuntimeSessionInput {
  runtimeSessionId: string;
  stationId?: string | null;
  runId?: string | null;
  kind: PersistedRuntimeSessionRecord["kind"];
  contract: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
}

export interface PersistedRuntimeCheckpointRecord {
  checkpointId: string;
  runtimeSessionId: string;
  stationId: string | null;
  runId: string | null;
  kind: string;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface UpsertRuntimeCheckpointInput {
  checkpointId: string;
  runtimeSessionId: string;
  stationId?: string | null;
  runId?: string | null;
  kind: string;
  summary: string;
  payload: Record<string, unknown>;
  createdAt?: number;
}

export interface PersistedRuntimeLedgerEventRecord {
  id: number;
  eventId: string;
  runtimeSessionId: string;
  stationId: string | null;
  runId: string | null;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: number;
}

export interface AppendRuntimeLedgerEventInput {
  eventId: string;
  runtimeSessionId: string;
  stationId?: string | null;
  runId?: string | null;
  type: string;
  payload: Record<string, unknown>;
  occurredAt?: number;
}

export interface RuntimeRecoverySummary {
  expiredPermissionRequestIds: string[];
  recoveredSubagentRunIds: string[];
  recoveredStationIds: string[];
  unrecoverableHostResourceIds: string[];
}

export interface PersistedRuntimeHostResourceRecord {
  resourceId: string;
  runtimeSessionId: string;
  stationId: string | null;
  kind: string;
  status: RuntimeHostResourceStatus;
  state: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertRuntimeHostResourceInput {
  resourceId: string;
  runtimeSessionId: string;
  stationId?: string | null;
  kind: string;
  status: RuntimeHostResourceStatus;
  state: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
}

export type McpServerConfigRecord = McpServerConfig & {
  description: string;
  source: McpServerSource;
  createdAt: number;
  updatedAt: number;
};

export type UpsertMcpServerConfigInput = McpServerConfig & {
  description?: string;
  source: McpServerSource;
  createdAt?: number;
};

export interface SubagentConfigRecord extends SubagentDomain {
  source: SubagentSource;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertSubagentConfigInput extends SubagentDomain {
  createdAt?: number;
}

export interface ProjectRepoMappingRecord {
  projectKey: string;
  repoRelativePaths: string[];
  updatedAt: number;
}

export interface RepoIntelligenceRecord {
  id: string;
  projectKey: string | null;
  repoRelativePath: string | null;
  type: RepoIntelligenceEntryType;
  title: string;
  content: string;
  tags: string[];
  source: RepoIntelligenceEntrySource;
  approved: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertRepoIntelligenceInput {
  id: string;
  projectKey?: string | null;
  repoRelativePath?: string | null;
  type: RepoIntelligenceEntryType;
  title: string;
  content: string;
  tags?: readonly string[];
  source: RepoIntelligenceEntrySource;
  approved?: boolean;
  createdAt?: number;
}

export interface ValidationProfileRecord {
  id: string;
  projectKey: string | null;
  repoRelativePath: string | null;
  label: string;
  kind: ValidationProfileKind;
  command: string;
  workingDirectory: string;
  notes: string | null;
  confidence: number;
  expectedRuntimeMs: number | null;
  prerequisites: string[];
  source: "builtin" | "user";
  createdAt: number;
  updatedAt: number;
}

export interface UpsertValidationProfileInput {
  id: string;
  projectKey?: string | null;
  repoRelativePath?: string | null;
  label: string;
  kind: ValidationProfileKind;
  command: string;
  workingDirectory: string;
  notes?: string | null;
  confidence?: number;
  expectedRuntimeMs?: number | null;
  prerequisites?: readonly string[];
  source: "builtin" | "user";
  createdAt?: number;
}

export interface ProofRuleRecord {
  id: string;
  projectKey: string | null;
  repoRelativePath: string | null;
  classificationKind: TicketRunMissionClassificationKind | null;
  uiChange: boolean | null;
  proofRequired: boolean | null;
  summaryKeywords: string[];
  recommendedLevel: TicketRunMissionProofLevel;
  rationale: string;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertProofRuleInput {
  id: string;
  projectKey?: string | null;
  repoRelativePath?: string | null;
  classificationKind?: TicketRunMissionClassificationKind | null;
  uiChange?: boolean | null;
  proofRequired?: boolean | null;
  summaryKeywords?: readonly string[];
  recommendedLevel: TicketRunMissionProofLevel;
  rationale: string;
  createdAt?: number;
}

export interface ProofDecisionRecord {
  runId: string;
  attemptId: string | null;
  recommendedLevel: TicketRunMissionProofLevel | null;
  preflightStatus: TicketRunMissionProofPreflightStatus | null;
  rationale: string | null;
  evidence: string[];
  repoRelativePaths: string[];
  createdAt: number;
  updatedAt: number;
}

export interface UpsertProofDecisionInput {
  runId: string;
  attemptId?: string | null;
  recommendedLevel?: TicketRunMissionProofLevel | null;
  preflightStatus?: TicketRunMissionProofPreflightStatus | null;
  rationale?: string | null;
  evidence?: readonly string[];
  repoRelativePaths?: readonly string[];
  createdAt?: number;
}

export interface MissionEventRecord {
  id: number;
  runId: string;
  attemptId: string | null;
  stage: string;
  eventType: string;
  metadata: Record<string, unknown> | null;
  occurredAt: number;
}

export interface AppendMissionEventInput {
  runId: string;
  attemptId?: string | null;
  stage: string;
  eventType: string;
  metadata?: Record<string, unknown> | null;
  occurredAt?: number;
}

export interface UpsertTicketRunWorktreeInput {
  repoRelativePath: string;
  repoAbsolutePath: string;
  worktreePath: string;
  branchName: string;
  commitMessageDraft?: string | null;
  cleanupState?: TicketRunCleanupState;
  createdAt?: number;
  updatedAt?: number;
}

export interface UpsertTicketRunSubmoduleInput {
  canonicalUrl: string;
  name: string;
  branchName: string;
  commitMessageDraft?: string | null;
  parentRefs: readonly TicketRunSubmoduleParentRef[];
  createdAt?: number;
  updatedAt?: number;
}

export interface UpsertTicketRunInput {
  runId: string;
  stationId?: string | null;
  ticketId: string;
  ticketSummary: string;
  ticketUrl: string;
  projectKey: string;
  status: TicketRunStatus;
  statusMessage?: string | null;
  commitMessageDraft?: string | null;
  startedAt?: number;
  createdAt?: number;
  worktrees: readonly UpsertTicketRunWorktreeInput[];
  submodules?: readonly UpsertTicketRunSubmoduleInput[];
  attempts?: readonly UpsertTicketRunAttemptInput[];
  missionPhase?: TicketRunMissionPhase;
  missionPhaseUpdatedAt?: number;
  classification?: TicketRunMissionClassification | null;
  plan?: TicketRunMissionPlan | null;
  validations?: readonly UpsertTicketRunValidationInput[];
  proofStrategy?: UpsertTicketRunProofStrategyInput | null;
  missionSummary?: UpsertTicketRunMissionSummaryInput | null;
  previousPassContext?: TicketRunPreviousPassContext | null;
  proof?: UpsertTicketRunProofInput;
  proofRuns?: readonly UpsertTicketRunProofRunInput[];
}

export interface UpsertTicketRunAttemptInput {
  attemptId: string;
  subagentRunId?: string | null;
  sequence: number;
  status: TicketRunAttemptStatus;
  prompt?: string | null;
  summary?: string | null;
  followupNeeded?: boolean;
  startedAt?: number;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number | null;
}

export interface UpsertTicketRunProofInput {
  status?: TicketRunProofStatus;
  lastProofRunId?: string | null;
  lastProofProfileId?: string | null;
  lastProofAt?: number | null;
  lastProofSummary?: string | null;
  staleReason?: string | null;
}

export interface UpsertTicketRunValidationInput {
  validationId: string;
  kind: TicketRunMissionValidationKind;
  command: string;
  cwd: string;
  supersedesValidationIds?: readonly string[];
  status: TicketRunMissionValidationStatus;
  summary?: string | null;
  artifacts?: readonly UpsertTicketRunProofArtifactInput[];
  startedAt?: number;
  completedAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface UpsertTicketRunProofStrategyInput {
  adapterId: string;
  repoRelativePath: string;
  scenarioPath?: string | null;
  scenarioName?: string | null;
  command: string;
  artifactMode: TicketRunMissionProofArtifactMode;
  rationale: string;
  metadata?: Record<string, unknown> | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface UpsertTicketRunMissionSummaryInput {
  completedWork: string;
  changedRepoRelativePaths: readonly string[];
  validationSummary?: string | null;
  proofSummary?: string | null;
  openQuestions?: readonly string[];
  followUps?: readonly string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface UpsertTicketRunProofArtifactInput {
  artifactId: string;
  kind: TicketRunProofArtifactKind;
  label: string;
  path: string;
  fileUrl: string;
}

export interface UpsertTicketRunProofRunInput {
  proofRunId: string;
  profileId: string;
  profileLabel: string;
  status: TicketRunProofRunStatus;
  summary?: string | null;
  startedAt?: number;
  completedAt?: number | null;
  exitCode?: number | null;
  command?: string | null;
  artifacts?: readonly UpsertTicketRunProofArtifactInput[];
}
