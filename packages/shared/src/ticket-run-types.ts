export const TICKET_RUN_STATUSES = [
  "starting",
  "ready",
  "blocked",
  "working",
  "awaiting-review",
  "error",
  "done",
] as const;
export type TicketRunStatus = (typeof TICKET_RUN_STATUSES)[number];

export const TICKET_RUN_CLEANUP_STATES = ["retained", "removed"] as const;
export type TicketRunCleanupState = (typeof TICKET_RUN_CLEANUP_STATES)[number];

export const TICKET_RUN_ATTEMPT_STATUSES = ["running", "completed", "failed", "cancelled"] as const;
export type TicketRunAttemptStatus = (typeof TICKET_RUN_ATTEMPT_STATUSES)[number];

export const TICKET_RUN_PROOF_STATUSES = [
  "not-run",
  "running",
  "passed",
  "failed",
  "stale",
  // Phase 2.1 — gate satisfied by the operator's manual review (no automated proof artifact required).
  // Carries a justification recorded with the proof-set-manual-review-only mission event.
  "manual-review",
  // Phase 2.3 — proof preflight identified blockers before the harness ran.
  // Recoverable: operator fixes the blockers and reruns, or chooses manual-review.
  "preflight-blocked",
] as const;
export type TicketRunProofStatus = (typeof TICKET_RUN_PROOF_STATUSES)[number];

export const TICKET_RUN_PROOF_RUN_STATUSES = ["running", "passed", "failed", "preflight-blocked"] as const;
export type TicketRunProofRunStatus = (typeof TICKET_RUN_PROOF_RUN_STATUSES)[number];

export const TICKET_RUN_MISSION_PHASES = [
  "classification",
  "plan",
  "implement",
  "validate",
  "proof",
  "summarize",
] as const;
export type TicketRunMissionPhase = (typeof TICKET_RUN_MISSION_PHASES)[number];

export const TICKET_RUN_MISSION_CLASSIFICATIONS = ["backend", "frontend", "ui", "infra", "mixed", "unknown"] as const;
export type TicketRunMissionClassificationKind = (typeof TICKET_RUN_MISSION_CLASSIFICATIONS)[number];

export const TICKET_RUN_MISSION_PROOF_ARTIFACT_MODES = ["none", "screenshot", "video"] as const;
export type TicketRunMissionProofArtifactMode = (typeof TICKET_RUN_MISSION_PROOF_ARTIFACT_MODES)[number];

export const TICKET_RUN_MISSION_PROOF_LEVELS = [
  "none",
  "light",
  "targeted-screenshot",
  "full-ui-proof",
  "manual-review-only",
] as const;
export type TicketRunMissionProofLevel = (typeof TICKET_RUN_MISSION_PROOF_LEVELS)[number];

export const TICKET_RUN_MISSION_VALIDATION_KINDS = [
  "build",
  "unit-test",
  "lint",
  "typecheck",
  // Phase 3.4 — additional kinds so validation profiles can describe a fuller catalog of
  // what "validation" looks like for a repo (dependency restore, formatter check,
  // smoke-only e2e). The rule scoring and recording paths treat all kinds equivalently;
  // the value is in giving the operator + the agent better vocabulary.
  "restore",
  "format",
  "e2e-smoke",
] as const;
export type TicketRunMissionValidationKind = (typeof TICKET_RUN_MISSION_VALIDATION_KINDS)[number];

export const TICKET_RUN_MISSION_VALIDATION_STATUSES = ["pending", "passed", "failed", "skipped"] as const;
export type TicketRunMissionValidationStatus = (typeof TICKET_RUN_MISSION_VALIDATION_STATUSES)[number];

export const TICKET_RUN_MISSION_PROOF_PREFLIGHT_STATUSES = ["runnable", "blocked", "degraded"] as const;
export type TicketRunMissionProofPreflightStatus = (typeof TICKET_RUN_MISSION_PROOF_PREFLIGHT_STATUSES)[number];

export const TICKET_RUN_MISSION_WORKFLOW_WAIT_REASONS = [
  "context-not-loaded",
  "classification-missing",
  "plan-missing",
  "validation-missing",
  "validation-pending",
  "validation-failed",
  "proof-strategy-missing",
  "proof-missing",
  "summary-missing",
  "complete",
] as const;
export type TicketRunMissionWorkflowWaitReason = (typeof TICKET_RUN_MISSION_WORKFLOW_WAIT_REASONS)[number];

