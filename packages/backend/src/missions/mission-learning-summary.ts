import type { MissionEventRecord, SpiraMemoryDatabase } from "@spira/memory-db";
import type {
  MissionLearningSummary,
  PromotedLearningItem,
  ProposedLearningItem,
  RepoProfileDraft,
  TicketRunSummary,
  ValidationProfileDraft,
} from "@spira/shared";
import { TICKET_RUN_MISSION_VALIDATION_KINDS } from "@spira/shared";
import { DEFAULT_PROMOTION_THRESHOLDS } from "./learned-candidate-promoter.js";
import { hashFragment } from "./mission-intelligence.js";
import { DEFAULT_VALIDATION_AUTO_PROMOTION_THRESHOLD } from "./validation-candidate-learner.js";

/**
 * Read the run's mission_events to project the close-screen learning summary the
 * renderer panel consumes. Pure read; never writes. Bootstrap drafts are derived from the
 * run's successful shell-command observations + worktree metadata.
 *
 * Inputs:
 *  - The closed run record (worktrees, projectKey).
 *  - The run's mission_events for any post-classify event types we need to project.
 *
 * Outputs are renderer-facing — see `MissionLearningSummary`.
 */

export interface AssembleMissionLearningSummaryInput {
  run: TicketRunSummary;
  events: readonly MissionEventRecord[];
  /**
   * Override for the project's existing repo_profiles row count. When zero, the
   * `bootstrapProfile` slot is filled.
   */
  projectHasRepoProfile: boolean;
  /**
   * Override for the project's existing validation_profiles row count for the impacted
   * repos. When zero AND the bootstrap path fired, we surface validation drafts too.
   */
  projectHasValidationProfiles: boolean;
}

const promotionRationale = (meta: Record<string, unknown>): string => {
  const confidence = typeof meta["confidence"] === "number" ? (meta["confidence"] as number) : null;
  const threshold = typeof meta["threshold"] === "number" ? (meta["threshold"] as number) : null;
  const successCount = typeof meta["successCount"] === "number" ? (meta["successCount"] as number) : null;
  if (successCount !== null && threshold !== null) {
    return `${successCount}/${threshold} confirming missions`;
  }
  if (confidence !== null && threshold !== null) {
    return `confidence ${confidence.toFixed(2)} ≥ threshold ${threshold}`;
  }
  return "promoted by the auto-promotion sweep";
};

const proposalRationale = (meta: Record<string, unknown>): string => {
  const successCount = typeof meta["successCount"] === "number" ? (meta["successCount"] as number) : null;
  if (successCount !== null) {
    return `${successCount} confirming mission${successCount === 1 ? "" : "s"} so far`;
  }
  return "below auto-promotion threshold";
};

const VALIDATION_KIND_SET = new Set<string>(TICKET_RUN_MISSION_VALIDATION_KINDS);

const inferKindFromCommand = (command: string): string | null => {
  const trimmed = command.trim();
  if (!trimmed) return null;
  if (/^(npm ci|pnpm install|yarn install|dotnet restore)\b/iu.test(trimmed)) return "restore";
  if (/\b(prettier|biome|black|gofmt|dotnet format|format[:-]check)\b/iu.test(trimmed)) return "format";
  if (/\b(eslint|tslint|stylelint|pnpm run lint|npm run lint|dotnet lint)\b/iu.test(trimmed)) return "lint";
  if (/\b(tsc|pyright|mypy|pnpm run typecheck|npm run typecheck)\b/iu.test(trimmed)) return "typecheck";
  if (/\b(vitest|jest|mocha|pytest|dotnet test|npm test|pnpm test)\b/iu.test(trimmed)) return "unit-test";
  if (/\b(tsc --build|webpack|vite build|next build|dotnet build|pnpm run build|npm run build|ng build)\b/iu.test(trimmed))
    return "build";
  if (/\b(playwright|cypress|spec\/e2e)\b/iu.test(trimmed)) return "e2e-smoke";
  return null;
};

const detectSdkHints = (events: readonly MissionEventRecord[]): string[] => {
  const sdks = new Set<string>();
  for (const event of events) {
    if (event.eventType !== "attempt-shell-command") continue;
    const meta = event.metadata as { command?: unknown } | null;
    if (typeof meta?.command !== "string") continue;
    const cmd = meta.command.toLowerCase();
    if (cmd.includes("dotnet ")) sdks.add(".NET 8+");
    if (cmd.includes("npm ") || cmd.includes("npx ")) sdks.add("node 22+");
    if (cmd.includes("pnpm ")) sdks.add("pnpm 9+");
    if (cmd.includes("yarn ")) sdks.add("yarn");
    if (cmd.includes("python ") || cmd.includes("pytest")) sdks.add("python 3.11+");
  }
  return [...sdks].sort();
};

