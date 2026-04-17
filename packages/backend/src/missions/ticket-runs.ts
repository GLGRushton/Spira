import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { SpiraMemoryDatabase } from "@spira/memory-db";
import type {
  CancelTicketRunWorkResult,
  CommitTicketRunResult,
  CompleteTicketRunResult,
  ContinueTicketRunWorkResult,
  CreateTicketRunPullRequestResult,
  GenerateTicketRunCommitDraftResult,
  RetryTicketRunSyncResult,
  SetTicketRunCommitDraftResult,
  StartTicketRunRequest,
  StartTicketRunResult,
  StartTicketRunWorkResult,
  SyncTicketRunRemoteResult,
  TicketRunAttemptStatus,
  TicketRunAttemptSummary,
  TicketRunDiffFileSummary,
  TicketRunGitState,
  TicketRunGitStateResult,
  TicketRunPushAction,
  TicketRunSnapshot,
  TicketRunStatus,
  TicketRunSummary,
} from "@spira/shared";
import { normalizeProjectKey } from "@spira/shared";
import fetch from "node-fetch";
import type { Logger } from "pino";
import type { ProjectRegistry } from "../projects/registry.js";
import { ConfigError, SpiraError } from "../util/errors.js";
import type { SpiraEventBus } from "../util/event-bus.js";

const execFileAsync = promisify(execFile);
const WORKTREE_DIRECTORY_NAME = ".spira-worktrees";
const MAX_BRANCH_NAME_LENGTH = 63;
const MAX_SLUG_LENGTH = 40;

export interface GitCommandResult {
  stdout: string;
  stderr: string;
}

export type GitCommandRunner = (cwd: string, args: readonly string[]) => Promise<GitCommandResult>;

interface ProjectRegistryLike {
  getSnapshot(): Promise<Awaited<ReturnType<ProjectRegistry["getSnapshot"]>>>;
}

interface YouTrackWriteService {
  transitionTicketToInProgress(ticketId: string): Promise<void>;
}

type SyncableRun = Pick<
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
  gitState: TicketRunGitState;
}

export interface MissionGitIdentity {
  name: string;
  email: string;
}

interface GitHubOriginInfo {
  repositoryUrl: string;
  defaultBranch: string | null;
}

interface GitHubPullRequestResponse {
  html_url?: string;
}

interface GitHubPullRequestValidationError {
  message?: string;
}

interface GitHubPullRequestErrorResponse {
  message?: string;
  errors?: GitHubPullRequestValidationError[];
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
  cancelMissionPass?: (stationId: string) => Promise<void>;
  closeMissionStation?: (stationId: string) => Promise<void>;
  stopRunServices?: (runId: string) => Promise<void>;
  generateCommitDraft?: (input: GenerateCommitDraftInput) => Promise<string>;
  resolveMissionGitIdentity?: () => Promise<MissionGitIdentity>;
  getMissionGitToken?: () => string | null;
}

const defaultGitCommandRunner: GitCommandRunner = async (cwd, args) => {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      windowsHide: true,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const sanitizedArgs = args.map((arg) =>
      /^http\.extraheader=AUTHORIZATION:\s+/iu.test(arg) ? "http.extraheader=AUTHORIZATION: [REDACTED]" : arg,
    );
    throw new SpiraError("TICKET_RUN_GIT_ERROR", `Git command failed in ${cwd}: git ${sanitizedArgs.join(" ")}`, error);
  }
};

const slugify = (value: string, maxLength: number): string => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug.slice(0, maxLength).replace(/-+$/g, "");
};

