import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SpiraMemoryDatabase, getSpiraMemoryDbPath } from "@spira/memory-db";
import type { TicketRunSummary } from "@spira/shared";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_PROOF_RULES, BUILTIN_REPO_INTELLIGENCE, BUILTIN_VALIDATION_PROFILES } from "./mission-intelligence.js";
import { MissionLifecycleService } from "./mission-lifecycle.js";
import { getMissionWorkflowState } from "./mission-workflow-guard.js";

const createDatabase = (): { database: SpiraMemoryDatabase; tempDir: string } => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "spira-mission-lifecycle-"));
  return {
    database: SpiraMemoryDatabase.open(getSpiraMemoryDbPath(tempDir)),
    tempDir,
  };
};

const createRun = (database: SpiraMemoryDatabase): TicketRunSummary =>
  database.upsertTicketRun({
    runId: "run-1",
    stationId: "mission:run-1",
    ticketId: "SPI-101",
    ticketSummary: "Add mission lifecycle tools",
    ticketUrl: "https://example.test/issue/SPI-101",
    projectKey: "SPI",
    status: "working",
    worktrees: [
      {
        repoRelativePath: "apps/web",
        repoAbsolutePath: "C:\\Repos\\apps\\web",
        worktreePath: "C:\\Repos\\.spira-worktrees\\spi-101\\apps-web",
        branchName: "feat/spi-101-mission-lifecycle",
        cleanupState: "retained",
      },
    ],
    attempts: [
      {
        attemptId: "attempt-1",
        sequence: 1,
        status: "running",
        summary: "Initial mission pass completed.",
        startedAt: 1,
      },
    ],
  });

