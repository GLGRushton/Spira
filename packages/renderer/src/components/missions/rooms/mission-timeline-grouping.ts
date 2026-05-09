import type { TicketRunMissionEventSummary, TicketRunMissionPhase } from "@spira/shared";

export type TimelineStage = TicketRunMissionPhase | "system";

export interface MissionTimelineGroup {
  stage: TimelineStage;
  events: TicketRunMissionEventSummary[];
  /** Earliest event timestamp in this group. */
  startedAt: number;
  /** Latest event timestamp in this group. */
  endedAt: number;
  /** endedAt - startedAt; minimum 0. */
  durationMs: number;
}

const STAGE_ORDER: TimelineStage[] = ["system", "classification", "plan", "implement", "validate", "proof", "summarize"];

const STAGE_INDEX: Record<TimelineStage, number> = STAGE_ORDER.reduce(
  (acc, stage, index) => ({ ...acc, [stage]: index }),
  {} as Record<TimelineStage, number>,
);

/**
 * Group mission events by phase (stage), preserving chronological order within each group.
 *
 * Returns groups in workflow order (system first, then classification → summarize). Empty
 * groups are omitted. The caller decides what to render for completed vs active groups.
 *
 * Live events from the per-run buffer (Phase 1.1) and the cold-fetched timeline can be merged
 * before passing in — duplicate IDs are deduplicated.
 */
export const groupMissionTimelineEvents = (
  events: readonly TicketRunMissionEventSummary[],
): MissionTimelineGroup[] => {
  const seenIds = new Set<number>();
  const byStage = new Map<TimelineStage, TicketRunMissionEventSummary[]>();

  for (const event of events) {
    if (seenIds.has(event.id)) {
      continue;
    }
    seenIds.add(event.id);
    const stage = (event.stage as TimelineStage) ?? "system";
    const bucket = byStage.get(stage) ?? [];
    bucket.push(event);
    byStage.set(stage, bucket);
  }

  const groups: MissionTimelineGroup[] = [];
  for (const [stage, bucket] of byStage) {
    const sorted = [...bucket].sort((left, right) => left.occurredAt - right.occurredAt);
    const startedAt = sorted[0]?.occurredAt ?? 0;
    const endedAt = sorted[sorted.length - 1]?.occurredAt ?? startedAt;
    groups.push({
      stage,
      events: sorted,
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
    });
  }

  return groups.sort(
    (left, right) =>
      (STAGE_INDEX[left.stage] ?? STAGE_ORDER.length) - (STAGE_INDEX[right.stage] ?? STAGE_ORDER.length) ||
      left.startedAt - right.startedAt,
  );
};

/**
 * Merge two streams of events (typically the cold-fetched mission timeline and the live event
 * buffer) into one deduplicated, newest-first list. The dedup key is the event id.
 */
export const mergeMissionEventStreams = (
  ...streams: readonly (readonly TicketRunMissionEventSummary[])[]
): TicketRunMissionEventSummary[] => {
  const byId = new Map<number, TicketRunMissionEventSummary>();
  for (const stream of streams) {
    for (const event of stream) {
      byId.set(event.id, event);
    }
  }
  return [...byId.values()].sort((left, right) => right.occurredAt - left.occurredAt);
};

export const formatTimelineDuration = (ms: number): string => {
  if (ms < 1_000) {
    return "<1s";
  }
  if (ms < 60_000) {
    return `${Math.round(ms / 1_000)}s`;
  }
  if (ms < 3_600_000) {
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.floor((ms % 60_000) / 1_000);
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
};