const normalizeMissionPrompt = (value: string | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeCommitDraft = (ticketId: string, rawDraft: string, fallbackBullets: string[]): string => {
  const cleaned = rawDraft
    .replace(/^```[a-z0-9-]*\s*/gim, "")
    .replace(/```$/gim, "")
    .trim();
  const lines = cleaned
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const summaryCandidate = lines.find((line) => !/^(?:[-*]\s+|\d+\.\s+)/u.test(line)) ?? "";
  const normalizedSummary = (summaryCandidate.match(/^feat\(([^)]+)\):\s*(.+)$/iu)?.[2] ?? summaryCandidate)
    .replace(/^[-*]\s+/u, "")
    .trim()
    .replace(/\.+$/u, "");
  const summary = normalizedSummary || "update implementation";
  const extractedBullets = lines
    .filter((line) => line !== summaryCandidate)
    .map((line) => line.replace(/^(?:[-*]\s+|\d+\.\s+)/u, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 6);
  const bullets = (extractedBullets.length > 0 ? extractedBullets : fallbackBullets).slice(0, 6);
  return [`feat(${ticketId}): ${summary}`, "", ...bullets.map((line) => `- ${line}`)].join("\n");
};

const buildFallbackCommitBullets = (files: readonly TicketRunDiffFileSummary[]): string[] => {
  const bullets = files.slice(0, 6).map((file) => {
    const action =
      file.status === "A"
        ? "Add"
        : file.status === "D"
          ? "Remove"
          : file.status === "R"
            ? "Rename"
            : file.status === "C"
              ? "Copy"
              : "Update";
    const detailParts: string[] = [action, file.path];
    if (file.additions !== null || file.deletions !== null) {
      detailParts.push(
        `(${file.additions ?? 0} insertion${file.additions === 1 ? "" : "s"}, ${file.deletions ?? 0} deletion${
          file.deletions === 1 ? "" : "s"
        })`,
      );
    }
    return detailParts.join(" ");
  });
  return bullets.length > 0 ? bullets : ["Review the completed ticket changes and prepare them for publish."];
};

const parseGitHubRepositoryUrl = (remoteUrl: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    return null;
  }

  const repositoryPath = parsed.pathname.replace(/\.git$/iu, "").replace(/\/+$/u, "");
  if (!/^\/[^/]+\/[^/]+$/u.test(repositoryPath)) {
    return null;
  }

  return `https://github.com${repositoryPath}`;
};

const parseRepositoryCoordinates = (repositoryUrl: string): { owner: string; repo: string } | null => {
  let parsed: URL;
  try {
    parsed = new URL(repositoryUrl);
  } catch {
    return null;
  }

  const segments = parsed.pathname.replace(/^\/+|\/+$/gu, "").split("/");
  if (segments.length !== 2) {
    return null;
  }

  const [owner, repo] = segments;
  if (!owner || !repo) {
    return null;
  }

  return { owner, repo };
};

const parseNameStatusMap = (stdout: string): Map<string, { status: string; previousPath: string | null }> => {
  const entries = new Map<string, { status: string; previousPath: string | null }>();
  for (const line of stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    const parts = line.split("\t");
    const statusToken = parts[0] ?? "";
    const status = statusToken.slice(0, 1) || "M";
    if ((status === "R" || status === "C") && parts.length >= 3) {
      entries.set(parts[2] ?? parts[1] ?? "", {
        status,
        previousPath: parts[1] ?? null,
      });
      continue;
    }
    if (parts[1]) {
      entries.set(parts[1], { status, previousPath: null });
    }
  }
  return entries;
};

const parseNumstatMap = (stdout: string): Map<string, { additions: number | null; deletions: number | null }> => {
  const entries = new Map<string, { additions: number | null; deletions: number | null }>();
  for (const line of stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }
    const additions = parts[0] === "-" ? null : Number(parts[0]);
    const deletions = parts[1] === "-" ? null : Number(parts[1]);
    const path = parts.length >= 4 ? (parts[3] ?? parts[2] ?? "") : (parts[2] ?? "");
    if (!path) {
      continue;
    }
    entries.set(path, {
      additions: Number.isFinite(additions) ? additions : null,
      deletions: Number.isFinite(deletions) ? deletions : null,
    });
  }
  return entries;
};

const parseDiffFiles = (
  rawDiff: string,
  nameStatusMap: ReadonlyMap<string, { status: string; previousPath: string | null }>,
  numstatMap: ReadonlyMap<string, { additions: number | null; deletions: number | null }>,
): TicketRunDiffFileSummary[] => {
  const trimmed = rawDiff.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed
    .split(/(?=^diff --git )/gmu)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const headerMatch = /^diff --git a\/(.+?) b\/(.+)$/mu.exec(chunk);
      const currentPath = headerMatch?.[2] ?? headerMatch?.[1] ?? "unknown";
      const statusEntry = nameStatusMap.get(currentPath);
      const numstatEntry = numstatMap.get(currentPath);
      const previousPath =
        statusEntry?.previousPath ?? (headerMatch?.[1] !== currentPath ? (headerMatch?.[1] ?? null) : null);
      return {
        path: currentPath,
        previousPath,
        status: statusEntry?.status ?? "M",
        additions: numstatEntry?.additions ?? null,
        deletions: numstatEntry?.deletions ?? null,
        patch: chunk,
      };
    });
};

