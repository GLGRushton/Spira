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
  cleanupState: TicketRunCleanupState;
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
  attempts: TicketRunAttemptSummary[];
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
  worktreePath: string;
  branchName: string;
  upstreamBranch: string | null;
  aheadCount: number;
  behindCount: number;
  hasDiff: boolean;
  pushAction: TicketRunPushAction;
  commitMessageDraft: string | null;
  pullRequestUrls: TicketRunPullRequestLinks;
  files: TicketRunDiffFileSummary[];
}

export interface TicketRunGitStateResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  gitState: TicketRunGitState;
}

export interface GenerateTicketRunCommitDraftResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  gitState: TicketRunGitState;
}

export interface SetTicketRunCommitDraftResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  gitState: TicketRunGitState;
}

export interface CommitTicketRunResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  gitState: TicketRunGitState;
  commitSha: string;
}

export interface SyncTicketRunRemoteResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  gitState: TicketRunGitState;
  action: Exclude<TicketRunPushAction, "none">;
}

export interface CreateTicketRunPullRequestResult {
  run: TicketRunSummary;
  snapshot: TicketRunSnapshot;
  gitState: TicketRunGitState;
  pullRequestUrl: string;
}
