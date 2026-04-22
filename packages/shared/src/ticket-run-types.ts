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

export const TICKET_RUN_PROOF_STATUSES = ["not-run", "running", "passed", "failed", "stale"] as const;
export type TicketRunProofStatus = (typeof TICKET_RUN_PROOF_STATUSES)[number];

export const TICKET_RUN_PROOF_RUN_STATUSES = ["running", "passed", "failed"] as const;
export type TicketRunProofRunStatus = (typeof TICKET_RUN_PROOF_RUN_STATUSES)[number];

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