export const buildTicketRunBranchName = (ticketId: string, summary: string): string => {
  const normalizedTicketId = slugify(ticketId, MAX_BRANCH_NAME_LENGTH).replace(/^-+|-+$/g, "") || "ticket";
  const prefix = `feat/${normalizedTicketId}`;
  const fallbackSlug = "work";
  const availableSlugLength = Math.max(0, Math.min(MAX_SLUG_LENGTH, MAX_BRANCH_NAME_LENGTH - prefix.length - 1));
  const summarySlug = slugify(summary, availableSlugLength) || fallbackSlug;
  const branchName = `${prefix}-${summarySlug}`;
  return branchName.slice(0, MAX_BRANCH_NAME_LENGTH).replace(/-+$/g, "");
};

const buildTicketRunMissionDirectory = (workspaceRoot: string, ticketId: string): string => {
  const ticketSlug = slugify(ticketId, 24) || "ticket";
  return path.join(workspaceRoot, WORKTREE_DIRECTORY_NAME, ticketSlug);
};

export const buildTicketRunWorktreePath = (workspaceRoot: string, ticketId: string, repoName: string): string => {
  const repoSlug = slugify(repoName, 20) || "repo";
  return path.join(buildTicketRunMissionDirectory(workspaceRoot, ticketId), repoSlug);
};

const resolveTicketRunWorkspacePath = (
  worktrees: ReadonlyArray<Pick<TicketRunSummary["worktrees"][number], "worktreePath">>,
): string => {
  const firstWorktree = worktrees[0];
  if (!firstWorktree) {
    return "the managed worktree";
  }

  const parents = [...new Set(worktrees.map((worktree) => path.dirname(worktree.worktreePath)))];
  if (parents.length === 1 && path.basename(parents[0] ?? "") !== WORKTREE_DIRECTORY_NAME) {
    return parents[0] ?? firstWorktree.worktreePath;
  }

  return firstWorktree.worktreePath;
};

const describeTicketRunWorkspace = (worktrees: ReadonlyArray<TicketRunSummary["worktrees"][number]>) => {
  const workspacePath = resolveTicketRunWorkspacePath(worktrees);
  if (workspacePath === worktrees[0]?.worktreePath) {
    return {
      path: workspacePath,
      noun: "worktree",
      phrase: `managed worktree at ${workspacePath}`,
    };
  }

  const repoCount = worktrees.length;
  return {
    path: workspacePath,
    noun: "mission directory",
    phrase: `mission directory at ${workspacePath} for ${repoCount} repo${repoCount === 1 ? "" : "s"}`,
  };
};

const formatTicketRunWorktreeList = (worktrees: ReadonlyArray<TicketRunSummary["worktrees"][number]>): string =>
  worktrees.map((worktree) => `- ${worktree.repoRelativePath}: ${worktree.worktreePath}`).join("\n");

export class TicketRunService {
  private readonly now: () => number;
  private readonly runIdFactory: () => string;
  private readonly attemptIdFactory: () => string;
  private readonly runGitCommand: GitCommandRunner;
  private interruptedWorkRecovered = false;
  private readonly runLocks = new Map<string, Promise<void>>();
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