describe("MissionLifecycleService", () => {
  it("returns stored mission context with available proof profiles", async () => {
    const { database, tempDir } = createDatabase();
    try {
      createRun(database);
      const service = new MissionLifecycleService(database, undefined, async (runId: string) => ({
        run: database.getTicketRun(runId) as TicketRunSummary,
        snapshot: database.getTicketRunSnapshot(),
        proofSnapshot: {
          runId,
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
          profiles: [
            {
              profileId: "profile-1",
              label: "UI proof",
              description: "Runs the targeted proof.",
              kind: "playwright-dotnet-nunit",
              repoRelativePath: "apps/web",
              projectRelativePath: "tests/ui",
              runSettingsRelativePath: null,
            },
          ],
          proofRuns: [],
        },
      }));

      const context = await service.getMissionContext("run-1");
      expect(context.availableProofs).toHaveLength(1);
      expect(context.latestAttemptSummary).toBe("Initial mission pass completed.");
      expect(context.workflow.kickoffComplete).toBe(true);
    } finally {
      database.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("marks context loaded with a timestamp later than the current attempt start", async () => {
    const { database, tempDir } = createDatabase();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1);
    try {
      createRun(database);
      const service = new MissionLifecycleService(database);

      const context = await service.getMissionContext("run-1");

      expect(context.workflow.kickoffComplete).toBe(true);
      expect(database.getTicketRun("run-1")?.missionPhaseUpdatedAt).toBe(2);
    } finally {
      nowSpy.mockRestore();
      database.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not treat stale proof from a prior pass as current-pass kickoff", () => {
    const { database, tempDir } = createDatabase();
    try {
      const run = database.upsertTicketRun({
        ...createRun(database),
        attempts: [
          {
            attemptId: "attempt-1",
            sequence: 1,
            status: "completed",
            summary: "Prior pass completed.",
            startedAt: 1,
            completedAt: 10,
          },
          {
            attemptId: "attempt-2",
            sequence: 2,
            status: "running",
            summary: null,
            startedAt: 20,
          },
        ],
        proof: {
          status: "stale",
          lastProofRunId: "proof-1",
          lastProofProfileId: "profile-1",
          lastProofAt: 10,
          lastProofSummary: "Previous proof passed.",
          staleReason: "A new pass started.",
        },
        missionPhaseUpdatedAt: 20,
      });

      expect(getMissionWorkflowState(run).kickoffComplete).toBe(false);
      expect(getMissionWorkflowState(run).nextAction).toBe("load-context");
    } finally {
      database.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("allows skipping proof when classification marks the run as non-UI", async () => {
    const { database, tempDir } = createDatabase();
    try {
      createRun(database);
      const service = new MissionLifecycleService(database);

      await service.getMissionContext("run-1");

      service.saveClassification("run-1", {
        kind: "backend",
        scopeSummary: "Backend-only ticket",
        acceptanceCriteria: [],
        impactedRepoRelativePaths: ["apps/web"],
        risks: [],
        uiChange: false,
        proofRequired: false,
        proofArtifactMode: "none",
        rationale: null,
        createdAt: 1,
        updatedAt: 1,
      });
      service.savePlan("run-1", {
        steps: ["Update the backend flow"],
        touchedRepoRelativePaths: ["apps/web"],
        validationPlan: ["pnpm test"],
        proofIntent: null,
        blockers: [],
        assumptions: [],
        createdAt: 2,
        updatedAt: 2,
      });
      service.recordValidation("run-1", {
        validationId: "validation-1",
        runId: "run-1",
        kind: "build",
        command: "pnpm test",
        cwd: "C:\\Repos\\apps\\web",
        status: "passed",
        summary: "Tests passed.",
        artifacts: [],
        startedAt: 3,
        completedAt: 4,
        createdAt: 3,
        updatedAt: 4,
      });
      const summarized = service.saveSummary("run-1", {
        completedWork: "Backend flow updated.",
        changedRepoRelativePaths: ["apps/web"],
        validationSummary: "pnpm test passed",
        proofSummary: null,
        openQuestions: [],
        followUps: [],
        createdAt: 5,
        updatedAt: 5,
      });

      expect(summarized.missionPhase).toBe("summarize");
    } finally {
      database.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns repo guidance, persists advisory proof decisions, and records mission events", async () => {
    const { database, tempDir } = createDatabase();
    try {
      database.upsertTicketRun({
        ...createRun(database),
        ticketSummary: "Adjust button label in the mission flow",
      });
      database.seedBuiltinRepoIntelligence(BUILTIN_REPO_INTELLIGENCE);
      database.seedBuiltinValidationProfiles(BUILTIN_VALIDATION_PROFILES);
      database.seedBuiltinProofRules(BUILTIN_PROOF_RULES);
      database.upsertProofRule({
        id: "packages-backend-light-proof",
        projectKey: "SPI",
        repoRelativePath: "packages/backend",
        classificationKind: "ui",
        uiChange: true,
        proofRequired: true,
        recommendedLevel: "manual-review-only",
        rationale:
          "Backend mission surfaces in the monorepo require manual review proof when scoped from the root worktree.",
      });

      const service = new MissionLifecycleService(database, undefined, async (runId: string) => ({
        run: database.getTicketRun(runId) as TicketRunSummary,
        snapshot: database.getTicketRunSnapshot(),
        proofSnapshot: {
          runId,
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
          profiles: [
            {
              profileId: "profile-1",
              label: "UI proof",
              description: "Runs targeted UI proof.",
              kind: "playwright-dotnet-nunit",
              repoRelativePath: "apps/web",
              projectRelativePath: "tests/ui",
              runSettingsRelativePath: null,
            },
          ],
          proofRuns: [],
        },
      }));

      const context = await service.getMissionContext("run-1");

      expect(context.repoGuidance.entries).not.toHaveLength(0);
      expect(context.repoGuidance.validationProfiles).not.toHaveLength(0);
      expect(context.advisoryProofDecision).toMatchObject({
        runId: "run-1",
        recommendedLevel: "light",
        preflightStatus: "runnable",
      });
      expect(database.getProofDecision("run-1")).toMatchObject({
        recommendedLevel: "light",
        preflightStatus: "runnable",
      });
      expect(database.listMissionEvents("run-1")[0]).toMatchObject({
        eventType: "context-loaded",
        stage: "classification",
      });
    } finally {
      database.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("uses mission scope paths for root worktree runs and keeps advisory proof off the stored classification", async () => {
    const { database, tempDir } = createDatabase();
    try {
      database.upsertTicketRun({
        ...createRun(database),
        ticketSummary: "Rename mission banner label",
        worktrees: [
          {
            repoRelativePath: ".",
            repoAbsolutePath: "C:\\Repos\\spira",
            worktreePath: "C:\\Repos\\.spira-worktrees\\spi-101",
            branchName: "feat/spi-101-mission-lifecycle",
            cleanupState: "retained",
          },
        ],
      });
      database.upsertRepoIntelligence({
        id: "packages-backend-briefing",
        projectKey: "SPI",
        repoRelativePath: "packages/backend",
        type: "briefing",
        title: "Backend mission guidance",
        content: "Mission lifecycle code lives here.",
        source: "user",
      });
      database.upsertValidationProfile({
        id: "packages-backend-tests",
        projectKey: "SPI",
        repoRelativePath: "packages/backend",
        label: "Backend tests",
        kind: "unit-test",
        command: "pnpm exec vitest run packages/backend/src/missions/mission-lifecycle.test.ts",
        workingDirectory: ".",
        source: "user",
      });
      database.seedBuiltinProofRules(BUILTIN_PROOF_RULES);
      database.upsertProofRule({
        id: "packages-backend-manual-proof",
        projectKey: "SPI",
        repoRelativePath: "packages/backend",
        summaryKeywords: [],
        uiChange: true,
        proofRequired: true,
        classificationKind: "ui",
        recommendedLevel: "manual-review-only",
        rationale:
          "Backend mission surfaces in the monorepo require manual review proof when scoped from the root worktree.",
      });

      const service = new MissionLifecycleService(database, undefined, async (runId: string) => ({
        run: database.getTicketRun(runId) as TicketRunSummary,
        snapshot: database.getTicketRunSnapshot(),
        proofSnapshot: {
          runId,
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
          profiles: [
            {
              profileId: "profile-1",
              label: "UI proof",
              description: "Runs targeted UI proof.",
              kind: "playwright-dotnet-nunit",
              repoRelativePath: ".",
              projectRelativePath: "tests/ui",
              runSettingsRelativePath: null,
            },
          ],
          proofRuns: [],
        },
      }));

      await service.getMissionContext("run-1");
      service.saveClassification("run-1", {
        kind: "ui",
        scopeSummary: "Rename copy in the backend mission screen",
        acceptanceCriteria: [],
        impactedRepoRelativePaths: ["packages/backend"],
        risks: [],
        uiChange: true,
        proofRequired: true,
        proofArtifactMode: "screenshot",
        rationale: null,
        createdAt: 1,
        updatedAt: 1,
      });

      const savedRun = database.getTicketRun("run-1");
      const context = await service.getMissionContext("run-1");

      expect(savedRun?.classification?.advisoryProofLevel).toBeNull();
      expect(savedRun?.classification?.advisoryProofRationale).toBeNull();
      expect(context.repoGuidance.entries).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "packages-backend-briefing" })]),
      );
      expect(context.repoGuidance.validationProfiles).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "packages-backend-tests" })]),
      );
      expect(context.advisoryProofDecision).toMatchObject({
        recommendedLevel: "manual-review-only",
        preflightStatus: "degraded",
        rationale:
          "Backend mission surfaces in the monorepo require manual review proof when scoped from the root worktree.",
      });
      expect(database.getProofDecision("run-1")).toMatchObject({
        recommendedLevel: "manual-review-only",
        repoRelativePaths: expect.arrayContaining([".", "packages/backend"]),
      });
    } finally {
      database.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // manual-review-only as a first-class satisfied gate state.
  describe("setProofManualReviewOnly", () => {
    const setupRunReadyForProof = (database: SpiraMemoryDatabase): void => {
      // Build a run that has classification + plan + proof strategy stored so the workflow guard
      // permits record-proof-result. Then we invoke setProofManualReviewOnly which uses the same
      // assertion gate.
      const baseRun = createRun(database);
      database.upsertTicketRun({
        ...baseRun,
        classification: {
          kind: "ui",
          scopeSummary: "Update labels",
          acceptanceCriteria: [],
          impactedRepoRelativePaths: ["apps/web"],
          risks: [],
          uiChange: true,
          proofRequired: true,
          proofArtifactMode: "screenshot",
          advisoryProofLevel: null,
          advisoryProofRationale: null,
          rationale: null,
          createdAt: 1,
          updatedAt: 5,
        },
        plan: {
          steps: ["Edit copy"],
          touchedRepoRelativePaths: ["apps/web"],
          validationPlan: ["pnpm typecheck"],
          proofIntent: "screenshot",
          blockers: [],
          assumptions: [],
          createdAt: 1,
          updatedAt: 6,
        },
        proofStrategy: {
          adapterId: "playwright",
          repoRelativePath: "apps/web",
          scenarioPath: null,
          scenarioName: null,
          command: "dotnet test",
          artifactMode: "screenshot",
          rationale: "Targeted UI proof.",
          metadata: null,
          createdAt: 1,
          updatedAt: 7,
        },
      });
    };

    it("rejects an empty justification", () => {
      const { database, tempDir } = createDatabase();
      try {
        setupRunReadyForProof(database);
        const service = new MissionLifecycleService(database);
        expect(() => service.setProofManualReviewOnly("run-1", "   ")).toThrow(/non-empty justification/);
      } finally {
        database.close();
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("sets proof.status = manual-review and records an audit event", () => {
      const { database, tempDir } = createDatabase();
      try {
        setupRunReadyForProof(database);
        const service = new MissionLifecycleService(database);
        const updated = service.setProofManualReviewOnly("run-1", "Copy edit, eyeballed in MissionChangesRoom.");
        expect(updated.proof.status).toBe("manual-review");
        expect(updated.proof.manualReviewJustification).toMatch(/eyeballed/);
        expect(updated.proof.manualReviewAt).not.toBeNull();
        const events = database.listMissionEvents("run-1", 50);
        expect(events.some((event) => event.eventType === "proof-set-manual-review-only")).toBe(true);
      } finally {
        database.close();
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("treats manual-review as a satisfied proof gate", () => {
      const { database, tempDir } = createDatabase();
      try {
        setupRunReadyForProof(database);
        const service = new MissionLifecycleService(database);
        service.setProofManualReviewOnly("run-1", "Operator review accepted.");
        const run = database.getTicketRun("run-1") as TicketRunSummary;
        const workflow = getMissionWorkflowState(run);
        expect(workflow.proofPassed).toBe(true);
      } finally {
        database.close();
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("clearProofManualReview reverts proof.status to not-run and records an event", () => {
      const { database, tempDir } = createDatabase();
      try {
        setupRunReadyForProof(database);
        const service = new MissionLifecycleService(database);
        service.setProofManualReviewOnly("run-1", "First review accepted.");
        const cleared = service.clearProofManualReview("run-1");
        expect(cleared.proof.status).toBe("not-run");
        expect(cleared.proof.manualReviewJustification).toBeNull();
        const events = database.listMissionEvents("run-1", 50);
        expect(events.some((event) => event.eventType === "proof-manual-review-cleared")).toBe(true);
      } finally {
        database.close();
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  // operator-initiated supersession of failed validations.
  describe("supersedeValidationsByKind", () => {
    const seedRunWithRetry = (database: SpiraMemoryDatabase): void => {
      const service = new MissionLifecycleService(database);
      database.upsertTicketRun({
        ...createRun(database),
        classification: {
          kind: "frontend",
          scopeSummary: "x",
          acceptanceCriteria: [],
          impactedRepoRelativePaths: ["apps/web"],
          risks: [],
          uiChange: false,
          proofRequired: false,
          proofArtifactMode: "none",
          advisoryProofLevel: null,
          advisoryProofRationale: null,
          rationale: null,
          createdAt: 1,
          updatedAt: 1,
        },
        plan: {
          steps: ["edit"],
          touchedRepoRelativePaths: ["apps/web"],
          validationPlan: ["pnpm test"],
          proofIntent: null,
          blockers: [],
          assumptions: [],
          createdAt: 1,
          updatedAt: 1,
        },
      });
      service.recordValidation("run-1", {
        validationId: "v-failed-1",
        runId: "run-1",
        kind: "build",
        command: "pnpm test",
        cwd: "C:\\Repos",
        status: "failed",
        summary: "Initial bad run.",
        artifacts: [],
        startedAt: 10,
        completedAt: 20,
        createdAt: 10,
        updatedAt: 20,
      });
      service.recordValidation("run-1", {
        validationId: "v-passed-1",
        runId: "run-1",
        kind: "build",
        command: "pnpm test",
        cwd: "C:\\Repos",
        status: "passed",
        summary: "Recovered.",
        artifacts: [],
        startedAt: 30,
        completedAt: 40,
        createdAt: 30,
        updatedAt: 40,
      });
    };

    it("attaches the failed peer ids to the latest passing entry's supersedesValidationIds", () => {
      const { database, tempDir } = createDatabase();
      try {
        seedRunWithRetry(database);
        const service = new MissionLifecycleService(database);
        const next = service.supersedeValidationsByKind("run-1", "build");
        const winner = next.validations.find((entry) => entry.validationId === "v-passed-1");
        expect(winner?.supersedesValidationIds).toContain("v-failed-1");
        const events = database.listMissionEvents("run-1", 50);
        expect(events.some((event) => event.eventType === "validations-superseded")).toBe(true);
      } finally {
        database.close();
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("rejects when no passing validation of the kind exists", () => {
      const { database, tempDir } = createDatabase();
      try {
        // Seed plan + classification so recordValidation passes the workflow guard,
        // then drop the failed validation alone (no passing peer).
        seedRunWithRetry(database);
        const service = new MissionLifecycleService(database);
        // Manually demote the passing entry so we end up with only failed entries.
        const run = database.getTicketRun("run-1");
        if (!run) throw new Error("expected run-1");
        database.upsertTicketRun({
          ...run,
          validations: run.validations.map((entry) =>
            entry.validationId === "v-passed-1" ? { ...entry, status: "failed" as const } : entry,
          ),
        });
        expect(() => service.supersedeValidationsByKind("run-1", "build")).toThrow(/No passing validation/);
      } finally {
        database.close();
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("rejects when no earlier failed/pending validations remain to supersede", () => {
      const { database, tempDir } = createDatabase();
      try {
        seedRunWithRetry(database);
        const service = new MissionLifecycleService(database);
        service.supersedeValidationsByKind("run-1", "build");
        expect(() => service.supersedeValidationsByKind("run-1", "build")).toThrow(/No earlier/);
      } finally {
        database.close();
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
