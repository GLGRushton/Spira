import type { MissionEventRecord } from "@spira/memory-db";
import type { TicketRunMissionPhase, TicketRunSummary } from "@spira/shared";
import { percentile } from "../util/stats.js";

/**
 * per-(projectKey, phase) duration hints.
 *
 * Pure computer that takes recent closed runs plus their `mission_events` and produces
 * a "typical duration" envelope per phase. The envelope is the rolling median + the
 * 25th and 75th percentiles across the most recent N runs. The renderer surfaces the
 * envelope as soft guidance ("Implement · 14:32 elapsed · typical 12-25 min"); never
 * blocking, never gating.
 *
 * Behaviour:
 *  - Only `done` runs contribute (aborted runs are noisy; in-flight runs are obviously
 *    not a budget input).
 *  - At least 3 contributing runs required before a hint is surfaced.
 *  - "phase duration" is the time spent with that phase as the most-recent
 *    `mission_phase` in the timeline — derived from event order, not stored.
 */

export const DEFAULT_BUDGET_SAMPLE_SIZE = 10;
export const DEFAULT_BUDGET_MIN_SAMPLES = 3;

export interface PhaseBudgetEntry {
  phase: TicketRunMissionPhase;
  /** Number of closed runs contributing to this hint. */
  sampleCount: number;
  /** Lower percentile (~p25) duration in ms. */
  lowMs: number;
  /** Median duration in ms. */
  medianMs: number;
  /** Upper percentile (~p75) duration in ms. */
  highMs: number;
}

export interface PhaseBudgetSnapshot {
  projectKey: string;
  entries: PhaseBudgetEntry[];
}

const PHASES: TicketRunMissionPhase[] = ["classification", "plan", "implement", "validate", "proof", "summarize"];

/**
 * Compute per-phase totals from a single run's mission events. The duration of phase
 * P in a run is the sum of (next.occurredAt − current.occurredAt) deltas across
 * adjacent events whose `stage` is P. System-stage events do not carry phase time.
 *
 * Pass `presorted: true` when the caller can guarantee `events` is already in
 * occurredAt-ascending order (e.g. straight from the DB) to skip the defensive sort.
 */
export const computePhaseTotalsFromEvents = (
  events: readonly MissionEventRecord[],
  options: { presorted?: boolean } = {},
): Map<string, number> => {
  const totals = new Map<string, number>();
  if (events.length < 2) return totals;
  const ordered = options.presorted
    ? events
    : [...events].sort((left, right) => left.occurredAt - right.occurredAt);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (previous.stage === "system") continue;
    const delta = current.occurredAt - previous.occurredAt;
    if (delta <= 0) continue;
    totals.set(previous.stage, (totals.get(previous.stage) ?? 0) + delta);
  }
  return totals;
};

export interface ComputePhaseBudgetInput {
  projectKey: string;
  /** Done runs in the project; the computer picks the most recent N. */
  runs: readonly TicketRunSummary[];
  /** Mission events for those runs (any order). */
  events: readonly MissionEventRecord[];
  sampleSize?: number;
  minSamples?: number;
}

/**
 * Build a per-phase budget envelope. Returns `entries: []` when fewer than minSamples
 * runs are available — caller treats that as "no hint yet."
 */
export const computePhaseBudget = (input: ComputePhaseBudgetInput): PhaseBudgetSnapshot => {
  const sampleSize = input.sampleSize ?? DEFAULT_BUDGET_SAMPLE_SIZE;
  const minSamples = input.minSamples ?? DEFAULT_BUDGET_MIN_SAMPLES;
  const closedRuns = input.runs
    .filter((run) => run.status === "done" && run.projectKey === input.projectKey)
    .sort((left, right) => (right.updatedAt ?? right.createdAt) - (left.updatedAt ?? left.createdAt))
    .slice(0, sampleSize);

  if (closedRuns.length < minSamples) {
    return { projectKey: input.projectKey, entries: [] };
  }

  const eventsByRun = new Map<string, MissionEventRecord[]>();
  for (const event of input.events) {
    const bucket = eventsByRun.get(event.runId);
    if (bucket) bucket.push(event);
    else eventsByRun.set(event.runId, [event]);
  }

  const samplesByPhase = new Map<TicketRunMissionPhase, number[]>();
  for (const run of closedRuns) {
    const totals = computePhaseTotalsFromEvents(eventsByRun.get(run.runId) ?? []);
    for (const [phase, durationMs] of totals) {
      const bucket = samplesByPhase.get(phase as TicketRunMissionPhase) ?? [];
      bucket.push(durationMs);
      samplesByPhase.set(phase as TicketRunMissionPhase, bucket);
    }
  }

  const entries: PhaseBudgetEntry[] = [];
  for (const phase of PHASES) {
    const samples = samplesByPhase.get(phase);
    if (!samples || samples.length < minSamples) continue;
    const sorted = [...samples].sort((left, right) => left - right);
    entries.push({
      phase,
      sampleCount: sorted.length,
      lowMs: percentile(sorted, 0.25),
      medianMs: percentile(sorted, 0.5),
      highMs: percentile(sorted, 0.75),
    });
  }
  return { projectKey: input.projectKey, entries };
};
