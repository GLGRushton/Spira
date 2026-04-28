import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
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
  TicketRunRepoIntelligenceCandidatesResult,
  TicketRunRepoIntelligenceEntrySummary,
  TicketRunProofRunSummary,
  TicketRunProofSnapshot,
  TicketRunProofSnapshotResult,
  TicketRunProofSummary,
  TicketRunPullRequestLinks,
  TicketRunPushAction,
  TicketRunReviewRepoEntry,
  TicketRunReviewRepoState,
  TicketRunReviewSnapshot,
  TicketRunReviewSnapshotResult,
  TicketRunReviewSubmoduleEntry,
  TicketRunReviewSubmoduleState,
  TicketRunSnapshot,
  TicketRunStatus,
  TicketRunSubmoduleGitState,
  TicketRunSubmoduleGitStateResult,
  TicketRunSubmoduleParentRef,
  TicketRunSubmoduleSummary,
  TicketRunSummary,
} from "@spira/shared";
import { normalizeProjectKey } from "@spira/shared";
import fetch from "node-fetch";
import type { Logger } from "pino";
import type { ProjectRegistry } from "../projects/registry.js";
import { ConfigError, SpiraError } from "../util/errors.js";
import type { SpiraEventBus } from "../util/event-bus.js";
import { buildLearnedRepoIntelligenceCandidates } from "./mission-intelligence.js";
import { buildMissionWorkflowRepairPrompt, getMissionWorkflowState } from "./mission-workflow-guard.js";
import {
  type ResolvedMissionProofProfile,
  discoverMissionProofProfiles,
  toMissionProofProfileSummary,
} from "./proof-registry.js";
import { type RunMissionProofInput, type RunMissionProofOutput, runMissionProof } from "./proof-runner.js";

const execFileAsync = promisify(execFile);
const WORKTREE_DIRECTORY_NAME = ".spira-worktrees";
const MAX_BRANCH_NAME_LENGTH = 63;
const MAX_SLUG_LENGTH = 40;
const MINUTE_MS = 60_000;
const DEFAULT_GIT_COMMAND_TIMEOUT_MS = MINUTE_MS;
const LONG_RUNNING_GIT_COMMAND_TIMEOUT_MS = 10 * MINUTE_MS;
const DEFAULT_GIT_COMMAND_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
const GITHUB_HTTP_EXTRAHEADER_CONFIG_KEY = "http.https://github.com/.extraheader";
const GITHUB_CREDENTIAL_PROMPT_DISABLED_PATTERN =
  /Cannot prompt because user interactivity has been disabled|terminal prompts disabled|could not read Username for 'https:\/\/github\.com'/iu;

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

interface GitRepoStateSnapshot {
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

interface ManagedSubmoduleRuntimeState {
  summary: TicketRunSubmoduleSummary;
  gitState: TicketRunSubmoduleGitState;
}

interface ManagedSubmoduleParentRuntimeState {
  parentRef: TicketRunSubmoduleParentRef;
  gitState: GitRepoStateSnapshot;
  headSha: string | null;
  diffFingerprint: string | null;
}

interface GitReadOptions {
  includeFiles?: boolean;
  allowHistoryFetch?: boolean;
}

interface GitmodulesEntry {
  path: string;
  url: string;
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
  resolveMissionGitIdentity?: () => Promise<MissionGitIdentity>;
  getMissionGitToken?: () => string | null;
}

const buildGitHubHttpAuthArgs = (token: string): string[] => {
  const authHeader = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `${GITHUB_HTTP_EXTRAHEADER_CONFIG_KEY}=AUTHORIZATION: basic ${authHeader}`];
};

const isGitHubCredentialPromptFailure = (error: unknown): boolean => {
  const text =
    error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : typeof error === "string" ? error : "";
  return text.length > 0 && GITHUB_CREDENTIAL_PROMPT_DISABLED_PATTERN.test(text);
};

const stripInlineGitConfigs = (args: readonly string[]): string[] => {
  const normalized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "-c") {
      index += 1;
      continue;
    }
    normalized.push(args[index] ?? "");
  }
  return normalized;
};

const resolveGitCommandTimeoutMs = (args: readonly string[]): number => {
  const normalizedArgs = stripInlineGitConfigs(args);
  const command = normalizedArgs[0];
  const subcommand = normalizedArgs[1];
  if (
    (command === "submodule" && subcommand === "update") ||
    (command === "worktree" && (subcommand === "add" || subcommand === "remove" || subcommand === "prune")) ||
    command === "fetch" ||
    command === "push"
  ) {
    return LONG_RUNNING_GIT_COMMAND_TIMEOUT_MS;
  }
  return DEFAULT_GIT_COMMAND_TIMEOUT_MS;
};