export const TICKET_RUN_PROOF_ARTIFACT_KINDS = [
  "folder",
  "report",
  "trace",
  "video",
  "screenshot",
  "log",
  "other",
] as const;
export type TicketRunProofArtifactKind = (typeof TICKET_RUN_PROOF_ARTIFACT_KINDS)[number];

export interface StartTicketRunRequest {
  ticketId: string;
  ticketSummary: string;
  ticketUrl: string;
  projectKey: string;
}

export interface TicketRunWorktreeSummary {
  repoRelativePath: string;
  repoAbsolutePath: string;
  worktreePath: string;
  branchName: string;
  commitMessageDraft?: string | null;
  cleanupState: TicketRunCleanupState;
  createdAt: number;
  updatedAt: number;
}

export interface TicketRunSubmoduleParentRef {
  parentRepoRelativePath: string;
  submodulePath: string;
  submoduleWorktreePath: string;
}

export interface TicketRunSubmoduleSummary {
  canonicalUrl: string;
  name: string;
  branchName: string;
  commitMessageDraft: string | null;
  parentRefs: TicketRunSubmoduleParentRef[];
  createdAt: number;
  updatedAt: number;
}

export interface TicketRunAttemptSummary {
  attemptId: string;
  runId: string;
  subagentRunId: string | null;
  sequence: number;
  status: TicketRunAttemptStatus;
  prompt: string | null;
  summary: string | null;
  followupNeeded: boolean;
  startedAt: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface TicketRunProofArtifact {
  artifactId: string;
  kind: TicketRunProofArtifactKind;
  label: string;
  path: string;
  fileUrl: string;
}

export interface TicketRunProofRunSummary {
  proofRunId: string;
  runId: string;
  profileId: string;
  profileLabel: string;
  status: TicketRunProofRunStatus;
  summary: string | null;
  startedAt: number;
  completedAt: number | null;
  exitCode: number | null;
  command: string | null;
  artifacts: TicketRunProofArtifact[];
}

export interface TicketRunProofSummary {
  status: TicketRunProofStatus;
  lastProofRunId: string | null;
  lastProofProfileId: string | null;
  lastProofAt: number | null;
  lastProofSummary: string | null;
  staleReason: string | null;
  /** Phase 2.1 — operator's free-text justification when the gate is satisfied via manual review. */
  manualReviewJustification: string | null;
  /** Phase 2.1 — when the manual-review status was set, for audit display. */
  manualReviewAt: number | null;
}

export interface TicketRunProofProfileSummary {
  profileId: string;
  label: string;
  description: string;
  kind: "playwright-dotnet-nunit";
  repoRelativePath: string;
  projectRelativePath: string;
  runSettingsRelativePath: string | null;
}

export interface TicketRunMissionWorkflowState {
  kickoffComplete: boolean;
  classificationSaved: boolean;
  planSaved: boolean;
  hasPassingValidation: boolean;
  hasFailingValidation: boolean;
  hasPendingValidation: boolean;
  proofRequired: boolean;
  proofStrategySaved: boolean;
  proofPassed: boolean;
  summarySaved: boolean;
  nextAction:
    | "load-context"
    | "save-classification"
    | "save-plan"
    | "record-validation"
    | "save-proof-strategy"
    | "record-proof-result"
    | "save-summary"
    | "complete-pass";
  nextActionLabel: string;
  waitReason: TicketRunMissionWorkflowWaitReason;
  blockedReason: string | null;
}

export interface TicketRunMissionClassification {
  kind: TicketRunMissionClassificationKind;
  scopeSummary: string;
  acceptanceCriteria: string[];
  impactedRepoRelativePaths: string[];
  risks: string[];
  uiChange: boolean;
  proofRequired: boolean;
  proofArtifactMode: TicketRunMissionProofArtifactMode;
  advisoryProofLevel?: TicketRunMissionProofLevel | null;
  advisoryProofRationale?: string | null;
  rationale: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TicketRunMissionPlan {
  steps: string[];
  touchedRepoRelativePaths: string[];
  validationPlan: string[];
  proofIntent: string | null;
  blockers: string[];
  assumptions: string[];
  createdAt: number;
  updatedAt: number;
}

export interface TicketRunMissionValidationRecord {
  validationId: string;
  runId: string;
  kind: TicketRunMissionValidationKind;
  command: string;
  cwd: string;
  supersedesValidationIds?: string[];
  status: TicketRunMissionValidationStatus;
  summary: string | null;
  artifacts: TicketRunProofArtifact[];
  startedAt: number;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface TicketRunMissionProofStrategy {
  runId: string;
  adapterId: string;
  repoRelativePath: string;
  scenarioPath: string | null;
  scenarioName: string | null;
  command: string;
  artifactMode: TicketRunMissionProofArtifactMode;
  rationale: string;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface TicketRunMissionSummary {
  completedWork: string;
  changedRepoRelativePaths: string[];
  validationSummary: string | null;
  proofSummary: string | null;
  openQuestions: string[];
  followUps: string[];
  createdAt: number;
  updatedAt: number;
}

export interface TicketRunPreviousPassContext {
  attemptId: string;
  sequence: number;
  completedAt: number;
  summary: string | null;
  classification: TicketRunMissionClassification | null;
  plan: TicketRunMissionPlan | null;
  validations: TicketRunMissionValidationRecord[];
  proofStrategy: TicketRunMissionProofStrategy | null;
  missionSummary: TicketRunMissionSummary | null;
  proof: TicketRunProofSummary;
}

export interface TicketRunSummary {
  runId: string;
  stationId: string | null;
  ticketId: string;
  ticketSummary: string;
  ticketUrl: string;
  projectKey: string;
  status: TicketRunStatus;
  statusMessage: string | null;
  commitMessageDraft: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number;
  worktrees: TicketRunWorktreeSummary[];
  submodules: TicketRunSubmoduleSummary[];
  attempts: TicketRunAttemptSummary[];
  missionPhase: TicketRunMissionPhase;
  missionPhaseUpdatedAt: number;
  classification: TicketRunMissionClassification | null;
  plan: TicketRunMissionPlan | null;
  validations: TicketRunMissionValidationRecord[];
  proofStrategy: TicketRunMissionProofStrategy | null;
  missionSummary: TicketRunMissionSummary | null;
  previousPassContext: TicketRunPreviousPassContext | null;
  proof: TicketRunProofSummary;
  proofRuns: TicketRunProofRunSummary[];
}

export interface TicketRunSnapshot {
  runs: TicketRunSummary[];
}

export interface StartTicketRunResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  reusedExistingRun: boolean;
}

export interface RetryTicketRunSyncResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
}

export interface StartTicketRunWorkResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
}

export interface ContinueTicketRunWorkResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  reusedLiveAttempt: boolean;
}