const buildBootstrapValidationDrafts = (
  run: TicketRunSummary,
  events: readonly MissionEventRecord[],
): ValidationProfileDraft[] => {
  type Observation = {
    command: string;
    cwd: string;
    repoRelativePath: string | null;
    durations: number[];
    successCount: number;
  };
  const seen = new Map<string, Observation>();
  for (const event of events) {
    if (event.eventType !== "attempt-shell-command") continue;
    const meta = event.metadata as { command?: unknown; cwd?: unknown; status?: unknown; durationMs?: unknown } | null;
    if (meta?.status !== "passed") continue;
    const command = typeof meta.command === "string" ? meta.command.trim() : "";
    const cwd = typeof meta.cwd === "string" ? meta.cwd : "";
    if (!command || !cwd) continue;
    const matchingWorktree = run.worktrees.find(
      (worktree) =>
        cwd === worktree.worktreePath ||
        cwd.startsWith(`${worktree.worktreePath}\\`) ||
        cwd.startsWith(`${worktree.worktreePath}/`),
    );
    const repoRelativePath = matchingWorktree?.repoRelativePath ?? null;
    const key = `${repoRelativePath ?? "*"}::${cwd}::${command}`;
    let entry = seen.get(key);
    if (!entry) {
      entry = { command, cwd, repoRelativePath, durations: [], successCount: 0 };
      seen.set(key, entry);
    }
    entry.successCount += 1;
    if (typeof meta.durationMs === "number" && Number.isFinite(meta.durationMs)) {
      entry.durations.push(meta.durationMs);
    }
  }
  const drafts: ValidationProfileDraft[] = [];
  for (const entry of seen.values()) {
    const kind = inferKindFromCommand(entry.command);
    if (kind === null || !VALIDATION_KIND_SET.has(kind)) continue;
    const sortedDurations = [...entry.durations].sort((left, right) => left - right);
    const median =
      sortedDurations.length === 0
        ? null
        : sortedDurations.length % 2 === 0
          ? Math.round((sortedDurations[sortedDurations.length / 2 - 1]! + sortedDurations[sortedDurations.length / 2]!) / 2)
          : sortedDurations[(sortedDurations.length - 1) / 2]!;
    const candidateId = `bootstrap-validation-${hashFragment(`${run.projectKey}::${entry.repoRelativePath ?? "*"}::${entry.command}::${entry.cwd}`)}`;
    drafts.push({
      candidateId,
      projectKey: run.projectKey,
      repoRelativePath: entry.repoRelativePath,
      scope: entry.repoRelativePath ? "project" : "global",
      kind,
      command: entry.command,
      workingDirectory: entry.cwd,
      successCount: entry.successCount,
      observedRuntimeMs: median,
    });
  }
  return drafts;
};

const buildBootstrapProfileDraft = (
  run: TicketRunSummary,
  events: readonly MissionEventRecord[],
): RepoProfileDraft | null => {
  if (!run.projectKey) return null;
  const firstWorktree = run.worktrees[0] ?? null;
  const buildCwds = new Set<string>();
  for (const event of events) {
    if (event.eventType !== "attempt-shell-command") continue;
    const meta = event.metadata as { command?: unknown; cwd?: unknown; status?: unknown } | null;
    if (meta?.status !== "passed") continue;
    if (typeof meta.command !== "string" || typeof meta.cwd !== "string") continue;
    if (/\b(build|dotnet build|ng build|next build|vite build)\b/iu.test(meta.command)) {
      buildCwds.add(meta.cwd);
    }
  }
  const defaultBuildDir = buildCwds.size === 1 ? [...buildCwds][0]! : ".";
  return {
    projectKey: run.projectKey,
    repoRelativePath: "",
    displayName: run.projectKey,
    defaultBranch: firstWorktree?.branchName ?? null,
    defaultBuildWorkingDirectory: defaultBuildDir,
    requiredSdks: detectSdkHints(events),
    notes: `Drafted from mission ${run.ticketId}; review and edit before saving.`,
  };
};