const defaultGitCommandRunner: GitCommandRunner = async (cwd, args) => {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      env: {
        ...process.env,
        GCM_INTERACTIVE: "Never",
        GIT_TERMINAL_PROMPT: "0",
      },
      maxBuffer: DEFAULT_GIT_COMMAND_MAX_BUFFER_BYTES,
      timeout: resolveGitCommandTimeoutMs(args),
      windowsHide: true,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const sanitizedArgs = args.map((arg) =>
      /^http(?:\..+)?\.extraheader=AUTHORIZATION:\s+/iu.test(arg)
        ? `${arg.slice(0, arg.indexOf("AUTHORIZATION:"))}AUTHORIZATION: [REDACTED]`
        : arg,
    );
    const timedOut =
      typeof error === "object" &&
      error !== null &&
      "killed" in error &&
      (error as { killed?: unknown }).killed === true;
    throw new SpiraError(
      "TICKET_RUN_GIT_ERROR",
      `${timedOut ? "Git command timed out" : "Git command failed"} in ${cwd}: git ${sanitizedArgs.join(" ")}`,
      error,
    );
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

const isRepoBlockingClose = (gitState: Pick<TicketRunGitState, "hasDiff" | "pushAction">): boolean =>
  gitState.hasDiff || gitState.pushAction !== "none";

const isRepoVisibleInReview = (gitState: Pick<TicketRunGitState, "hasDiff" | "pushAction">): boolean =>
  isRepoBlockingClose(gitState);

const isSubmoduleBlockingClose = (
  gitState: Pick<TicketRunSubmoduleGitState, "hasDiff" | "reconcileRequired" | "pushAction" | "parents">,
): boolean =>
  gitState.hasDiff ||
  gitState.reconcileRequired ||
  gitState.pushAction !== "none" ||
  gitState.parents.some((parentState) => !parentState.isAligned);

const isSubmoduleBlockingRepoWorkflow = (
  gitState: Pick<TicketRunSubmoduleGitState, "hasDiff" | "reconcileRequired" | "pushAction">,
): boolean => gitState.hasDiff || gitState.reconcileRequired || gitState.pushAction !== "none";

const isSubmoduleVisibleInReview = (
  gitState: Pick<TicketRunSubmoduleGitState, "hasDiff" | "reconcileRequired" | "pushAction" | "parents">,
): boolean => isSubmoduleBlockingClose(gitState);

const toReviewRepoState = ({ files: _files, ...gitState }: TicketRunGitState): TicketRunReviewRepoState => gitState;

const toReviewSubmoduleState = ({
  files: _files,
  ...gitState
}: TicketRunSubmoduleGitState): TicketRunReviewSubmoduleState => gitState;

const describeReviewLoadError = (error: unknown, fallbackMessage: string): string =>
  error instanceof Error && error.message.trim().length > 0 ? error.message : fallbackMessage;

const describeDeleteBlockers = (deleteBlockers: readonly TicketRunDeleteBlocker[]): string =>
  deleteBlockers.map((blocker) => `${blocker.label} (${blocker.reason})`).join(", ");

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

const parseNullSeparatedEntries = (stdout: string): string[] => {
  if (stdout.includes("\u0000")) {
    return stdout.split("\u0000").filter((entry) => entry.length > 0);
  }
  return stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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

const mergeUntrackedFiles = (
  files: readonly TicketRunDiffFileSummary[],
  untrackedPaths: readonly string[],
): TicketRunDiffFileSummary[] => {
  if (untrackedPaths.length === 0) {
    return [...files];
  }

  const merged = new Map(files.map((file) => [file.path, file] as const));
  for (const untrackedPath of [...untrackedPaths].sort((left, right) => left.localeCompare(right))) {
    if (merged.has(untrackedPath)) {
      continue;
    }
    merged.set(untrackedPath, {
      path: untrackedPath,
      previousPath: null,
      status: "A",
      additions: null,
      deletions: null,
      patch: "",
    });
  }

  return [...merged.values()];
};

const normalizeSubmoduleCanonicalUrl = (rawUrl: string): string => {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }

  if (!trimmed.includes("://")) {
    const scpLikeMatch = /^(?:[^@]+@)?([^:]+):(.+)$/u.exec(trimmed);
    if (scpLikeMatch) {
      return `${scpLikeMatch[1]}/${scpLikeMatch[2]}`
        .replace(/\\/gu, "/")
        .replace(/\.git$/iu, "")
        .replace(/\/+$/u, "")
        .toLowerCase();
    }
  }

  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.replace(/\.git$/iu, "").replace(/\/+$/u, "");
    return `${parsed.host}${pathname}`.replace(/\\/gu, "/").toLowerCase();
  } catch {
    return trimmed
      .replace(/\\/gu, "/")
      .replace(/\.git$/iu, "")
      .replace(/\/+$/u, "")
      .toLowerCase();
  }
};