export interface CancelTicketRunWorkResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
}

export interface CompleteTicketRunResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
}

export interface TicketRunProofSnapshot {
  runId: string;
  proof: TicketRunProofSummary;
  profiles: TicketRunProofProfileSummary[];
  proofRuns: TicketRunProofRunSummary[];
}

export interface TicketRunProofSnapshotResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  proofSnapshot: TicketRunProofSnapshot;
}

export interface TicketRunMissionEventSummary {
  id: number;
  runId: string;
  attemptId: string | null;
  stage: TicketRunMissionPhase | "system";
  eventType: string;
  metadata: Record<string, unknown> | null;
  occurredAt: number;
}

/**
 * Phase 3.4 — renderer-friendly validation profile snapshot. Mirrors the DB-side
 * ValidationProfileRecord (which lives in @spira/memory-db) but with renderer-friendly
 * types and the rolling-runtime field exposed.
 */
export interface MissionValidationProfileRecord {
  id: string;
  projectKey: string | null;
  repoRelativePath: string | null;
  label: string;
  kind: TicketRunMissionValidationKind;
  command: string;
  workingDirectory: string;
  notes: string | null;
  confidence: number;
  expectedRuntimeMs: number | null;
  /** Rolling-average observed runtime; populated by Phase 5's learning loop. */
  lastObservedRuntimeMs: number | null;
  prerequisites: string[];
  source: "builtin" | "user";
  createdAt: number;
  updatedAt: number;
}

export interface MissionValidationProfilesSnapshot {
  profiles: MissionValidationProfileRecord[];
}

