import { describe, expect, it } from "vitest";
import type { TicketRunSummary } from "./ticket-run-types.js";
import { getEffectiveValidations, getTicketRunMissionWorkflowState } from "./ticket-run-workflow.js";

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
  missionPhase: "validate",
  missionPhaseUpdatedAt: 20,
  classification: {
    kind: "backend",
    scopeSummary: "Fix mission workflow",
    acceptanceCriteria: [],
    impactedRepoRelativePaths: ["packages/backend"],
    risks: [],
    uiChange: false,
    proofRequired: false,
    proofArtifactMode: "none",
    rationale: null,
    createdAt: 21,
    updatedAt: 21,
  },
  plan: {
    steps: ["Update workflow semantics."],
    touchedRepoRelativePaths: ["packages/backend"],
    validationPlan: ["pnpm test"],
    proofIntent: null,
    blockers: [],
    assumptions: [],
    createdAt: 22,
    updatedAt: 22,
  },
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
    status: "not-run",
    lastProofRunId: null,
    lastProofProfileId: null,
    lastProofAt: null,
    lastProofSummary: null,
    staleReason: null,
    manualReviewJustification: null,
    manualReviewAt: null,
  },
  proofRuns: [],
});

describe("getEffectiveValidations", () => {
  it("drops validations explicitly superseded by a later record", () => {
    const run = createRun();
    run.validations = [
      {
        runId: "run-1",
        validationId: "validation-older",
        kind: "unit-test",
        command: "pnpm test",
        cwd: "C:\\GitHub\\Spira\\packages\\backend",
        status: "failed",
        summary: "Initial run failed.",
        artifacts: [],
        startedAt: 21,
        completedAt: 22,
        createdAt: 21,
        updatedAt: 22,
      },
      {
        runId: "run-1",
        validationId: "validation-newer",
        kind: "unit-test",
        command: "pnpm test",
        cwd: "C:\\GitHub\\Spira",
        supersedesValidationIds: ["validation-older"],
        status: "passed",
        summary: "Rerun passed.",
        artifacts: [],
        startedAt: 25,
        completedAt: 26,
        createdAt: 25,
        updatedAt: 26,
      },
      {
        runId: "run-1",
        validationId: "validation-lint",
        kind: "lint",
        command: "pnpm lint",
        cwd: "C:\\GitHub\\Spira",
        status: "passed",
        summary: "Lint passed.",
        artifacts: [],
        startedAt: 27,
        completedAt: 28,
        createdAt: 27,
        updatedAt: 28,
      },
    ];

    expect(getEffectiveValidations(run.validations).map((validation) => validation.validationId)).toEqual([
      "validation-lint",
      "validation-newer",
    ]);
  });

  it("keeps distinct validations independent without explicit supersession", () => {
    const run = createRun();
    run.validations = [
      {
        runId: "run-1",
        validationId: "validation-test",
        kind: "unit-test",
        command: "pnpm test",
        cwd: "C:\\GitHub\\Spira",
        status: "passed",
        summary: "Tests passed.",
        artifacts: [],
        startedAt: 21,
        completedAt: 22,
        createdAt: 21,
        updatedAt: 22,
      },
      {
        runId: "run-1",
        validationId: "validation-other-directory",
        kind: "unit-test",
        command: "pnpm test",
        cwd: "C:\\GitHub\\Spira\\packages\\renderer",
        status: "failed",
        summary: "Renderer tests failed.",
        artifacts: [],
        startedAt: 23,
        completedAt: 24,
        createdAt: 23,
        updatedAt: 24,
      },
    ];

    expect(getEffectiveValidations(run.validations).map((validation) => validation.validationId)).toEqual([
      "validation-other-directory",
      "validation-test",
    ]);
  });
});

describe("getTicketRunMissionWorkflowState", () => {
  it("treats a later passing rerun as clearing an older failure", () => {
    const run = createRun();
    run.validations = [
      {
        runId: "run-1",
        validationId: "validation-older",
        kind: "unit-test",
        command: "pnpm test",
        cwd: "C:\\GitHub\\Spira\\packages\\backend",
        status: "failed",
        summary: "Initial run failed.",
        artifacts: [],
        startedAt: 21,
        completedAt: 22,
        createdAt: 21,
        updatedAt: 22,
      },
      {
        runId: "run-1",
        validationId: "validation-newer",
        kind: "unit-test",
        command: "pnpm test",
        cwd: "C:\\GitHub\\Spira",
        supersedesValidationIds: ["validation-older"],
        status: "passed",
        summary: "Rerun passed.",
        artifacts: [],
        startedAt: 25,
        completedAt: 26,
        createdAt: 25,
        updatedAt: 26,
      },
    ];

    const state = getTicketRunMissionWorkflowState(run);

    expect(state.hasPassingValidation).toBe(true);
    expect(state.hasFailingValidation).toBe(false);
    expect(state.hasPendingValidation).toBe(false);
    expect(state.nextAction).toBe("save-summary");
  });

  it("still blocks when the latest validation result is failing", () => {
    const run = createRun();
    run.validations = [
      {
        runId: "run-1",
        validationId: "validation-older",
        kind: "unit-test",
        command: "pnpm test",
        cwd: "C:\\GitHub\\Spira",
        status: "passed",
        summary: "Initial run passed.",
        artifacts: [],
        startedAt: 21,
        completedAt: 22,
        createdAt: 21,
        updatedAt: 22,
      },
      {
        runId: "run-1",
        validationId: "validation-newer",
        kind: "unit-test",
        command: "pnpm test",
        cwd: "C:\\GitHub\\Spira\\packages\\backend",
        status: "failed",
        summary: "Regression failed.",
        artifacts: [],
        startedAt: 25,
        completedAt: 26,
        createdAt: 25,
        updatedAt: 26,
      },
    ];

    const state = getTicketRunMissionWorkflowState(run);

    expect(state.hasPassingValidation).toBe(true);
    expect(state.hasFailingValidation).toBe(true);
    expect(state.nextAction).toBe("record-validation");
    expect(state.waitReason).toBe("validation-failed");
  });
});
