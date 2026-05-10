import type { TicketRunSummary } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { reconcileMissionDisplayState } from "./mission-state-reconciler.js";

const baseRun = (overrides: Partial<TicketRunSummary> = {}): TicketRunSummary => ({
  runId: "run-1",
  stationId: null,
  ticketId: "SPI-1",
  ticketSummary: "Reconcile me",
  ticketUrl: "https://example.test/SPI-1",
  projectKey: "SPI",
  status: "done",
  statusMessage: null,
  commitMessageDraft: null,
  createdAt: 1_000,
  updatedAt: 5_000,
  startedAt: 1_000,
  worktrees: [],
  submodules: [],
  attempts: [],
  missionPhase: "summarize",
  missionPhaseUpdatedAt: 4_500,
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
  ...overrides,
});

describe("reconcileMissionDisplayState (Phase 6.2)", () => {
  it("returns no patches when state is already canonical", () => {
    const result = reconcileMissionDisplayState(baseRun());
    expect(result.patches).toEqual([]);
    expect(result.run).toEqual(baseRun());
  });

  it("clears proof.staleReason when proof.status moved off 'stale'", () => {
    const result = reconcileMissionDisplayState(
      baseRun({
        proof: {
          ...baseRun().proof,
          status: "passed",
          staleReason: "validations re-ran since the last proof",
        },
      }),
    );
    expect(result.patches).toHaveLength(1);
    expect(result.patches[0]).toMatchObject({ field: "proof.staleReason", nextValue: "null" });
    expect(result.run.proof.staleReason).toBeNull();
  });

  it("rewrites a stale 'working...' statusMessage on a closed run", () => {
    const result = reconcileMissionDisplayState(
      baseRun({
        status: "done",
        statusMessage: "Working on the implementation pass",
      }),
    );
    expect(result.patches.some((patch) => patch.field === "statusMessage")).toBe(true);
    expect(result.run.statusMessage).toBe("Mission closed.");
  });

  it("does NOT widen the gate when proof.status is 'failed' (real contradiction left for the workflow guard)", () => {
    const result = reconcileMissionDisplayState(
      baseRun({
        status: "done",
        proof: { ...baseRun().proof, status: "failed", staleReason: "noisy" },
      }),
    );
    // staleReason still gets cleared (proof.status isn't "stale" or "not-run") but no
    // statusMessage rewrite (statusMessage is null on the fixture).
    expect(result.patches.some((patch) => patch.field === "statusMessage")).toBe(false);
  });
});
