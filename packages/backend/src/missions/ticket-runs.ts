import { randomUUID } from "node:crypto";
import { mkdir, open, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { RepoIntelligenceRecord, SpiraMemoryDatabase } from "@spira/memory-db";
import type {
  ApproveTicketRunRepoIntelligenceResult,
  CancelTicketRunWorkResult,
  CommitTicketRunResult,
  CommitTicketRunSubmoduleResult,
  CompleteTicketRunResult,
  ContinueTicketRunWorkResult,
  CreateTicketRunPullRequestResult,
  CreateTicketRunSubmodulePullRequestResult,
  DeleteTicketRunResult,
  GenerateTicketRunCommitDraftResult,
  GenerateTicketRunSubmoduleCommitDraftResult,
  MissionEventMetadataMap,
  MissionEventType,
  RetryTicketRunSyncResult,
  RunTicketRunProofResult,
  SetTicketRunCommitDraftResult,
  SetTicketRunSubmoduleCommitDraftResult,
  StartTicketRunRequest,
  StartTicketRunResult,
  StartTicketRunWorkResult,
  SyncTicketRunRemoteResult,
  SyncTicketRunSubmoduleRemoteResult,
  TicketRunAttemptStatus,
  TicketRunAttemptSummary,
  TicketRunDeleteBlocker,
  TicketRunDiffFileSummary,
  TicketRunGitState,
  TicketRunGitStateResult,
  TicketRunMissionEventSummary,
  TicketRunMissionTimelineResult,
  TicketRunPhaseBudgetSnapshot,
  TicketRunProofRunSummary,
  TicketRunProofSnapshot,
  TicketRunProofSnapshotResult,
  TicketRunPushAction,
  TicketRunRepoIntelligenceCandidatesResult,
  TicketRunRepoIntelligenceEntrySummary,
  TicketRunReviewRepoEntry,
  TicketRunReviewSnapshot,
  TicketRunReviewSnapshotResult,
  TicketRunReviewSubmoduleEntry,
  TicketRunSnapshot,
  TicketRunStatus,
  TicketRunSubmoduleGitState,
  TicketRunSubmoduleGitStateResult,
  TicketRunSubmoduleParentRef,
  TicketRunSubmoduleSummary,
  TicketRunSummary,
} from "@spira/shared";
import { getEffectiveValidations, normalizeProjectKey } from "@spira/shared";
import fetch from "node-fetch";
import { BoundedMap } from "../util/bounded-map.js";
import { ConfigError, SpiraError } from "../util/errors.js";
import { pathExists } from "../util/fs.js";
import { warmRunDependencies } from "./dependency-warmer.js";
import { PROMOTION_FORMULA_VERSION, buildPromotedTags, scoreLearnedCandidates } from "./learned-candidate-promoter.js";
import { buildLearnedRepoIntelligenceCandidates } from "./mission-intelligence.js";
import { type MissionOutcomeClassification, classifyMissionOutcome } from "./mission-outcome.js";
import { reconcileMissionDisplayState } from "./mission-state-reconciler.js";
import { buildMissionWorkflowRepairPrompt, getMissionWorkflowState } from "./mission-workflow-guard.js";
import { DEFAULT_BUDGET_MIN_SAMPLES, DEFAULT_BUDGET_SAMPLE_SIZE, computePhaseBudget } from "./phase-budget.js";
import { buildPostmortemFilename, generateMissionPostmortem } from "./post-mortem-generator.js";
import { atomicWritePostmortem } from "./postmortem-writer.js";
import { runProofPreflight } from "./proof-preflight.js";
import {
  type ResolvedMissionProofProfile,
  discoverProofProfileForWorktree,
  toMissionProofProfileSummary,
} from "./proof-registry.js";
import { type RunMissionProofInput, type RunMissionProofOutput, runMissionProof } from "./proof-runner.js";
import { buildRepoGuidanceSection } from "./repo-guidance.js";
import {
  buildSubmoduleDiffFingerprint,
  mergeUntrackedFiles,
  parseDiffFiles,
  parseNameStatusMap,
  parseNullSeparatedEntries,
  parseNumstatMap,
} from "./ticket-runs/diff.js";
import {
  buildGitHubHttpAuthArgs,
  defaultGitCommandRunner,
  extractGitFailureDetail,
  isGitHubCredentialPromptFailure,
} from "./ticket-runs/git-commands.js";
import {
  type GitHubOriginInfo,
  type GitHubPullRequestErrorResponse,
  type GitHubPullRequestResponse,
  parseGitHubRepositoryUrl,
  parseRepositoryCoordinates,
} from "./ticket-runs/github.js";
import { buildPullRequestBody, categorizeChangedFiles } from "./ticket-runs/pull-request-template.js";
import {
  buildDefaultProofSummary,
  buildFallbackCommitBullets,
  buildStaleProofSummary,
  describeDeleteBlockers,
  describeReviewLoadError,
  isRepoBlockingClose,
  isRepoVisibleInReview,
  isSubmoduleBlockingClose,
  isSubmoduleBlockingRepoWorkflow,
  isSubmoduleVisibleInReview,
  normalizeCommitDraft,
  normalizeMissionPrompt,
  toReviewRepoState,
  toReviewSubmoduleState,
} from "./ticket-runs/review.js";
import {
  type GitmodulesEntry,
  areSubmoduleSummariesEqual,
  normalizeSubmoduleCanonicalUrl,
  parseGitmodulesEntries,
  sortSubmoduleParentRefs,
} from "./ticket-runs/submodules.js";
import type {
  GitCommandRunner,
  GitReadOptions,
  GitRepoStateSnapshot,
  ManagedSubmoduleParentRuntimeState,
  ManagedSubmoduleRuntimeState,
  MissionGitIdentity,
  MissionPassHandle,
  MissionPassResult,
  SyncableRun,
  TicketRunServiceOptions,
} from "./ticket-runs/types.js";
import {
  buildTicketRunBranchName,
  buildTicketRunWorktreePath,
  describeTicketRunWorkspace,
  formatPreviousPassContextSection,
  formatTicketRunWorktreeList,
  resolveTicketRunMissionDirectory,
} from "./ticket-runs/workspace.js";
import {
  DEFAULT_VALIDATION_AUTO_PROMOTION_THRESHOLD,
  DEFAULT_VALIDATION_CANDIDATE_THRESHOLD,
  deriveValidationProfileCandidates,
} from "./validation-candidate-learner.js";

export type {
  GenerateCommitDraftInput,
  GitCommandResult,
  GitCommandRunner,
  LaunchMissionPassInput,
  MissionGitIdentity,
  MissionPassHandle,
  MissionPassResult,
  TicketRunServiceOptions,
} from "./ticket-runs/types.js";
export { buildTicketRunBranchName, buildTicketRunWorktreePath };

/**
 * Per-step timeouts for mission startup. Calibrated for big repos so a successful-but-slow
 * startup never trips them. If real-world startups hit these, raise the constants rather
 * than adding new state-machine concepts.
 */
export const STARTUP_WORKTREE_ADD_TIMEOUT_MS = 10 * 60_000;
export const STARTUP_SUBMODULE_HYDRATE_TIMEOUT_MS = 15 * 60_000;

type StartupTimeoutStep = "worktree-add" | "submodule-hydrate";

/**
 * Typed error so the startRun catch block can tell a step-timeout apart from a real git
 * failure and emit a `mission-startup-timed-out` event with the right metadata.
 */
class MissionStartupTimeoutError extends SpiraError {
  constructor(
    public readonly step: StartupTimeoutStep,
    public readonly repoRelativePath: string,
    public readonly timeoutMs: number,
  ) {
    const minutes = Math.round(timeoutMs / 60_000);
    const action = step === "worktree-add" ? "Worktree creation" : "Submodule hydrate";
    super(
      "MISSIONS_STARTUP_TIMEOUT",
      `${action} timed out after ${minutes} minute${minutes === 1 ? "" : "s"} for ${repoRelativePath}.`,
    );
  }
}

const raceWithStartupTimeout = async <T>(
  work: Promise<T>,
  step: StartupTimeoutStep,
  repoRelativePath: string,
  timeoutMs: number,
): Promise<T> => {
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new MissionStartupTimeoutError(step, repoRelativePath, timeoutMs));
        }, timeoutMs);
        // Don't keep the process alive just for this timer.
        timeoutHandle.unref?.();
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

export class TicketRunService {
  private readonly now: () => number;
  private readonly runIdFactory: () => string;
  private readonly attemptIdFactory: () => string;
  private readonly runGitCommand: GitCommandRunner;
  private interruptedWorkRecovered = false;
  private readonly runLocks = new Map<string, Promise<void>>();
  private readonly reviewSnapshotRequests = new Map<string, Promise<TicketRunReviewSnapshotResult>>();
  /**
   * Memoised result of `git rev-parse --git-dir` per worktree path. Treated as a cheap
   * fast-path: the path-existence check still runs first so externally-deleted worktrees
   * do not hit a stale cache.
   */
  private readonly usableWorktreeCache = new BoundedMap<string, true>(256);
  /**
   * Resolved proof profile per worktree path. Invalidated only by removeManagedWorktree;
   * the discovery itself depends on file presence + content checks that effectively never
   * change inside a single mission.
   */
  private readonly proofDiscoveryCache = new BoundedMap<string, ResolvedMissionProofProfile | null>(256);
  /** Set of run ids currently in a dependency-warming pass; prevents re-warm storms. */
  private readonly warmingInFlight = new Set<string>();
  /**
   * Per-project phase-budget cache. Keyed on projectKey, holds the last-computed snapshot
   * plus the latest peer-run `updatedAt` observed at compute time. Invalidates only when
   * a peer run closes (its `updatedAt` exceeds the cached watermark) — soft hint data
   * doesn't need stronger consistency than that.
   */
  private readonly phaseBudgetCache = new BoundedMap<
    string,
    { watermarkUpdatedAt: number; snapshot: TicketRunPhaseBudgetSnapshot }
  >(64);
  private disposed = false;

  constructor(private readonly options: TicketRunServiceOptions) {
    this.now = options.now ?? Date.now;
    this.runIdFactory = options.runIdFactory ?? randomUUID;
    this.attemptIdFactory = options.attemptIdFactory ?? randomUUID;
    this.runGitCommand = options.runGitCommand ?? defaultGitCommandRunner;
  }

  recoverInterruptedWork(): void {
    this.recoverInterruptedWorkOnce(this.requireMemoryDb());
  }

  getSnapshot(): TicketRunSnapshot {
    const memoryDb = this.requireMemoryDb();
    this.recoverInterruptedWork();
    return memoryDb.getTicketRunSnapshot();
  }

  getRun(runId: string): TicketRunSummary {
    return this.getFreshRun(runId);
  }

  private async readGitmodulesEntries(worktreePath: string): Promise<GitmodulesEntry[]> {
    if (!(await this.worktreeHasGitmodules(worktreePath))) {
      return [];
    }

    try {
      const result = await this.runGitCommand(worktreePath, [
        "config",
        "--file",
        ".gitmodules",
        "--get-regexp",
        "^submodule\\..*\\.(path|url)$",
      ]);
      return parseGitmodulesEntries(result.stdout);
    } catch {
      return [];
    }
  }

  private async discoverManagedSubmodules(run: TicketRunSummary): Promise<TicketRunSubmoduleSummary[]> {
    const branchName = buildTicketRunBranchName(run.ticketId, run.ticketSummary);
    const existingByCanonicalUrl = new Map(
      run.submodules.map((submodule) => [submodule.canonicalUrl, submodule] as const),
    );
    const submodulesByCanonicalUrl = new Map<
      string,
      {
        name: string;
        branchName: string;
        parentRefs: TicketRunSubmoduleParentRef[];
      }
    >();

    for (const worktree of run.worktrees) {
      const entries = await this.readGitmodulesEntries(worktree.worktreePath);
      for (const entry of entries) {
        const canonicalUrl = normalizeSubmoduleCanonicalUrl(entry.url);
        if (!canonicalUrl) {
          continue;
        }

        const current = submodulesByCanonicalUrl.get(canonicalUrl) ?? {
          name: path.basename(entry.path.replace(/[\\/]+/gu, "/")) || entry.path,
          branchName,
          parentRefs: [],
        };
        current.parentRefs.push({
          parentRepoRelativePath: worktree.repoRelativePath,
          submodulePath: entry.path,
          submoduleWorktreePath: path.join(worktree.worktreePath, entry.path),
        });
        submodulesByCanonicalUrl.set(canonicalUrl, current);
      }
    }

    return [...submodulesByCanonicalUrl.entries()]
      .map(([canonicalUrl, submodule], index) => {
        const existing = existingByCanonicalUrl.get(canonicalUrl);
        const dedupedParentRefs = [
          ...new Map(
            submodule.parentRefs.map((parentRef) => [
              `${parentRef.parentRepoRelativePath}\u0000${parentRef.submodulePath}`,
              parentRef,
            ]),
          ).values(),
        ];
        const createdAt = existing?.createdAt ?? this.now() + index;
        return {
          canonicalUrl,
          name: existing?.name ?? submodule.name,
          branchName: existing?.branchName ?? submodule.branchName,
          commitMessageDraft: existing?.commitMessageDraft ?? null,
          parentRefs: sortSubmoduleParentRefs(dedupedParentRefs),
          createdAt,
          updatedAt: this.now(),
        };
      })
      .sort(
        (left, right) => left.name.localeCompare(right.name) || left.canonicalUrl.localeCompare(right.canonicalUrl),
      );
  }

  private async ensureRunSubmodules(run: TicketRunSummary): Promise<TicketRunSummary> {
    const discovered = await this.discoverManagedSubmodules(run);
    if (areSubmoduleSummariesEqual(run.submodules, discovered)) {
      return run;
    }

    return this.persistRun(run, {
      submodules: discovered,
    });
  }

