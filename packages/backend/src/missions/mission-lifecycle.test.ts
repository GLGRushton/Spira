import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SpiraMemoryDatabase, getSpiraMemoryDbPath } from "@spira/memory-db";
import { describe, expect, it, vi } from "vitest";
import type { TicketRunSummary } from "@spira/shared";
import { getMissionWorkflowState } from "./mission-workflow-guard.js";
import { MissionLifecycleService } from "./mission-lifecycle.js";

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
});
