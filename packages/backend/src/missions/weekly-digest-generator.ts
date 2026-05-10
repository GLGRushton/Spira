import type { MissionEventRecord, RepoIntelligenceRecord } from "@spira/memory-db";
import type { TicketRunSummary } from "@spira/shared";
import { classifyMissionOutcome, type MissionOutcomeKind } from "./mission-outcome.js";
import { computePhaseTotalsFromEvents } from "./phase-budget.js";
import { formatDurationMs } from "./post-mortem-generator.js";

/**
 * Phase 5.3 — cross-mission weekly digest.
 *
 * Pure markdown generator that takes a slice of closed runs + their mission events and
 * produces a roll-up: top-N longest phases, top-N most common preflight blockers, top-N
 * proof recipes that failed, top-N learned candidates pending approval, and the outcome
 * distribution. The generator is deterministic for testing — caller picks the time window
 * and provides "now" for the header.
 *
 * Cron wiring is intentionally out of scope here; the generator is invoked on demand from
 * the operator-facing trigger (admin pane button or CLI). The cost of a "weekly cron" is a
 * persistence layer (last-run timestamp, scheduling) that earns its weight only once an
 * operator asks for it.
 */

const TOP_N = 5;

export interface WeeklyDigestInput {
  /** Closed runs in the digest window (newest-first or any order — generator sorts itself). */
  runs: readonly TicketRunSummary[];
  /** All mission events across the digest's runs. */
  events: readonly MissionEventRecord[];
  /** Pending learned intelligence candidates (approved=false, source=learned). */
  pendingCandidates: readonly RepoIntelligenceRecord[];
  /** ms-since-epoch start of the digest window. */
  windowStartMs: number;
  /** ms-since-epoch end of the digest window. */
  windowEndMs: number;
  /** Override for the report header date. Defaults to windowEndMs. */
  generatedAt?: number;
}

export interface WeeklyDigestResult {
  filename: string;
  markdown: string;
}

const formatDate = (ms: number): string => new Date(ms).toISOString().split("T")[0]!;

const buildOutcomeDistribution = (runs: readonly TicketRunSummary[]): Map<MissionOutcomeKind | "unclassified", number> => {
  const counts = new Map<MissionOutcomeKind | "unclassified", number>();
  for (const run of runs) {
    const outcome = classifyMissionOutcome(run);
    const key: MissionOutcomeKind | "unclassified" = outcome ? outcome.kind : "unclassified";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

interface PhaseTimingEntry {
  runId: string;
  ticketId: string;
  phase: string;
  durationMs: number;
}

const computeLongestPhases = (
  runs: readonly TicketRunSummary[],
  events: readonly MissionEventRecord[],
): PhaseTimingEntry[] => {
  const eventsByRun = new Map<string, MissionEventRecord[]>();
  for (const event of events) {
    const bucket = eventsByRun.get(event.runId);
    if (bucket) bucket.push(event);
    else eventsByRun.set(event.runId, [event]);
  }

  const entries: PhaseTimingEntry[] = [];
  for (const run of runs) {
    const phaseTotals = computePhaseTotalsFromEvents(eventsByRun.get(run.runId) ?? []);
    for (const [phase, durationMs] of phaseTotals) {
      entries.push({ runId: run.runId, ticketId: run.ticketId, phase, durationMs });
    }
  }
  return entries.sort((left, right) => right.durationMs - left.durationMs).slice(0, TOP_N);
};

const computeFrequencyTable = (
  events: readonly MissionEventRecord[],
  predicate: (event: MissionEventRecord) => string | null,
): Array<{ key: string; count: number }> => {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = predicate(event);
    if (key === null) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
    .slice(0, TOP_N);
};

export const buildWeeklyDigestFilename = (windowEndMs: number): string =>
  `weekly-mission-digest-${formatDate(windowEndMs)}.md`;

export const generateWeeklyDigest = (input: WeeklyDigestInput): WeeklyDigestResult => {
  const generatedAt = input.generatedAt ?? input.windowEndMs;
  const closedInWindow = input.runs.filter(
    (run) => run.status === "done" && run.updatedAt >= input.windowStartMs && run.updatedAt <= input.windowEndMs,
  );

  const lines: string[] = [];
  lines.push(`# Weekly mission digest — ${formatDate(generatedAt)}`);
  lines.push("");
  lines.push(`Window: ${formatDate(input.windowStartMs)} to ${formatDate(input.windowEndMs)} (UTC)`);
  lines.push(`Closed missions in window: **${closedInWindow.length}**`);
  lines.push("");

  // Outcome distribution
  lines.push("## Outcome distribution");
  if (closedInWindow.length === 0) {
    lines.push("No closed missions to classify.");
  } else {
    const distribution = buildOutcomeDistribution(closedInWindow);
    for (const [outcome, count] of [...distribution.entries()].sort((left, right) => right[1] - left[1])) {
      lines.push(`- **${outcome}** — ${count}`);
    }
  }
  lines.push("");

  // Top longest phases
  lines.push(`## Top ${TOP_N} longest phases`);
  const longestPhases = computeLongestPhases(closedInWindow, input.events);
  if (longestPhases.length === 0) {
    lines.push("No phase timing data available.");
  } else {
    lines.push("| Ticket | Phase | Duration |");
    lines.push("| --- | --- | ---: |");
    for (const entry of longestPhases) {
      lines.push(`| ${entry.ticketId} | ${entry.phase} | ${formatDurationMs(entry.durationMs)} |`);
    }
  }
  lines.push("");

  // Top preflight blockers
  lines.push(`## Top ${TOP_N} preflight blocker reasons`);
  const blockerSummaries = computeFrequencyTable(input.events, (event) => {
    if (event.eventType !== "proof-preflight-finished") return null;
    const metadata = event.metadata as { ok?: unknown; summary?: unknown };
    if (metadata.ok !== false) return null;
    const summary = typeof metadata.summary === "string" ? metadata.summary.trim() : "";
    return summary.length > 0 ? summary : null;
  });
  if (blockerSummaries.length === 0) {
    lines.push("No preflight blockers in window.");
  } else {
    for (const entry of blockerSummaries) {
      lines.push(`- **${entry.count}×** ${entry.key}`);
    }
  }
  lines.push("");

  // Top failed proof recipes
  lines.push(`## Top ${TOP_N} failed proof recipes`);
  const failedProofs = computeFrequencyTable(input.events, (event) => {
    if (event.eventType !== "proof-finished") return null;
    const metadata = event.metadata as { status?: unknown; profileId?: unknown };
    if (metadata.status !== "failed") return null;
    return typeof metadata.profileId === "string" ? metadata.profileId : null;
  });
  if (failedProofs.length === 0) {
    lines.push("No failed proof runs in window.");
  } else {
    for (const entry of failedProofs) {
      lines.push(`- **${entry.count}×** ${entry.key}`);
    }
  }
  lines.push("");

  // Pending learned candidates
  lines.push(`## Top ${TOP_N} learned candidates pending approval`);
  if (input.pendingCandidates.length === 0) {
    lines.push("No learned candidates currently pending approval.");
  } else {
    const sorted = [...input.pendingCandidates]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, TOP_N);
    lines.push("| Type | Project | Repo | Title |");
    lines.push("| --- | --- | --- | --- |");
    for (const candidate of sorted) {
      lines.push(
        `| ${candidate.type} | ${candidate.projectKey ?? "(any)"} | ${candidate.repoRelativePath ?? "(any)"} | ${candidate.title} |`,
      );
    }
  }
  lines.push("");

  return { filename: buildWeeklyDigestFilename(input.windowEndMs), markdown: lines.join("\n") };
};
