import type { MissionEventRecord, ValidationProfileRecord } from "@spira/memory-db";
import type { TicketRunMissionValidationKind, TicketRunSummary } from "@spira/shared";
import { median } from "../util/stats.js";
import { hashFragment } from "./mission-intelligence.js";

/**
 * derive `validation_profile` candidates from the per-attempt shell command
 * stream. Once any spawned command has been observed succeeding ≥ N times for a
 * `(projectKey, repoRelativePath, kind)` triple, we propose it as a registered profile.
 *
 * The kind is inferred from the command itself via simple string heuristics — the goal is
 * to surface high-signal proposals without a full parse, not to be a shell linter. Caller
 * dedupes proposals against existing profiles; we never re-propose a command that already
 * has a registered profile for the same (projectKey, repoRelativePath, command) triple.
 */

/** Default success-count threshold before a candidate is surfaced. */
export const DEFAULT_VALIDATION_CANDIDATE_THRESHOLD = 3;

/**
 * Default success-count threshold above which a surfaced candidate auto-promotes to a
 * registered validation profile (`validation-profile-auto-promoted` mission event). The
 * close-screen learning panel uses the same value to compute "X of N confirming missions"
 * progress copy for sub-threshold proposals.
 */
export const DEFAULT_VALIDATION_AUTO_PROMOTION_THRESHOLD = 5;

const KIND_HEURISTICS: Array<{ kind: TicketRunMissionValidationKind; matcher: RegExp }> = [
  { kind: "restore", matcher: /^(npm ci|pnpm install|yarn install|dotnet restore)\b/iu },
  { kind: "format", matcher: /\b(prettier|biome|black|gofmt|dotnet format|format[:-]check)\b/iu },
  { kind: "lint", matcher: /\b(eslint|tslint|stylelint|pnpm run lint|npm run lint|dotnet lint)\b/iu },
  { kind: "typecheck", matcher: /\b(tsc|pyright|mypy|pnpm run typecheck|npm run typecheck)\b/iu },
  { kind: "unit-test", matcher: /\b(vitest|jest|mocha|pytest|dotnet test|npm test|pnpm test)\b/iu },
  { kind: "build", matcher: /\b(tsc --build|webpack|vite build|next build|dotnet build|pnpm run build|npm run build)\b/iu },
  { kind: "e2e-smoke", matcher: /\b(playwright|cypress|spec\/e2e)\b/iu },
];

/**
 * Best-effort kind inference from a shell command. Returns null when nothing matches —
 * the caller skips proposing those (we want high-signal candidates, not "ran echo once").
 */
export const inferValidationKindFromCommand = (command: string): TicketRunMissionValidationKind | null => {
  const trimmed = command.trim();
  if (trimmed.length === 0) return null;
  for (const heuristic of KIND_HEURISTICS) {
    if (heuristic.matcher.test(trimmed)) return heuristic.kind;
  }
  return null;
};

export interface ValidationProfileCandidate {
  /** Stable id derived from the (projectKey, repoRelativePath, command) triple. */
  candidateId: string;
  projectKey: string | null;
  repoRelativePath: string | null;
  kind: TicketRunMissionValidationKind;
  command: string;
  workingDirectory: string;
  /** Distinct-mission successful observations of this command/cwd at the moment of proposal. */
  successCount: number;
  /** Median observed runtime across the contributing observations, ms. */
  observedRuntimeMs: number | null;
}

interface ObservedCommand {
  command: string;
  cwd: string;
  durationsMs: number[];
  /** Distinct run ids that observed a successful invocation of this command/cwd. */
  successRunIds: Set<string>;
}

const buildCandidateKey = (projectKey: string | null, repoRelativePath: string | null, command: string, cwd: string): string =>
  `learned:${projectKey ?? "*"}:${repoRelativePath ?? "*"}:${cwd}:${command}`;