const parseGitmodulesEntries = (stdout: string): GitmodulesEntry[] => {
  const entriesByName = new Map<string, Partial<GitmodulesEntry>>();
  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const separatorIndex = line.indexOf(" ");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1).trim();
    const match = /^submodule\.(.+)\.(path|url)$/u.exec(key);
    if (!match || !value) {
      continue;
    }

    const [, name, property] = match;
    const current = entriesByName.get(name) ?? {};
    if (property === "path") {
      current.path = value;
    } else {
      current.url = value;
    }
    entriesByName.set(name, current);
  }

  return [...entriesByName.values()]
    .filter((entry): entry is GitmodulesEntry => typeof entry.path === "string" && typeof entry.url === "string")
    .map((entry) => ({ path: entry.path.trim(), url: entry.url.trim() }))
    .filter((entry) => entry.path.length > 0 && entry.url.length > 0);
};

const buildSubmoduleDiffFingerprint = (files: readonly TicketRunDiffFileSummary[]): string | null => {
  if (files.length === 0) {
    return null;
  }

  return JSON.stringify(
    files.map((file) => ({
      path: file.path,
      previousPath: file.previousPath,
      status: file.status,
      patch: file.patch,
    })),
  );
};

const sortSubmoduleParentRefs = (parentRefs: readonly TicketRunSubmoduleParentRef[]): TicketRunSubmoduleParentRef[] =>
  [...parentRefs].sort(
    (left, right) =>
      left.parentRepoRelativePath.localeCompare(right.parentRepoRelativePath) ||
      left.submodulePath.localeCompare(right.submodulePath),
  );

const areSubmoduleSummariesEqual = (
  left: readonly TicketRunSubmoduleSummary[],
  right: readonly TicketRunSubmoduleSummary[],
): boolean =>
  JSON.stringify(
    [...left]
      .map((submodule) => ({
        canonicalUrl: submodule.canonicalUrl,
        name: submodule.name,
        branchName: submodule.branchName,
        commitMessageDraft: submodule.commitMessageDraft ?? null,
        parentRefs: sortSubmoduleParentRefs(submodule.parentRefs),
      }))
      .sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl)),
  ) ===
  JSON.stringify(
    [...right]
      .map((submodule) => ({
        canonicalUrl: submodule.canonicalUrl,
        name: submodule.name,
        branchName: submodule.branchName,
        commitMessageDraft: submodule.commitMessageDraft ?? null,
        parentRefs: sortSubmoduleParentRefs(submodule.parentRefs),
      }))
      .sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl)),
  );

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

