import type { TicketRunMissionValidationRecord, TicketRunSummary } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { classifyMissionOutcome, outcomeLearningWeight } from "./mission-outcome.js";

const baseRun = (overrides: Partial<TicketRunSummary> = {}): TicketRunSummary => ({
  runId: "run-1",
  stationId: null,
  ticketId: "SPI-1",
  ticketSummary: "Outcome",
  ticketUrl: "https://example.test/SPI-1",
  projectKey: "SPI",
  status: "done",
  statusMessage: null,
  commitMessageDraft: null,
  createdAt: 1_000,
  updatedAt: 2_000,
  startedAt: 1_000,
  worktrees: [],
  submodules: [],
  attempts: [],
  missionPhase: "summarize",
  missionPhaseUpdatedAt: 1_500,
  classification: {
    kind: "frontend",
    scopeSummary: "Patch button copy",
    acceptanceCriteria: [],
    impactedRepoRelativePaths: ["web"],
    risks: [],
    uiChange: true,
    proofRequired: false,
    proofArtifactMode: "none",
    rationale: null,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  plan: {
    steps: ["edit"],
    touchedRepoRelativePaths: ["web"],
    validationPlan: ["pnpm test"],
    proofIntent: null,
    blockers: [],
    assumptions: [],
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  validations: [],
  proofStrategy: null,
  missionSummary: {
    completedWork: "Renamed",
    changedRepoRelativePaths: ["web"],
    validationSummary: "passed",
    proofSummary: null,
    openQuestions: [],
    followUps: [],
    createdAt: 1_000,
    updatedAt: 1_000,
  },
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

const validation = (overrides: Partial<TicketRunMissionValidationRecord>): TicketRunMissionValidationRecord => ({
  validationId: "v-1",
  runId: "run-1",
  kind: "build",
  command: "pnpm build",
  cwd: "C:\\Repos\\web",
  status: "passed",
  summary: null,
  artifacts: [],
  startedAt: 1_000,
  completedAt: 1_500,
  createdAt: 1_000,
  updatedAt: 1_000,
  ...overrides,
});

describe("classifyMissionOutcome (Phase 5.1)", () => {
  it("returns null when the run is not closed", () => {
    expect(classifyMissionOutcome(baseRun({ status: "working" }))).toBeNull();
  });

  it("returns null when the run is missing classification or summary", () => {
    expect(classifyMissionOutcome(baseRun({ classification: null }))).toBeNull();
    expect(classifyMissionOutcome(baseRun({ missionSummary: null }))).toBeNull();
  });

  it("classifies clean-pass when validations passed first try and proof not required", () => {
    const result = classifyMissionOutcome(baseRun({
      validations: [validation({ validationId: "v-1", status: "passed" })],
    }));
    expect(result).toMatchObject({ kind: "clean-pass", retriedValidationKinds: [], usedManualReview: false });
  });

  it("classifies pass-with-friction when a validation kind was retried", () => {
    const result = classifyMissionOutcome(baseRun({
      validations: [
        validation({ validationId: "v-old", status: "failed" }),
        validation({
          validationId: "v-new",
          status: "passed",
          supersedesValidationIds: ["v-old"],
        }),
      ],
    }));
    expect(result?.kind).toBe("pass-with-friction");
    expect(result?.retriedValidationKinds).toEqual(["build"]);
  });

  it("classifies pass-with-friction when proof gate satisfied via manual review", () => {
    const run = baseRun({
      classification: {
        ...baseRun().classification!,
        proofRequired: true,
      },
      proof: {
        ...baseRun().proof,
        status: "manual-review",
        manualReviewJustification: "5-line copy edit",
        manualReviewAt: 1_900,
      },
      validations: [validation({ validationId: "v-1", status: "passed" })],
    });
    const result = classifyMissionOutcome(run);
    expect(result?.kind).toBe("pass-with-friction");
    expect(result?.usedManualReview).toBe(true);
  });

  it("classifies fail-with-recovery when both retry and manual review combined", () => {
    const run = baseRun({
      classification: {
        ...baseRun().classification!,
        proofRequired: true,
      },
      proof: {
        ...baseRun().proof,
        status: "manual-review",
        manualReviewJustification: "Recovered",
        manualReviewAt: 1_900,
      },
      validations: [
        validation({ validationId: "v-old", status: "failed" }),
        validation({
          validationId: "v-new",
          status: "passed",
          supersedesValidationIds: ["v-old"],
        }),
      ],
    });
    const result = classifyMissionOutcome(run);
    expect(result?.kind).toBe("fail-with-recovery");
  });

  it("classifies fail-final when an unrecovered validation failure remains", () => {
    const result = classifyMissionOutcome(baseRun({
      validations: [validation({ validationId: "v-1", status: "failed" })],
    }));
    expect(result?.kind).toBe("fail-final");
  });

  it("classifies fail-final when proof gate is unsatisfied", () => {
    const result = classifyMissionOutcome(baseRun({
      classification: { ...baseRun().classification!, proofRequired: true },
      proof: { ...baseRun().proof, status: "failed" },
      validations: [validation({ validationId: "v-1", status: "passed" })],
    }));
    expect(result?.kind).toBe("fail-final");
  });

  it("uses the documented learning weights", () => {
    expect(outcomeLearningWeight("clean-pass")).toBe(1);
    expect(outcomeLearningWeight("pass-with-friction")).toBe(0.5);
    expect(outcomeLearningWeight("fail-with-recovery")).toBe(0.25);
    expect(outcomeLearningWeight("fail-final")).toBe(-2);
  });
});