  async startRun(ticket: StartTicketRunRequest): Promise<StartTicketRunResult> {
    const memoryDb = this.requireMemoryDb();

    const ticketId = ticket.ticketId.trim();
    const ticketSummary = ticket.ticketSummary.trim();
    const ticketUrl = ticket.ticketUrl.trim();
    const projectKey = normalizeProjectKey(ticket.projectKey);
    if (!ticketId || !ticketSummary || !ticketUrl || !projectKey) {
      throw new ConfigError("Missions needs a ticket id, summary, URL, and project key to start a run.");
    }

    this.recoverInterruptedWork();

    const existingRun = memoryDb.getTicketRunByTicketId(ticketId);
    const recoverableRun =
      existingRun && (existingRun.status === "error" || existingRun.status === "starting") ? existingRun : null;
    if (existingRun && !recoverableRun) {
      return {
        run: existingRun,
        snapshot: memoryDb.getTicketRunSnapshot(),
        reusedExistingRun: true,
      };
    }

    const recoverableWorktrees = await this.normalizeRecoverableWorktrees(
      ticketId,
      recoverableRun?.runId ?? null,
      recoverableRun?.worktrees.map((worktree) => ({
        ...worktree,
        commitMessageDraft: worktree.commitMessageDraft ?? null,
      })) ?? [],
    );
    const recoverableWorktreeByRepo = new Map(
      recoverableWorktrees.map((worktree) => [worktree.repoRelativePath, worktree] as const),
    );
    let targetWorktrees = [...recoverableWorktrees];

    const snapshot = await this.options.projectRegistry.getSnapshot();
    if (!snapshot.workspaceRoot && recoverableWorktrees.length === 0) {
      throw new ConfigError("Set a workspace root before starting ticket runs.");
    }

    const repoHasSubmodulesByRelativePath = new Map(
      snapshot.repos.map((repo) => [repo.relativePath, repo.hasSubmodules] as const),
    );

    if (snapshot.workspaceRoot) {
      const mappedRepos = snapshot.repos
        .filter((repo) => repo.mappedProjectKeys.includes(projectKey))
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
      if (mappedRepos.length === 0 && recoverableWorktrees.length === 0) {
        throw new ConfigError(`Map at least one repository to ${projectKey} before starting work on ${ticketId}.`);
      }

      const branchName = buildTicketRunBranchName(ticketId, ticketSummary);
      for (const repo of mappedRepos) {
        if (recoverableWorktreeByRepo.has(repo.relativePath)) {
          continue;
        }

        targetWorktrees.push({
          repoRelativePath: repo.relativePath,
          repoAbsolutePath: repo.absolutePath,
          worktreePath: buildTicketRunWorktreePath(snapshot.workspaceRoot, ticketId, repo.name),
          branchName,
          commitMessageDraft: null,
          cleanupState: "retained",
          createdAt: recoverableRun?.createdAt ?? this.now(),
          updatedAt: recoverableRun?.createdAt ?? this.now(),
        });
      }
    }

    targetWorktrees = [...targetWorktrees].sort((left, right) =>
      left.repoRelativePath.localeCompare(right.repoRelativePath),
    );
    if (targetWorktrees.length === 0) {
      throw new ConfigError("Missions could not resolve any repository worktree targets.");
    }

    const runId = recoverableRun?.runId ?? this.runIdFactory();
    const createdAt = recoverableRun?.createdAt ?? this.now();
    const startingWorktrees = targetWorktrees.map((worktree) => ({
      repoRelativePath: worktree.repoRelativePath,
      repoAbsolutePath: worktree.repoAbsolutePath,
      worktreePath: worktree.worktreePath,
      branchName: worktree.branchName,
      commitMessageDraft: worktree.commitMessageDraft ?? null,
      cleanupState: "retained" as const,
      createdAt: worktree.createdAt ?? createdAt,
      updatedAt: createdAt,
    }));

    memoryDb.upsertTicketRun({
      runId,
      ticketId,
      ticketSummary,
      ticketUrl,
      projectKey,
      status: "starting",
      statusMessage: recoverableRun?.worktrees.length
        ? "Resuming managed worktrees after an interrupted start."
        : "Preparing managed worktrees.",
      startedAt: createdAt,
      createdAt,
      worktrees: startingWorktrees,
      submodules: recoverableRun?.submodules ?? [],
      attempts: recoverableRun?.attempts ?? [],
      proof: recoverableRun?.proof ?? buildDefaultProofSummary(),
      proofRuns: recoverableRun?.proofRuns ?? [],
    });
    this.emitSnapshot();

    const worktreesToCreate = startingWorktrees.filter(
      (worktree) => !recoverableWorktreeByRepo.has(worktree.repoRelativePath),
    );

    const createdWorktrees: Array<{
      worktree: (typeof startingWorktrees)[number];
      branchExistedBeforeCreate: boolean;
    }> = [];
    try {
      for (const worktree of worktreesToCreate) {
        if (await pathExists(worktree.worktreePath)) {
          await this.removeManagedWorktree(worktree);
        }
        await mkdir(path.dirname(worktree.worktreePath), { recursive: true });
        const branchExistedBeforeCreate = await this.hasLocalBranch(worktree.repoAbsolutePath, worktree.branchName);
        await raceWithStartupTimeout(
          this.runGitCommand(worktree.repoAbsolutePath, [
            "worktree",
            "add",
            ...(branchExistedBeforeCreate
              ? [worktree.worktreePath, worktree.branchName]
              : [recoverableRun ? "-B" : "-b", worktree.branchName, worktree.worktreePath]),
          ]),
          "worktree-add",
          worktree.repoRelativePath,
          this.options.startupTimeoutsMs?.worktreeAdd ?? STARTUP_WORKTREE_ADD_TIMEOUT_MS,
        );
        createdWorktrees.push({
          worktree,
          branchExistedBeforeCreate,
        });
      }

      for (const worktree of startingWorktrees) {
        await raceWithStartupTimeout(
          this.maybeHydrateWorktreeSubmodules(worktree, repoHasSubmodulesByRelativePath.get(worktree.repoRelativePath)),
          "submodule-hydrate",
          worktree.repoRelativePath,
          this.options.startupTimeoutsMs?.submoduleHydrate ?? STARTUP_SUBMODULE_HYDRATE_TIMEOUT_MS,
        );
      }
    } catch (error) {
      this.options.logger.warn({ err: error, ticketId, runId }, "Failed to prepare managed worktrees");
      const retainedWorktrees: typeof startingWorktrees = [];
      for (const createdWorktree of [...createdWorktrees].reverse()) {
        try {
          await this.runGitCommand(createdWorktree.worktree.repoAbsolutePath, [
            "worktree",
            "remove",
            "--force",
            createdWorktree.worktree.worktreePath,
          ]);
          if (!createdWorktree.branchExistedBeforeCreate) {
            try {
              await this.deleteLocalMissionBranch(
                createdWorktree.worktree.repoAbsolutePath,
                createdWorktree.worktree.branchName,
              );
            } catch (branchCleanupError) {
              this.options.logger.warn(
                {
                  err: branchCleanupError,
                  ticketId,
                  runId,
                  repoRelativePath: createdWorktree.worktree.repoRelativePath,
                  branchName: createdWorktree.worktree.branchName,
                },
                "Failed to roll back a partially created mission branch",
              );
            }
          }
        } catch (cleanupError) {
          retainedWorktrees.push(createdWorktree.worktree);
          this.options.logger.warn(
            { err: cleanupError, ticketId, runId, worktreePath: createdWorktree.worktree.worktreePath },
            "Failed to roll back a partially created managed worktree",
          );
        }
      }

      const failedWorktrees = [...recoverableWorktrees, ...retainedWorktrees].sort((left, right) =>
        left.repoRelativePath.localeCompare(right.repoRelativePath),
      );
      const isStartupTimeout = error instanceof MissionStartupTimeoutError;
      const failureMessage = isStartupTimeout
        ? `${error.message} Retry to try again, or abort to discard.`
        : error instanceof Error
          ? error.message
          : "Failed to prepare the managed worktrees.";
      const failedRun = memoryDb.upsertTicketRun({
        runId,
        ticketId,
        ticketSummary,
        ticketUrl,
        projectKey,
        status: "error",
        statusMessage: failureMessage,
        startedAt: createdAt,
        createdAt,
        worktrees: failedWorktrees,
        submodules: recoverableRun?.submodules ?? [],
        attempts: recoverableRun?.attempts ?? [],
        proof: recoverableRun?.proof ?? buildDefaultProofSummary(),
        proofRuns: recoverableRun?.proofRuns ?? [],
      });
      if (isStartupTimeout) {
        memoryDb.appendMissionEvent({
          runId,
          attemptId: null,
          stage: "system",
          eventType: "mission-startup-timed-out",
          metadata: {
            step: error.step,
            repoRelativePath: error.repoRelativePath,
            timeoutMs: error.timeoutMs,
          },
        });
      }
      const failedSnapshot = memoryDb.getTicketRunSnapshot();
      this.emitSnapshot(failedSnapshot);
      return {
        run: failedRun,
        snapshot: failedSnapshot,
        reusedExistingRun: false,
      };
    }

    memoryDb.upsertTicketRun({
      runId,
      ticketId,
      ticketSummary,
      ticketUrl,
      projectKey,
      status: "starting",
      statusMessage: "Managed worktrees created. Transitioning the ticket into active work.",
      startedAt: createdAt,
      createdAt,
      worktrees: startingWorktrees,
      submodules: recoverableRun?.submodules ?? [],
      attempts: recoverableRun?.attempts ?? [],
      proof: recoverableRun?.proof ?? buildDefaultProofSummary(),
      proofRuns: recoverableRun?.proofRuns ?? [],
    });
    this.emitSnapshot();

    let run = await this.syncRunState({
      runId,
      stationId: recoverableRun?.stationId ?? null,
      ticketId,
      ticketSummary,
      ticketUrl,
      projectKey,
      startedAt: createdAt,
      createdAt,
      worktrees: startingWorktrees.map((worktree) => ({
        repoRelativePath: worktree.repoRelativePath,
        repoAbsolutePath: worktree.repoAbsolutePath,
        worktreePath: worktree.worktreePath,
        branchName: worktree.branchName,
        commitMessageDraft: worktree.commitMessageDraft ?? null,
        cleanupState: "retained",
        createdAt: worktree.createdAt,
        updatedAt: this.now(),
      })),
      submodules: recoverableRun?.submodules ?? [],
    });
    run = await this.ensureRunSubmodules(run);
    const nextSnapshot = memoryDb.getTicketRunSnapshot();

    return {
      run,
      snapshot: nextSnapshot,
      reusedExistingRun: false,
    };
  }

  async retryRunSync(runId: string): Promise<RetryTicketRunSyncResult> {
    const memoryDb = this.requireMemoryDb();

    const run = memoryDb.getTicketRun(runId);
    if (!run) {
      throw new ConfigError(`Unknown ticket run ${runId}.`);
    }

    if (run.status !== "blocked") {
      throw new ConfigError(`Ticket run ${run.ticketId} is not waiting on a YouTrack retry.`);
    }

    const syncedRun = await this.syncRunState(run);
    const snapshot = memoryDb.getTicketRunSnapshot();
    return {
      run: syncedRun,
      snapshot,
    };
  }

  async startWork(runId: string, prompt?: string): Promise<StartTicketRunWorkResult> {
    return this.withRunLock(runId, async () => {
      const run = this.getFreshRun(runId);
      if (run.status !== "ready") {
        throw new ConfigError(`Ticket ${run.ticketId} is ${run.status} and cannot start work yet.`);
      }

      const normalizedPrompt = normalizeMissionPrompt(prompt);
      const handle = await this.launchMissionPass(run, this.buildInitialPrompt(run, normalizedPrompt));
      const nextRun = this.beginAttempt(run, handle, normalizedPrompt);
      return {
        run: nextRun,
        snapshot: this.requireMemoryDb().getTicketRunSnapshot(),
      };
    });
  }

  async continueWork(runId: string, prompt?: string): Promise<ContinueTicketRunWorkResult> {
    return this.withRunLock(runId, async () => {
      const run = this.getFreshRun(runId);
      const isRecoveringErroredContinuation = run.status === "error" && run.attempts.length > 0;
      if (run.status !== "awaiting-review" && !isRecoveringErroredContinuation) {
        throw new ConfigError(`Ticket ${run.ticketId} is ${run.status} and is not ready for another pass.`);
      }

      const normalizedPrompt = normalizeMissionPrompt(prompt);
      const handle = await this.launchMissionPass(run, this.buildContinuationPrompt(run, normalizedPrompt));
      const nextRun = this.beginAttempt(run, handle, normalizedPrompt);
      return {
        run: nextRun,
        snapshot: this.requireMemoryDb().getTicketRunSnapshot(),
        reusedLiveAttempt: handle.reusedLiveAttempt,
      };
    });
  }

  async cancelWork(runId: string): Promise<CancelTicketRunWorkResult> {
    return this.withRunLock(runId, async () => {
      const memoryDb = this.requireMemoryDb();
      const run = this.getFreshRun(runId);
      if (run.status !== "working") {
        throw new ConfigError(`Ticket ${run.ticketId} is not actively working.`);
      }

      const latestAttempt = this.getLatestAttempt(run);
      if (!latestAttempt || latestAttempt.status !== "running" || !run.stationId) {
        throw new ConfigError(`Ticket ${run.ticketId} does not have a cancellable work attempt.`);
      }

      if (!this.options.cancelMissionPass) {
        throw new ConfigError("Mission work cancellation is unavailable.");
      }

      await this.options.cancelMissionPass(run.stationId);
      const cancelledAt = this.now();
      const cancelledRun = this.persistRun(run, {
        status: "awaiting-review",
        statusMessage: "Work attempt cancelled. Review the worktree and continue when ready.",
        attempts: run.attempts.map((attempt) =>
          attempt.attemptId === latestAttempt.attemptId
            ? {
                ...attempt,
                status: "cancelled",
                summary: "Work attempt cancelled.",
                followupNeeded: true,
                completedAt: cancelledAt,
                updatedAt: cancelledAt,
              }
            : attempt,
        ),
      });
      this.recordMissionEvent(cancelledRun, cancelledRun.missionPhase, "attempt-cancelled", {
        attemptId: latestAttempt.attemptId,
      });
      this.emitRunUpdate(cancelledRun.runId);
      return {
        run: cancelledRun,
        snapshot: memoryDb.getTicketRunSnapshot(),
      };
    });
  }

  async completeRun(runId: string): Promise<CompleteTicketRunResult> {
    return this.withRunLock(runId, async () => {
      const memoryDb = this.requireMemoryDb();
      const run = await this.ensureRunSubmodules(this.getFreshRun(runId));
      if (run.status !== "awaiting-review") {
        throw new ConfigError(`Ticket ${run.ticketId} must be awaiting review before it can be closed.`);
      }
      if (run.proof.status === "running") {
        throw new ConfigError(`Wait for the active proof run to finish before closing ${run.ticketId}.`);
      }

      this.assertRunCanCloseWithLifecycle(run);

      const { stationCleared } = await this.tearDownStationAndServices(run, { tolerateFailures: false });
      const completedRun = this.persistRun(this.getFreshRun(runId), {
        ...(stationCleared ? { stationId: null } : {}),
        status: "done",
        statusMessage: "Mission closed.",
      });
      this.runStateReconciliation(completedRun);
      this.observeRepoIntelligenceCandidates(completedRun);
      this.recordMissionEvent(completedRun, "system", "run-closed", {
        stationCleared,
      });
      // fire-and-forget auto post-mortem stub. Failures are logged but do not
      // fault the close path; the underlying mission_events data is still in the DB and
      // a future run can regenerate the stub.
      void this.writePostmortemStub(completedRun).catch((error) => {
        this.options.logger.warn(
          { err: error, runId: completedRun.runId, ticketId: completedRun.ticketId },
          "Failed to write mission post-mortem stub",
        );
      });
      const snapshot = memoryDb.getTicketRunSnapshot();
      this.emitSnapshot(snapshot);
      return {
        run: completedRun,
        snapshot,
      };
    });
  }