export const assembleMissionLearningSummary = (
  input: AssembleMissionLearningSummaryInput,
): MissionLearningSummary => {
  const { run, events, projectHasRepoProfile, projectHasValidationProfiles } = input;
  const autoPromoted: PromotedLearningItem[] = [];
  const proposed: ProposedLearningItem[] = [];

  // Two-pass: collect every candidateId that was auto-promoted in this run so we can
  // skip surfacing the same candidate as a proposal regardless of event order.
  const autoPromotedIds = new Set<string>();
  for (const event of events) {
    if (
      event.eventType === "validation-profile-auto-promoted" ||
      event.eventType === "learned-candidate-promoted"
    ) {
      const meta = (event.metadata ?? {}) as Record<string, unknown>;
      if (typeof meta["candidateId"] === "string") {
        autoPromotedIds.add(meta["candidateId"] as string);
      }
    }
  }

  for (const event of events) {
    const meta = (event.metadata ?? {}) as Record<string, unknown>;
    const candidateId = typeof meta["candidateId"] === "string" ? (meta["candidateId"] as string) : "";
    if (!candidateId) continue;
    if (event.eventType === "validation-profile-auto-promoted") {
      autoPromoted.push({
        kind: "validation-profile",
        candidateId,
        title: typeof meta["command"] === "string" ? `${meta["kind"] ?? "validation"}: ${meta["command"]}` : candidateId,
        rationale: promotionRationale(meta),
        acceptanceMode: "automatic",
        occurredAt: event.occurredAt,
      });
    } else if (event.eventType === "learned-candidate-promoted") {
      const type = typeof meta["type"] === "string" ? (meta["type"] as string) : "intelligence";
      const kind: PromotedLearningItem["kind"] =
        type === "briefing"
          ? "repo-intelligence-briefing"
          : type === "pitfall"
            ? "repo-intelligence-pitfall"
            : "repo-intelligence-example";
      autoPromoted.push({
        kind,
        candidateId,
        title: typeof meta["title"] === "string" ? (meta["title"] as string) : candidateId,
        rationale: promotionRationale(meta),
        acceptanceMode: "automatic",
        occurredAt: event.occurredAt,
      });
    } else if (event.eventType === "validation-profile-candidate-observed") {
      // Skip if already auto-promoted in this same run (we only want pending review here).
      if (autoPromotedIds.has(candidateId)) continue;
      const successCount = typeof meta["successCount"] === "number" ? (meta["successCount"] as number) : null;
      proposed.push({
        kind: "validation-profile",
        candidateId,
        title:
          typeof meta["command"] === "string" ? `${meta["kind"] ?? "validation"}: ${meta["command"]}` : candidateId,
        rationale: proposalRationale(meta),
        currentScore: successCount,
        threshold: DEFAULT_VALIDATION_AUTO_PROMOTION_THRESHOLD,
      });
    } else if (event.eventType === "repo-intelligence-candidates-observed") {
      // The observed-event's metadata.entryIds[] each map to a separate proposal entry.
      const entryIds = Array.isArray(meta["entryIds"]) ? (meta["entryIds"] as string[]) : [];
      // Repo-intelligence promotion threshold varies by type (briefing/example/pitfall).
      // The observed event doesn't carry the type per entry, so default to the example
      // bucket — the most common shape the learner emits.
      const threshold = DEFAULT_PROMOTION_THRESHOLDS.example;
      for (const entryId of entryIds) {
        if (autoPromotedIds.has(entryId)) continue;
        proposed.push({
          kind: "repo-intelligence-example",
          candidateId: entryId,
          title: `Observed pattern from ${run.ticketId}`,
          rationale: "1 confirming mission so far",
          currentScore: 1,
          threshold,
        });
      }
    }
  }

  const bootstrapProfile = projectHasRepoProfile ? null : buildBootstrapProfileDraft(run, events);
  const bootstrapValidationProfiles =
    bootstrapProfile === null && projectHasValidationProfiles
      ? []
      : buildBootstrapValidationDrafts(run, events);

  return {
    runId: run.runId,
    autoPromoted: autoPromoted.sort((left, right) => right.occurredAt - left.occurredAt),
    proposed,
    bootstrapProfile,
    bootstrapValidationProfiles,
  };
};

/**
 * Convenience wrapper that pulls events + project-state from the memory DB. The TicketRun
 * service uses this directly; tests can call `assembleMissionLearningSummary` with a stub.
 */
export const buildMissionLearningSummaryFromDb = (
  memoryDb: SpiraMemoryDatabase,
  run: TicketRunSummary,
): MissionLearningSummary => {
  const events = memoryDb.listMissionEvents(run.runId, 500);
  const projectKey = run.projectKey?.trim();
  let projectHasRepoProfile = false;
  let projectHasValidationProfiles = false;
  if (projectKey) {
    try {
      projectHasRepoProfile = memoryDb.listRepoProfiles({ projectKey, limit: 1 }).length > 0;
      projectHasValidationProfiles = memoryDb.listValidationProfiles({ projectKey, limit: 1 }).length > 0;
    } catch {
      // Best-effort; default to false (drafts surface) on any read failure.
    }
  }
  return assembleMissionLearningSummary({
    run,
    events,
    projectHasRepoProfile,
    projectHasValidationProfiles,
  });
};
