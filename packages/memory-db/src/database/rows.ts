export interface ConversationSummaryRow {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessageAt: number | null;
  lastViewedAt: number | null;
}

export interface ConversationMessageRow {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  model: string | null;
  timestamp: number;
  wasAborted: number;
  autoSpeak: number;
}

export interface ToolCallRow {
  messageId: string;
  callId: string | null;
  name: string;
  args: string | null;
  result: string | null;
  status: string | null;
  details: string | null;
}

export interface ConversationSearchRow {
  conversationId: string;
  conversationTitle: string | null;
  messageId: string;
  role: string;
  timestamp: number;
  snippet: string;
  score: number;
}

export interface MemoryEntryRow {
  id: string;
  category: string;
  content: string;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SessionStateRow {
  value: string | null;
}

export interface SessionStateKeyRow {
  key: string;
}

export interface SessionStateRecordRow {
  key: string;
  value: string | null;
  updatedAt: number;
}

export interface RuntimePermissionRequestRow {
  requestId: string;
  stationId: string | null;
  payloadJson: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}

export interface RuntimeSubagentRunRow {
  runId: string;
  stationId: string | null;
  snapshotJson: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
}

export interface RuntimeSessionRow {
  runtimeSessionId: string;
  stationId: string | null;
  runId: string | null;
  kind: string;
  contractJson: string;
  createdAt: number;
  updatedAt: number;
}

export interface RuntimeCheckpointRow {
  checkpointId: string;
  runtimeSessionId: string;
  stationId: string | null;
  runId: string | null;
  kind: string;
  summary: string;
  payloadJson: string;
  createdAt: number;
}

export interface RuntimeLedgerEventRow {
  id: number;
  eventId: string;
  runtimeSessionId: string;
  stationId: string | null;
  runId: string | null;
  type: string;
  payloadJson: string;
  occurredAt: number;
}

export interface RuntimeHostResourceRow {
  resourceId: string;
  runtimeSessionId: string;
  stationId: string | null;
  kind: string;
  status: string;
  stateJson: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderUsageRecordRow {
  id: number;
  provider: string;
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
  source: string;
}

export interface ProjectWorkspaceConfigRow {
  workspaceRoot: string | null;
}

export interface ProjectRepoMappingRow {
  projectKey: string;
  repoRelativePath: string;
  updatedAt: number;
}

export interface RepoIntelligenceRow {
  id: string;
  projectKey: string | null;
  repoRelativePath: string | null;
  type: string;
  title: string;
  content: string;
  tagsJson: string;
  source: string;
  approved: number;
  createdAt: number;
  updatedAt: number;
}

export interface ValidationProfileRow {
  id: string;
  projectKey: string | null;
  repoRelativePath: string | null;
  label: string;
  kind: string;
  command: string;
  workingDirectory: string;
  notes: string | null;
  confidence: number;
  expectedRuntimeMs: number | null;
  lastObservedRuntimeMs: number | null;
  prerequisitesJson: string;
  source: string;
  createdAt: number;
  updatedAt: number;
}

export interface RepoProfileRow {
  projectKey: string;
  displayName: string;
  description: string | null;
  defaultBranch: string | null;
  defaultBuildWorkingDirectory: string | null;
  defaultRegistry: string | null;
  registryHintsJson: string;
  requiredEnvVarsJson: string;
  requiredSdksJson: string;
  userFacingCopyGlobsJson: string;
  uiTestGlobsJson: string;
  notes: string | null;
  source: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProofRuleRow {
  id: string;
  projectKey: string | null;
  repoRelativePath: string | null;
  classificationKind: string | null;
  uiChange: number | null;
  proofRequired: number | null;
  summaryKeywordsJson: string;
  recommendedLevel: string;
  rationale: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProofDecisionRow {
  runId: string;
  attemptId: string | null;
  recommendedLevel: string | null;
  preflightStatus: string | null;
  rationale: string | null;
  evidenceJson: string | null;
  repoRelativePathsJson: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MissionEventRow {
  id: number;
  runId: string;
  attemptId: string | null;
  stage: string;
  eventType: string;
  metadataJson: string | null;
  occurredAt: number;
}

export interface YouTrackStateMappingRow {
  todoJson: string;
  inProgressJson: string;
  updatedAt: number;
}

export interface TicketRunRow {
  runId: string;
  stationId: string | null;
  ticketId: string;
  ticketSummary: string;
  ticketUrl: string;
  projectKey: string;
  status: string;
  statusMessage: string | null;
  commitMessageDraft: string | null;
  missionPhase: string;
  missionPhaseUpdatedAt: number;
  classificationJson: string | null;
  planJson: string | null;
  summaryJson: string | null;
  previousPassContextJson: string | null;
  proofStatus: string;
  lastProofRunId: string | null;
  lastProofProfileId: string | null;
  lastProofAt: number | null;
  lastProofSummary: string | null;
  proofStaleReason: string | null;
  proofManualReviewJustification: string | null;
  proofManualReviewAt: number | null;
  startedAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface TicketRunValidationRow {
  validationId: string;
  runId: string;
  kind: string;
  command: string;
  cwd: string;
  supersedesValidationIdsJson: string | null;
  status: string;
  summary: string | null;
  artifactsJson: string | null;
  startedAt: number;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface TicketRunProofStrategyRow {
  runId: string;
  adapterId: string;
  repoRelativePath: string;
  scenarioPath: string | null;
  scenarioName: string | null;
  command: string;
  artifactMode: string;
  rationale: string;
  metadataJson: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TicketRunWorktreeRow {
  runId: string;
  repoRelativePath: string;
  repoAbsolutePath: string;
  worktreePath: string;
  branchName: string;
  commitMessageDraft: string | null;
  cleanupState: string;
  createdAt: number;
  updatedAt: number;
}

export interface TicketRunAttemptRow {
  attemptId: string;
  runId: string;
  subagentRunId: string | null;
  sequence: number;
  status: string;
  prompt: string | null;
  summary: string | null;
  followupNeeded: number;
  startedAt: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface TicketRunSubmoduleRow {
  runId: string;
  canonicalUrl: string;
  name: string;
  branchName: string;
  commitMessageDraft: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TicketRunSubmoduleParentRow {
  runId: string;
  canonicalUrl: string;
  parentRepoRelativePath: string;
  submodulePath: string;
  submoduleWorktreePath: string;
}

export interface TicketRunProofRunRow {
  proofRunId: string;
  runId: string;
  profileId: string;
  profileLabel: string;
  status: string;
  summary: string | null;
  startedAt: number;
  completedAt: number | null;
  exitCode: number | null;
  command: string | null;
  artifactsJson: string | null;
}

export interface McpServerConfigRow {
  id: string;
  name: string;
  description: string;
  source: string;
  transport: "stdio" | "streamable-http";
  command: string;
  argsJson: string;
  envJson: string | null;
  url: string | null;
  headersJson: string | null;
  toolAccessJson: string | null;
  enabled: number;
  autoRestart: number;
  maxRestarts: number;
  createdAt: number;
  updatedAt: number;
}

export interface SubagentConfigRow {
  id: string;
  label: string;
  description: string;
  source: string;
  systemPrompt: string;
  delegationToolName: string;
  serverIdsJson: string;
  allowedToolNamesJson: string | null;
  allowWrites: number;
  ready: number;
  createdAt: number;
  updatedAt: number;
}