export interface DeriveValidationCandidatesInput {
  /** All mission events that may carry attempt-shell-command observations. */
  events: readonly MissionEventRecord[];
  /** Closed runs the events came from (used for run id + projectKey + repo paths). */
  runs: readonly TicketRunSummary[];
  /** Profiles that already exist for this scope; used to suppress duplicates. */
  existingProfiles: readonly ValidationProfileRecord[];
  /** Override the default success threshold. */
  threshold?: number;
}

/**
 * Aggregate cross-run shell-command observations into validation_profile candidates.
 * only commands whose inferred kind is non-null and whose distinct-run success count
 * meets the threshold are returned. Existing profiles are filtered out.
 */
export const deriveValidationProfileCandidates = (input: DeriveValidationCandidatesInput): ValidationProfileCandidate[] => {
  const threshold = input.threshold ?? DEFAULT_VALIDATION_CANDIDATE_THRESHOLD;
  const runById = new Map(input.runs.map((run) => [run.runId, run] as const));
  // Keyed on (projectKey, repoRelativePath, command, cwd) — we group successful observations
  // across runs so the threshold reflects "distinct missions agreed this command works."
  const observations = new Map<string, ObservedCommand & { projectKey: string | null; repoRelativePath: string | null }>();

  for (const event of input.events) {
    if (event.eventType !== "attempt-shell-command") continue;
    const metadata = event.metadata as { command?: unknown; cwd?: unknown; status?: unknown; durationMs?: unknown };
    if (metadata.status !== "passed") continue;
    const command = typeof metadata.command === "string" ? metadata.command.trim() : "";
    const cwd = typeof metadata.cwd === "string" ? metadata.cwd : "";
    if (!command || !cwd) continue;

    const run = runById.get(event.runId);
    if (!run) continue;
    // Map cwd to a repo-relative path when it lives under a managed worktree.
    const matchingWorktree = run.worktrees.find((worktree) => cwd === worktree.worktreePath || cwd.startsWith(`${worktree.worktreePath}\\`) || cwd.startsWith(`${worktree.worktreePath}/`));
    const repoRelativePath = matchingWorktree?.repoRelativePath ?? null;
    const projectKey = run.projectKey || null;
    const key = buildCandidateKey(projectKey, repoRelativePath, command, cwd);

    let entry = observations.get(key);
    if (!entry) {
      entry = {
        projectKey,
        repoRelativePath,
        command,
        cwd,
        durationsMs: [],
        successRunIds: new Set(),
      };
      observations.set(key, entry);
    }
    entry.successRunIds.add(event.runId);
    if (typeof metadata.durationMs === "number" && Number.isFinite(metadata.durationMs)) {
      entry.durationsMs.push(metadata.durationMs);
    }
  }

  const existingByCommand = new Set(
    input.existingProfiles.map((profile) =>
      buildCandidateKey(profile.projectKey, profile.repoRelativePath, profile.command, profile.workingDirectory),
    ),
  );

  const candidates: ValidationProfileCandidate[] = [];
  for (const entry of observations.values()) {
    if (entry.successRunIds.size < threshold) continue;
    const kind = inferValidationKindFromCommand(entry.command);
    if (kind === null) continue;
    if (existingByCommand.has(buildCandidateKey(entry.projectKey, entry.repoRelativePath, entry.command, entry.cwd))) continue;
    candidates.push({
      candidateId: `learned-validation-${hashFragment(buildCandidateKey(entry.projectKey, entry.repoRelativePath, entry.command, entry.cwd))}`,
      projectKey: entry.projectKey,
      repoRelativePath: entry.repoRelativePath,
      kind,
      command: entry.command,
      workingDirectory: entry.cwd,
      successCount: entry.successRunIds.size,
      observedRuntimeMs: median(entry.durationsMs),
    });
  }
  return candidates.sort((left, right) => right.successCount - left.successCount || left.command.localeCompare(right.command));
};
