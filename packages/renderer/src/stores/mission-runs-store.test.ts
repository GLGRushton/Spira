import type { TicketRunSnapshot, TicketRunSummary } from "@spira/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { useMissionRunsStore } from "./mission-runs-store.js";

const createRun = (overrides: Partial<TicketRunSummary> = {}): TicketRunSummary => ({
  runId: overrides.runId ?? "run-1",
  stationId: overrides.stationId ?? "mission:run-1",
  ticketId: overrides.ticketId ?? "SPI-1",
  ticketSummary: overrides.ticketSummary ?? "Sample ticket",
  ticketUrl: overrides.ticketUrl ?? "https://example.test/issue/SPI-1",
  projectKey: overrides.projectKey ?? "SPI",
  status: overrides.status ?? "ready",
  statusMessage: overrides.statusMessage ?? null,
  commitMessageDraft: overrides.commitMessageDraft ?? null,
  missionPhase: overrides.missionPhase ?? "classification",
  missionPhaseUpdatedAt: overrides.missionPhaseUpdatedAt ?? 1_000,
  classification: overrides.classification ?? null,
  plan: overrides.plan ?? null,
  proofStrategy: overrides.proofStrategy ?? null,
  missionSummary: overrides.missionSummary ?? null,
  proof: overrides.proof ?? {
    status: "not-run",
    lastProofAt: null,
    lastProofRunId: null,
    lastProofProfileId: null,
    lastProofSummary: null,
    staleReason: null,
    manualReviewJustification: null,
    manualReviewAt: null,
  },
  proofRuns: overrides.proofRuns ?? [],
  worktrees: overrides.worktrees ?? [],
  submodules: overrides.submodules ?? [],
  attempts: overrides.attempts ?? [],
  validations: overrides.validations ?? [],
  previousPassContext: overrides.previousPassContext ?? null,
  createdAt: overrides.createdAt ?? 1_000,
  updatedAt: overrides.updatedAt ?? 1_000,
  startedAt: overrides.startedAt ?? 1_000,
});

const createSnapshot = (runs: TicketRunSummary[]): TicketRunSnapshot => ({ runs });

const resetStore = (): void => {
  useMissionRunsStore.setState({
    snapshot: { runs: [] },
    isLoading: false,
    error: null,
    hasLoaded: false,
  });
};

describe("mission-runs-store delta channel (Phase 0.3)", () => {
  beforeEach(() => {
    resetStore();
  });

  it("setSnapshot replaces the entire snapshot (cold path)", () => {
    useMissionRunsStore.getState().setSnapshot(createSnapshot([createRun({ runId: "run-a" })]));
    expect(useMissionRunsStore.getState().snapshot.runs.map((run) => run.runId)).toEqual(["run-a"]);
    useMissionRunsStore.getState().setSnapshot(createSnapshot([createRun({ runId: "run-b" })]));
    expect(useMissionRunsStore.getState().snapshot.runs.map((run) => run.runId)).toEqual(["run-b"]);
  });

  it("setRun updates a single run in place without disturbing the others", () => {
    useMissionRunsStore.getState().setSnapshot(
      createSnapshot([
        createRun({ runId: "run-a", missionPhase: "classification" }),
        createRun({ runId: "run-b", missionPhase: "implement" }),
      ]),
    );

    useMissionRunsStore
      .getState()
      .setRun(createRun({ runId: "run-a", missionPhase: "validate", status: "working" }));

    const runs = useMissionRunsStore.getState().snapshot.runs;
    expect(runs.map((run) => run.runId)).toEqual(["run-a", "run-b"]);
    const updatedA = runs.find((run) => run.runId === "run-a");
    const untouchedB = runs.find((run) => run.runId === "run-b");
    expect(updatedA?.missionPhase).toBe("validate");
    expect(updatedA?.status).toBe("working");
    expect(untouchedB?.missionPhase).toBe("implement");
  });

  it("setRun appends if the run is missing from the snapshot (no full replay needed)", () => {
    useMissionRunsStore.getState().setSnapshot(createSnapshot([createRun({ runId: "run-a" })]));
    useMissionRunsStore.getState().setRun(createRun({ runId: "run-c" }));
    expect(useMissionRunsStore.getState().snapshot.runs.map((run) => run.runId)).toEqual(["run-a", "run-c"]);
  });

  it("delta sequence converges with a cold snapshot replay", () => {
    // Apply a series of deltas, then replay the equivalent cold snapshot — final state should match.
    const cold = createSnapshot([
      createRun({ runId: "run-1", missionPhase: "validate" }),
      createRun({ runId: "run-2", missionPhase: "summarize" }),
    ]);

    useMissionRunsStore.getState().setSnapshot(createSnapshot([createRun({ runId: "run-1" })]));
    useMissionRunsStore.getState().setRun(createRun({ runId: "run-2" }));
    useMissionRunsStore.getState().setRun(createRun({ runId: "run-1", missionPhase: "validate" }));
    useMissionRunsStore.getState().setRun(createRun({ runId: "run-2", missionPhase: "summarize" }));

    const fromDeltas = useMissionRunsStore.getState().snapshot.runs;
    expect(fromDeltas.map((run) => `${run.runId}:${run.missionPhase}`)).toEqual(
      cold.runs.map((run) => `${run.runId}:${run.missionPhase}`),
    );
  });
});
