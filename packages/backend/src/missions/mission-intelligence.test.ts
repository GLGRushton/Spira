import { describe, expect, it } from "vitest";
import type { TicketRunSummary } from "@spira/shared";
import {
  buildLearnedRepoIntelligenceCandidates,
  toPersistedProofDecisionInput,
} from "./mission-intelligence.js";

const createRun = (): TicketRunSummary => ({
  runId: "run-1",
  stationId: "mission:run-1",
  ticketId: "SPI-101",
  ticketSummary: "Update mission surfaces",
  ticketUrl: "https://example.test/issue/SPI-101",
  projectKey: "SPI",
  status: "done",
  statusMessage: null,
  commitMessageDraft: null,
  createdAt: 1,
  updatedAt: 1,
  startedAt: 1,
  worktrees: [
    {
      repoRelativePath: ".",
      repoAbsolutePath: "C:\\Repos\\spira",
      worktreePath: "C:\\Repos\\.spira-worktrees\\spi-101",
      branchName: "feat/spi-101",
      cleanupState: "retained",
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  submodules: [],
  attempts: [
    {
      attemptId: "attempt-1",
      runId: "run-1",
      subagentRunId: null,
      sequence: 1,
      status: "running",
      prompt: null,
      summary: null,
      followupNeeded: false,
      startedAt: 1,
      completedAt: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  missionPhase: "validate",
  missionPhaseUpdatedAt: 1,
  classification: {
    kind: "ui",
    scopeSummary: "Update mission surfaces",
    acceptanceCriteria: [],
    impactedRepoRelativePaths: ["packages/backend"],
    risks: [],
    uiChange: true,
    proofRequired: true,
    proofArtifactMode: "screenshot",
    rationale: null,
    createdAt: 1,
    updatedAt: 1,
  },
  plan: {
    steps: ["Update mission UI"],
    touchedRepoRelativePaths: ["packages/renderer"],
    validationPlan: ["pnpm test"],
    proofIntent: "Capture proof",
    blockers: [],
    assumptions: [],
    createdAt: 1,
    updatedAt: 1,
  },
  validations: [
    {
      validationId: "validation-1",
      runId: "run-1",
      kind: "unit-test",
      command: "pnpm test",
      cwd: ".",
      status: "passed",
      summary: "Tests passed.",
      artifacts: [],
      startedAt: 1,
      completedAt: 2,
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  proofStrategy: {
    runId: "run-1",
    adapterId: "playwright",
    repoRelativePath: "packages/renderer",
    scenarioPath: null,
    scenarioName: null,
    command: "pnpm exec playwright test",
    artifactMode: "screenshot",
    rationale: "UI proof required.",
    metadata: null,
    createdAt: 1,
    updatedAt: 1,
  },
  missionSummary: {
    completedWork: "Updated workflow surfaces.",
    changedRepoRelativePaths: ["packages/backend", "apps/web-admin", "apps/web/admin"],
    validationSummary: "Tests passed.",
    proofSummary: "Screenshots captured.",
    openQuestions: [],
    followUps: [],
    createdAt: 2,
    updatedAt: 2,
  },
  previousPassContext: null,
  proof: {
    status: "passed",
    lastProofRunId: "proof-1",
    lastProofProfileId: "profile-1",
    lastProofAt: 2,
    lastProofSummary: "Proof passed.",
    staleReason: null,
  },
  proofRuns: [],
});

describe("mission-intelligence", () => {
  it("uses collision-safe learned repo-intelligence ids", () => {
    const run = createRun();

    const candidates = buildLearnedRepoIntelligenceCandidates(run);
    const targetIds = candidates
      .filter((candidate) => candidate.repoRelativePath === "apps/web-admin" || candidate.repoRelativePath === "apps/web/admin")
      .map((candidate) => candidate.id);

    expect(targetIds).toHaveLength(2);
    expect(new Set(targetIds).size).toBe(2);
  });

  it("persists expanded mission scope paths for advisory proof decisions", () => {
    const run = createRun();

    const persisted = toPersistedProofDecisionInput(
      run,
      {
        recommendedLevel: "manual-review-only",
        preflightStatus: "degraded",
        rationale: "Use manual review.",
        evidence: ["proof-rule:rule-1"],
      },
      run.classification,
    );

    expect(persisted.repoRelativePaths).toEqual(
      expect.arrayContaining([".", "packages/backend", "packages/renderer", "apps/web-admin", "apps/web/admin"]),
    );
  });
});
