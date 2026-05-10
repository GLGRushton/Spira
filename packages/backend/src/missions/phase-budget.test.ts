import type { MissionEventRecord } from "@spira/memory-db";
import type { TicketRunSummary } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { computePhaseBudget } from "./phase-budget.js";

const closedRun = (runId: string, updatedAt: number, projectKey = "SPI"): TicketRunSummary => ({
  runId,
  stationId: null,
  ticketId: `SPI-${runId}`,
  ticketSummary: "x",
  ticketUrl: `https://example.test/${runId}`,
  projectKey,
  status: "done",
  statusMessage: null,
  commitMessageDraft: null,
  createdAt: updatedAt - 60_000,
  updatedAt,
  startedAt: updatedAt - 60_000,
  worktrees: [],
  submodules: [],
  attempts: [],
  missionPhase: "summarize",
  missionPhaseUpdatedAt: updatedAt - 1_000,
  classification: null,
  plan: null,
  validations: [],
  proofStrategy: null,
  missionSummary: null,
  previousPassContext: null,
  proof: {
    status: "passed",
    lastProofAt: null,
    lastProofRunId: null,
    lastProofProfileId: null,
    lastProofSummary: null,
    staleReason: null,
    manualReviewJustification: null,
    manualReviewAt: null,
  },
  proofRuns: [],
});

const event = (
  id: number,
  runId: string,
  stage: MissionEventRecord["stage"],
  occurredAt: number,
): MissionEventRecord => ({
  id,
  runId,
  attemptId: null,
  stage,
  eventType: "validation-recorded",
  metadata: null,
  occurredAt,
});

describe("computePhaseBudget (Phase 6.4)", () => {
  it("returns no entries when fewer than minSamples runs available", () => {
    const result = computePhaseBudget({
      projectKey: "SPI",
      runs: [closedRun("run-1", 1_000), closedRun("run-2", 2_000)],
      events: [],
      minSamples: 3,
    });
    expect(result.entries).toEqual([]);
  });

  it("computes per-phase median + p25/p75 across recent runs", () => {
    const runs = [closedRun("run-1", 1_000_000), closedRun("run-2", 2_000_000), closedRun("run-3", 3_000_000)];
    // Each run: implement 60_000 ms, validate 30_000 ms (different baselines per run).
    const events: MissionEventRecord[] = [];
    for (const run of runs) {
      const offset = run.updatedAt - 100_000;
      events.push(event(events.length + 1, run.runId, "implement", offset));
      // implement → validate transition after 60s
      events.push(event(events.length + 1, run.runId, "validate", offset + 60_000));
      // validate → summarize transition after 30s
      events.push(event(events.length + 1, run.runId, "summarize", offset + 90_000));
    }
    const result = computePhaseBudget({
      projectKey: "SPI",
      runs,
      events,
      minSamples: 3,
    });
    const implement = result.entries.find((entry) => entry.phase === "implement");
    expect(implement).toBeDefined();
    expect(implement?.medianMs).toBe(60_000);
    expect(implement?.sampleCount).toBe(3);
    const validate = result.entries.find((entry) => entry.phase === "validate");
    expect(validate?.medianMs).toBe(30_000);
  });

  it("ignores runs from other projects", () => {
    const runs = [
      closedRun("run-1", 1_000, "SPI"),
      closedRun("run-2", 2_000, "OTHER"),
      closedRun("run-3", 3_000, "SPI"),
      closedRun("run-4", 4_000, "OTHER"),
    ];
    const result = computePhaseBudget({
      projectKey: "SPI",
      runs,
      events: [],
      minSamples: 3,
    });
    expect(result.entries).toEqual([]); // only 2 SPI runs, below min
  });

  it("ignores non-done runs", () => {
    const open: TicketRunSummary = { ...closedRun("run-open", 1_000), status: "working" };
    const result = computePhaseBudget({
      projectKey: "SPI",
      runs: [open, closedRun("run-1", 2_000), closedRun("run-2", 3_000)],
      events: [],
      minSamples: 3,
    });
    expect(result.entries).toEqual([]); // only 2 done runs
  });
});
