import type { TicketRunSummary } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { describeMissionNextAction } from "./mission-display-utils.js";

const createRun = (): TicketRunSummary => ({
  runId: "run-1",
  stationId: "mission:run-1",
  ticketId: "SPI-101",
  ticketSummary: "Mission lifecycle",
  ticketUrl: "https://example.test/issue/SPI-101",
  projectKey: "SPI",
  status: "working",
  statusMessage: null,
  commitMessageDraft: null,
  missionPhase: "classification",
  missionPhaseUpdatedAt: 20,
  classification: null,
  plan: null,
  validations: [],
  proofStrategy: null,
  missionSummary: null,
  previousPassContext: null,
  createdAt: 1,
  updatedAt: 20,
  startedAt: 1,
  worktrees: [],
  submodules: [],
  attempts: [
    {
      attemptId: "attempt-1",
      sequence: 1,
      status: "completed",
      prompt: null,
      summary: "Previous pass completed.",
      followupNeeded: false,
      startedAt: 1,
      createdAt: 1,
      updatedAt: 10,
      completedAt: 10,
      runId: "run-1",
      subagentRunId: null,
    },
    {
      attemptId: "attempt-2",
      sequence: 2,
      status: "running",
      prompt: null,
      summary: null,
      followupNeeded: false,
      startedAt: 20,
      createdAt: 20,
      updatedAt: 20,
      completedAt: null,
      runId: "run-1",
      subagentRunId: null,
    },
  ],
  proof: {
    status: "stale",
    lastProofRunId: "proof-1",
    lastProofProfileId: "profile-1",
    lastProofAt: 10,
    lastProofSummary: "Previous proof passed.",
    staleReason: "A new pass started after the last proof run.",
  },
  proofRuns: [],
});

describe("describeMissionNextAction", () => {
  it("still requires context loading when only stale proof exists from a previous pass", () => {
    expect(describeMissionNextAction(createRun())).toEqual({
      label: "Load mission context",
      detail: "Shinra must call get_mission_context before doing real work.",
      complete: false,
    });
  });

  it("blocks completion while validation is pending", () => {
    const run = createRun();
    run.classification = {
      kind: "ui",
      scopeSummary: "Update the mission details room.",
      acceptanceCriteria: [],
      impactedRepoRelativePaths: ["packages/renderer"],
      risks: [],
      uiChange: true,
      proofRequired: true,
      proofArtifactMode: "screenshot",
      rationale: null,
      createdAt: 21,
      updatedAt: 21,
    };
    run.plan = {
      steps: ["Redesign the journey view."],
      touchedRepoRelativePaths: ["packages/renderer"],
      validationPlan: ["pnpm test"],
      proofIntent: "Capture the new journey flow.",
      blockers: [],
      assumptions: [],
      createdAt: 22,
      updatedAt: 22,
    };
    run.validations = [
      {
        runId: "run-1",
        validationId: "validation-1",
        kind: "unit-test",
        status: "pending",
        command: "pnpm test",
        cwd: "C:\\GitHub\\Spira",
        summary: null,
        artifacts: [],
        startedAt: 23,
        completedAt: null,
        createdAt: 23,
        updatedAt: 23,
      },
    ];

    expect(describeMissionNextAction(run)).toEqual({
      label: "Record validation",
      detail: "A validation is still pending, so the pass cannot finish yet.",
      complete: false,
    });
  });
});
