import type { SpiraMemoryDatabase } from "@spira/memory-db";
import type {
  TicketRunDiffFileSummary,
  TicketRunGitState,
  TicketRunPullRequestLinks,
  TicketRunPushAction,
  TicketRunSubmoduleGitState,
  TicketRunSubmoduleParentRef,
  TicketRunSubmoduleSummary,
  TicketRunSummary,
} from "@spira/shared";
import type { Logger } from "pino";
import type { ProjectRegistry } from "../../projects/registry.js";
import type { SpiraEventBus } from "../../util/event-bus.js";
import type { DependencyWarmingResult, WarmRunDependenciesInput } from "../dependency-warmer.js";
import type { ProofPreflightResult } from "../proof-preflight.js";
import type { ResolvedMissionProofProfile } from "../proof-registry.js";
import type { RunMissionProofInput, RunMissionProofOutput } from "../proof-runner.js";

export interface GitCommandResult {
  stdout: string;
  stderr: string;
}

export type GitCommandRunner = (cwd: string, args: readonly string[]) => Promise<GitCommandResult>;

export interface ProjectRegistryLike {
  getSnapshot(): Promise<Awaited<ReturnType<ProjectRegistry["getSnapshot"]>>>;
}

export interface YouTrackWriteService {
  transitionTicketToInProgress(ticketId: string): Promise<void>;
}

export type SyncableRun = Pick<
  TicketRunSummary,
  | "runId"
  | "stationId"
  | "ticketId"
  | "ticketSummary"
  | "ticketUrl"
  | "projectKey"
  | "startedAt"
  | "createdAt"
  | "worktrees"
  | "submodules"
>;

export interface MissionPassResult {
  status: "completed" | "failed" | "cancelled";
  summary: string;
}

export interface MissionPassHandle {
  stationId: string;
  reusedLiveAttempt: boolean;
  completion: Promise<MissionPassResult>;
}

export interface LaunchMissionPassInput {
  run: TicketRunSummary;
  prompt: string;
}

export interface GenerateCommitDraftInput {
  run: TicketRunSummary;
  gitState: TicketRunGitState | TicketRunSubmoduleGitState;
}

export interface MissionGitIdentity {
  name: string;
  email: string;
}

export interface GitRepoStateSnapshot {
  worktreePath: string;
  branchName: string;
  upstreamBranch: string | null;
  aheadCount: number;
  behindCount: number;
  hasDiff: boolean;
  pushAction: TicketRunPushAction;
  pullRequestUrls: TicketRunPullRequestLinks;
  files: TicketRunDiffFileSummary[];
  diffFingerprint: string | null;
}

export interface ManagedSubmoduleRuntimeState {
  summary: TicketRunSubmoduleSummary;
  gitState: TicketRunSubmoduleGitState;
}

export interface ManagedSubmoduleParentRuntimeState {
  parentRef: TicketRunSubmoduleParentRef;
  gitState: GitRepoStateSnapshot;
  headSha: string | null;
  diffFingerprint: string | null;
}

export interface GitReadOptions {
  includeFiles?: boolean;
  allowHistoryFetch?: boolean;
}

export interface TicketRunServiceOptions {
  memoryDb: SpiraMemoryDatabase | null;
  projectRegistry: ProjectRegistryLike;
  youTrackService: YouTrackWriteService | null;
  logger: Logger;
  bus?: SpiraEventBus;
  now?: () => number;
  runIdFactory?: () => string;
  attemptIdFactory?: () => string;
  runGitCommand?: GitCommandRunner;
  launchMissionPass?: (input: LaunchMissionPassInput) => Promise<MissionPassHandle>;
  repairMissionPass?: (input: LaunchMissionPassInput) => Promise<MissionPassResult>;
  cancelMissionPass?: (stationId: string) => Promise<void>;
  closeMissionStation?: (stationId: string) => Promise<void>;
  stopRunServices?: (runId: string) => Promise<void>;
  generateCommitDraft?: (input: GenerateCommitDraftInput) => Promise<string>;
  discoverMissionProofProfiles?: (run: TicketRunSummary) => Promise<ResolvedMissionProofProfile[]>;
  runMissionProof?: (input: RunMissionProofInput) => Promise<RunMissionProofOutput>;
  /** Phase 2.3 — preflight delegate; defaults to {@link runProofPreflight} from proof-preflight.ts. */
  runProofPreflight?: (profile: ResolvedMissionProofProfile) => Promise<ProofPreflightResult>;
  /**
   * Dependency-warming delegate. Defaults to {@link warmRunDependencies}; tests stub it
   * with `async () => []` to skip the spawn entirely.
   */
  warmRunDependencies?: (input: WarmRunDependenciesInput) => Promise<DependencyWarmingResult[]>;
  resolveMissionGitIdentity?: () => Promise<MissionGitIdentity>;
  getMissionGitToken?: () => string | null;
}