    const recoverableWorktrees =
      recoverableRun?.worktrees.map((worktree) => ({
        ...worktree,
        commitMessageDraft: worktree.commitMessageDraft ?? null,
      })) ?? [];
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
      attempts: recoverableRun?.attempts ?? [],
    });
    this.emitSnapshot();

    const worktreesToCreate = startingWorktrees.filter(
      (worktree) => !recoverableWorktreeByRepo.has(worktree.repoRelativePath),
    );

    const createdWorktrees: typeof startingWorktrees = [];
    try {
      for (const worktree of worktreesToCreate) {
        await mkdir(path.dirname(worktree.worktreePath), { recursive: true });
        await this.runGitCommand(worktree.repoAbsolutePath, [
          "worktree",
          "add",
          recoverableRun ? "-B" : "-b",
          worktree.branchName,
          worktree.worktreePath,
        ]);
        createdWorktrees.push(worktree);
      }

      for (const worktree of startingWorktrees) {
        await this.maybeHydrateWorktreeSubmodules(
          worktree,
          repoHasSubmodulesByRelativePath.get(worktree.repoRelativePath),
        );
      }
    } catch (error) {
      this.options.logger.warn({ err: error, ticketId, runId }, "Failed to prepare managed worktrees");
      const retainedWorktrees: typeof startingWorktrees = [];
      for (const createdWorktree of [...createdWorktrees].reverse()) {
        try {
          await this.runGitCommand(createdWorktree.repoAbsolutePath, [
            "worktree",
            "remove",
            "--force",
            createdWorktree.worktreePath,
          ]);
        } catch (cleanupError) {
          retainedWorktrees.push(createdWorktree);
          this.options.logger.warn(
            { err: cleanupError, ticketId, runId, worktreePath: createdWorktree.worktreePath },
            "Failed to roll back a partially created managed worktree",
          );
        }
      }

      const failedWorktrees = [...recoverableWorktrees, ...retainedWorktrees].sort((left, right) =>
        left.repoRelativePath.localeCompare(right.repoRelativePath),
      );
      const failedRun = memoryDb.upsertTicketRun({
        runId,
        ticketId,
        ticketSummary,
        ticketUrl,
        projectKey,
        status: "error",
        statusMessage: error instanceof Error ? error.message : "Failed to prepare the managed worktrees.",
        startedAt: createdAt,
        createdAt,
        worktrees: failedWorktrees,
        attempts: recoverableRun?.attempts ?? [],
      });
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
      attempts: recoverableRun?.attempts ?? [],
    });
    this.emitSnapshot();

    const run = await this.syncRunState({
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
    });
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

  async startWork(runId: string): Promise<StartTicketRunWorkResult> {
    return this.withRunLock(runId, async () => {
      const run = this.getFreshRun(runId);
      if (run.status !== "ready") {
        throw new ConfigError(`Ticket ${run.ticketId} is ${run.status} and cannot start work yet.`);
      }

      const handle = await this.launchMissionPass(run, this.buildInitialPrompt(run));
      const nextRun = this.beginAttempt(run, handle, null);
      return {
        run: nextRun,
        snapshot: this.requireMemoryDb().getTicketRunSnapshot(),
      };
    });
  }

  async continueWork(runId: string, prompt?: string): Promise<ContinueTicketRunWorkResult> {
    return this.withRunLock(runId, async () => {
      const run = this.getFreshRun(runId);
      if (run.status !== "awaiting-review") {
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
      const snapshot = memoryDb.getTicketRunSnapshot();
      this.emitSnapshot(snapshot);
      return {
        run: cancelledRun,
        snapshot,
      };
    });
  }

  async completeRun(runId: string): Promise<CompleteTicketRunResult> {
    return this.withRunLock(runId, async () => {
      const memoryDb = this.requireMemoryDb();
      const run = this.getFreshRun(runId);
      if (run.status !== "awaiting-review" && run.status !== "ready") {
        throw new ConfigError(`Ticket ${run.ticketId} must be ready for review before it can be marked complete.`);
      }

      if (this.options.stopRunServices) {
        await this.options.stopRunServices(run.runId);
      }

      let completedRun = this.persistRun(run, {
        status: "done",
        statusMessage: "Mission marked complete.",
      });
      completedRun = await this.generateAndPersistCommitDraft(completedRun);
      const stationId = completedRun.stationId;
      if (stationId && this.options.closeMissionStation) {
        await this.options.closeMissionStation(stationId);
        completedRun = this.persistRun(completedRun, {
          stationId: null,
        });
      }
      const snapshot = memoryDb.getTicketRunSnapshot();
      this.emitSnapshot(snapshot);
      return {
        run: completedRun,
        snapshot,
      };
    });
  }

  async getGitState(runId: string, repoRelativePath?: string): Promise<TicketRunGitStateResult> {
    const run = this.getFreshRun(runId);
    return {
      run,
      snapshot: this.requireMemoryDb().getTicketRunSnapshot(),
      gitState: await this.readGitState(run, repoRelativePath),
    };
  }

  async generateCommitDraft(runId: string, repoRelativePath?: string): Promise<GenerateTicketRunCommitDraftResult> {
    return this.withRunLock(runId, async () => {
      const run = this.getFreshRun(runId);
      const updatedRun = await this.generateAndPersistCommitDraft(run, repoRelativePath);
      const snapshot = this.requireMemoryDb().getTicketRunSnapshot();
      this.emitSnapshot(snapshot);
      return {
        run: updatedRun,
        snapshot,
        gitState: await this.readGitState(updatedRun, repoRelativePath),
      };
    });
  }

  async setCommitDraft(
    runId: string,
    message: string,
    repoRelativePath?: string,
  ): Promise<SetTicketRunCommitDraftResult> {
    return this.withRunLock(runId, async () => {
      const run = this.getFreshRun(runId);
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
      const snapshot = this.requireMemoryDb().getTicketRunSnapshot();
      this.emitSnapshot(snapshot);
      return {
        run: nextRun,
        snapshot,
        gitState: await this.readGitState(nextRun, worktree.repoRelativePath),
      };
    });
  }

  async commitRun(runId: string, message: string, repoRelativePath?: string): Promise<CommitTicketRunResult> {
    return this.withRunLock(runId, async () => {
      const run = this.getFreshRun(runId);
      if (run.status !== "done") {
        throw new ConfigError(`Ticket ${run.ticketId} must be completed before it can be committed.`);
      }
      const trimmedMessage = message.trim();
      if (!trimmedMessage) {
        throw new ConfigError("Enter a commit message before committing this mission.");
      }

      const worktree = this.resolveTargetWorktree(run, repoRelativePath);
      const gitState = await this.readGitState(run, worktree.repoRelativePath);
      if (!gitState.hasDiff) {
        throw new ConfigError(`Ticket ${run.ticketId} does not have any tracked changes to commit.`);
      }

      const identity = await this.resolveMissionGitIdentity();
      try {
        await this.runGitCommand(worktree.worktreePath, ["add", "-u"]);
        await this.runGitCommand(worktree.worktreePath, [
          "-c",
          `user.name=${identity.name}`,
          "-c",
          `user.email=${identity.email}`,
          "-c",
          "commit.gpgsign=false",
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
      const snapshot = this.requireMemoryDb().getTicketRunSnapshot();
      this.emitSnapshot(snapshot);
      return {
        run: nextRun,
        snapshot,
        gitState: await this.readGitState(nextRun, worktree.repoRelativePath),
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

  async createPullRequest(runId: string, repoRelativePath?: string): Promise<CreateTicketRunPullRequestResult> {
    return this.withRunLock(runId, async () => {
      const run = this.getFreshRun(runId);
      if (run.status !== "done") {
        throw new ConfigError(`Ticket ${run.ticketId} must be completed before a pull request can be opened.`);
      }

      const gitState = await this.readGitState(run, repoRelativePath);
      if (gitState.hasDiff) {
        throw new ConfigError(`Commit the tracked changes for ${run.ticketId} before opening a pull request.`);
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

  dispose(): void {
    this.disposed = true;
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

    try {
      await this.runGitCommand(worktree.worktreePath, ["submodule", "update", "--init", "--recursive"]);
    } catch (error) {
      throw new SpiraError(
        "MISSIONS_SUBMODULE_UPDATE_FAILED",
        `Failed to hydrate submodules for ${worktree.repoRelativePath}.`,
        error,
      );
    }
  }

  private async worktreeHasGitmodules(worktreePath: string): Promise<boolean> {
    try {
      await access(path.join(worktreePath, ".gitmodules"));
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return false;
      }
      throw error;
    }
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
      this.emitSnapshot(this.requireMemoryDb().getTicketRunSnapshot());
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
      attempts: [...run.attempts, attempt],
    });
    this.emitSnapshot(this.requireMemoryDb().getTicketRunSnapshot());
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

  private async applyAttemptCompletion(runId: string, attemptId: string, result: MissionPassResult): Promise<void> {
    if (this.disposed) {
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

      const completedAt = this.now();
      const attemptStatus: TicketRunAttemptStatus =
        result.status === "completed" ? "completed" : result.status === "cancelled" ? "cancelled" : "failed";
      const summary = result.summary.trim() || "Mission work finished and is ready for review.";
      const updatedRun = this.persistRun(run, {
        status: "awaiting-review",
        statusMessage: summary,
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
      this.emitSnapshot(memoryDb.getTicketRunSnapshot());
      this.options.logger.debug(
        { runId: updatedRun.runId, ticketId: updatedRun.ticketId, attemptId, attemptStatus },
        "Mission pass completed",
      );
    });
  }

  private recoverInterruptedWorkOnce(memoryDb: SpiraMemoryDatabase): void {
    if (this.interruptedWorkRecovered) {
      return;
    }
    this.interruptedWorkRecovered = true;
    this.applyInterruptedWorkRecovery(memoryDb);
  }

  private applyInterruptedWorkRecovery(memoryDb: SpiraMemoryDatabase): void {
    const strandedRuns = memoryDb
      .listTicketRuns()
      .filter((run) => run.status === "working" && this.getLatestAttempt(run)?.status === "running");
    if (strandedRuns.length === 0) {
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
    }

    this.emitSnapshot(memoryDb.getTicketRunSnapshot());
  }

  private buildInitialPrompt(run: TicketRunSummary): string {
    const workspace = describeTicketRunWorkspace(run.worktrees);
    return [
      `Work on ticket ${run.ticketId}: ${run.ticketSummary}.`,
      `Mission workspace: ${workspace.phrase}.`,
      `Repositories in scope:\n${formatTicketRunWorktreeList(run.worktrees)}`,
      "The working directory is already set to the mission workspace. Move between repo directories as needed.",
      "Inspect the codebase, implement the ticket, and leave the worktree in a reviewable state.",
      "Use the existing station context as your scratchpad; do not restart from first principles unless the evidence demands it.",
      "If you stop with open questions or partial work, say so plainly in your final summary.",
    ].join("\n");
  }

  private buildContinuationPrompt(run: TicketRunSummary, prompt: string | null): string {
    const latestAttempt = this.getLatestAttempt(run);
    const workspace = describeTicketRunWorkspace(run.worktrees);
    return [
      `Continue work on ticket ${run.ticketId}: ${run.ticketSummary}.`,
      `Mission workspace: ${workspace.phrase}.`,
      `Repositories in scope:\n${formatTicketRunWorktreeList(run.worktrees)}`,
      "Stay inside the mission workspace and preserve the existing repo layout.",
      "Continue inside the same mission station and preserve context from the prior pass.",
      latestAttempt?.summary ? `Last pass summary: ${latestAttempt.summary}` : "No prior pass summary is available.",
      prompt
        ? `User follow-up: ${prompt}`
        : "Tighten the solution, resolve remaining issues, and leave a crisp handoff summary.",
    ].join("\n");
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

  private async readGitState(run: TicketRunSummary, repoRelativePath?: string): Promise<TicketRunGitState> {
    const worktree = this.resolveTargetWorktree(run, repoRelativePath);
    const gitHubOrigin = await this.readGitHubOrigin(worktree.worktreePath);
    let upstreamBranch: string | null = null;
    try {
      upstreamBranch = (
        await this.runGitCommand(worktree.worktreePath, [
          "rev-parse",
          "--abbrev-ref",
          "--symbolic-full-name",
          "@{upstream}",
        ])
      ).stdout.trim();
    } catch {
      upstreamBranch = null;
    }

    let aheadCount = 0;
    let behindCount = 0;
    if (upstreamBranch) {
      try {
        const counts = (
          await this.runGitCommand(worktree.worktreePath, [
            "rev-list",
            "--left-right",
            "--count",
            `${upstreamBranch}...HEAD`,
          ])
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

    const [nameStatusResult, numstatResult, diffResult] = await Promise.all([
      this.runGitCommand(worktree.worktreePath, [
        "diff",
        "--find-renames",
        "--find-copies",
        "--name-status",
        "HEAD",
        "--",
      ]),
      this.runGitCommand(worktree.worktreePath, ["diff", "--find-renames", "--find-copies", "--numstat", "HEAD", "--"]),
      this.runGitCommand(worktree.worktreePath, [
        "diff",
        "--find-renames",
        "--find-copies",
        "--patch",
        "--no-color",
        "HEAD",
        "--",
      ]),
    ]);
    const files = parseDiffFiles(
      diffResult.stdout,
      parseNameStatusMap(nameStatusResult.stdout),
      parseNumstatMap(numstatResult.stdout),
    );
    const hasDiff = files.length > 0;
    let unpublishedCommitCount = 0;
    if (!upstreamBranch) {
      try {
        unpublishedCommitCount = Number(
          (
            await this.runGitCommand(worktree.worktreePath, [
              "rev-list",
              "--count",
              "HEAD",
              "--not",
              "--remotes=origin",
            ])
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
        ? this.buildPullRequestUrls(gitHubOrigin.repositoryUrl, gitHubOrigin.defaultBranch, worktree.branchName)
        : { open: null, draft: null };

    return {
      runId: run.runId,
      repoRelativePath: worktree.repoRelativePath,
      worktreePath: worktree.worktreePath,
      branchName: worktree.branchName,
      upstreamBranch,
      aheadCount,
      behindCount,
      hasDiff,
      pushAction,
      commitMessageDraft: worktree.commitMessageDraft ?? null,
      pullRequestUrls,
      files,
    };
  }

  private async generateAndPersistCommitDraft(
    run: TicketRunSummary,
    repoRelativePath?: string,
  ): Promise<TicketRunSummary> {
    const worktree = this.resolveTargetWorktree(run, repoRelativePath);
    const gitState = await this.readGitState(run, worktree.repoRelativePath);
    const fallbackBullets = buildFallbackCommitBullets(gitState.files);
    const fallbackDraft = normalizeCommitDraft(run.ticketId, run.ticketSummary, fallbackBullets);
    let draft = fallbackDraft;

    if (this.options.generateCommitDraft) {
      try {
        draft = normalizeCommitDraft(
          run.ticketId,
          await this.options.generateCommitDraft({ run, gitState }),
          fallbackBullets,
        );
      } catch (error) {
        this.options.logger.warn(
          { err: error, runId: run.runId, ticketId: run.ticketId },
          "Commit draft generation failed",
        );
      }
    }

    return this.persistRun(run, {
      worktrees: run.worktrees.map((candidate) =>
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

  private getMissionGitToken(): string {
    const token = this.options.getMissionGitToken?.()?.trim();
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

  private async createGitHubPullRequest(run: TicketRunSummary, gitState: TicketRunGitState): Promise<string> {
    const origin = await this.readGitHubOrigin(gitState.worktreePath);
    if (!origin?.defaultBranch) {
      throw new ConfigError("Mission pull requests require an HTTPS GitHub origin with a detectable default branch.");
    }

    const coordinates = parseRepositoryCoordinates(origin.repositoryUrl);
    if (!coordinates) {
      throw new ConfigError("Mission pull requests require a standard GitHub repository origin.");
    }

    const token = this.getMissionGitToken();
    const commitMessage = (
      await this.runGitCommand(gitState.worktreePath, ["log", "-1", "--pretty=%s%n%n%b", "HEAD"])
    ).stdout.trim();
    const [titleLine, ...bodyLines] = commitMessage.split(/\r?\n/u);
    const title = titleLine?.trim() || `feat(${run.ticketId}): ${run.ticketSummary}`;
    const body = bodyLines.join("\n").trim();

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
      const run = this.getFreshRun(runId);
      if (run.status !== "done") {
        throw new ConfigError(`Ticket ${run.ticketId} must be completed before it can be ${requestedAction}ed.`);
      }
      const worktree = this.resolveTargetWorktree(run, repoRelativePath);
      const gitState = await this.readGitState(run, worktree.repoRelativePath);
      if (gitState.hasDiff) {
        throw new ConfigError(`Commit the tracked changes for ${run.ticketId} before trying to ${requestedAction}.`);
      }
      if (requestedAction === "push" && gitState.pushAction !== "push") {
        throw new ConfigError(`Ticket ${run.ticketId} does not have any local commits ready to push.`);
      }
      if (requestedAction === "publish" && gitState.pushAction !== "publish") {
        throw new ConfigError(`Ticket ${run.ticketId} is already published or has nothing ready to publish.`);
      }

      await this.ensurePublishableRemote(worktree.worktreePath);
      const authHeader = Buffer.from(`x-access-token:${this.getMissionGitToken()}`).toString("base64");
      try {
        await this.runGitCommand(worktree.worktreePath, [
          "-c",
          `http.extraheader=AUTHORIZATION: basic ${authHeader}`,
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

  private persistRun(
    run: TicketRunSummary,
    overrides: Partial<
      Pick<TicketRunSummary, "stationId" | "status" | "statusMessage" | "commitMessageDraft" | "attempts" | "worktrees">
    >,
  ): TicketRunSummary {
    const memoryDb = this.requireMemoryDb();
    const worktrees = overrides.worktrees ?? run.worktrees;
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
      attempts: previousRun?.attempts ?? [],
    });
    this.emitSnapshot(memoryDb.getTicketRunSnapshot());
    return updatedRun;
  }

  private emitSnapshot(snapshot?: TicketRunSnapshot): void {
    if (!this.options.memoryDb) {
      return;
    }

    this.options.bus?.emit("missions:runs-changed", snapshot ?? this.options.memoryDb.getTicketRunSnapshot());
  }
}
