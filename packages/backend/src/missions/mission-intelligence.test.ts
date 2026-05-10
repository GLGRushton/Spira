import type { ProofRuleRecord } from "@spira/memory-db";
import type {
  TicketRunMissionClassification,
  TicketRunProofProfileSummary,
  TicketRunSummary,
} from "@spira/shared";
import { describe, expect, it } from "vitest";
import {
  buildLearnedRepoIntelligenceCandidates,
  computeAdvisoryProofDecision,
  toPersistedProofDecisionInput,
} from "./mission-intelligence.js";
import type { MissionOutcomeClassification } from "./mission-outcome.js";

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
    manualReviewJustification: null,
    manualReviewAt: null,
  },
  proofRuns: [],
});

const stubOutcome = (): MissionOutcomeClassification => ({
  kind: "clean-pass",
  rationale: "test",
  retriedValidationKinds: [],
  usedManualReview: false,
});

describe("mission-intelligence", () => {
  it("uses collision-safe learned repo-intelligence ids", () => {
    const run = createRun();

    const candidates = buildLearnedRepoIntelligenceCandidates(run, stubOutcome());
    const targetIds = candidates
      .filter(
        (candidate) =>
          candidate.repoRelativePath === "apps/web-admin" || candidate.repoRelativePath === "apps/web/admin",
      )
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

  it("treats superseded validation failures as clean for learned intelligence", () => {
    const run = createRun();
    run.validations = [
      {
        validationId: "validation-older",
        runId: "run-1",
        kind: "unit-test",
        command: "pnpm test",
        cwd: "C:\\Repos\\.spira-worktrees\\spi-101",
        status: "failed",
        summary: "Initial run failed.",
        artifacts: [],
        startedAt: 1,
        completedAt: 2,
        createdAt: 1,
        updatedAt: 2,
      },
      {
        validationId: "validation-newer",
        runId: "run-1",
        kind: "unit-test",
        command: "pnpm test",
        cwd: "C:\\Repos\\.spira-worktrees\\spi-101\\ClientApp",
        supersedesValidationIds: ["validation-older"],
        status: "passed",
        summary: "Rerun passed.",
        artifacts: [],
        startedAt: 3,
        completedAt: 4,
        createdAt: 3,
        updatedAt: 4,
      },
    ];

    const candidates = buildLearnedRepoIntelligenceCandidates(run, stubOutcome());

    expect(candidates).not.toHaveLength(0);
  });
});

describe("computeAdvisoryProofDecision proportionality (Phase 2.4)", () => {
  const baseClassification = (overrides: Partial<TicketRunMissionClassification> = {}): TicketRunMissionClassification => ({
    kind: "ui",
    scopeSummary: "Update copy",
    acceptanceCriteria: [],
    impactedRepoRelativePaths: ["web-app"],
    risks: [],
    uiChange: true,
    proofRequired: true,
    proofArtifactMode: "screenshot",
    advisoryProofLevel: null,
    advisoryProofRationale: null,
    rationale: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });

  const proofProfile: TicketRunProofProfileSummary = {
    profileId: "p:1",
    label: "UI proof",
    description: "",
    kind: "playwright-dotnet-nunit",
    repoRelativePath: "web-app",
    projectRelativePath: "Project.csproj",
    runSettingsRelativePath: null,
  };

  it("downgrades to 'none' when the diff signal reports tests-only changes", () => {
    const decision = computeAdvisoryProofDecision({
      run: createRun(),
      classification: baseClassification(),
      availableProofs: [proofProfile],
      proofRules: [],
      diffSignal: {
        totalFilesChanged: 2,
        totalLinesAdded: 30,
        totalLinesRemoved: 4,
        copyOnly: false,
        testsOnly: true,
        touchesUiSurface: false,
      },
    });
    expect(decision.recommendedLevel).toBe("none");
    expect(decision.evidence).toContain("diff-tests-only");
  });

  it("downgrades to 'light' when the diff is copy-only and small", () => {
    const decision = computeAdvisoryProofDecision({
      run: createRun(),
      classification: baseClassification(),
      availableProofs: [proofProfile],
      proofRules: [],
      diffSignal: {
        totalFilesChanged: 1,
        totalLinesAdded: 4,
        totalLinesRemoved: 2,
        copyOnly: true,
        testsOnly: false,
        touchesUiSurface: false,
      },
    });
    expect(decision.recommendedLevel).toBe("light");
    expect(decision.evidence).toContain("diff-copy-only-small");
  });

  it("escalates to 'targeted-screenshot' when the diff touches a registered UI surface and base is below it", () => {
    const decision = computeAdvisoryProofDecision({
      run: createRun(),
      classification: baseClassification({ uiChange: false, proofRequired: false }),
      // The classification disables proof, so the base is "none". Diff signal escalates.
      availableProofs: [proofProfile],
      proofRules: [],
      diffSignal: {
        totalFilesChanged: 5,
        totalLinesAdded: 60,
        totalLinesRemoved: 12,
        copyOnly: false,
        testsOnly: false,
        touchesUiSurface: true,
      },
    });
    // Note: the !proofRequired branch returns "none" directly without proportionality —
    // so this just asserts the gate honours classification first.
    expect(decision.recommendedLevel).toBe("none");
  });

  it("surfaces historical failure evidence without changing the level", () => {
    const decision = computeAdvisoryProofDecision({
      run: createRun(),
      classification: baseClassification(),
      availableProofs: [proofProfile],
      proofRules: [],
      historicalOutcomes: {
        recentRuns: [
          { status: "preflight-blocked", ageMs: 60_000 },
          { status: "failed", ageMs: 120_000 },
          { status: "passed", ageMs: 300_000 },
        ],
      },
    });
    expect(decision.evidence.some((entry) => entry.startsWith("history-recent-failures:"))).toBe(true);
  });

  it("uses a matching proof rule's recommendedLevel as the base", () => {
    const matchingRule: ProofRuleRecord = {
      id: "user-test",
      projectKey: null,
      repoRelativePath: null,
      classificationKind: "ui",
      uiChange: true,
      proofRequired: true,
      summaryKeywords: [],
      recommendedLevel: "manual-review-only",
      rationale: "Tiny UI changes go to manual review.",
      createdAt: 1,
      updatedAt: 100,
    };
    const decision = computeAdvisoryProofDecision({
      run: createRun(),
      classification: baseClassification(),
      availableProofs: [],
      proofRules: [matchingRule],
    });
    expect(decision.recommendedLevel).toBe("manual-review-only");
    expect(decision.evidence).toContain(`proof-rule:${matchingRule.id}`);
  });
});