export interface UpsertMissionValidationProfileInput {
  /** Optional id; if omitted the service mints one. */
  id?: string;
  projectKey?: string | null;
  repoRelativePath?: string | null;
  label: string;
  kind: TicketRunMissionValidationKind;
  command: string;
  workingDirectory: string;
  notes?: string | null;
  confidence?: number;
  expectedRuntimeMs?: number | null;
  prerequisites?: readonly string[];
}

/**
 * Phase 3.1 — first-class per-project repo profile. One record per `projectKey`. Carries
 * the metadata that's most expensive for a fresh mission to re-derive (registry, default
 * branch, required SDKs, where user-facing copy lives, etc.) so prompt context and the
 * onboarding wizard can both surface it.
 *
 * `source` follows the same vocabulary as repo_intelligence_entries:
 *  - `builtin`: ships with the application code.
 *  - `user`: captured by the operator via the admin pane / onboarding wizard.
 *  - `learned`: written by the Phase 5 learning loop (not yet active).
 */
export interface MissionRepoProfileRecord {
  projectKey: string;
  displayName: string;
  description: string | null;
  defaultBranch: string | null;
  defaultBuildWorkingDirectory: string | null;
  defaultRegistry: string | null;
  registryHints: string[];
  requiredEnvVars: string[];
  requiredSdks: string[];
  userFacingCopyGlobs: string[];
  uiTestGlobs: string[];
  notes: string | null;
  source: "builtin" | "user" | "learned";
  createdAt: number;
  updatedAt: number;
}

export interface MissionRepoProfilesSnapshot {
  profiles: MissionRepoProfileRecord[];
}

export interface UpsertMissionRepoProfileInput {
  projectKey: string;
  displayName: string;
  description?: string | null;
  defaultBranch?: string | null;
  defaultBuildWorkingDirectory?: string | null;
  defaultRegistry?: string | null;
  registryHints?: readonly string[];
  requiredEnvVars?: readonly string[];
  requiredSdks?: readonly string[];
  userFacingCopyGlobs?: readonly string[];
  uiTestGlobs?: readonly string[];
  notes?: string | null;
  source?: "builtin" | "user" | "learned";
}

/**
 * Phase 2.5 — proof rule snapshot returned to the renderer admin pane.
 * Mirrors the DB-side ProofRuleRecord but with renderer-friendly types.
 */
export interface MissionProofRuleRecord {
  id: string;
  projectKey: string | null;
  repoRelativePath: string | null;
  classificationKind: TicketRunMissionClassificationKind | null;
  uiChange: boolean | null;
  proofRequired: boolean | null;
  summaryKeywords: string[];
  recommendedLevel: TicketRunMissionProofLevel;
  rationale: string;
  source: "builtin" | "user";
  createdAt: number;
  updatedAt: number;
}

export interface MissionProofRulesSnapshot {
  rules: MissionProofRuleRecord[];
}

export interface UpsertMissionProofRuleInput {
  id?: string;
  projectKey?: string | null;
  repoRelativePath?: string | null;
  classificationKind?: TicketRunMissionClassificationKind | null;
  uiChange?: boolean | null;
  proofRequired?: boolean | null;
  summaryKeywords?: readonly string[];
  recommendedLevel: TicketRunMissionProofLevel;
  rationale: string;
}

export interface TicketRunMissionTimelineResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  events: TicketRunMissionEventSummary[];
}

export interface TicketRunRepoIntelligenceEntrySummary {
  id: string;
  projectKey: string | null;
  repoRelativePath: string | null;
  type: "briefing" | "pitfall" | "example";
  title: string;
  content: string;
  tags: string[];
  source: "builtin" | "user" | "learned";
  approved: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TicketRunRepoIntelligenceCandidatesResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  entries: TicketRunRepoIntelligenceEntrySummary[];
}

export interface ApproveTicketRunRepoIntelligenceResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  entry: TicketRunRepoIntelligenceEntrySummary;
}

export interface RunTicketRunProofResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  proofSnapshot: TicketRunProofSnapshot;
  proofRun: TicketRunProofRunSummary;
}

export interface DeleteTicketRunResult {
  runId: string;
  ticketId: string;
  snapshot: TicketRunSnapshot;
}