  /**
   * operator-initiated abort. Closes the run with the `aborted` status,
   * generates the post-mortem stub (with the abort reason in the open-observations
   * placeholder), and records a `mission-aborted` event. Permitted from any status
   * except `done` and `aborted` — if the operator wants out, they get out.
   */
  async abortRun(runId: string, reason: string): Promise<CompleteTicketRunResult> {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      throw new ConfigError("An abort reason is required.");
    }
    return this.withRunLock(runId, async () => {
      const memoryDb = this.requireMemoryDb();
      const run = await this.ensureRunSubmodules(this.getFreshRun(runId));
      if (run.status === "done" || run.status === "aborted") {
        throw new ConfigError(`Ticket ${run.ticketId} is already closed (${run.status}).`);
      }

      const { stationCleared } = await this.tearDownStationAndServices(run, {
        tolerateFailures: true,
        cancelInFlightPass: true,
      });

      // Aborting from startup leaves nothing worth keeping on disk: the mission never
      // produced any commits or attempt history, and the partial worktrees often block a
      // later retry of the same ticket. Tolerate failures — the abort itself must succeed
      // even if a worktree is locked or already gone.
      const isStartupAbort = run.status === "starting" || (run.status === "error" && run.attempts.length === 0);
      if (isStartupAbort) {
        for (const worktree of run.worktrees) {
          try {
            await this.removeManagedWorktree(worktree);
          } catch (cleanupError) {
            this.options.logger.warn(
              { err: cleanupError, runId: run.runId, worktreePath: worktree.worktreePath },
              "Failed to remove a managed worktree during startup abort; continuing",
            );
          }
          try {
            await this.deleteLocalMissionBranch(worktree.repoAbsolutePath, worktree.branchName);
          } catch (cleanupError) {
            this.options.logger.warn(
              { err: cleanupError, runId: run.runId, branchName: worktree.branchName },
              "Failed to delete a mission branch during startup abort; continuing",
            );
          }
        }
        const missionDirectory = resolveTicketRunMissionDirectory(run.worktrees);
        if (missionDirectory) {
          try {
            await rm(missionDirectory, { force: true, recursive: true });
          } catch (cleanupError) {
            this.options.logger.warn(
              { err: cleanupError, runId: run.runId, missionDirectory },
              "Failed to remove the mission directory during startup abort; continuing",
            );
          }
        }
      }

      const phaseAtAbort = run.missionPhase;
      const abortedRun = this.persistRun(this.getFreshRun(runId), {
        ...(stationCleared ? { stationId: null } : {}),
        status: "aborted",
        statusMessage: `Mission aborted: ${trimmedReason}`,
        ...(isStartupAbort ? { worktrees: [] } : {}),
      });
      this.recordMissionEvent(abortedRun, "system", "mission-aborted", {
        reason: trimmedReason,
        phaseAtAbort,
      });
      this.recordMissionEvent(abortedRun, "system", "run-closed", {
        stationCleared,
      });
      void this.writePostmortemStub(abortedRun).catch((error) => {
        this.options.logger.warn(
          { err: error, runId: abortedRun.runId, ticketId: abortedRun.ticketId },
          "Failed to write mission post-mortem stub for aborted run",
        );
      });
      const snapshot = memoryDb.getTicketRunSnapshot();
      this.emitSnapshot(snapshot);
      return {
        run: abortedRun,
        snapshot,
      };
    });
  }

  /**
   * Cancel an in-flight pass (optional), stop run services, and close the mission
   * station for `run`. `tolerateFailures: false` lets exceptions propagate (the close
   * path semantics — a teardown failure aborts the close). `tolerateFailures: true`
   * swallows + logs (the abort path — operator wants out, we get them out).
   */
  private async tearDownStationAndServices(
    run: TicketRunSummary,
    options: { tolerateFailures: boolean; cancelInFlightPass?: boolean },
  ): Promise<{ stationCleared: boolean }> {
    const tolerate = async <T>(label: string, work: () => Promise<T>): Promise<T | undefined> => {
      if (!options.tolerateFailures) return work();
      try {
        return await work();
      } catch (error) {
        this.options.logger.warn({ err: error, runId: run.runId }, label);
        return undefined;
      }
    };

    if (options.cancelInFlightPass) {
      const latestAttempt = this.getLatestAttempt(run);
      if (latestAttempt?.status === "running" && run.stationId && this.options.cancelMissionPass) {
        await tolerate("Failed to cancel mission pass during teardown; continuing", () =>
          this.options.cancelMissionPass!(run.stationId!),
        );
      }
    }

    if (this.options.stopRunServices) {
      await tolerate("Failed to stop run services during teardown; continuing", () =>
        this.options.stopRunServices!(run.runId),
      );
    }

    let stationCleared = false;
    const stationId = run.stationId;
    if (stationId && this.options.closeMissionStation) {
      const result = await tolerate("Failed to close mission station during teardown; continuing", () =>
        this.options.closeMissionStation!(stationId),
      );
      stationCleared = options.tolerateFailures ? result !== undefined : true;
    }
    return { stationCleared };
  }

  /**
   * Apply the deterministic display-state reconciler. Best-effort: any failure is logged
   * but never faults the close path. Each patch applied emits a `mission-state-reconciled`
   * event so drift is observable from the timeline.
   */
  private runStateReconciliation(run: TicketRunSummary): void {
    try {
      const result = reconcileMissionDisplayState(run);
      if (result.patches.length === 0) return;
      // Persist the reconciled state and emit an event per patch.
      this.persistRun(run, {
        statusMessage: result.run.statusMessage,
        missionPhase: result.run.missionPhase,
        proof: result.run.proof,
      });
      for (const patch of result.patches) {
        this.recordMissionEvent(result.run, "system", "mission-state-reconciled", {
          field: patch.field,
          previousValue: patch.previousValue,
          nextValue: patch.nextValue,
          reason: patch.reason,
        });
      }
    } catch (error) {
      this.options.logger.warn({ err: error, runId: run.runId }, "Mission state reconciliation failed; continuing");
    }
  }

  /**
   * generate a markdown post-mortem stub at `<workspaceRoot>/reports/{ticketId}-...md`.
   * Best-effort: if no workspace root is configured, the file is skipped (the data is still in the
   * DB). The file uses {@link generateMissionPostmortem} for the body.
   */
  private async writePostmortemStub(run: TicketRunSummary): Promise<void> {
    const memoryDb = this.options.memoryDb;
    if (!memoryDb) {
      return;
    }
    const workspaceRoot = memoryDb.getProjectWorkspaceRoot();
    if (!workspaceRoot) {
      this.options.logger.debug(
        { runId: run.runId, ticketId: run.ticketId },
        "Skipping post-mortem stub — no workspace root configured.",
      );
      return;
    }
    const events = memoryDb.listMissionEvents(run.runId, 500);
    const closedAt = run.updatedAt ?? this.now();
    const filename = buildPostmortemFilename(run, closedAt);
    const markdown = generateMissionPostmortem(
      run,
      events.map((event) => ({
        id: event.id,
        runId: event.runId,
        attemptId: event.attemptId,
        stage: event.stage as TicketRunMissionEventSummary["stage"],
        eventType: event.eventType,
        metadata: event.metadata,
        occurredAt: event.occurredAt,
      })),
    );
    const result = await atomicWritePostmortem({ workspaceRoot, filename, markdown });
    if (result.status === "written") {
      this.options.logger.info(
        { runId: run.runId, ticketId: run.ticketId, targetPath: result.path },
        "Wrote auto-generated mission post-mortem stub.",
      );
    } else if (result.status === "exists") {
      this.options.logger.info(
        { runId: run.runId, ticketId: run.ticketId, targetPath: result.path },
        "Mission post-mortem already exists; leaving the existing file untouched.",
      );
    }
  }

  async getProofSnapshot(runId: string): Promise<TicketRunProofSnapshotResult> {
    const run = await this.ensureRunSubmodules(this.getFreshRun(runId));
    return {
      run,
      snapshot: this.requireMemoryDb().getTicketRunSnapshot(),
      proofSnapshot: await this.buildProofSnapshot(run),
    };
  }

  async getMissionTimeline(
    runId: string,
    options: { beforeId?: number | null; limit?: number } = {},
  ): Promise<TicketRunMissionTimelineResult> {
    const run = this.getFreshRun(runId);
    const limit = options.limit ?? 80;
    // Read limit + 1 so we can report `hasMore` without a follow-up COUNT(*).
    const probedEvents = this.listMissionEvents(runId, { beforeId: options.beforeId, limit: limit + 1 });
    const hasMore = probedEvents.length > limit;
    const events = hasMore ? probedEvents.slice(0, limit) : probedEvents;
    return {
      run,
      snapshot: this.requireMemoryDb().getTicketRunSnapshot(),
      events,
      hasMore,
      phaseBudget: this.computePhaseBudgetForRun(run),
    };
  }

  /**
   * Read recent same-project closed runs and their events; compute the per-phase budget
   * envelope. Returns an empty entries list when there's not enough data yet (renderer
   * treats absence as "no hint to show"). Memoised per project on a watermark — recompute
   * only when a new peer run has closed since the previous compute.
   */
  private computePhaseBudgetForRun(run: TicketRunSummary): TicketRunPhaseBudgetSnapshot {
    const memoryDb = this.options.memoryDb;
    if (!memoryDb || !run.projectKey) {
      return { projectKey: run.projectKey ?? "", entries: [] };
    }
    try {
      const peerRuns = memoryDb
        .listTicketRuns()
        .filter(
          (candidate) =>
            candidate.projectKey === run.projectKey && candidate.status === "done" && candidate.runId !== run.runId,
        );
      if (peerRuns.length < DEFAULT_BUDGET_MIN_SAMPLES) {
        return { projectKey: run.projectKey, entries: [] };
      }
      const watermarkUpdatedAt = peerRuns.reduce(
        (latest, candidate) => Math.max(latest, candidate.updatedAt ?? candidate.createdAt),
        0,
      );
      const cached = this.phaseBudgetCache.get(run.projectKey);
      if (cached && cached.watermarkUpdatedAt === watermarkUpdatedAt) {
        return cached.snapshot;
      }
      const sampled = peerRuns
        .sort((left, right) => (right.updatedAt ?? right.createdAt) - (left.updatedAt ?? left.createdAt))
        .slice(0, DEFAULT_BUDGET_SAMPLE_SIZE);
      const events = sampled.flatMap((peer) => memoryDb.listMissionEvents(peer.runId, { limit: 500 }));
      const snapshot = computePhaseBudget({
        projectKey: run.projectKey,
        runs: sampled,
        events,
      });
      this.phaseBudgetCache.set(run.projectKey, { watermarkUpdatedAt, snapshot });
      return snapshot;
    } catch (error) {
      this.options.logger.warn({ err: error, runId: run.runId }, "Phase budget computation failed");
      return { projectKey: run.projectKey, entries: [] };
    }
  }

  /**
   * read a proof artifact's contents (for the inline log viewer).
   *
   * Validates that:
   *  - the run, proof run, and artifact all exist
   *  - the artifact path is INSIDE the proof run's `.spira-proof/<proofRunId>/` directory
   *    (defends against path traversal via maliciously persisted artifact paths)
   *  - the file size is read up to maxBytes; truncation is reported back
   *
   * Binary files are detected heuristically (presence of NUL byte in the prefix); the
   * caller is told via `mimeKind: "binary"` and content is omitted.
   */
  async readProofArtifactText(
    runId: string,
    proofRunId: string,
    artifactId: string,
    options: { maxBytes?: number } = {},
  ): Promise<{
    content: string | null;
    truncated: boolean;
    totalBytes: number;
    mimeKind: "text" | "binary" | "missing";
    artifactPath: string | null;
  }> {
    const maxBytes = Math.min(Math.max(options.maxBytes ?? 256 * 1024, 1024), 2 * 1024 * 1024);
    const run = this.getFreshRun(runId);
    const proofRun = run.proofRuns.find((candidate) => candidate.proofRunId === proofRunId);
    if (!proofRun) {
      throw new SpiraError("MISSIONS_PROOF_RUN_NOT_FOUND", `Proof run ${proofRunId} was not found.`);
    }
    const artifact = proofRun.artifacts.find((candidate) => candidate.artifactId === artifactId);
    if (!artifact) {
      throw new SpiraError("MISSIONS_PROOF_ARTIFACT_NOT_FOUND", `Proof artifact ${artifactId} was not found.`);
    }

    // Re-derive the canonical proof run directory and assert containment.
    const parentDirectories = [...new Set(run.worktrees.map((worktree) => path.dirname(worktree.worktreePath)))];
    const baseDirectory = parentDirectories[0] ?? run.worktrees[0]?.worktreePath ?? null;
    if (!baseDirectory) {
      throw new SpiraError("MISSIONS_PROOF_ROOT_MISSING", "Cannot resolve proof root for this mission.");
    }
    const proofRoot = path.resolve(baseDirectory, ".spira-proof", proofRunId);
    const resolvedArtifact = path.resolve(artifact.path);
    const proofRootWithSep = proofRoot.endsWith(path.sep) ? proofRoot : `${proofRoot}${path.sep}`;
    if (resolvedArtifact !== proofRoot && !resolvedArtifact.startsWith(proofRootWithSep)) {
      throw new SpiraError(
        "MISSIONS_PROOF_ARTIFACT_FORBIDDEN",
        "Refused to read proof artifact outside the proof run directory.",
      );
    }

    try {
      const stats = await stat(resolvedArtifact);
      if (!stats.isFile()) {
        return { content: null, truncated: false, totalBytes: 0, mimeKind: "missing", artifactPath: resolvedArtifact };
      }
      const totalBytes = stats.size;
      const handle = await open(resolvedArtifact, "r");
      try {
        const buffer = Buffer.alloc(Math.min(maxBytes, totalBytes));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const slice = buffer.subarray(0, bytesRead);
        // Heuristic: presence of NUL in the first 4 KB strongly suggests a binary file.
        const probe = slice.subarray(0, Math.min(slice.length, 4096));
        const looksBinary = probe.includes(0);
        if (looksBinary) {
          return {
            content: null,
            truncated: bytesRead < totalBytes,
            totalBytes,
            mimeKind: "binary",
            artifactPath: resolvedArtifact,
          };
        }
        return {
          content: slice.toString("utf8"),
          truncated: bytesRead < totalBytes,
          totalBytes,
          mimeKind: "text",
          artifactPath: resolvedArtifact,
        };
      } finally {
        await handle.close();
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return { content: null, truncated: false, totalBytes: 0, mimeKind: "missing", artifactPath: resolvedArtifact };
      }
      throw error;
    }
  }

  async getRepoIntelligenceCandidates(runId: string, limit = 20): Promise<TicketRunRepoIntelligenceCandidatesResult> {
    const run = this.getFreshRun(runId);
    const memoryDb = this.requireMemoryDb();
    return {
      run,
      snapshot: memoryDb.getTicketRunSnapshot(),
      entries: memoryDb
        .listRepoIntelligence({
          projectKey: run.projectKey,
          includeUnapproved: true,
          tags: [`run:${runId}`],
          limit,
        })
        .map((entry) => this.toRepoIntelligenceEntrySummary(entry)),
    };
  }

  async approveRepoIntelligenceCandidate(
    runId: string,
    entryId: string,
  ): Promise<ApproveTicketRunRepoIntelligenceResult> {
    return this.withRunLock(runId, async () => {
      const memoryDb = this.requireMemoryDb();
      const run = this.getFreshRun(runId);
      const entry = memoryDb.getRepoIntelligenceEntry(entryId);
      if (!entry || !entry.tags.includes(`run:${runId}`) || entry.source !== "learned") {
        throw new ConfigError(
          `Mission ${run.ticketId} does not expose a learned repo intelligence candidate named ${entryId}.`,
        );
      }

      const approvedEntry = memoryDb.setRepoIntelligenceApproval(entryId, true);
      this.recordMissionEvent(run, "system", "repo-intelligence-candidate-approved", {
        entryId: approvedEntry.id,
        repoRelativePath: approvedEntry.repoRelativePath,
      });
      this.emitRunUpdate(run.runId);
      return {
        run,
        snapshot: memoryDb.getTicketRunSnapshot(),
        entry: this.toRepoIntelligenceEntrySummary(approvedEntry),
      };
    });
  }

  async runProof(runId: string, profileId: string): Promise<RunTicketRunProofResult> {
    return this.withRunLock(runId, async () => {
      const memoryDb = this.requireMemoryDb();
      let run = await this.ensureRunSubmodules(this.getFreshRun(runId));
      if (run.status !== "awaiting-review" && run.status !== "working") {
        throw new ConfigError(`Ticket ${run.ticketId} must be working or awaiting review before proof can be run.`);
      }

      const profiles = await this.discoverMissionProofProfiles(run);
      const profile = profiles.find((candidate) => candidate.profileId === profileId);
      if (!profile) {
        throw new ConfigError(`Mission ${run.ticketId} does not expose a proof profile named ${profileId}.`);
      }

      const proofRunId = this.runIdFactory();
      // preflight before spawning the harness. A blocked preflight short-circuits
      // the run with a typed `preflight-blocked` outcome so the operator sees concrete remediations
      // instead of waiting on a 20-minute timeout for a harness that was never going to succeed.
      this.recordMissionEvent(run, "proof", "proof-preflight-started", {
        profileId: profile.profileId,
        profileLabel: profile.label,
      });
      const preflight = await this.executeProofPreflight(profile);
      this.recordMissionEvent(run, "proof", "proof-preflight-finished", {
        profileId: profile.profileId,
        profileLabel: profile.label,
        ok: preflight.ok,
        blockerCount: preflight.blockers.length,
        warningCount: preflight.warnings.length,
        elapsedMs: preflight.elapsedMs,
        summary: preflight.summary,
      });

      if (!preflight.ok) {
        // Persist a per-run audit row with the preflight findings. No harness spawned, no
        // artifacts, no exit code — just the typed blockers in the summary so the renderer
        // can surface them.
        const startedAt = this.now();
        const completedAt = startedAt + preflight.elapsedMs;
        const blockedSummary = `Preflight blocked: ${preflight.blockers.map((finding) => finding.message).join(" | ")}`;
        const blockedProofRun: TicketRunProofRunSummary = {
          proofRunId,
          runId: run.runId,
          profileId: profile.profileId,
          profileLabel: profile.label,
          status: "preflight-blocked",
          summary: blockedSummary,
          startedAt,
          completedAt,
          exitCode: null,
          command: profile.command,
          artifacts: [],
        };
        run = this.persistRun(run, {
          proof: {
            status: "preflight-blocked",
            lastProofRunId: proofRunId,
            lastProofProfileId: profile.profileId,
            lastProofAt: completedAt,
            lastProofSummary: blockedSummary,
            staleReason: null,
            manualReviewJustification: null,
            manualReviewAt: null,
          },
          proofRuns: [blockedProofRun, ...run.proofRuns.filter((candidate) => candidate.proofRunId !== proofRunId)],
        });
        this.emitRunUpdate(run.runId);
        const snapshot = memoryDb.getTicketRunSnapshot();
        return {
          run,
          snapshot,
          proofSnapshot: {
            runId: run.runId,
            proof: run.proof,
            profiles: profiles.map((candidate) => toMissionProofProfileSummary(candidate)),
            proofRuns: run.proofRuns,
          },
          proofRun: blockedProofRun,
        };
      }

      const runningProofRun: TicketRunProofRunSummary = {
        proofRunId,
        runId: run.runId,
        profileId: profile.profileId,
        profileLabel: profile.label,
        status: "running",
        summary: null,
        startedAt: this.now(),
        completedAt: null,
        exitCode: null,
        command: null,
        artifacts: [],
      };
      run = this.persistRun(run, {
        proof: {
          status: "running",
          lastProofRunId: proofRunId,
          lastProofProfileId: profile.profileId,
          lastProofAt: null,
          lastProofSummary: null,
          staleReason: null,
          // Starting an automated proof clears any prior manual-review state. The mission_events
          // log preserves the audit trail, including the prior justification.
          manualReviewJustification: null,
          manualReviewAt: null,
        },
        proofRuns: [runningProofRun, ...run.proofRuns.filter((candidate) => candidate.proofRunId !== proofRunId)],
      });
      this.recordMissionEvent(run, "proof", "proof-started", {
        proofRunId,
        profileId: profile.profileId,
        profileLabel: profile.label,
      });
      this.emitRunUpdate(run.runId);

      let proofOutput: RunMissionProofOutput;
      try {
        proofOutput = await this.executeMissionProof({
          run,
          profile,
          proofRunId,
          logger: this.options.logger,
          now: this.now,
        });
      } catch (error) {
        proofOutput = {
          status: "failed",
          summary: error instanceof Error ? error.message : "Mission proof failed before it completed.",
          startedAt: runningProofRun.startedAt,
          completedAt: this.now(),
          exitCode: null,
          command: profile.command,
          artifacts: [],
        };
      }

      const completedProofRun: TicketRunProofRunSummary = {
        ...runningProofRun,
        status: proofOutput.status,
        summary: proofOutput.summary,
        startedAt: proofOutput.startedAt,
        completedAt: proofOutput.completedAt,
        exitCode: proofOutput.exitCode,
        command: proofOutput.command,
        artifacts: proofOutput.artifacts,
      };
      run = this.persistRun(this.getFreshRun(runId), {
        proof: {
          status: proofOutput.status,
          lastProofRunId: proofRunId,
          lastProofProfileId: profile.profileId,
          lastProofAt: proofOutput.completedAt,
          lastProofSummary: proofOutput.summary,
          staleReason: null,
          manualReviewJustification: null,
          manualReviewAt: null,
        },
        proofRuns: [completedProofRun, ...run.proofRuns.filter((candidate) => candidate.proofRunId !== proofRunId)],
      });
      this.recordMissionEvent(run, "proof", "proof-finished", {
        proofRunId,
        profileId: profile.profileId,
        status: proofOutput.status,
        exitCode: proofOutput.exitCode,
      });
      this.emitRunUpdate(run.runId);
      const snapshot = memoryDb.getTicketRunSnapshot();
      return {
        run,
        snapshot,
        proofSnapshot: {
          runId: run.runId,
          proof: run.proof,
          profiles: profiles.map((candidate) => toMissionProofProfileSummary(candidate)),
          proofRuns: run.proofRuns,
        },
        proofRun: completedProofRun,
      };
    });
  }

  private assertRunCanCloseWithLifecycle(run: TicketRunSummary): void {
    const effectiveValidations = getEffectiveValidations(run.validations);
    if (run.missionPhase !== "summarize") {
      throw new ConfigError(`Ticket ${run.ticketId} must reach the summarize phase before it can be closed.`);
    }
    if (!run.classification) {
      throw new ConfigError(`Ticket ${run.ticketId} is missing mission classification data.`);
    }
    if (!run.plan) {
      throw new ConfigError(`Ticket ${run.ticketId} is missing a stored mission plan.`);
    }
    if (!run.missionSummary) {
      throw new ConfigError(`Ticket ${run.ticketId} is missing a final mission summary.`);
    }
    if (
      effectiveValidations.length === 0 ||
      !effectiveValidations.some((validation) => validation.status === "passed")
    ) {
      throw new ConfigError(`Ticket ${run.ticketId} requires recorded validation results before it can be closed.`);
    }
    if (effectiveValidations.some((validation) => validation.status === "pending")) {
      throw new ConfigError(`Ticket ${run.ticketId} has pending validation work that must finish before closing.`);
    }
    if (effectiveValidations.some((validation) => validation.status === "failed")) {
      throw new ConfigError(
        `Ticket ${run.ticketId} has failing validation results that must be resolved before closing.`,
      );
    }
    if (run.classification.proofRequired && !run.proofStrategy) {
      throw new ConfigError(`Ticket ${run.ticketId} requires a stored proof strategy before it can be closed.`);
    }
    if (run.classification.proofRequired && run.proof.status !== "passed") {
      throw new ConfigError(`Ticket ${run.ticketId} requires a passing proof result before it can be closed.`);
    }
  }

  async deleteRun(runId: string): Promise<DeleteTicketRunResult> {
    return this.withRunLock(runId, async () => {
      const memoryDb = this.requireMemoryDb();
      const run = this.getFreshRun(runId);
      const deleteBlockers = await this.buildDeleteBlockers(run);
      if (deleteBlockers.length > 0) {
        throw new ConfigError(
          `Mission ${run.ticketId} cannot be deleted because published branches were found: ${describeDeleteBlockers(deleteBlockers)}.`,
        );
      }

      if (run.status === "working" && run.stationId && this.options.cancelMissionPass) {
        await this.options.cancelMissionPass(run.stationId);
      }
      if (this.options.stopRunServices) {
        await this.options.stopRunServices(run.runId);
      }
      if (run.stationId && this.options.closeMissionStation) {
        await this.options.closeMissionStation(run.stationId);
      }

      for (const worktree of run.worktrees) {
        await this.removeManagedWorktree(worktree);
      }

      const missionDirectory = resolveTicketRunMissionDirectory(run.worktrees);
      if (missionDirectory) {
        await rm(missionDirectory, { force: true, recursive: true });
      }

      for (const worktree of run.worktrees) {
        await this.deleteLocalMissionBranch(worktree.repoAbsolutePath, worktree.branchName);
      }

      if (!memoryDb.deleteTicketRun(run.runId)) {
        throw new ConfigError(
          `Mission ${run.ticketId} could not be deleted because its local record no longer exists.`,
        );
      }

      this.reviewSnapshotRequests.delete(runId);
      const snapshot = memoryDb.getTicketRunSnapshot();
      this.emitSnapshot(snapshot);
      return {
        runId: run.runId,
        ticketId: run.ticketId,
        snapshot,
      };
    });
  }

  async getReviewSnapshot(runId: string): Promise<TicketRunReviewSnapshotResult> {
    const existing = this.reviewSnapshotRequests.get(runId);
    if (existing) {
      return existing;
    }

    const request = this.withRunLock(runId, async () => {
      const memoryDb = this.requireMemoryDb();
      const run = await this.ensureRunSubmodules(this.getFreshRun(runId));
      const reviewSnapshot = await this.buildReviewSnapshot(run);

      return {
        run,
        snapshot: memoryDb.getTicketRunSnapshot(),
        reviewSnapshot,
      };
    });
    this.reviewSnapshotRequests.set(runId, request);

    try {
      return await request;
    } finally {
      if (this.reviewSnapshotRequests.get(runId) === request) {
        this.reviewSnapshotRequests.delete(runId);
      }
    }
  }

  private async buildReviewSnapshot(run: TicketRunSummary): Promise<TicketRunReviewSnapshot> {
    const submoduleEntries = await Promise.all(
      run.submodules.map(async (submodule): Promise<TicketRunReviewSubmoduleEntry> => {
        try {
          const managedState = await this.readSubmoduleState(run, submodule.canonicalUrl, {
            includeFiles: false,
            allowHistoryFetch: false,
          });
          return {
            canonicalUrl: submodule.canonicalUrl,
            gitState: toReviewSubmoduleState(managedState.gitState),
            error: null,
          };
        } catch (error) {
          return {
            canonicalUrl: submodule.canonicalUrl,
            gitState: null,
            error: describeReviewLoadError(error, `Failed to load managed submodule state for ${submodule.name}.`),
          };
        }
      }),
    );

    const submoduleGitStatesByUrl = new Map(
      submoduleEntries.flatMap((entry) => (entry.gitState ? ([[entry.canonicalUrl, entry.gitState]] as const) : [])),
    );

    const repoEntries = await Promise.all(
      run.worktrees.map(async (worktree): Promise<TicketRunReviewRepoEntry> => {
        try {
          const gitState = await this.readGitState(run, worktree.repoRelativePath, submoduleGitStatesByUrl, {
            includeFiles: false,
            allowHistoryFetch: false,
          });
          return {
            repoRelativePath: worktree.repoRelativePath,
            gitState: toReviewRepoState(gitState),
            error: null,
          };
        } catch (error) {
          return {
            repoRelativePath: worktree.repoRelativePath,
            gitState: null,
            error: describeReviewLoadError(error, `Failed to load mission git state for ${worktree.repoRelativePath}.`),
          };
        }
      }),
    );

    const reviewSnapshot: TicketRunReviewSnapshot = {
      runId: run.runId,
      repoEntries,
      submoduleEntries,
      visibleRepoPaths: repoEntries
        .filter((entry) => entry.error !== null || (entry.gitState !== null && isRepoVisibleInReview(entry.gitState)))
        .map((entry) => entry.repoRelativePath),
      visibleSubmoduleUrls: submoduleEntries
        .filter(
          (entry) => entry.error !== null || (entry.gitState !== null && isSubmoduleVisibleInReview(entry.gitState)),
        )
        .map((entry) => entry.canonicalUrl),
      canClose:
        repoEntries.every(
          (entry) => entry.error === null && entry.gitState !== null && !isRepoBlockingClose(entry.gitState),
        ) &&
        submoduleEntries.every(
          (entry) => entry.error === null && entry.gitState !== null && !isSubmoduleBlockingClose(entry.gitState),
        ),
      canDelete: false,
      deleteBlockers: await this.buildDeleteBlockers(run),
    };
    reviewSnapshot.canDelete = reviewSnapshot.deleteBlockers.length === 0;

    return reviewSnapshot;
  }

  async getGitState(runId: string, repoRelativePath?: string): Promise<TicketRunGitStateResult> {
    const run = this.getFreshRun(runId);
    return {
      run,
      snapshot: this.requireMemoryDb().getTicketRunSnapshot(),
      gitState: await this.readGitState(run, repoRelativePath),
    };
  }

  async getSubmoduleGitState(runId: string, canonicalUrl: string): Promise<TicketRunSubmoduleGitStateResult> {
    const run = this.getFreshRun(runId);
    return {
      run,
      snapshot: this.requireMemoryDb().getTicketRunSnapshot(),
      gitState: (await this.readSubmoduleState(run, canonicalUrl)).gitState,
    };
  }

  async generateCommitDraft(runId: string, repoRelativePath?: string): Promise<GenerateTicketRunCommitDraftResult> {
    return this.withRunLock(runId, async () => {
      const run = await this.ensureRunSubmodules(this.getFreshRun(runId));
      const updatedRun = await this.generateAndPersistCommitDraft(run, repoRelativePath);
      this.emitRunUpdate(updatedRun.runId);
      return {
        run: updatedRun,
        snapshot: this.requireMemoryDb().getTicketRunSnapshot(),
        gitState: await this.readGitState(updatedRun, repoRelativePath),
      };
    });
  }

  async generateSubmoduleCommitDraft(
    runId: string,
    canonicalUrl: string,
  ): Promise<GenerateTicketRunSubmoduleCommitDraftResult> {
    return this.withRunLock(runId, async () => {
      const run = await this.ensureRunSubmodules(this.getFreshRun(runId));
      const updatedRun = await this.generateAndPersistSubmoduleCommitDraft(run, canonicalUrl);
      this.emitRunUpdate(updatedRun.runId);
      return {
        run: updatedRun,
        snapshot: this.requireMemoryDb().getTicketRunSnapshot(),
        gitState: (await this.readSubmoduleState(updatedRun, canonicalUrl)).gitState,
      };
    });
  }

  async setCommitDraft(
    runId: string,
    message: string,
    repoRelativePath?: string,
  ): Promise<SetTicketRunCommitDraftResult> {
    return this.withRunLock(runId, async () => {
      const run = await this.ensureRunSubmodules(this.getFreshRun(runId));
      const worktree = this.resolveTargetWorktree(run, repoRelativePath);
      const nextRun = this.persistRun(run, {
        worktrees: run.worktrees.map((candidate) =>
          candidate.repoRelativePath === worktree.repoRelativePath
            ? {
                ...candidate,
                commitMessageDraft: message,
              }
            : candidate,
        ),
      });
      this.emitRunUpdate(nextRun.runId);
      return {
        run: nextRun,
        snapshot: this.requireMemoryDb().getTicketRunSnapshot(),
        gitState: await this.readGitState(nextRun, worktree.repoRelativePath),
      };
    });
  }

  async setSubmoduleCommitDraft(
    runId: string,
    canonicalUrl: string,
    message: string,
  ): Promise<SetTicketRunSubmoduleCommitDraftResult> {
    return this.withRunLock(runId, async () => {
      const run = await this.ensureRunSubmodules(this.getFreshRun(runId));
      this.requireManagedSubmodule(run, canonicalUrl);
      const nextRun = this.persistRun(run, {
        submodules: run.submodules.map((candidate) =>
          candidate.canonicalUrl === canonicalUrl
            ? {
                ...candidate,
                commitMessageDraft: message,
              }
            : candidate,
        ),
      });
      this.emitRunUpdate(nextRun.runId);
      return {
        run: nextRun,
        snapshot: this.requireMemoryDb().getTicketRunSnapshot(),
        gitState: (await this.readSubmoduleState(nextRun, canonicalUrl)).gitState,
      };
    });
  }

  async commitRun(runId: string, message: string, repoRelativePath?: string): Promise<CommitTicketRunResult> {
    return this.withRunLock(runId, async () => {
      const run = await this.ensureRunSubmodules(this.getFreshRun(runId));
      if (run.status !== "awaiting-review") {
        throw new ConfigError(`Ticket ${run.ticketId} must be awaiting review before it can be committed.`);
      }
      const trimmedMessage = message.trim();
      if (!trimmedMessage) {
        throw new ConfigError("Enter a commit message before committing this mission.");
      }

      const worktree = this.resolveTargetWorktree(run, repoRelativePath);
      const gitState = await this.readGitState(run, worktree.repoRelativePath);
      this.assertParentRepoSubmodulesReady(run, gitState, "commit");
      if (!gitState.hasDiff) {
        throw new ConfigError(`Ticket ${run.ticketId} does not have any changes to commit.`);
      }

      const identity = await this.resolveMissionGitIdentity();
      try {
        await this.runGitCommand(worktree.worktreePath, ["add", "-A"]);
        await this.runGitCommand(worktree.worktreePath, [
          "-c",
          `user.name=${identity.name}`,
          "-c",
          `user.email=${identity.email}`,
          ...this.buildCommitSigningArgs(),
          "commit",
          `--author=${identity.name} <${identity.email}>`,
          "--cleanup=strip",
          "-m",
          trimmedMessage,
        ]);
      } catch (error) {
        this.options.logger.warn({ err: error, runId, ticketId: run.ticketId }, "Mission commit failed");
        throw new SpiraError(
          "MISSIONS_COMMIT_FAILED",
          `Failed to commit ${run.ticketId}. Check the git log for the underlying error.`,
          error,
        );
      }

      const commitSha = (await this.runGitCommand(worktree.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
      const nextRun = this.persistRun(run, {
        worktrees: run.worktrees.map((candidate) =>
          candidate.repoRelativePath === worktree.repoRelativePath
            ? {
                ...candidate,
                commitMessageDraft: null,
              }
            : candidate,
        ),
      });
      this.emitRunUpdate(nextRun.runId);
      return {
        run: nextRun,
        snapshot: this.requireMemoryDb().getTicketRunSnapshot(),
        gitState: await this.readGitState(nextRun, worktree.repoRelativePath),
        commitSha,
      };
    });
  }

  async commitSubmodule(runId: string, canonicalUrl: string, message: string): Promise<CommitTicketRunSubmoduleResult> {
    return this.withRunLock(runId, async () => {
      const run = await this.ensureRunSubmodules(this.getFreshRun(runId));
      if (run.status !== "awaiting-review") {
        throw new ConfigError(
          `Ticket ${run.ticketId} must be awaiting review before a managed submodule can be committed.`,
        );
      }

      const trimmedMessage = message.trim();
      if (!trimmedMessage) {
        throw new ConfigError("Enter a commit message before committing this managed submodule.");
      }

      const managedState = await this.readSubmoduleState(run, canonicalUrl);
      if (managedState.gitState.reconcileRequired) {
        throw new ConfigError(
          managedState.gitState.reconcileReason ??
            `Managed submodule ${managedState.summary.name} requires reconciliation.`,
        );
      }
      if (!managedState.gitState.hasDiff) {
        throw new ConfigError(`Managed submodule ${managedState.summary.name} does not have any changes to commit.`);
      }

      await this.ensureBranchCheckedOut(managedState.gitState.worktreePath, managedState.gitState.branchName);
      const identity = await this.resolveMissionGitIdentity();
      try {
        await this.runGitCommand(managedState.gitState.worktreePath, ["add", "-A"]);
        await this.runGitCommand(managedState.gitState.worktreePath, [
          "-c",
          `user.name=${identity.name}`,
          "-c",
          `user.email=${identity.email}`,
          ...this.buildCommitSigningArgs(),
          "commit",
          `--author=${identity.name} <${identity.email}>`,
          "--cleanup=strip",
          "-m",
          trimmedMessage,
        ]);
      } catch (error) {
        this.options.logger.warn(
          { err: error, runId, ticketId: run.ticketId, canonicalUrl },
          "Managed submodule commit failed",
        );
        throw new SpiraError(
          "MISSIONS_SUBMODULE_COMMIT_FAILED",
          `Failed to commit managed submodule ${managedState.summary.name}. Check the git log for the underlying error.`,
          error,
        );
      }

      const commitSha = (
        await this.runGitCommand(managedState.gitState.worktreePath, ["rev-parse", "HEAD"])
      ).stdout.trim();
      const nextRun = this.persistRun(run, {
        submodules: run.submodules.map((candidate) =>
          candidate.canonicalUrl === canonicalUrl
            ? {
                ...candidate,
                commitMessageDraft: null,
              }
            : candidate,
        ),
      });
      this.emitRunUpdate(nextRun.runId);
      return {
        run: nextRun,
        snapshot: this.requireMemoryDb().getTicketRunSnapshot(),
        gitState: (await this.readSubmoduleState(nextRun, canonicalUrl)).gitState,
        commitSha,
      };
    });
  }

  async publishRun(runId: string, repoRelativePath?: string): Promise<SyncTicketRunRemoteResult> {
    return this.syncRemote(runId, "publish", repoRelativePath);
  }

  async pushRun(runId: string, repoRelativePath?: string): Promise<SyncTicketRunRemoteResult> {
    return this.syncRemote(runId, "push", repoRelativePath);
  }

  async publishSubmodule(runId: string, canonicalUrl: string): Promise<SyncTicketRunSubmoduleRemoteResult> {
    return this.syncSubmoduleRemote(runId, canonicalUrl, "publish");
  }

  async pushSubmodule(runId: string, canonicalUrl: string): Promise<SyncTicketRunSubmoduleRemoteResult> {
    return this.syncSubmoduleRemote(runId, canonicalUrl, "push");
  }

  async createPullRequest(runId: string, repoRelativePath?: string): Promise<CreateTicketRunPullRequestResult> {
    return this.withRunLock(runId, async () => {
      const run = await this.ensureRunSubmodules(this.getFreshRun(runId));
      if (run.status !== "awaiting-review") {
        throw new ConfigError(`Ticket ${run.ticketId} must be awaiting review before a pull request can be opened.`);
      }

      const gitState = await this.readGitState(run, repoRelativePath);
      this.assertParentRepoSubmodulesReady(run, gitState, "open a pull request for");
      if (gitState.hasDiff) {
        throw new ConfigError(`Commit the changes for ${run.ticketId} before opening a pull request.`);
      }
      if (gitState.pushAction !== "none") {
        throw new ConfigError(`Publish and push ${run.ticketId} before opening a pull request.`);
      }

      const pullRequestUrl = await this.createGitHubPullRequest(run, gitState);
      return {
        run,
        snapshot: this.requireMemoryDb().getTicketRunSnapshot(),
        gitState,
        pullRequestUrl,
      };
    });
  }

  async createSubmodulePullRequest(
    runId: string,
    canonicalUrl: string,
  ): Promise<CreateTicketRunSubmodulePullRequestResult> {
    return this.withRunLock(runId, async () => {
      const run = await this.ensureRunSubmodules(this.getFreshRun(runId));
      if (run.status !== "awaiting-review") {
        throw new ConfigError(
          `Ticket ${run.ticketId} must be awaiting review before a managed submodule pull request can be opened.`,
        );
      }

      const managedState = await this.readSubmoduleState(run, canonicalUrl);
      if (managedState.gitState.reconcileRequired) {
        throw new ConfigError(
          managedState.gitState.reconcileReason ??
            `Managed submodule ${managedState.summary.name} requires reconciliation.`,
        );
      }
      if (managedState.gitState.parents.some((parentState) => !parentState.isAligned)) {
        throw new ConfigError(
          `Publish ${managedState.summary.name} and align every parent repo before opening its pull request.`,
        );
      }
      if (managedState.gitState.hasDiff) {
        throw new ConfigError(`Commit the changes for ${managedState.summary.name} before opening a pull request.`);
      }
      if (managedState.gitState.pushAction !== "none") {
        throw new ConfigError(`Publish and push ${managedState.summary.name} before opening a pull request.`);
      }

      const pullRequestUrl = await this.createGitHubPullRequest(run, managedState.gitState);
      return {
        run,
        snapshot: this.requireMemoryDb().getTicketRunSnapshot(),
        gitState: managedState.gitState,
        pullRequestUrl,
      };
    });
  }

  dispose(): void {
    this.disposed = true;
    this.reviewSnapshotRequests.clear();
  }

  private requireMemoryDb(): SpiraMemoryDatabase {
    if (!this.options.memoryDb) {
      throw new ConfigError("Ticket run persistence is unavailable.");
    }
    return this.options.memoryDb;
  }

  private getFreshRun(runId: string): TicketRunSummary {
    const memoryDb = this.requireMemoryDb();
    this.recoverInterruptedWork();
    const run = memoryDb.getTicketRun(runId);
    if (!run) {
      throw new ConfigError(`Unknown ticket run ${runId}.`);
    }
    return run;
  }

  private getLatestAttempt(run: TicketRunSummary): TicketRunAttemptSummary | null {
    return run.attempts.at(-1) ?? null;
  }

  private async maybeHydrateWorktreeSubmodules(
    worktree: Pick<TicketRunSummary["worktrees"][number], "repoRelativePath" | "worktreePath">,
    hasSubmodulesHint?: boolean,
  ): Promise<void> {
    if (hasSubmodulesHint === false) {
      return;
    }

    if (hasSubmodulesHint !== true && !(await this.worktreeHasGitmodules(worktree.worktreePath))) {
      return;
    }

    const missionGitToken = this.getOptionalMissionGitToken();
    try {
      await this.runGitCommand(worktree.worktreePath, [
        ...(missionGitToken ? buildGitHubHttpAuthArgs(missionGitToken) : []),
        "submodule",
        "update",
        "--init",
        "--recursive",
      ]);
    } catch (error) {
      const detail = extractGitFailureDetail(error);
      const detailSentence = detail ? ` Git reported: ${detail}${/[.!?]$/u.test(detail) ? "" : "."}` : "";
      const missionGitTokenHint =
        !missionGitToken && isGitHubCredentialPromptFailure(error)
          ? " Set a mission GitHub PAT in Settings so Spira can clone private GitHub submodules."
          : "";
      throw new SpiraError(
        "MISSIONS_SUBMODULE_UPDATE_FAILED",
        `Failed to hydrate submodules for ${worktree.repoRelativePath}.${detailSentence}${missionGitTokenHint}`,
        error,
      );
    }
  }

  private async worktreeHasGitmodules(worktreePath: string): Promise<boolean> {
    return pathExists(path.join(worktreePath, ".gitmodules"));
  }

  private async discoverMissionProofProfiles(run: TicketRunSummary): Promise<ResolvedMissionProofProfile[]> {
    if (this.options.discoverMissionProofProfiles) {
      return this.options.discoverMissionProofProfiles(run);
    }
    const profiles = await Promise.all(
      run.worktrees.map((worktree) => this.cachedWorktreeProofDiscovery(run, worktree)),
    );
    return profiles.flatMap((profile) => (profile ? [profile] : []));
  }

  private async cachedWorktreeProofDiscovery(
    run: TicketRunSummary,
    worktree: TicketRunSummary["worktrees"][number],
  ): Promise<ResolvedMissionProofProfile | null> {
    const cached = this.proofDiscoveryCache.get(worktree.worktreePath);
    if (cached !== undefined) return cached;
    const profile = await discoverProofProfileForWorktree(run, worktree);
    this.proofDiscoveryCache.set(worktree.worktreePath, profile);
    return profile;
  }

  private async executeMissionProof(input: RunMissionProofInput): Promise<RunMissionProofOutput> {
    return this.options.runMissionProof ? this.options.runMissionProof(input) : runMissionProof(input);
  }

  /**
   * preflight delegate. Tests inject a stub that returns ok=true so they can
   * exercise the runProof flow without a real `dotnet` install or worktree-on-disk.
   */
  private async executeProofPreflight(profile: ResolvedMissionProofProfile) {
    return this.options.runProofPreflight ? this.options.runProofPreflight(profile) : runProofPreflight(profile);
  }

  private async buildProofSnapshot(run: TicketRunSummary): Promise<TicketRunProofSnapshot> {
    const profiles = await this.discoverMissionProofProfiles(run);
    return {
      runId: run.runId,
      proof: run.proof,
      profiles: profiles.map((profile) => toMissionProofProfileSummary(profile)),
      proofRuns: run.proofRuns,
    };
  }

  private async launchMissionPass(run: TicketRunSummary, prompt: string): Promise<MissionPassHandle> {
    if (!this.options.launchMissionPass) {
      throw new ConfigError("Mission work execution is unavailable.");
    }

    try {
      return await this.options.launchMissionPass({ run, prompt });
    } catch (error) {
      this.options.logger.warn(
        { err: error, runId: run.runId, ticketId: run.ticketId },
        "Failed to launch mission pass",
      );
      const failedRun = this.persistRun(run, {
        stationId: run.stationId,
        status: "error",
        statusMessage: error instanceof Error ? error.message : "Failed to start mission work.",
      });
      this.emitRunUpdate(failedRun.runId);
      throw new ConfigError(failedRun.statusMessage ?? "Failed to start mission work.");
    }
  }

  private beginAttempt(run: TicketRunSummary, handle: MissionPassHandle, prompt: string | null): TicketRunSummary {
    const now = this.now();
    const nextSequence = (this.getLatestAttempt(run)?.sequence ?? 0) + 1;
    const workspace = describeTicketRunWorkspace(run.worktrees);
    const attempt: TicketRunAttemptSummary = {
      attemptId: this.attemptIdFactory(),
      runId: run.runId,
      subagentRunId: null,
      sequence: nextSequence,
      status: "running",
      prompt,
      summary: null,
      followupNeeded: false,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    const nextRun = this.persistRun(run, {
      stationId: handle.stationId,
      status: "working",
      statusMessage:
        workspace.noun === "worktree"
          ? `Attempt ${nextSequence} is working in ${workspace.path}.`
          : `Attempt ${nextSequence} is working from ${workspace.path} across ${run.worktrees.length} repos.`,
      missionPhase: "classification",
      missionPhaseUpdatedAt: now,
      classification: null,
      plan: null,
      validations: [],
      proofStrategy: null,
      missionSummary: null,
      proof: buildStaleProofSummary(run, "A new mission work pass started after the last proof run."),
      attempts: [...run.attempts, attempt],
    });
    this.recordMissionEvent(nextRun, nextRun.missionPhase, "attempt-started", {
      attemptId: attempt.attemptId,
      sequence: attempt.sequence,
      reusedLiveAttempt: handle.reusedLiveAttempt,
      promptProvided: prompt !== null,
    });
    this.emitRunUpdate(nextRun.runId);
    void this.watchAttemptCompletion(nextRun.runId, attempt.attemptId, handle.completion);
    return nextRun;
  }

  private async watchAttemptCompletion(
    runId: string,
    attemptId: string,
    completion: Promise<MissionPassResult>,
  ): Promise<void> {
    try {
      const result = await completion;
      await this.applyAttemptCompletion(runId, attemptId, result);
    } catch (error) {
      this.options.logger.warn({ err: error, runId, attemptId }, "Mission pass completion failed");
      await this.applyAttemptCompletion(runId, attemptId, {
        status: "failed",
        summary: error instanceof Error ? error.message : "Mission work ended without a usable result.",
      });
    }
  }

  private async applyAttemptCompletion(
    runId: string,
    attemptId: string,
    result: MissionPassResult,
    repairCount = 0,
  ): Promise<void> {
    if (this.disposed) {
      return;
    }
    const repaired = await this.tryRepairAttemptCompletion(runId, attemptId, result, repairCount);
    if (repaired) {
      return;
    }
    await this.withRunLock(runId, async () => {
      if (this.disposed) {
        return;
      }
      const memoryDb = this.options.memoryDb;
      if (!memoryDb) {
        return;
      }
      const run = memoryDb.getTicketRun(runId);
      if (!run) {
        return;
      }

      const targetAttempt = run.attempts.find((attempt) => attempt.attemptId === attemptId);
      if (!targetAttempt || targetAttempt.status !== "running") {
        return;
      }

      const workflow = getMissionWorkflowState(run);
      const finalResult =
        result.status === "completed" && workflow.nextAction !== "complete-pass"
          ? {
              status: "failed" as const,
              summary: `Mission workflow incomplete: ${workflow.blockedReason ?? "record the missing lifecycle state before finishing."}`,
            }
          : result;
      const completedAt = this.now();
      const attemptStatus: TicketRunAttemptStatus =
        finalResult.status === "completed" ? "completed" : finalResult.status === "cancelled" ? "cancelled" : "failed";
      const summary = finalResult.summary.trim() || "Mission work finished and is ready for review.";
      const updatedRun = this.persistRun(run, {
        status: "awaiting-review",
        statusMessage: summary,
        previousPassContext:
          attemptStatus === "completed"
            ? {
                attemptId,
                sequence: targetAttempt.sequence,
                completedAt,
                summary,
                classification: run.classification,
                plan: run.plan,
                validations: run.validations,
                proofStrategy: run.proofStrategy,
                missionSummary: run.missionSummary,
                proof: run.proof,
              }
            : run.previousPassContext,
        attempts: run.attempts.map((attempt) =>
          attempt.attemptId === attemptId
            ? {
                ...attempt,
                status: attemptStatus,
                summary,
                followupNeeded: true,
                completedAt,
                updatedAt: completedAt,
              }
            : attempt,
        ),
      });
      this.recordMissionEvent(updatedRun, updatedRun.missionPhase, "attempt-finished", {
        attemptId,
        status: attemptStatus,
        repairCount,
        waitReason: workflow.waitReason,
        nextAction: workflow.nextAction,
      });
      this.emitRunUpdate(updatedRun.runId);
      this.options.logger.debug(
        { runId: updatedRun.runId, ticketId: updatedRun.ticketId, attemptId, attemptStatus },
        "Mission pass completed",
      );
    });
  }

  private async tryRepairAttemptCompletion(
    runId: string,
    attemptId: string,
    result: MissionPassResult,
    repairCount: number,
  ): Promise<boolean> {
    if (result.status !== "completed" || repairCount > 0 || !this.options.repairMissionPass) {
      return false;
    }

    const memoryDb = this.options.memoryDb;
    if (!memoryDb) {
      return false;
    }
    const run = memoryDb.getTicketRun(runId);
    if (!run) {
      return false;
    }

    const targetAttempt = run.attempts.find((attempt) => attempt.attemptId === attemptId);
    if (!targetAttempt || targetAttempt.status !== "running") {
      return false;
    }

    const workflow = getMissionWorkflowState(run);
    if (workflow.nextAction === "complete-pass") {
      return false;
    }

    this.persistRun(run, {
      status: "working",
      statusMessage: `Mission workflow incomplete. Requesting corrective turn: ${workflow.nextActionLabel}.`,
    });
    this.recordMissionEvent(run, run.missionPhase, "attempt-repair-requested", {
      attemptId,
      waitReason: workflow.waitReason,
      nextAction: workflow.nextAction,
    });
    this.emitRunUpdate(run.runId);

    const repairedResult = await this.options.repairMissionPass({
      run,
      prompt: buildMissionWorkflowRepairPrompt(run),
    });
    await this.applyAttemptCompletion(runId, attemptId, repairedResult, repairCount + 1);
    return true;
  }

  private recoverInterruptedWorkOnce(memoryDb: SpiraMemoryDatabase): void {
    if (this.interruptedWorkRecovered) {
      return;
    }
    this.interruptedWorkRecovered = true;
    this.applyInterruptedWorkRecovery(memoryDb);
  }

  private applyInterruptedWorkRecovery(memoryDb: SpiraMemoryDatabase): void {
    const allRuns = memoryDb.listTicketRuns();
    const strandedRuns = allRuns.filter(
      (run) => run.status === "working" && this.getLatestAttempt(run)?.status === "running",
    );
    // Runs killed during startRun never reach "ready" / "working", so the working-only sweep
    // misses them. The "starting" state is process-bound — a fresh Spira boot means no
    // startRun is in flight, so any run still flagged "starting" is by definition stranded.
    const strandedStartups = allRuns.filter((run) => run.status === "starting");
    if (strandedRuns.length === 0 && strandedStartups.length === 0) {
      return;
    }

    const now = this.now();
    for (const run of strandedRuns) {
      const latestAttempt = this.getLatestAttempt(run);
      if (!latestAttempt) {
        continue;
      }

      this.persistRun(run, {
        status: "awaiting-review",
        statusMessage:
          "Spira restarted before the work attempt reported back. Review the worktree and continue when ready.",
        attempts: run.attempts.map((attempt) =>
          attempt.attemptId === latestAttempt.attemptId
            ? {
                ...attempt,
                status: "failed",
                summary: "Spira restarted before the work attempt reported back.",
                followupNeeded: true,
                completedAt: now,
                updatedAt: now,
              }
            : attempt,
        ),
      });
      this.recordMissionEvent(run, "system", "attempt-recovered-after-restart", {
        attemptId: latestAttempt.attemptId,
      });
    }

    for (const run of strandedStartups) {
      const previousStatusMessage = run.statusMessage ?? null;
      const recoveredRun = this.persistRun(run, {
        status: "error",
        statusMessage: "Spira restarted before mission startup finished. Retry to try again, or abandon to discard.",
      });
      this.recordMissionEvent(recoveredRun, "system", "mission-startup-recovered-after-restart", {
        previousStatusMessage,
      });
    }

    this.emitSnapshot(memoryDb.getTicketRunSnapshot());
  }

  /**
   * prompt order is optimised for provider prompt caching.
   *
   * Stable-per-mission sections (repo guidance, workspace layout, the workflow contract
   * boilerplate) come FIRST so the provider can hash and cache the longest possible prefix
   * across a mission's attempts. Ticket-specific lines (ticket id, summary, operator
   * follow-up) come LAST. The cache window is per-(model, system-prompt, user-prefix) so
   * stable-prefix-first means a real token-cost reduction across attempts.
   */
  private buildInitialPrompt(run: TicketRunSummary, prompt: string | null): string {
    const workspace = describeTicketRunWorkspace(run.worktrees);
    const guidance = this.tryBuildRepoGuidance(run);
    return [
      // ── Stable per-mission prefix (cacheable) ───────────────────────────────────
      ...(guidance ? [guidance] : []),
      `Mission workspace: ${workspace.phrase}.`,
      `Repositories in scope:\n${formatTicketRunWorktreeList(run.worktrees)}`,
      "The working directory is already set to the mission workspace. Move between repo directories as needed.",
      "Inspect the codebase, implement the ticket, and leave the worktree in a reviewable state.",
      "Use the existing station context as your scratchpad; do not restart from first principles unless the evidence demands it.",
      "If the ticket references screenshots or other attached evidence, call youtrack_list_attachments and then youtrack_view_attachment to inspect them.",
      "If you stop with open questions or partial work, say so plainly in your final summary.",
      // ── Per-attempt suffix (not cacheable) ──────────────────────────────────────
      `Work on ticket ${run.ticketId}: ${run.ticketSummary}.`,
      prompt ? `Additional operator context: ${prompt}` : "No extra operator context was provided beyond the ticket.",
    ].join("\n");
  }

  private buildContinuationPrompt(run: TicketRunSummary, prompt: string | null): string {
    const latestAttempt = this.getLatestAttempt(run);
    const workspace = describeTicketRunWorkspace(run.worktrees);
    const guidance = this.tryBuildRepoGuidance(run);
    const priorPass = formatPreviousPassContextSection(run.previousPassContext);
    return [
      // ── Stable per-mission prefix (cacheable) ───────────────────────────────────
      ...(guidance ? [guidance] : []),
      `Mission workspace: ${workspace.phrase}.`,
      `Repositories in scope:\n${formatTicketRunWorktreeList(run.worktrees)}`,
      "Stay inside the mission workspace and preserve the existing repo layout.",
      "Continue inside the same mission station and preserve context from the prior pass.",
      "If the ticket references screenshots or other attached evidence you have not yet seen, call youtrack_list_attachments and then youtrack_view_attachment to inspect them.",
      // ── Per-attempt suffix (not cacheable) ──────────────────────────────────────
      `Continue work on ticket ${run.ticketId}: ${run.ticketSummary}.`,
      latestAttempt?.summary ? `Last pass summary: ${latestAttempt.summary}` : "No prior pass summary is available.",
      ...(priorPass ? [priorPass] : []),
      prompt
        ? `User follow-up: ${prompt}`
        : "Tighten the solution, resolve remaining issues, and leave a crisp handoff summary.",
    ].join("\n");
  }

  /**
   * best-effort repo-guidance section. Returns null if no memoryDb is wired
   * (test stubs) or if there's nothing useful to inject. Failures are logged but never
   * fault prompt construction — guidance is a hint, not a hard requirement.
   */
  private tryBuildRepoGuidance(run: TicketRunSummary): string | null {
    const memoryDb = this.options.memoryDb;
    if (!memoryDb) return null;
    try {
      const result = buildRepoGuidanceSection(memoryDb, run);
      if (!result) return null;
      // Record provenance so the renderer's "Guidance applied" panel can show which
      // learned entries shaped this attempt's prompt. Best-effort; never faults.
      try {
        this.recordMissionEvent(run, "system", "repo-guidance-injected", {
          repoIntelligenceEntryIds: result.provenance.repoIntelligenceEntryIds,
          validationProfileIds: result.provenance.validationProfileIds,
          repoProfileKeys: result.provenance.repoProfileKeys,
          sectionLength: result.provenance.sectionLength,
        });
      } catch (provenanceError) {
        this.options.logger.warn(
          { err: provenanceError, runId: run.runId },
          "Failed to record repo-guidance-injected event; continuing",
        );
      }
      return result.markdown;
    } catch (error) {
      this.options.logger.warn(
        { err: error, runId: run.runId, ticketId: run.ticketId },
        "Failed to build repo guidance section; continuing without it",
      );
      return null;
    }
  }

  private resolveTargetWorktree(
    run: TicketRunSummary,
    repoRelativePath?: string,
  ): TicketRunSummary["worktrees"][number] {
    const normalizedRepoRelativePath = repoRelativePath?.trim();
    const worktree = normalizedRepoRelativePath
      ? run.worktrees.find((candidate) => candidate.repoRelativePath === normalizedRepoRelativePath)
      : run.worktrees[0];
    if (!worktree) {
      throw new ConfigError(
        normalizedRepoRelativePath
          ? `Ticket ${run.ticketId} does not have a managed worktree for ${normalizedRepoRelativePath}.`
          : `Ticket ${run.ticketId} does not have a managed worktree yet.`,
      );
    }
    return worktree;
  }

  private async hasLocalBranch(repoAbsolutePath: string, branchName: string): Promise<boolean> {
    try {
      const result = await this.runGitCommand(repoAbsolutePath, [
        "branch",
        "--list",
        "--format=%(refname:short)",
        branchName,
      ]);
      return result.stdout.trim() === branchName;
    } catch {
      return false;
    }
  }

  private async isUsableManagedWorktree(
    worktree: Pick<TicketRunSummary["worktrees"][number], "worktreePath">,
  ): Promise<boolean> {
    // pathExists first so that an externally-deleted worktree never hits a stale cache.
    if (!(await pathExists(worktree.worktreePath))) {
      this.usableWorktreeCache.delete(worktree.worktreePath);
      return false;
    }
    if (this.usableWorktreeCache.has(worktree.worktreePath)) {
      return true;
    }
    try {
      await this.runGitCommand(worktree.worktreePath, ["rev-parse", "--git-dir"]);
      this.usableWorktreeCache.set(worktree.worktreePath, true);
      return true;
    } catch {
      return false;
    }
  }

  private async normalizeRecoverableWorktrees(
    ticketId: string,
    runId: string | null,
    worktrees: Array<
      Pick<
        TicketRunSummary["worktrees"][number],
        | "repoRelativePath"
        | "repoAbsolutePath"
        | "worktreePath"
        | "branchName"
        | "commitMessageDraft"
        | "cleanupState"
        | "createdAt"
        | "updatedAt"
      >
    >,
  ): Promise<typeof worktrees> {
    const recoverableWorktrees: typeof worktrees = [];
    for (const worktree of worktrees) {
      if (await this.isUsableManagedWorktree(worktree)) {
        recoverableWorktrees.push(worktree);
        continue;
      }

      try {
        await this.removeManagedWorktree(worktree);
      } catch (cleanupError) {
        this.options.logger.warn(
          { err: cleanupError, ticketId, runId, worktreePath: worktree.worktreePath },
          "Failed to clear an invalid recoverable managed worktree before recreation",
        );
      }
    }
    return recoverableWorktrees;
  }

  private async removeManagedWorktree(worktree: TicketRunSummary["worktrees"][number]): Promise<void> {
    // Phase 4.2/4.4 — invalidate caches keyed on this worktree path. Idempotent.
    this.usableWorktreeCache.delete(worktree.worktreePath);
    this.proofDiscoveryCache.delete(worktree.worktreePath);
    if (!(await pathExists(worktree.worktreePath))) {
      try {
        await this.runGitCommand(worktree.repoAbsolutePath, ["worktree", "prune"]);
      } catch {
        // Ignore prune failures for already-missing worktrees; delete retries should still be possible.
      }
      return;
    }

    try {
      await this.runGitCommand(worktree.repoAbsolutePath, ["worktree", "remove", "--force", worktree.worktreePath]);
      return;
    } catch (error) {
      await rm(worktree.worktreePath, { force: true, recursive: true });
      try {
        await this.runGitCommand(worktree.repoAbsolutePath, ["worktree", "prune"]);
      } catch {
        // Best effort prune after a forced directory cleanup.
      }
      if (await pathExists(worktree.worktreePath)) {
        throw error;
      }
    }
  }

  private async deleteLocalMissionBranch(repoAbsolutePath: string, branchName: string): Promise<void> {
    if (!(await this.hasLocalBranch(repoAbsolutePath, branchName))) {
      return;
    }

    await this.runGitCommand(repoAbsolutePath, ["branch", "-D", branchName]);
  }

  private async readBranchUpstream(repoAbsolutePath: string, branchName: string): Promise<string | null> {
    if (!(await pathExists(repoAbsolutePath))) {
      return null;
    }
    if (!(await this.hasLocalBranch(repoAbsolutePath, branchName))) {
      return null;
    }

    const result = await this.runGitCommand(repoAbsolutePath, [
      "for-each-ref",
      "--format=%(upstream:short)",
      `refs/heads/${branchName}`,
    ]);
    const upstreamBranch = result.stdout.trim();
    return upstreamBranch.length > 0 ? upstreamBranch : null;
  }

  private async buildDeleteBlockers(run: TicketRunSummary): Promise<TicketRunDeleteBlocker[]> {
    const repoBlockers = await Promise.all(
      run.worktrees.map(async (worktree): Promise<TicketRunDeleteBlocker | null> => {
        try {
          const upstreamBranch = await this.readBranchUpstream(worktree.repoAbsolutePath, worktree.branchName);
          return upstreamBranch
            ? {
                label: worktree.repoRelativePath,
                reason: `branch ${worktree.branchName} is already published`,
              }
            : null;
        } catch {
          return {
            label: worktree.repoRelativePath,
            reason: "publish state could not be verified",
          };
        }
      }),
    );

    const submoduleBlockers = await Promise.all(
      run.submodules.map(async (submodule): Promise<TicketRunDeleteBlocker | null> => {
        let submoduleRepoPath: string | null = null;
        for (const parentRef of submodule.parentRefs) {
          if (await pathExists(parentRef.submoduleWorktreePath)) {
            submoduleRepoPath = parentRef.submoduleWorktreePath;
            break;
          }
        }
        if (!submoduleRepoPath) {
          return null;
        }

        try {
          const upstreamBranch = await this.readBranchUpstream(submoduleRepoPath, submodule.branchName);
          return upstreamBranch
            ? {
                label: submodule.name,
                reason: `branch ${submodule.branchName} is already published`,
              }
            : null;
        } catch {
          return {
            label: submodule.name,
            reason: "publish state could not be verified",
          };
        }
      }),
    );

    return [...repoBlockers, ...submoduleBlockers].filter(
      (blocker): blocker is TicketRunDeleteBlocker => blocker !== null,
    );
  }

  private async resolveHeadSha(worktreePath: string): Promise<string | null> {
    try {
      return (await this.runGitCommand(worktreePath, ["rev-parse", "HEAD"])).stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private async hasCommitObject(worktreePath: string, sha: string): Promise<boolean> {
    try {
      await this.runGitCommand(worktreePath, ["rev-parse", "--verify", `${sha}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureCommitObjectAvailable(
    worktreePath: string,
    sha: string,
    sourcePath: string,
    allowFetch = true,
  ): Promise<boolean> {
    if (await this.hasCommitObject(worktreePath, sha)) {
      return true;
    }

    if (!allowFetch) {
      return false;
    }

    if (sourcePath !== worktreePath) {
      try {
        await this.runGitCommand(worktreePath, ["fetch", "--no-tags", sourcePath, sha]);
      } catch {
        // Fall through and let the caller surface a reconciliation error if histories still cannot be compared.
      }
    }

    return this.hasCommitObject(worktreePath, sha);
  }

  private async isAncestorInRepo(
    worktreePath: string,
    ancestorSha: string,
    descendantSha: string,
    ancestorSourcePath = worktreePath,
    descendantSourcePath = worktreePath,
    allowFetch = true,
  ): Promise<boolean> {
    const ancestorAvailable = await this.ensureCommitObjectAvailable(
      worktreePath,
      ancestorSha,
      ancestorSourcePath,
      allowFetch,
    );
    const descendantAvailable = await this.ensureCommitObjectAvailable(
      worktreePath,
      descendantSha,
      descendantSourcePath,
      allowFetch,
    );
    if (!ancestorAvailable || !descendantAvailable) {
      return false;
    }

    try {
      await this.runGitCommand(worktreePath, ["merge-base", "--is-ancestor", ancestorSha, descendantSha]);
      return true;
    } catch {
      return false;
    }
  }

  private async readGitRepoState(
    worktreePath: string,
    branchName: string,
    options: GitReadOptions = {},
  ): Promise<GitRepoStateSnapshot> {
    const includeFiles = options.includeFiles ?? true;
    let upstreamBranch: string | null = null;
    try {
      upstreamBranch = (
        await this.runGitCommand(worktreePath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
      ).stdout.trim();
    } catch {
      upstreamBranch = null;
    }
    const gitHubOrigin = upstreamBranch ? await this.readGitHubOrigin(worktreePath) : null;

    let aheadCount = 0;
    let behindCount = 0;
    if (upstreamBranch) {
      try {
        const counts = (
          await this.runGitCommand(worktreePath, ["rev-list", "--left-right", "--count", `${upstreamBranch}...HEAD`])
        ).stdout
          .trim()
          .split(/\s+/u);
        behindCount = Number(counts[0] ?? "0") || 0;
        aheadCount = Number(counts[1] ?? "0") || 0;
      } catch {
        aheadCount = 0;
        behindCount = 0;
      }
    }

    let files: TicketRunDiffFileSummary[] = [];
    let diffFingerprint: string | null = null;
    let hasDiff = false;
    if (includeFiles) {
      const [nameStatusResult, numstatResult, diffResult, statusResult, untrackedResult] = await Promise.all([
        this.runGitCommand(worktreePath, ["diff", "--find-renames", "--find-copies", "--name-status", "HEAD", "--"]),
        this.runGitCommand(worktreePath, ["diff", "--find-renames", "--find-copies", "--numstat", "HEAD", "--"]),
        this.runGitCommand(worktreePath, [
          "diff",
          "--find-renames",
          "--find-copies",
          "--patch",
          "--no-color",
          "HEAD",
          "--",
        ]),
        this.runGitCommand(worktreePath, [
          "status",
          "--porcelain=v1",
          "--untracked-files=all",
          "--ignore-submodules=none",
        ]).catch(() => ({
          stdout: "",
          stderr: "",
        })),
        this.runGitCommand(worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"]).catch(() => ({
          stdout: "",
          stderr: "",
        })),
      ]);
      files = mergeUntrackedFiles(
        parseDiffFiles(
          diffResult.stdout,
          parseNameStatusMap(nameStatusResult.stdout),
          parseNumstatMap(numstatResult.stdout),
        ),
        parseNullSeparatedEntries(untrackedResult.stdout),
      );
      const normalizedStatus = statusResult.stdout.trim();
      hasDiff = files.length > 0 || normalizedStatus.length > 0;
      diffFingerprint = hasDiff ? (buildSubmoduleDiffFingerprint(files) ?? normalizedStatus) : null;
    } else {
      const statusResult = await this.runGitCommand(worktreePath, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignore-submodules=none",
      ]);
      const normalizedStatus = statusResult.stdout.trim();
      hasDiff = normalizedStatus.length > 0;
      diffFingerprint = hasDiff ? normalizedStatus : null;
    }

    let unpublishedCommitCount = 0;
    if (!upstreamBranch) {
      try {
        unpublishedCommitCount = Number(
          (
            await this.runGitCommand(worktreePath, ["rev-list", "--count", "HEAD", "--not", "--remotes=origin"])
          ).stdout.trim(),
        );
      } catch {
        unpublishedCommitCount = 0;
      }
    }

    const pushAction: TicketRunPushAction = hasDiff
      ? "none"
      : upstreamBranch
        ? aheadCount > 0
          ? "push"
          : "none"
        : unpublishedCommitCount > 0
          ? "publish"
          : "none";
    const pullRequestUrls =
      gitHubOrigin && upstreamBranch
        ? this.buildPullRequestUrls(gitHubOrigin.repositoryUrl, gitHubOrigin.defaultBranch, branchName)
        : { open: null, draft: null };

    return {
      worktreePath,
      branchName,
      upstreamBranch,
      aheadCount,
      behindCount,
      hasDiff,
      pushAction,
      pullRequestUrls,
      files,
      diffFingerprint,
    };
  }

  private async readManagedSubmoduleParentState(
    parentRef: TicketRunSubmoduleParentRef,
    branchName: string,
    options: GitReadOptions = {},
  ): Promise<ManagedSubmoduleParentRuntimeState> {
    const gitState = await this.readGitRepoState(parentRef.submoduleWorktreePath, branchName, options);
    const headSha = await this.resolveHeadSha(parentRef.submoduleWorktreePath);
    return {
      parentRef,
      gitState,
      headSha,
      diffFingerprint: gitState.diffFingerprint,
    };
  }

  private async selectPrimarySubmoduleState(
    parentStates: readonly ManagedSubmoduleParentRuntimeState[],
    options: GitReadOptions = {},
  ): Promise<{ primary: ManagedSubmoduleParentRuntimeState | null; reconcileReason: string | null }> {
    const allowHistoryFetch = options.allowHistoryFetch ?? true;
    if (parentStates.length === 0) {
      return {
        primary: null,
        reconcileReason: "No managed submodule working copy is available for this mission.",
      };
    }

    const sortedStates = [...parentStates].sort((left, right) =>
      left.parentRef.parentRepoRelativePath.localeCompare(right.parentRef.parentRepoRelativePath),
    );
    const uniqueHeadShas = [
      ...new Set(sortedStates.map((state) => state.headSha).filter((sha): sha is string => Boolean(sha))),
    ];
    if (uniqueHeadShas.length <= 1) {
      const dirtyStates = sortedStates.filter((state) => state.gitState.hasDiff);
      const fingerprints = [...new Set(dirtyStates.map((state) => state.diffFingerprint).filter(Boolean))];
      if (fingerprints.length > 1) {
        return {
          primary: dirtyStates[0] ?? sortedStates[0] ?? null,
          reconcileReason: "Managed submodule changes differ between parent repos and need manual reconciliation.",
        };
      }
      return { primary: dirtyStates[0] ?? sortedStates[0] ?? null, reconcileReason: null };
    }

    for (const candidate of sortedStates) {
      if (!candidate.headSha) {
        continue;
      }
      let isDominant = true;
      for (const other of sortedStates) {
        if (other === candidate || !other.headSha || other.headSha === candidate.headSha) {
          continue;
        }
        if (
          !(await this.isAncestorInRepo(
            candidate.parentRef.submoduleWorktreePath,
            other.headSha,
            candidate.headSha,
            other.parentRef.submoduleWorktreePath,
            candidate.parentRef.submoduleWorktreePath,
            allowHistoryFetch,
          ))
        ) {
          isDominant = false;
          break;
        }
      }
      if (isDominant) {
        const dirtyStates = sortedStates.filter((state) => state.gitState.hasDiff);
        const fingerprints = [...new Set(dirtyStates.map((state) => state.diffFingerprint).filter(Boolean))];
        if (fingerprints.length > 1) {
          return {
            primary: candidate,
            reconcileReason: "Managed submodule changes differ between parent repos and need manual reconciliation.",
          };
        }
        return { primary: candidate, reconcileReason: null };
      }
    }

    return {
      primary: sortedStates[0] ?? null,
      reconcileReason: "Managed submodule histories diverge across parent repos and need manual reconciliation.",
    };
  }

  private async readSubmoduleState(
    run: TicketRunSummary,
    canonicalUrl: string,
    options: GitReadOptions = {},
  ): Promise<ManagedSubmoduleRuntimeState> {
    const summary = run.submodules.find((candidate) => candidate.canonicalUrl === canonicalUrl);
    if (!summary) {
      throw new ConfigError(`Ticket ${run.ticketId} does not track a managed submodule for ${canonicalUrl}.`);
    }

    const parentStates = await Promise.all(
      summary.parentRefs.map((parentRef) =>
        this.readManagedSubmoduleParentState(parentRef, summary.branchName, options),
      ),
    );
    const { primary, reconcileReason } = await this.selectPrimarySubmoduleState(parentStates, options);
    const fallbackState = primary ?? parentStates.find((state) => state.gitState.hasDiff) ?? parentStates[0];
    if (!fallbackState) {
      throw new ConfigError(`Ticket ${run.ticketId} does not have a readable managed submodule for ${summary.name}.`);
    }

    const committedSha = primary?.headSha ?? fallbackState.headSha;
    return {
      summary,
      gitState: {
        runId: run.runId,
        canonicalUrl: summary.canonicalUrl,
        name: summary.name,
        branchName: summary.branchName,
        worktreePath: fallbackState.parentRef.submoduleWorktreePath,
        upstreamBranch: fallbackState.gitState.upstreamBranch,
        aheadCount: fallbackState.gitState.aheadCount,
        behindCount: fallbackState.gitState.behindCount,
        hasDiff: fallbackState.gitState.hasDiff,
        pushAction: fallbackState.gitState.pushAction,
        commitMessageDraft: summary.commitMessageDraft ?? null,
        pullRequestUrls: fallbackState.gitState.pullRequestUrls,
        files: fallbackState.gitState.files,
        parents: parentStates.map((state) => ({
          parentRepoRelativePath: state.parentRef.parentRepoRelativePath,
          submodulePath: state.parentRef.submodulePath,
          submoduleWorktreePath: state.parentRef.submoduleWorktreePath,
          headSha: state.headSha,
          hasDiff: state.gitState.hasDiff,
          isPrimary:
            primary?.parentRef.parentRepoRelativePath === state.parentRef.parentRepoRelativePath &&
            primary?.parentRef.submodulePath === state.parentRef.submodulePath,
          isAligned: committedSha !== null && state.headSha === committedSha && !state.gitState.hasDiff,
        })),
        primaryParentRepoRelativePath: primary?.parentRef.parentRepoRelativePath ?? null,
        committedSha,
        reconcileRequired: reconcileReason !== null,
        reconcileReason,
      },
    };
  }

  private listRunSubmodulesForRepo(run: TicketRunSummary, repoRelativePath: string): TicketRunSubmoduleSummary[] {
    return run.submodules.filter((candidate) =>
      candidate.parentRefs.some((parentRef) => parentRef.parentRepoRelativePath === repoRelativePath),
    );
  }

  private buildBlockingSubmoduleCanonicalUrls(
    run: TicketRunSummary,
    repoRelativePath: string,
    submoduleGitStatesByUrl: ReadonlyMap<
      string,
      Pick<TicketRunSubmoduleGitState, "hasDiff" | "reconcileRequired" | "pushAction" | "parents">
    >,
  ): string[] {
    return this.listRunSubmodulesForRepo(run, repoRelativePath)
      .filter((submodule) => {
        const gitState = submoduleGitStatesByUrl.get(submodule.canonicalUrl);
        return gitState ? isSubmoduleBlockingRepoWorkflow(gitState) : true;
      })
      .map((submodule) => submodule.canonicalUrl);
  }

  private async readGitState(
    run: TicketRunSummary,
    repoRelativePath?: string,
    submoduleGitStatesByUrl?: ReadonlyMap<
      string,
      Pick<TicketRunSubmoduleGitState, "hasDiff" | "reconcileRequired" | "pushAction" | "parents">
    >,
    options: GitReadOptions = {},
  ): Promise<TicketRunGitState> {
    const worktree = this.resolveTargetWorktree(run, repoRelativePath);
    const repoState = await this.readGitRepoState(worktree.worktreePath, worktree.branchName, options);
    const blockingSubmodules = submoduleGitStatesByUrl
      ? this.buildBlockingSubmoduleCanonicalUrls(run, worktree.repoRelativePath, submoduleGitStatesByUrl)
      : (
          await Promise.all(
            this.listRunSubmodulesForRepo(run, worktree.repoRelativePath).map(async (submodule) => ({
              canonicalUrl: submodule.canonicalUrl,
              managedState: await this.readSubmoduleState(run, submodule.canonicalUrl, {
                includeFiles: false,
                allowHistoryFetch: options.allowHistoryFetch,
              }),
            })),
          )
        )
          .filter(({ managedState }) => isSubmoduleBlockingRepoWorkflow(managedState.gitState))
          .map(({ canonicalUrl }) => canonicalUrl);

    return {
      runId: run.runId,
      repoRelativePath: worktree.repoRelativePath,
      worktreePath: worktree.worktreePath,
      branchName: worktree.branchName,
      upstreamBranch: repoState.upstreamBranch,
      aheadCount: repoState.aheadCount,
      behindCount: repoState.behindCount,
      hasDiff: repoState.hasDiff,
      pushAction: repoState.pushAction,
      commitMessageDraft: worktree.commitMessageDraft ?? null,
      pullRequestUrls: repoState.pullRequestUrls,
      blockedBySubmoduleCanonicalUrls: blockingSubmodules,
      files: repoState.files,
    };
  }

  private requireManagedSubmodule(run: TicketRunSummary, canonicalUrl: string): TicketRunSubmoduleSummary {
    const submodule = run.submodules.find((candidate) => candidate.canonicalUrl === canonicalUrl);
    if (!submodule) {
      throw new ConfigError(`Ticket ${run.ticketId} does not track a managed submodule for ${canonicalUrl}.`);
    }
    return submodule;
  }

  private assertParentRepoSubmodulesReady(
    run: TicketRunSummary,
    gitState: TicketRunGitState,
    actionLabel: string,
  ): void {
    if (gitState.blockedBySubmoduleCanonicalUrls.length === 0) {
      return;
    }

    const blockedNames = gitState.blockedBySubmoduleCanonicalUrls.map(
      (canonicalUrl) => this.requireManagedSubmodule(run, canonicalUrl).name,
    );
    throw new ConfigError(
      `Finish the managed submodule workflow before trying to ${actionLabel} ${gitState.repoRelativePath}: ${blockedNames.join(", ")}.`,
    );
  }

  private async ensureBranchCheckedOut(worktreePath: string, branchName: string): Promise<void> {
    const currentBranch = (await this.runGitCommand(worktreePath, ["branch", "--show-current"])).stdout.trim();
    if (currentBranch === branchName) {
      return;
    }

    try {
      await this.runGitCommand(worktreePath, ["checkout", "-B", branchName]);
    } catch (error) {
      throw new SpiraError(
        "MISSIONS_SUBMODULE_BRANCH_FAILED",
        `Failed to prepare managed submodule branch ${branchName}.`,
        error,
      );
    }
  }

  private async alignManagedSubmoduleParents(
    run: TicketRunSummary,
    managedState: ManagedSubmoduleRuntimeState,
    commitSha: string,
  ): Promise<void> {
    let firstError: unknown = null;
    const failedParents: string[] = [];
    for (const parentState of managedState.gitState.parents) {
      try {
        if (!parentState.isPrimary) {
          await this.runGitCommand(parentState.submoduleWorktreePath, [
            "fetch",
            "origin",
            managedState.gitState.branchName,
          ]);
          // Secondary embedded copies should resolve to the canonical published commit, not keep their own detached edits.
          await this.runGitCommand(parentState.submoduleWorktreePath, ["checkout", "--detach", commitSha]);
        }

        const parentWorktree = this.resolveTargetWorktree(run, parentState.parentRepoRelativePath);
        await this.runGitCommand(parentWorktree.worktreePath, ["add", parentState.submodulePath]);
      } catch (error) {
        firstError ??= error;
        failedParents.push(`${parentState.parentRepoRelativePath} (${parentState.submodulePath})`);
        this.options.logger.warn(
          {
            err: error,
            runId: run.runId,
            ticketId: run.ticketId,
            canonicalUrl: managedState.summary.canonicalUrl,
            parentRepoRelativePath: parentState.parentRepoRelativePath,
            submodulePath: parentState.submodulePath,
          },
          "Managed submodule parent alignment failed",
        );
      }
    }

    if (failedParents.length > 0) {
      throw new SpiraError(
        "MISSIONS_SUBMODULE_ALIGN_FAILED",
        `Failed to align managed submodule ${managedState.summary.name} in ${failedParents.join(", ")}.`,
        firstError,
      );
    }
  }

  private async generateAndPersistSubmoduleCommitDraft(
    run: TicketRunSummary,
    canonicalUrl: string,
  ): Promise<TicketRunSummary> {
    const managedState = await this.readSubmoduleState(run, canonicalUrl);
    const fallbackBullets = buildFallbackCommitBullets(managedState.gitState.files);
    const fallbackDraft = normalizeCommitDraft(
      run.ticketId,
      `${managedState.summary.name}: ${run.ticketSummary}`,
      fallbackBullets,
    );
    let draft = fallbackDraft;

    if (this.options.generateCommitDraft) {
      try {
        draft = normalizeCommitDraft(
          run.ticketId,
          await this.options.generateCommitDraft({ run, gitState: managedState.gitState }),
          fallbackBullets,
        );
      } catch (error) {
        this.options.logger.warn(
          { err: error, runId: run.runId, ticketId: run.ticketId, canonicalUrl },
          "Managed submodule commit draft generation failed",
        );
      }
    }

    return this.persistRun(run, {
      submodules: run.submodules.map((candidate) =>
        candidate.canonicalUrl === canonicalUrl
          ? {
              ...candidate,
              commitMessageDraft: draft,
            }
          : candidate,
      ),
    });
  }

  private async generateAndPersistCommitDraft(
    run: TicketRunSummary,
    repoRelativePath?: string,
  ): Promise<TicketRunSummary> {
    const hydratedRun = await this.ensureRunSubmodules(run);
    const worktree = this.resolveTargetWorktree(hydratedRun, repoRelativePath);
    const gitState = await this.readGitState(hydratedRun, worktree.repoRelativePath);
    const fallbackBullets = buildFallbackCommitBullets(gitState.files);
    const fallbackDraft = normalizeCommitDraft(hydratedRun.ticketId, hydratedRun.ticketSummary, fallbackBullets);
    let draft = fallbackDraft;

    if (this.options.generateCommitDraft) {
      try {
        draft = normalizeCommitDraft(
          hydratedRun.ticketId,
          await this.options.generateCommitDraft({ run: hydratedRun, gitState }),
          fallbackBullets,
        );
      } catch (error) {
        this.options.logger.warn(
          { err: error, runId: hydratedRun.runId, ticketId: hydratedRun.ticketId },
          "Commit draft generation failed",
        );
      }
    }

    return this.persistRun(hydratedRun, {
      worktrees: hydratedRun.worktrees.map((candidate) =>
        candidate.repoRelativePath === worktree.repoRelativePath
          ? {
              ...candidate,
              commitMessageDraft: draft,
            }
          : candidate,
      ),
    });
  }

  private async resolveMissionGitIdentity(): Promise<MissionGitIdentity> {
    if (!this.options.resolveMissionGitIdentity) {
      throw new ConfigError("Mission git identity resolution is unavailable.");
    }
    return this.options.resolveMissionGitIdentity();
  }

  private buildCommitSigningArgs(): string[] {
    const signing = this.options.getMissionSshSigning?.();
    if (!signing?.enabled || !signing.key) {
      return ["-c", "commit.gpgsign=false"];
    }
    return [
      "-c",
      "gpg.format=ssh",
      "-c",
      `user.signingKey=${signing.key}`,
      "-c",
      "commit.gpgsign=true",
    ];
  }

  private getOptionalMissionGitToken(): string | null {
    const token = this.options.getMissionGitToken?.()?.trim();
    return token ? token : null;
  }

  private getMissionGitToken(): string {
    const token = this.getOptionalMissionGitToken();
    if (!token) {
      throw new ConfigError("Set a mission GitHub PAT in Settings before using mission git actions.");
    }
    return token;
  }

  private async readGitHubOrigin(worktreePath: string): Promise<GitHubOriginInfo | null> {
    let remoteUrl: string;
    try {
      remoteUrl = (await this.runGitCommand(worktreePath, ["remote", "get-url", "origin"])).stdout.trim();
    } catch {
      return null;
    }

    const repositoryUrl = parseGitHubRepositoryUrl(remoteUrl);
    if (!repositoryUrl) {
      return null;
    }

    let defaultBranch: string | null = null;
    try {
      const symbolicRef = (
        await this.runGitCommand(worktreePath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
      ).stdout.trim();
      defaultBranch = symbolicRef.replace(/^origin\//u, "") || null;
    } catch {
      defaultBranch = null;
    }

    return {
      repositoryUrl,
      defaultBranch,
    };
  }

  private buildPullRequestUrls(
    repositoryUrl: string,
    defaultBranch: string | null,
    branchName: string,
  ): { open: string; draft: string } {
    const branchSpec = defaultBranch
      ? `${encodeURIComponent(defaultBranch)}...${encodeURIComponent(branchName)}`
      : encodeURIComponent(branchName);
    const openUrl = new URL(`${repositoryUrl.replace(/\/+$/u, "")}/pull/new/${branchSpec}`);
    const draftUrl = new URL(openUrl.toString());
    draftUrl.searchParams.set("draft", "1");
    return {
      open: openUrl.toString(),
      draft: draftUrl.toString(),
    };
  }

  private async ensurePublishableRemote(worktreePath: string): Promise<void> {
    const origin = await this.readGitHubOrigin(worktreePath);
    if (!origin) {
      throw new ConfigError("Mission git publish and push currently require an HTTPS GitHub origin remote.");
    }
  }

  private async getCommitMessagesOnBranch(worktreePath: string, baseRef: string): Promise<string[]> {
    const separator = "<<<SPIRA_COMMIT_SEPARATOR>>>";
    try {
      const { stdout } = await this.runGitCommand(worktreePath, [
        "log",
        `${baseRef}..HEAD`,
        `--pretty=format:%B${separator}`,
      ]);
      return stdout
        .split(separator)
        .map((message) => message.trim())
        .filter((message) => message.length > 0);
    } catch {
      return [];
    }
  }

  private async getChangedFilesOnBranch(worktreePath: string, baseRef: string): Promise<string[]> {
    try {
      const { stdout } = await this.runGitCommand(worktreePath, ["diff", "--name-only", `${baseRef}...HEAD`]);
      return stdout
        .split(/\r?\n/u)
        .map((path) => path.trim())
        .filter((path) => path.length > 0);
    } catch {
      return [];
    }
  }

  private async createGitHubPullRequest(
    run: TicketRunSummary,
    gitState: TicketRunGitState | TicketRunSubmoduleGitState,
  ): Promise<string> {
    const origin = await this.readGitHubOrigin(gitState.worktreePath);
    if (!origin?.defaultBranch) {
      throw new ConfigError("Mission pull requests require an HTTPS GitHub origin with a detectable default branch.");
    }

    const coordinates = parseRepositoryCoordinates(origin.repositoryUrl);
    if (!coordinates) {
      throw new ConfigError("Mission pull requests require a standard GitHub repository origin.");
    }

    const token = this.getMissionGitToken();
    const latestCommitMessage = (
      await this.runGitCommand(gitState.worktreePath, ["log", "-1", "--pretty=%s%n%n%b", "HEAD"])
    ).stdout.trim();
    const [titleLine] = latestCommitMessage.split(/\r?\n/u);
    const title = titleLine?.trim() || `feat(${run.ticketId}): ${run.ticketSummary}`;
    const baseRef = `origin/${origin.defaultBranch}`;
    const [commitMessages, changedFiles] = await Promise.all([
      this.getCommitMessagesOnBranch(gitState.worktreePath, baseRef),
      this.getChangedFilesOnBranch(gitState.worktreePath, baseRef),
    ]);
    const body = buildPullRequestBody({
      commitMessages: commitMessages.length > 0 ? commitMessages : [latestCommitMessage],
      categories: categorizeChangedFiles(changedFiles),
    });

    const requestHeaders = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "Spira",
    };

    const createResponse = await fetch(`https://api.github.com/repos/${coordinates.owner}/${coordinates.repo}/pulls`, {
      method: "POST",
      headers: requestHeaders,
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        title,
        body,
        head: gitState.branchName,
        base: origin.defaultBranch,
        draft: false,
      }),
    });

    if (createResponse.ok) {
      const created = (await createResponse.json()) as GitHubPullRequestResponse;
      const pullRequestUrl = created.html_url?.trim();
      if (!pullRequestUrl) {
        throw new ConfigError("GitHub created the pull request but did not return a browser URL.");
      }
      return pullRequestUrl;
    }

    if (createResponse.status === 422) {
      const errorPayload = (await createResponse.json()) as GitHubPullRequestErrorResponse;
      const existing = await this.findExistingGitHubPullRequest(
        coordinates.owner,
        coordinates.repo,
        gitState.branchName,
        requestHeaders,
      );
      if (existing) {
        return existing;
      }
      throw new ConfigError(errorPayload.message?.trim() || "GitHub could not create this pull request.");
    }

    throw new ConfigError(`GitHub pull request creation failed with status ${createResponse.status}.`);
  }

  private async findExistingGitHubPullRequest(
    owner: string,
    repo: string,
    branchName: string,
    headers: Record<string, string>,
  ): Promise<string | null> {
    const search = new URLSearchParams({
      state: "open",
      head: `${owner}:${branchName}`,
    });
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?${search.toString()}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return null;
    }
    const pulls = (await response.json()) as GitHubPullRequestResponse[];
    return pulls.find((pull) => pull.html_url?.trim())?.html_url?.trim() ?? null;
  }

  private async syncRemote(
    runId: string,
    requestedAction: Exclude<TicketRunPushAction, "none">,
    repoRelativePath?: string,
  ): Promise<SyncTicketRunRemoteResult> {
    return this.withRunLock(runId, async () => {
      const run = await this.ensureRunSubmodules(this.getFreshRun(runId));
      if (run.status !== "awaiting-review") {
        throw new ConfigError(`Ticket ${run.ticketId} must be awaiting review before it can be ${requestedAction}ed.`);
      }
      const worktree = this.resolveTargetWorktree(run, repoRelativePath);
      const gitState = await this.readGitState(run, worktree.repoRelativePath);
      this.assertParentRepoSubmodulesReady(run, gitState, requestedAction);
      if (gitState.hasDiff) {
        throw new ConfigError(`Commit the changes for ${run.ticketId} before trying to ${requestedAction}.`);
      }
      if (requestedAction === "push" && gitState.pushAction !== "push") {
        throw new ConfigError(`Ticket ${run.ticketId} does not have any local commits ready to push.`);
      }
      if (requestedAction === "publish" && gitState.pushAction !== "publish") {
        throw new ConfigError(`Ticket ${run.ticketId} is already published or has nothing ready to publish.`);
      }

      await this.ensurePublishableRemote(worktree.worktreePath);
      try {
        await this.runGitCommand(worktree.worktreePath, [
          ...buildGitHubHttpAuthArgs(this.getMissionGitToken()),
          "push",
          ...(requestedAction === "publish"
            ? ["--set-upstream", "origin", worktree.branchName]
            : ["origin", worktree.branchName]),
        ]);
      } catch (error) {
        this.options.logger.warn(
          { err: error, runId, ticketId: run.ticketId, requestedAction },
          "Mission remote sync failed",
        );
        throw new SpiraError(
          "MISSIONS_PUSH_FAILED",
          `Failed to ${requestedAction} ${run.ticketId}. Check the git log for the underlying error.`,
          error,
        );
      }

      return {
        run,
        snapshot: this.requireMemoryDb().getTicketRunSnapshot(),
        gitState: await this.readGitState(run, worktree.repoRelativePath),
        action: requestedAction,
      };
    });
  }

  private async syncSubmoduleRemote(
    runId: string,
    canonicalUrl: string,
    requestedAction: Exclude<TicketRunPushAction, "none">,
  ): Promise<SyncTicketRunSubmoduleRemoteResult> {
    return this.withRunLock(runId, async () => {
      const run = await this.ensureRunSubmodules(this.getFreshRun(runId));
      if (run.status !== "awaiting-review") {
        throw new ConfigError(
          `Ticket ${run.ticketId} must be awaiting review before managed submodules can be ${requestedAction}ed.`,
        );
      }

      const managedState = await this.readSubmoduleState(run, canonicalUrl);
      if (managedState.gitState.reconcileRequired) {
        throw new ConfigError(
          managedState.gitState.reconcileReason ??
            `Managed submodule ${managedState.summary.name} requires reconciliation.`,
        );
      }
      if (managedState.gitState.hasDiff) {
        throw new ConfigError(
          `Commit the changes for ${managedState.summary.name} before trying to ${requestedAction}.`,
        );
      }
      await this.ensureBranchCheckedOut(managedState.gitState.worktreePath, managedState.gitState.branchName);
      const preparedState = await this.readSubmoduleState(run, canonicalUrl);
      const needsParentAlignment = preparedState.gitState.parents.some((parentState) => !parentState.isAligned);
      const alignmentRetryOnly = preparedState.gitState.pushAction === "none" && needsParentAlignment;
      if (requestedAction === "push" && preparedState.gitState.pushAction !== "push" && !alignmentRetryOnly) {
        throw new ConfigError(
          `Managed submodule ${managedState.summary.name} does not have any local commits ready to push.`,
        );
      }
      if (requestedAction === "publish" && preparedState.gitState.pushAction !== "publish" && !alignmentRetryOnly) {
        throw new ConfigError(
          `Managed submodule ${managedState.summary.name} is already published or has nothing ready to publish.`,
        );
      }

      if (!alignmentRetryOnly) {
        await this.ensurePublishableRemote(preparedState.gitState.worktreePath);
        try {
          await this.runGitCommand(preparedState.gitState.worktreePath, [
            ...buildGitHubHttpAuthArgs(this.getMissionGitToken()),
            "push",
            ...(requestedAction === "publish"
              ? ["--set-upstream", "origin", preparedState.gitState.branchName]
              : ["origin", preparedState.gitState.branchName]),
          ]);
        } catch (error) {
          this.options.logger.warn(
            { err: error, runId, ticketId: run.ticketId, canonicalUrl, requestedAction },
            "Managed submodule remote sync failed",
          );
          throw new SpiraError(
            "MISSIONS_SUBMODULE_PUSH_FAILED",
            `Failed to ${requestedAction} managed submodule ${managedState.summary.name}. Check the git log for the underlying error.`,
            error,
          );
        }
      }

      const commitSha = (
        await this.runGitCommand(preparedState.gitState.worktreePath, ["rev-parse", "HEAD"])
      ).stdout.trim();
      await this.alignManagedSubmoduleParents(run, preparedState, commitSha);
      const nextRun = this.getFreshRun(runId);
      const snapshot = this.requireMemoryDb().getTicketRunSnapshot();

      return {
        run: nextRun,
        snapshot,
        gitState: (await this.readSubmoduleState(nextRun, canonicalUrl)).gitState,
        action: requestedAction,
      };
    });
  }

  private persistRun(
    run: TicketRunSummary,
    overrides: Partial<
      Pick<
        TicketRunSummary,
        | "stationId"
        | "status"
        | "statusMessage"
        | "commitMessageDraft"
        | "attempts"
        | "worktrees"
        | "submodules"
        | "missionPhase"
        | "missionPhaseUpdatedAt"
        | "classification"
        | "plan"
        | "validations"
        | "proofStrategy"
        | "missionSummary"
        | "previousPassContext"
        | "proof"
        | "proofRuns"
      >
    >,
  ): TicketRunSummary {
    const memoryDb = this.requireMemoryDb();
    const worktrees = overrides.worktrees ?? run.worktrees;
    const submodules = overrides.submodules ?? run.submodules;
    const proof = overrides.proof ?? run.proof;
    const proofRuns = overrides.proofRuns ?? run.proofRuns;
    return memoryDb.upsertTicketRun({
      runId: run.runId,
      stationId: overrides.stationId !== undefined ? overrides.stationId : run.stationId,
      ticketId: run.ticketId,
      ticketSummary: run.ticketSummary,
      ticketUrl: run.ticketUrl,
      projectKey: run.projectKey,
      status: overrides.status ?? run.status,
      statusMessage: overrides.statusMessage !== undefined ? overrides.statusMessage : run.statusMessage,
      commitMessageDraft:
        overrides.commitMessageDraft !== undefined
          ? overrides.commitMessageDraft
          : (worktrees[0]?.commitMessageDraft ?? null),
      missionPhase: overrides.missionPhase ?? run.missionPhase,
      missionPhaseUpdatedAt: overrides.missionPhaseUpdatedAt ?? run.missionPhaseUpdatedAt,
      classification: overrides.classification !== undefined ? overrides.classification : run.classification,
      plan: overrides.plan !== undefined ? overrides.plan : run.plan,
      validations: overrides.validations ?? run.validations,
      proofStrategy: overrides.proofStrategy !== undefined ? overrides.proofStrategy : run.proofStrategy,
      missionSummary: overrides.missionSummary !== undefined ? overrides.missionSummary : run.missionSummary,
      previousPassContext:
        overrides.previousPassContext !== undefined ? overrides.previousPassContext : run.previousPassContext,
      startedAt: run.startedAt,
      createdAt: run.createdAt,
      worktrees: worktrees.map((worktree) => ({
        repoRelativePath: worktree.repoRelativePath,
        repoAbsolutePath: worktree.repoAbsolutePath,
        worktreePath: worktree.worktreePath,
        branchName: worktree.branchName,
        commitMessageDraft: worktree.commitMessageDraft ?? null,
        cleanupState: worktree.cleanupState,
        createdAt: worktree.createdAt,
        updatedAt: this.now(),
      })),
      submodules: submodules.map((submodule) => ({
        canonicalUrl: submodule.canonicalUrl,
        name: submodule.name,
        branchName: submodule.branchName,
        commitMessageDraft: submodule.commitMessageDraft ?? null,
        parentRefs: submodule.parentRefs,
        createdAt: submodule.createdAt,
        updatedAt: this.now(),
      })),
      attempts: (overrides.attempts ?? run.attempts).map((attempt) => ({
        attemptId: attempt.attemptId,
        subagentRunId: attempt.subagentRunId,
        sequence: attempt.sequence,
        status: attempt.status,
        prompt: attempt.prompt,
        summary: attempt.summary,
        followupNeeded: attempt.followupNeeded,
        startedAt: attempt.startedAt,
        createdAt: attempt.createdAt,
        updatedAt: attempt.updatedAt,
        completedAt: attempt.completedAt,
      })),
      proof,
      proofRuns: proofRuns.map((proofRun) => ({
        proofRunId: proofRun.proofRunId,
        profileId: proofRun.profileId,
        profileLabel: proofRun.profileLabel,
        status: proofRun.status,
        summary: proofRun.summary,
        startedAt: proofRun.startedAt,
        completedAt: proofRun.completedAt,
        exitCode: proofRun.exitCode,
        command: proofRun.command,
        artifacts: proofRun.artifacts,
      })),
    });
  }

  private async withRunLock<T>(runId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.runLocks.get(runId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    const queue = previous.then(() => current);
    this.runLocks.set(runId, queue);

    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.runLocks.get(runId) === queue) {
        this.runLocks.delete(runId);
      }
    }
  }

  private async syncRunState(run: SyncableRun): Promise<TicketRunSummary> {
    const memoryDb = this.requireMemoryDb();

    let status: TicketRunStatus = "ready";
    const workspace = describeTicketRunWorkspace(run.worktrees);
    let statusMessage =
      workspace.noun === "worktree"
        ? `Worktree ready at ${workspace.path}.`
        : `Mission directory ready at ${workspace.path} for ${run.worktrees.length} repos.`;
    try {
      await this.options.youTrackService?.transitionTicketToInProgress(run.ticketId);
      statusMessage =
        workspace.noun === "worktree"
          ? `Worktree ready at ${workspace.path}. Ticket moved to In Progress.`
          : `Mission directory ready at ${workspace.path} for ${run.worktrees.length} repos. Ticket moved to In Progress.`;
    } catch (error) {
      status = "blocked";
      statusMessage = `${
        workspace.noun === "worktree"
          ? `Worktree ready at ${workspace.path}`
          : `Mission directory ready at ${workspace.path} for ${run.worktrees.length} repos`
      }, but the ticket state could not be updated: ${
        error instanceof Error ? error.message : "Unknown YouTrack error."
      }`;
      this.options.logger.warn(
        { err: error, ticketId: run.ticketId, runId: run.runId },
        "Ticket run is blocked on YouTrack state sync",
      );
    }

    const previousRun = memoryDb.getTicketRun(run.runId);
    const updatedRun = memoryDb.upsertTicketRun({
      runId: run.runId,
      stationId: previousRun?.stationId ?? run.stationId ?? null,
      ticketId: run.ticketId,
      ticketSummary: run.ticketSummary,
      ticketUrl: run.ticketUrl,
      projectKey: run.projectKey,
      status,
      statusMessage,
      startedAt: run.startedAt,
      createdAt: run.createdAt,
      worktrees: run.worktrees.map((worktree) => ({
        repoRelativePath: worktree.repoRelativePath,
        repoAbsolutePath: worktree.repoAbsolutePath,
        worktreePath: worktree.worktreePath,
        branchName: worktree.branchName,
        commitMessageDraft: worktree.commitMessageDraft ?? null,
        cleanupState: worktree.cleanupState,
        createdAt: worktree.createdAt,
        updatedAt: this.now(),
      })),
      submodules: run.submodules.map((submodule) => ({
        canonicalUrl: submodule.canonicalUrl,
        name: submodule.name,
        branchName: submodule.branchName,
        commitMessageDraft: submodule.commitMessageDraft ?? null,
        parentRefs: submodule.parentRefs,
        createdAt: submodule.createdAt,
        updatedAt: this.now(),
      })),
      attempts: previousRun?.attempts ?? [],
      proof: previousRun?.proof ?? buildDefaultProofSummary(),
      proofRuns: previousRun?.proofRuns ?? [],
    });
    this.recordMissionEvent(updatedRun, "system", "workspace-prepared", {
      status: updatedRun.status,
      worktreeCount: updatedRun.worktrees.length,
    });
    this.emitRunUpdate(updatedRun.runId);
    // fire-and-forget dependency warming. Failures are recorded in mission_events
    // (warming-finished with status: "failed") but never fault the syncRunState path; the
    // first validation pays the cold cost in that case.
    void this.warmRunDependenciesInBackground(updatedRun);
    return updatedRun;
  }

  /**
   * kick off `restore`-kind validation profile commands in parallel after the
   * worktree is ready. Skipped silently when no projectKey, no validation profiles, or
   * disabled by the option flag. The renderer surfaces progress via the warming-started /
   * warming-finished mission events that this method emits per task.
   */
  private async warmRunDependenciesInBackground(run: TicketRunSummary): Promise<void> {
    const memoryDb = this.options.memoryDb;
    if (!memoryDb) return;
    if (!run.projectKey || run.worktrees.length === 0) return;
    // Guard against a re-warm storm if the operator clicks "Retry sync" while the previous
    // warming pass is still in flight; one in-flight task per run is enough.
    if (this.warmingInFlight.has(run.runId)) return;
    this.warmingInFlight.add(run.runId);

    try {
      let validationProfiles: ReturnType<typeof memoryDb.listValidationProfiles>;
      try {
        validationProfiles = memoryDb.listValidationProfiles({
          projectKey: run.projectKey,
          repoRelativePaths: run.worktrees.map((worktree) => worktree.repoRelativePath),
          limit: 50,
        });
      } catch (error) {
        this.options.logger.warn(
          { err: error, runId: run.runId, ticketId: run.ticketId },
          "Failed to list validation profiles for dependency warming; skipping",
        );
        return;
      }
      if (validationProfiles.length === 0) return;

      const warmer = this.options.warmRunDependencies ?? warmRunDependencies;
      try {
        await warmer({
          run,
          validationProfiles,
          logger: this.options.logger,
          now: this.now,
          onTaskStarted: (task) => {
            this.recordMissionEvent(run, "system", "workspace-dependencies-warming-started", {
              repoRelativePath: task.repoRelativePath,
              profileId: task.profileId,
              profileLabel: task.profileLabel,
              command: task.command,
              workingDirectory: task.workingDirectory,
            });
          },
          onTaskFinished: (result) => {
            this.recordMissionEvent(run, "system", "workspace-dependencies-warming-finished", {
              repoRelativePath: result.repoRelativePath,
              profileId: result.profileId,
              profileLabel: result.profileLabel,
              command: result.command,
              status: result.status,
              durationMs: result.durationMs,
              exitCode: result.exitCode,
              error: result.error,
            });
            if (result.status === "ok") {
              try {
                memoryDb.recordValidationProfileObservedRuntime(result.profileId, result.durationMs);
              } catch (error) {
                this.options.logger.debug(
                  { err: error, runId: run.runId, profileId: result.profileId },
                  "Failed to record warming runtime on validation profile",
                );
              }
            }
          },
        });
      } catch (error) {
        this.options.logger.warn(
          { err: error, runId: run.runId, ticketId: run.ticketId },
          "Dependency warming failed unexpectedly",
        );
      }
    } finally {
      this.warmingInFlight.delete(run.runId);
    }
  }

  private listMissionEvents(
    runId: string,
    optionsOrLimit: number | { beforeId?: number | null; limit?: number },
  ): TicketRunMissionEventSummary[] {
    const memoryDb = this.options.memoryDb;
    if (!memoryDb) {
      return [];
    }
    return memoryDb.listMissionEvents(runId, optionsOrLimit).map((event) => ({
      id: event.id,
      runId: event.runId,
      attemptId: event.attemptId,
      stage: (event.stage === "system" ? "system" : event.stage) as TicketRunMissionEventSummary["stage"],
      eventType: event.eventType,
      metadata: event.metadata,
      occurredAt: event.occurredAt,
    }));
  }

  private toRepoIntelligenceEntrySummary(entry: RepoIntelligenceRecord): TicketRunRepoIntelligenceEntrySummary {
    return {
      id: entry.id,
      projectKey: entry.projectKey,
      repoRelativePath: entry.repoRelativePath,
      type: entry.type,
      title: entry.title,
      content: entry.content,
      tags: entry.tags,
      source: entry.source,
      approved: entry.approved,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  private observeRepoIntelligenceCandidates(run: TicketRunSummary): void {
    const memoryDb = this.options.memoryDb;
    if (!memoryDb) {
      return;
    }
    // M.1/M.2: respect the project's trust-learner mode. `paused` skips the whole observe
    // path so the corpus doesn't accumulate during a refactor.
    const trustMode = this.lookupProjectTrustLearnerMode(run);
    if (trustMode === "paused") {
      return;
    }
    // classify the closed mission once and reuse it for both the audit-trail
    // event and the candidate generator. Null means "not closed cleanly enough to learn
    // from" and we skip everything below.
    const outcome = classifyMissionOutcome(run);
    if (!outcome) return;
    this.recordMissionEvent(run, "system", "mission-outcome-classified", {
      outcome: outcome.kind,
      rationale: outcome.rationale,
      retriedValidationKinds: outcome.retriedValidationKinds,
      usedManualReview: outcome.usedManualReview,
    });
    const entries = buildLearnedRepoIntelligenceCandidates(run, outcome).map((candidate) =>
      memoryDb.upsertRepoIntelligence(candidate),
    );
    if (entries.length > 0) {
      this.recordMissionEvent(run, "system", "repo-intelligence-candidates-observed", {
        count: entries.length,
        entryIds: entries.map((entry) => entry.id),
        repoRelativePaths: entries.map((entry) => entry.repoRelativePath),
      });
      if (trustMode === "auto-accept-below-threshold") {
        // Operator opted into silent acceptance: flip approval on every freshly-observed
        // candidate AND any older pending entries that pre-date the toggle. The
        // threshold-based promotion sweep below still runs but auto-accept means it
        // rarely has anything to do.
        for (const entry of entries) {
          try {
            memoryDb.setRepoIntelligenceApproval(entry.id, true);
          } catch (approveError) {
            this.options.logger.warn(
              { err: approveError, runId: run.runId, entryId: entry.id },
              "Auto-accept-below-threshold approval failed; entry remains pending",
            );
          }
        }
      }
    }
    if (trustMode === "auto-accept-below-threshold" && run.projectKey) {
      // Backlog catch-up: pending learned entries observed before the operator flipped the
      // toggle should also flip to approved. Bounded to 500 entries per close to keep the
      // sweep cheap — anything older than that is a corner case worth a manual sweep.
      try {
        const pending = memoryDb.listRepoIntelligence({
          projectKey: run.projectKey,
          includeUnapproved: true,
          source: "learned",
          limit: 500,
        });
        for (const entry of pending) {
          if (entry.approved) continue;
          try {
            memoryDb.setRepoIntelligenceApproval(entry.id, true);
          } catch (approveError) {
            this.options.logger.warn(
              { err: approveError, runId: run.runId, entryId: entry.id },
              "Auto-accept backlog approval failed; entry remains pending",
            );
          }
        }
      } catch (listError) {
        this.options.logger.warn(
          { err: listError, runId: run.runId },
          "Auto-accept backlog sweep failed; pending entries unaffected",
        );
      }
    }
    // Validation candidates and the promotion sweep are independent of whether THIS
    // run produced new repo-intelligence candidates — a clean-pass with no fresh
    // candidates can still tip an older one over its confidence threshold. Run them
    // off the close path via setImmediate so close latency stays bounded.
    setImmediate(() => {
      try {
        this.observeValidationProfileCandidates(run, outcome, trustMode);
      } catch (error) {
        this.options.logger.warn({ err: error, runId: run.runId }, "Validation-candidate observation failed");
      }
      if (this.options.autoPromoteLearnedCandidates !== false) {
        try {
          this.runLearnedCandidatePromotionSweep(run);
        } catch (error) {
          this.options.logger.warn({ err: error, runId: run.runId }, "Learned-candidate promotion sweep failed");
        }
      }
    });
  }

  /**
   * scan the closed run plus its peers for shell commands that have succeeded
   * across enough distinct missions to warrant a `validation_profile` candidate. Friction
   * outcomes only contribute the *current* run; clean-pass outcomes look at recent peers
   * too. Each surfaced candidate emits a `validation-profile-candidate-observed` event so
   * the operator-facing audit trail is complete; persistence as an actual profile is opt-in
   * via the admin pane (Phase 5.4 auto-promotes only above the confidence threshold).
   */
  /**
   * Resolve the project-wide `trust_learner_mode` for a run's project, defaulting to
   * `manual-review` when no profile exists or memory db isn't wired. The mode is read
   * once per close-path observer chain.
   */
  private lookupProjectTrustLearnerMode(run: TicketRunSummary): "manual-review" | "auto-accept-below-threshold" | "paused" {
    const memoryDb = this.options.memoryDb;
    if (!memoryDb || !run.projectKey) return "manual-review";
    try {
      const profile = memoryDb.getRepoProfile(run.projectKey, "");
      return profile?.trustLearnerMode ?? "manual-review";
    } catch {
      return "manual-review";
    }
  }

  private observeValidationProfileCandidates(
    run: TicketRunSummary,
    outcome: MissionOutcomeClassification,
    trustMode: "manual-review" | "auto-accept-below-threshold" | "paused" = "manual-review",
  ): void {
    const memoryDb = this.options.memoryDb;
    if (!memoryDb || !run.projectKey) return;
    // Negative-evidence outcomes don't propose new profiles — a fail-final mission's shell
    // commands are not a reliable signal that the command itself is good.
    if (outcome.kind === "fail-final") return;

    const peerRuns = memoryDb
      .listTicketRuns()
      .filter((candidate) => candidate.projectKey === run.projectKey && candidate.status === "done");
    // Single SQL JOIN replaces the per-peer N+1 listMissionEvents loop. The shared util
    // returns up to perRunLimit shell-command events per peer run, so very long missions
    // surface their tail without dragging the whole table into memory.
    const allEvents = memoryDb.listMissionEventsByProjectKey({
      projectKey: run.projectKey,
      runStatus: "done",
      eventTypes: ["attempt-shell-command"],
      perRunLimit: 500,
    });
    const existingProfiles = memoryDb.listValidationProfiles({
      projectKey: run.projectKey,
      repoRelativePaths: run.worktrees.map((worktree) => worktree.repoRelativePath),
      limit: 200,
    });

    const candidates = deriveValidationProfileCandidates({
      events: allEvents,
      runs: peerRuns,
      existingProfiles,
      threshold: DEFAULT_VALIDATION_CANDIDATE_THRESHOLD,
    });
    // M.1: when the project trusts the learner, promote any successful observation
    // immediately (threshold = 1) instead of waiting for the default 5-mission threshold.
    const autoPromotionThreshold =
      trustMode === "auto-accept-below-threshold"
        ? 1
        : this.options.validationProfileAutoPromotionThreshold ?? DEFAULT_VALIDATION_AUTO_PROMOTION_THRESHOLD;
    for (const candidate of candidates) {
      this.recordMissionEvent(run, "system", "validation-profile-candidate-observed", {
        candidateId: candidate.candidateId,
        projectKey: candidate.projectKey,
        repoRelativePath: candidate.repoRelativePath,
        kind: candidate.kind,
        command: candidate.command,
        workingDirectory: candidate.workingDirectory,
        successCount: candidate.successCount,
      });
      if (
        this.options.autoPromoteValidationProfiles !== false &&
        candidate.successCount >= autoPromotionThreshold &&
        candidate.projectKey
      ) {
        try {
          const promoted = memoryDb.upsertValidationProfile({
            id: candidate.candidateId,
            projectKey: candidate.projectKey,
            repoRelativePath: candidate.repoRelativePath,
            label: `Auto: ${candidate.kind} (${candidate.command})`,
            kind: candidate.kind,
            command: candidate.command,
            workingDirectory: candidate.workingDirectory,
            confidence: 0.7,
            expectedRuntimeMs: candidate.observedRuntimeMs,
            lastObservedRuntimeMs: candidate.observedRuntimeMs,
            // Schema lacks a "learned" source enum; "user" matches the operator-curated
            // bucket so the editor still allows hand-edits without a migration.
            source: "user",
          });
          this.recordMissionEvent(run, "system", "validation-profile-auto-promoted", {
            candidateId: candidate.candidateId,
            profileId: promoted.id,
            projectKey: candidate.projectKey,
            repoRelativePath: candidate.repoRelativePath,
            kind: candidate.kind,
            command: candidate.command,
            workingDirectory: candidate.workingDirectory,
            successCount: candidate.successCount,
            threshold: autoPromotionThreshold,
            formulaVersion: PROMOTION_FORMULA_VERSION,
            promotionReason:
              trustMode === "auto-accept-below-threshold" ? "trust-mode-auto" : "threshold-met",
          });
        } catch (error) {
          this.options.logger.warn(
            { err: error, candidateId: candidate.candidateId },
            "Validation-profile auto-promotion failed",
          );
        }
      }
    }
  }

  /**
   * auto-promote any pending learned candidate whose confidence now clears its
   * per-type threshold. Promotion is `setRepoIntelligenceApproval(id, true)` plus a tag
   * update so the contributing-run set is preserved on the entry itself; revocations
   * (handled elsewhere) refuse to re-promote on the same evidence.
   */
  private runLearnedCandidatePromotionSweep(run: TicketRunSummary): void {
    const memoryDb = this.options.memoryDb;
    if (!memoryDb || !run.projectKey) return;
    const peerRuns = memoryDb.listTicketRuns().filter((candidate) => candidate.projectKey === run.projectKey);
    const candidates = memoryDb.listRepoIntelligence({
      projectKey: run.projectKey,
      includeUnapproved: true,
      source: "learned",
      limit: 500,
    });
    const decisions = scoreLearnedCandidates({
      candidates,
      runs: peerRuns,
      thresholds: this.options.learnedCandidatePromotionThresholds,
      now: this.now(),
    });

    for (const decision of decisions) {
      if (!decision.promote) continue;
      const candidate = candidates.find((entry) => entry.id === decision.candidateId);
      if (!candidate) continue;
      try {
        const promoted = memoryDb.upsertRepoIntelligence({
          id: candidate.id,
          projectKey: candidate.projectKey,
          repoRelativePath: candidate.repoRelativePath,
          type: candidate.type,
          title: candidate.title,
          content: candidate.content,
          tags: buildPromotedTags(candidate, decision.contributingRunIds),
          source: candidate.source,
          approved: true,
          createdAt: candidate.createdAt,
        });
        this.recordMissionEvent(run, "system", "learned-candidate-promoted", {
          candidateId: promoted.id,
          type: promoted.type,
          confidence: decision.confidence,
          threshold: decision.threshold,
          formulaVersion: PROMOTION_FORMULA_VERSION,
          contributingRunIds: decision.contributingRunIds,
          contradictingRunIds: decision.contradictingRunIds,
        });
      } catch (error) {
        this.options.logger.warn(
          { err: error, candidateId: decision.candidateId },
          "Failed to auto-promote learned candidate; leaving as pending",
        );
      }
    }
  }

  private recordMissionEvent<T extends MissionEventType>(
    run: Pick<TicketRunSummary, "runId" | "attempts" | "missionPhase">,
    stage: TicketRunMissionEventSummary["stage"],
    eventType: T,
    metadata: MissionEventMetadataMap[T],
  ): void {
    const memoryDb = this.options.memoryDb;
    if (!memoryDb) {
      return;
    }
    const currentAttempt =
      [...run.attempts].reverse().find((attempt) => attempt.status === "running") ?? run.attempts.at(-1) ?? null;
    memoryDb.appendMissionEvent({
      runId: run.runId,
      attemptId: currentAttempt?.attemptId ?? null,
      stage,
      eventType,
      metadata,
    });
  }

  private emitSnapshot(snapshot?: TicketRunSnapshot): void {
    if (!this.options.memoryDb) {
      return;
    }

    this.options.bus?.emit("missions:runs-changed", snapshot ?? this.options.memoryDb.getTicketRunSnapshot());
  }

  /**
   * Emit a per-run delta (Phase 0.3). Avoids the full-snapshot rebuild on the renderer
   * for high-frequency events that touch a single run (attempt-finished, proof progress,
   * live attempt-action telemetry). Falls back to a full snapshot if the run is missing
   * (the renderer treats absence as removal and prunes).
   */
  private emitRunUpdate(runId: string): void {
    const memoryDb = this.options.memoryDb;
    if (!memoryDb) {
      return;
    }
    const run = memoryDb.getTicketRun(runId);
    if (!run) {
      // Run was deleted; fall back to full snapshot so the renderer prunes.
      this.emitSnapshot();
      return;
    }
    this.options.bus?.emit("missions:run-updated", { runId, run });
  }
}