const resolveTicketRunMissionDirectory = (
  worktrees: ReadonlyArray<Pick<TicketRunSummary["worktrees"][number], "worktreePath">>,
): string | null => {
  if (worktrees.length === 0) {
    return null;
  }

  const parents = [...new Set(worktrees.map((worktree) => path.dirname(worktree.worktreePath)))];
  return parents.length === 1 ? (parents[0] ?? null) : null;
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

const buildDefaultProofSummary = (): TicketRunProofSummary => ({
  status: "not-run",
  lastProofRunId: null,
  lastProofProfileId: null,
  lastProofAt: null,
  lastProofSummary: null,
  staleReason: null,
});

const buildStaleProofSummary = (run: TicketRunSummary, staleReason: string): TicketRunProofSummary =>
  run.proof.lastProofRunId
    ? {
        ...run.proof,
        status: "stale",
        staleReason,
      }
    : buildDefaultProofSummary();

export class TicketRunService {
  private readonly now: () => number;
  private readonly runIdFactory: () => string;
  private readonly attemptIdFactory: () => string;
  private readonly runGitCommand: GitCommandRunner;
  private interruptedWorkRecovered = false;
  private readonly runLocks = new Map<string, Promise<void>>();
  private readonly reviewSnapshotRequests = new Map<string, Promise<TicketRunReviewSnapshotResult>>();
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
        if (await this.pathExists(worktree.worktreePath)) {
          await this.removeManagedWorktree(worktree);
        }
        await mkdir(path.dirname(worktree.worktreePath), { recursive: true });
        const branchExistedBeforeCreate = await this.hasLocalBranch(worktree.repoAbsolutePath, worktree.branchName);
        await this.runGitCommand(worktree.repoAbsolutePath, [
          "worktree",
          "add",
          ...(branchExistedBeforeCreate
            ? [worktree.worktreePath, worktree.branchName]
            : [recoverableRun ? "-B" : "-b", worktree.branchName, worktree.worktreePath]),
        ]);
        createdWorktrees.push({
          worktree,
          branchExistedBeforeCreate,
        });
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
        submodules: recoverableRun?.submodules ?? [],
        attempts: recoverableRun?.attempts ?? [],
        proof: recoverableRun?.proof ?? buildDefaultProofSummary(),
        proofRuns: recoverableRun?.proofRuns ?? [],
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
      const run = await this.ensureRunSubmodules(this.getFreshRun(runId));
      if (run.status !== "awaiting-review") {
        throw new ConfigError(`Ticket ${run.ticketId} must be awaiting review before it can be closed.`);
      }
      if (run.proof.status === "running") {
        throw new ConfigError(`Wait for the active proof run to finish before closing ${run.ticketId}.`);
      }

      this.assertRunCanCloseWithLifecycle(run);

      if (this.options.stopRunServices) {
        await this.options.stopRunServices(run.runId);
      }

      let stationCleared = false;
      const stationId = run.stationId;
      if (stationId && this.options.closeMissionStation) {
        await this.options.closeMissionStation(stationId);
        stationCleared = true;
      }
      const completedRun = this.persistRun(this.getFreshRun(runId), {
        ...(stationCleared ? { stationId: null } : {}),
        status: "done",
        statusMessage: "Mission closed.",
      });
      this.observeRepoIntelligenceCandidates(completedRun);
      this.recordMissionEvent(completedRun, "system", "run-closed", {
        stationCleared,
      });
      const snapshot = memoryDb.getTicketRunSnapshot();
      this.emitSnapshot(snapshot);
      return {
        run: completedRun,
        snapshot,
      };
    });
  }

  async getProofSnapshot(runId: string): Promise<TicketRunProofSnapshotResult> {
    const run = await this.ensureRunSubmodules(this.getFreshRun(runId));
    return {
      run,
      snapshot: this.requireMemoryDb().getTicketRunSnapshot(),
      proofSnapshot: await this.buildProofSnapshot(run),
    };
  }

  async getMissionTimeline(runId: string, limit = 80): Promise<TicketRunMissionTimelineResult> {
    const run = this.getFreshRun(runId);
    return {
      run,
      snapshot: this.requireMemoryDb().getTicketRunSnapshot(),
      events: this.listMissionEvents(runId, limit),
    };
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
        throw new ConfigError(`Mission ${run.ticketId} does not expose a learned repo intelligence candidate named ${entryId}.`);
      }

      const approvedEntry = memoryDb.setRepoIntelligenceApproval(entryId, true);
      this.recordMissionEvent(run, "system", "repo-intelligence-candidate-approved", {
        entryId: approvedEntry.id,
        repoRelativePath: approvedEntry.repoRelativePath,
      });
      const snapshot = memoryDb.getTicketRunSnapshot();
      this.emitSnapshot(snapshot);
      return {
        run,
        snapshot,
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
        },
        proofRuns: [runningProofRun, ...run.proofRuns.filter((candidate) => candidate.proofRunId !== proofRunId)],
      });
      this.recordMissionEvent(run, "proof", "proof-started", {
        proofRunId,
        profileId: profile.profileId,
        profileLabel: profile.label,
      });
      this.emitSnapshot(memoryDb.getTicketRunSnapshot());

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
        },
        proofRuns: [completedProofRun, ...run.proofRuns.filter((candidate) => candidate.proofRunId !== proofRunId)],
      });
      this.recordMissionEvent(run, "proof", "proof-finished", {
        proofRunId,
        profileId: profile.profileId,
        status: proofOutput.status,
        exitCode: proofOutput.exitCode,
      });
      const snapshot = memoryDb.getTicketRunSnapshot();
      this.emitSnapshot(snapshot);
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
    if (run.validations.length === 0 || !run.validations.some((validation) => validation.status === "passed")) {
      throw new ConfigError(`Ticket ${run.ticketId} requires recorded validation results before it can be closed.`);
    }
    if (run.validations.some((validation) => validation.status === "pending")) {
      throw new ConfigError(`Ticket ${run.ticketId} has pending validation work that must finish before closing.`);
    }
    if (run.validations.some((validation) => validation.status === "failed")) {
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
      const snapshot = this.requireMemoryDb().getTicketRunSnapshot();
      this.emitSnapshot(snapshot);
      return {
        run: updatedRun,
        snapshot,
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
      const snapshot = this.requireMemoryDb().getTicketRunSnapshot();
      this.emitSnapshot(snapshot);
      return {
        run: updatedRun,
        snapshot,
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
      const snapshot = this.requireMemoryDb().getTicketRunSnapshot();
      this.emitSnapshot(snapshot);
      return {
        run: nextRun,
        snapshot,
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
      const snapshot = this.requireMemoryDb().getTicketRunSnapshot();
      this.emitSnapshot(snapshot);
      return {
        run: nextRun,
        snapshot,
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
          "-c",
          "commit.gpgsign=false",
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
      const snapshot = this.requireMemoryDb().getTicketRunSnapshot();
      this.emitSnapshot(snapshot);
      return {
        run: nextRun,
        snapshot,
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
      throw new SpiraError(
        "MISSIONS_SUBMODULE_UPDATE_FAILED",
        !missionGitToken && isGitHubCredentialPromptFailure(error)
          ? `Failed to hydrate submodules for ${worktree.repoRelativePath}. Set a mission GitHub PAT in Settings so Spira can clone private GitHub submodules.`
          : `Failed to hydrate submodules for ${worktree.repoRelativePath}.`,
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

  private async discoverMissionProofProfiles(run: TicketRunSummary): Promise<ResolvedMissionProofProfile[]> {
    return this.options.discoverMissionProofProfiles
      ? this.options.discoverMissionProofProfiles(run)
      : discoverMissionProofProfiles(run);
  }

  private async executeMissionProof(input: RunMissionProofInput): Promise<RunMissionProofOutput> {
    return this.options.runMissionProof ? this.options.runMissionProof(input) : runMissionProof(input);
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
      this.emitSnapshot(memoryDb.getTicketRunSnapshot());
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
    this.emitSnapshot(memoryDb.getTicketRunSnapshot());

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
      this.recordMissionEvent(run, "system", "attempt-recovered-after-restart", {
        attemptId: latestAttempt.attemptId,
      });
    }

    this.emitSnapshot(memoryDb.getTicketRunSnapshot());
  }

  private buildInitialPrompt(run: TicketRunSummary, prompt: string | null): string {
    const workspace = describeTicketRunWorkspace(run.worktrees);
    return [
      `Work on ticket ${run.ticketId}: ${run.ticketSummary}.`,
      `Mission workspace: ${workspace.phrase}.`,
      `Repositories in scope:\n${formatTicketRunWorktreeList(run.worktrees)}`,
      "The working directory is already set to the mission workspace. Move between repo directories as needed.",
      "Inspect the codebase, implement the ticket, and leave the worktree in a reviewable state.",
      "Use the existing station context as your scratchpad; do not restart from first principles unless the evidence demands it.",
      prompt ? `Additional operator context: ${prompt}` : "No extra operator context was provided beyond the ticket.",
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

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath);
      return true;
    } catch {
      return false;
    }
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
    if (!(await this.pathExists(worktree.worktreePath))) {
      return false;
    }

    try {
      await this.runGitCommand(worktree.worktreePath, ["rev-parse", "--git-dir"]);
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
    if (!(await this.pathExists(worktree.worktreePath))) {
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
      if (await this.pathExists(worktree.worktreePath)) {
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
    if (!(await this.pathExists(repoAbsolutePath))) {
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
          if (await this.pathExists(parentRef.submoduleWorktreePath)) {
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
    this.emitSnapshot(memoryDb.getTicketRunSnapshot());
    return updatedRun;
  }

  private listMissionEvents(runId: string, limit: number): TicketRunMissionEventSummary[] {
    const memoryDb = this.options.memoryDb;
    if (!memoryDb) {
      return [];
    }
    return memoryDb.listMissionEvents(runId, limit).map((event) => ({
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
    const entries = buildLearnedRepoIntelligenceCandidates(run).map((candidate) => memoryDb.upsertRepoIntelligence(candidate));
    if (entries.length === 0) {
      return;
    }
    this.recordMissionEvent(run, "system", "repo-intelligence-candidates-observed", {
      count: entries.length,
      entryIds: entries.map((entry) => entry.id),
      repoRelativePaths: entries.map((entry) => entry.repoRelativePath),
    });
  }

  private recordMissionEvent(
    run: Pick<TicketRunSummary, "runId" | "attempts" | "missionPhase">,
    stage: TicketRunMissionEventSummary["stage"],
    eventType: string,
    metadata: Record<string, unknown>,
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
}
