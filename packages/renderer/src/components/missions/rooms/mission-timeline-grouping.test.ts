import type { TicketRunMissionEventSummary } from "@spira/shared";
import { describe, expect, it } from "vitest";
import {
  formatTimelineDuration,
  groupMissionTimelineEvents,
  mergeMissionEventStreams,
} from "./mission-timeline-grouping.js";

const evt = (
  id: number,
  stage: TicketRunMissionEventSummary["stage"],
  eventType: string,
  occurredAt: number,
): TicketRunMissionEventSummary => ({
  id,
  runId: "run-1",
  attemptId: null,
  stage,
  eventType,
  metadata: null,
  occurredAt,
});

describe("groupMissionTimelineEvents", () => {
  it("returns groups in workflow order regardless of input order", () => {
    const events: TicketRunMissionEventSummary[] = [
      evt(1, "proof", "proof-finished", 5_000),
      evt(2, "system", "workspace-prepared", 1_000),
      evt(3, "classification", "context-loaded", 2_000),
      evt(4, "implement", "attempt-started", 3_000),
    ];
    const groups = groupMissionTimelineEvents(events);
    expect(groups.map((group) => group.stage)).toEqual(["system", "classification", "implement", "proof"]);
  });

  it("computes duration from earliest to latest event in a group", () => {
    const events: TicketRunMissionEventSummary[] = [
      evt(1, "implement", "attempt-started", 1_000),
      evt(2, "implement", "attempt-action", 1_500),
      evt(3, "implement", "attempt-finished", 4_500),
    ];
    const [group] = groupMissionTimelineEvents(events);
    expect(group?.startedAt).toBe(1_000);
    expect(group?.endedAt).toBe(4_500);
    expect(group?.durationMs).toBe(3_500);
  });

  it("dedupes by event id when called twice with overlapping streams", () => {
    const event = evt(7, "validate", "validation-recorded", 9_000);
    const groups = groupMissionTimelineEvents([event, event]);
    expect(groups[0]?.events).toHaveLength(1);
  });

  it("omits empty groups", () => {
    expect(groupMissionTimelineEvents([])).toEqual([]);
  });
});

describe("mergeMissionEventStreams", () => {
  it("merges two streams newest-first with id-based dedup", () => {
    const cold = [evt(1, "implement", "attempt-started", 1_000), evt(2, "implement", "attempt-finished", 5_000)];
    const live = [evt(2, "implement", "attempt-finished", 5_000), evt(3, "implement", "attempt-action", 6_000)];
    const merged = mergeMissionEventStreams(cold, live);
    expect(merged.map((event) => event.id)).toEqual([3, 2, 1]);
  });
});

describe("formatTimelineDuration", () => {
  it.each([
    [500, "<1s"],
    [4_000, "4s"],
    [60_000, "1m"],
    [125_000, "2m 5s"],
    [3_600_000, "1h"],
    [3_900_000, "1h 5m"],
  ])("formats %d ms as %s", (ms, expected) => {
    expect(formatTimelineDuration(ms)).toBe(expected);
  });
});