export interface TicketRunDiffFileSummary {
  path: string;
  previousPath: string | null;
  status: string;
  additions: number | null;
  deletions: number | null;
  patch: string;
}

export type TicketRunPushAction = "push" | "publish" | "none";

export interface TicketRunPullRequestLinks {
  open: string | null;
  draft: string | null;
}

export interface TicketRunGitState {
  runId: string;
  repoRelativePath: string;
  worktreePath: string;
  branchName: string;
  upstreamBranch: string | null;
  aheadCount: number;
  behindCount: number;
  hasDiff: boolean;
  pushAction: TicketRunPushAction;
  commitMessageDraft: string | null;
  pullRequestUrls: TicketRunPullRequestLinks;
  blockedBySubmoduleCanonicalUrls: string[];
  files: TicketRunDiffFileSummary[];
}

export interface TicketRunSubmoduleParentGitState {
  parentRepoRelativePath: string;
  submodulePath: string;
  submoduleWorktreePath: string;
  headSha: string | null;
  hasDiff: boolean;
  isPrimary: boolean;
  isAligned: boolean;
}

export interface TicketRunSubmoduleGitState {
  runId: string;
  canonicalUrl: string;
  name: string;
  branchName: string;
  worktreePath: string;
  upstreamBranch: string | null;
  aheadCount: number;
  behindCount: number;
  hasDiff: boolean;
  pushAction: TicketRunPushAction;
  commitMessageDraft: string | null;
  pullRequestUrls: TicketRunPullRequestLinks;
  files: TicketRunDiffFileSummary[];
  parents: TicketRunSubmoduleParentGitState[];
  primaryParentRepoRelativePath: string | null;
  committedSha: string | null;
  reconcileRequired: boolean;
  reconcileReason: string | null;
}

export type TicketRunReviewRepoState = Omit<TicketRunGitState, "files">;
export type TicketRunReviewSubmoduleState = Omit<TicketRunSubmoduleGitState, "files">;

export interface TicketRunDeleteBlocker {
  label: string;
  reason: string;
}

export interface TicketRunReviewRepoEntry {
  repoRelativePath: string;
  gitState: TicketRunReviewRepoState | null;
  error: string | null;
}

export interface TicketRunReviewSubmoduleEntry {
  canonicalUrl: string;
  gitState: TicketRunReviewSubmoduleState | null;
  error: string | null;
}

export interface TicketRunReviewSnapshot {
  runId: string;
  repoEntries: TicketRunReviewRepoEntry[];
  submoduleEntries: TicketRunReviewSubmoduleEntry[];
  visibleRepoPaths: string[];
  visibleSubmoduleUrls: string[];
  canClose: boolean;
  canDelete: boolean;
  deleteBlockers: TicketRunDeleteBlocker[];
}

export interface TicketRunReviewSnapshotResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  reviewSnapshot: TicketRunReviewSnapshot;
}

export interface TicketRunGitStateResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  gitState: TicketRunGitState;
}

export interface TicketRunSubmoduleGitStateResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  gitState: TicketRunSubmoduleGitState;
}

export interface GenerateTicketRunCommitDraftResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  gitState: TicketRunGitState;
}

export interface GenerateTicketRunSubmoduleCommitDraftResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  gitState: TicketRunSubmoduleGitState;
}

export interface SetTicketRunCommitDraftResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  gitState: TicketRunGitState;
}

export interface SetTicketRunSubmoduleCommitDraftResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  gitState: TicketRunSubmoduleGitState;
}

export interface CommitTicketRunResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  gitState: TicketRunGitState;
  commitSha: string;
}

export interface CommitTicketRunSubmoduleResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  gitState: TicketRunSubmoduleGitState;
  commitSha: string;
}

export interface SyncTicketRunRemoteResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  gitState: TicketRunGitState;
  action: Exclude<TicketRunPushAction, "none">;
}

export interface SyncTicketRunSubmoduleRemoteResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  gitState: TicketRunSubmoduleGitState;
  action: Exclude<TicketRunPushAction, "none">;
}

export interface CreateTicketRunPullRequestResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  gitState: TicketRunGitState;
  pullRequestUrl: string;
}

export interface CreateTicketRunSubmodulePullRequestResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  gitState: TicketRunSubmoduleGitState;
  pullRequestUrl: string;
}
