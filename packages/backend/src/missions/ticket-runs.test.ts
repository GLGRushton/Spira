import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SpiraMemoryDatabase, getSpiraMemoryDbPath } from "@spira/memory-db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TicketRunService, buildTicketRunBranchName, buildTicketRunWorktreePath } from "./ticket-runs.js";

const tempDirs: string[] = [];
const openDatabases: SpiraMemoryDatabase[] = [];

const createTestDatabase = (): SpiraMemoryDatabase => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "spira-ticket-run-db-"));
  tempDirs.push(tempDir);
  const database = SpiraMemoryDatabase.open(getSpiraMemoryDbPath(tempDir));
  openDatabases.push(database);
  return database;
};

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close();
  }

  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (!directory) {
      continue;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

const createLogger = () => ({ warn: vi.fn(), debug: vi.fn() }) as never;

describe("buildTicketRunBranchName", () => {
  it("slugifies ticket ids and summaries into the branch format", () => {
    expect(buildTicketRunBranchName("SPI-123", "Wire native Missions pickup!!!")).toBe(
      "feat/spi-123-wire-native-missions-pickup",
    );
  });

  it("falls back to a safe slug when the summary is empty", () => {
    expect(buildTicketRunBranchName("SPI-123", "!!!")).toBe("feat/spi-123-work");
  });

  it("caps the branch name length", () => {
    const branch = buildTicketRunBranchName("SPI-123", "a ".repeat(100));
    expect(branch.length).toBeLessThanOrEqual(63);
    expect(branch.startsWith("feat/spi-123-")).toBe(true);
  });
});

describe("buildTicketRunWorktreePath", () => {
  it("creates a managed worktree path beneath the workspace root", () => {
    expect(buildTicketRunWorktreePath("C:\\Repos", "SPI-123", "service-api")).toBe(
      path.join("C:\\Repos", ".spira-worktrees", "spi-123-service-api"),
    );
  });
});

describe("TicketRunService", () => {
  it("starts a single-repo run and persists the worktree details", async () => {
    const database = createTestDatabase();
    const gitRunner = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const transitionTicket = vi.fn().mockResolvedValue(undefined);
    const logger = createLogger();
    const service = new TicketRunService({
      memoryDb: database,
      logger,
      projectRegistry: {
        getSnapshot: async () => ({
          workspaceRoot: "C:\\Repos",
          repos: [
            {
              name: "service-api",
              relativePath: "service-api",
              absolutePath: "C:\\Repos\\service-api",
              hasSubmodules: false,
              mappedProjectKeys: ["SPI"],
            },
          ],
          mappings: [
            {
              projectKey: "SPI",
              repoRelativePaths: ["service-api"],
              missingRepoRelativePaths: [],
              updatedAt: 100,
            },
          ],
        }),
      },
      youTrackService: {
        transitionTicketToInProgress: transitionTicket,
      },
      runGitCommand: gitRunner,
      runIdFactory: () => "run-1",
      now: () => 1234,
    });

    const result = await service.startRun({
      ticketId: "SPI-101",
      ticketSummary: "Start Missions pickup",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-101",
      projectKey: "SPI",
    });

    expect(gitRunner).toHaveBeenCalledWith("C:\\Repos\\service-api", [
      "worktree",
      "add",
      "-b",
      "feat/spi-101-start-missions-pickup",
      path.join("C:\\Repos", ".spira-worktrees", "spi-101-service-api"),
    ]);
    expect(transitionTicket).toHaveBeenCalledWith("SPI-101");
    expect(result.reusedExistingRun).toBe(false);
    expect(result.run.status).toBe("ready");
    expect(result.snapshot.runs).toHaveLength(1);
    expect(result.run.worktrees[0]).toMatchObject({
      repoRelativePath: "service-api",
      repoAbsolutePath: "C:\\Repos\\service-api",
      branchName: "feat/spi-101-start-missions-pickup",
      cleanupState: "retained",
    });
  });

  it("reuses an existing run for the same ticket", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-existing",
      ticketId: "SPI-101",
      ticketSummary: "Existing run",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-101",
      projectKey: "SPI",
      status: "ready",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-101-service-api",
          branchName: "feat/spi-101-existing-run",
        },
      ],
    });

    const gitRunner = vi.fn();
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: null,
      runGitCommand: gitRunner,
    });

    const result = await service.startRun({
      ticketId: "SPI-101",
      ticketSummary: "Existing run",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-101",
      projectKey: "SPI",
    });

    expect(result.reusedExistingRun).toBe(true);
    expect(gitRunner).not.toHaveBeenCalled();
  });

  it("keeps the run but marks it blocked when the YouTrack transition fails", async () => {
    const database = createTestDatabase();
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: {
        getSnapshot: async () => ({
          workspaceRoot: "C:\\Repos",
          repos: [
            {
              name: "service-api",
              relativePath: "service-api",
              absolutePath: "C:\\Repos\\service-api",
              hasSubmodules: false,
              mappedProjectKeys: ["SPI"],
            },
          ],
          mappings: [
            {
              projectKey: "SPI",
              repoRelativePaths: ["service-api"],
              missingRepoRelativePaths: [],
              updatedAt: 100,
            },
          ],
        }),
      },
      youTrackService: {
        transitionTicketToInProgress: vi.fn().mockRejectedValue(new Error("Transition failed")),
      },
      runGitCommand: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
      runIdFactory: () => "run-1",
      now: () => 1234,
    });

    const result = await service.startRun({
      ticketId: "SPI-102",
      ticketSummary: "Blocked transition",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-102",
      projectKey: "SPI",
    });

    expect(result.run.status).toBe("blocked");
    expect(result.run.statusMessage).toContain("Transition failed");
    expect(result.snapshot.runs[0]?.status).toBe("blocked");
  });

  it("records an error run when worktree creation fails", async () => {
    const database = createTestDatabase();
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: {
        getSnapshot: async () => ({
          workspaceRoot: "C:\\Repos",
          repos: [
            {
              name: "service-api",
              relativePath: "service-api",
              absolutePath: "C:\\Repos\\service-api",
              hasSubmodules: false,
              mappedProjectKeys: ["SPI"],
            },
          ],
          mappings: [
            {
              projectKey: "SPI",
              repoRelativePaths: ["service-api"],
              missingRepoRelativePaths: [],
              updatedAt: 100,
            },
          ],
        }),
      },
      youTrackService: null,
      runGitCommand: vi.fn().mockRejectedValue(new Error("git failed")),
      runIdFactory: () => "run-1",
      now: () => 1234,
    });

    const result = await service.startRun({
      ticketId: "SPI-103",
      ticketSummary: "Worktree failure",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-103",
      projectKey: "SPI",
    });

    expect(result.run.status).toBe("error");
    expect(result.run.statusMessage).toContain("git failed");
  });

  it("retries an error run with a forced branch reset", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-104",
      ticketSummary: "Retry failed run",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-104",
      projectKey: "SPI",
      status: "error",
      createdAt: 100,
      startedAt: 100,
      worktrees: [],
    });
    const gitRunner = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: {
        getSnapshot: async () => ({
          workspaceRoot: "C:\\Repos",
          repos: [
            {
              name: "service-api",
              relativePath: "service-api",
              absolutePath: "C:\\Repos\\service-api",
              hasSubmodules: false,
              mappedProjectKeys: ["SPI"],
            },
          ],
          mappings: [],
        }),
      },
      youTrackService: null,
      runGitCommand: gitRunner,
      now: () => 1234,
    });

    await service.startRun({
      ticketId: "SPI-104",
      ticketSummary: "Retry failed run",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-104",
      projectKey: "SPI",
    });

    expect(gitRunner).toHaveBeenCalledWith("C:\\Repos\\service-api", [
      "worktree",
      "add",
      "-B",
      "feat/spi-104-retry-failed-run",
      path.join("C:\\Repos", ".spira-worktrees", "spi-104-service-api"),
    ]);
  });

  it("resumes a starting run with an existing worktree instead of recreating it", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-105",
      ticketSummary: "Resume interrupted run",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-105",
      projectKey: "SPI",
      status: "starting",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-105-service-api",
          branchName: "feat/spi-105-resume-interrupted-run",
        },
      ],
    });
    const gitRunner = vi.fn();
    const transitionTicket = vi.fn().mockResolvedValue(undefined);
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: {
        transitionTicketToInProgress: transitionTicket,
      },
      runGitCommand: gitRunner,
      now: () => 1234,
    });

    const result = await service.startRun({
      ticketId: "SPI-105",
      ticketSummary: "Resume interrupted run",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-105",
      projectKey: "SPI",
    });

    expect(gitRunner).not.toHaveBeenCalled();
    expect(transitionTicket).toHaveBeenCalledWith("SPI-105");
    expect(result.run.status).toBe("ready");
  });

  it("retries a blocked run without recreating the worktree", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-106",
      ticketSummary: "Retry blocked sync",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-106",
      projectKey: "SPI",
      status: "blocked",
      statusMessage: "YouTrack sync failed",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-106-service-api",
          branchName: "feat/spi-106-retry-blocked-sync",
        },
      ],
    });
    const transitionTicket = vi.fn().mockResolvedValue(undefined);
    const gitRunner = vi.fn();
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: {
        transitionTicketToInProgress: transitionTicket,
      },
      runGitCommand: gitRunner,
      now: () => 1234,
    });

    const result = await service.retryRunSync("run-1");

    expect(gitRunner).not.toHaveBeenCalled();
    expect(transitionTicket).toHaveBeenCalledWith("SPI-106");
    expect(result.run.status).toBe("ready");
  });

  it("does not recover unrelated live work when retrying a blocked run", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-blocked",
      ticketId: "SPI-200",
      ticketSummary: "Retry blocked sync",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-200",
      projectKey: "SPI",
      status: "blocked",
      statusMessage: "YouTrack sync failed",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-200-service-api",
          branchName: "feat/spi-200-retry-blocked-sync",
        },
      ],
    });
    database.upsertTicketRun({
      runId: "run-working",
      ticketId: "SPI-201",
      ticketSummary: "Live mission work",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-201",
      projectKey: "SPI",
      status: "working",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-201-service-api",
          branchName: "feat/spi-201-live-mission-work",
        },
      ],
      attempts: [
        {
          attemptId: "attempt-1",
          sequence: 1,
          status: "running",
          startedAt: 100,
          createdAt: 100,
          updatedAt: 100,
          completedAt: null,
        },
      ],
    });
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: {
        transitionTicketToInProgress: vi.fn().mockResolvedValue(undefined),
      },
      runGitCommand: vi.fn(),
      now: () => 1234,
    });

    await service.retryRunSync("run-blocked");

    expect(database.getTicketRun("run-working")).toMatchObject({
      status: "working",
      attempts: [
        {
          status: "running",
        },
      ],
    });
  });

  it("starts a mission pass and stores attempt history", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-107",
      ticketSummary: "Ship mission work",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-107",
      projectKey: "SPI",
      status: "ready",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-107-service-api",
          branchName: "feat/spi-107-ship-mission-work",
        },
      ],
    });
    let resolveCompletion: ((value: { status: "completed"; summary: string }) => void) | undefined;
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: null,
      launchMissionPass: vi.fn().mockImplementation(async () => ({
        stationId: "mission:run-1",
        reusedLiveAttempt: false,
        completion: new Promise((resolve) => {
          resolveCompletion = resolve;
        }),
      })),
      now: () => 1234,
    });

    const started = await service.startWork("run-1");
    expect(started.run.status).toBe("working");
    expect(started.run.attempts).toHaveLength(1);
    expect(started.run.attempts[0]).toMatchObject({
      status: "running",
      sequence: 1,
      subagentRunId: null,
    });
    expect(started.run.stationId).toBe("mission:run-1");

    resolveCompletion?.({ status: "completed", summary: "Code updated and ready for review." });
    await Promise.resolve();
    await Promise.resolve();

    expect(database.getTicketRun("run-1")).toMatchObject({
      status: "awaiting-review",
      attempts: [
        {
          status: "completed",
          summary: "Code updated and ready for review.",
        },
      ],
    });
  });

  it("continues a reviewable mission and preserves the user prompt", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-108",
      ticketSummary: "Refine mission work",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-108",
      projectKey: "SPI",
      status: "awaiting-review",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-108-service-api",
          branchName: "feat/spi-108-refine-mission-work",
        },
      ],
      attempts: [
        {
          attemptId: "attempt-1",
          subagentRunId: "subagent-1",
          sequence: 1,
          status: "completed",
          summary: "Initial pass landed.",
          followupNeeded: true,
          startedAt: 100,
          createdAt: 100,
          updatedAt: 150,
          completedAt: 150,
        },
      ],
    });
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: null,
      launchMissionPass: vi.fn().mockResolvedValue({
        stationId: "mission:run-1",
        reusedLiveAttempt: true,
        completion: Promise.resolve({ status: "completed", summary: "Follow-up pass landed." }),
      }),
      attemptIdFactory: () => "attempt-2",
      now: () => 200,
    });

    const result = await service.continueWork("run-1", "Tighten the final error handling.");
    expect(result.reusedLiveAttempt).toBe(true);
    expect(result.run.status).toBe("working");
    expect(result.run.attempts[1]).toMatchObject({
      attemptId: "attempt-2",
      sequence: 2,
      prompt: "Tighten the final error handling.",
      status: "running",
    });
  });

  it("marks stranded working runs as awaiting review during explicit recovery", () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-109",
      ticketSummary: "Recover mission work",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-109",
      projectKey: "SPI",
      status: "working",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-109-service-api",
          branchName: "feat/spi-109-recover-mission-work",
        },
      ],
      attempts: [
        {
          attemptId: "attempt-1",
          subagentRunId: "subagent-1",
          sequence: 1,
          status: "running",
          startedAt: 100,
          createdAt: 100,
          updatedAt: 100,
          completedAt: null,
        },
      ],
    });
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: null,
      now: () => 500,
    });

    service.recoverInterruptedWork();
    const snapshot = service.getSnapshot();
    expect(snapshot.runs[0]).toMatchObject({
      status: "awaiting-review",
      attempts: [
        {
          status: "failed",
          summary: "Spira restarted before the work attempt reported back.",
        },
      ],
    });
  });

  it("generates a persisted commit draft when a run is completed", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-1",
      stationId: "mission:run-1",
      ticketId: "SPI-110",
      ticketSummary: "Prepare manual commit flow",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-110",
      projectKey: "SPI",
      status: "awaiting-review",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-110-service-api",
          branchName: "feat/spi-110-prepare-manual-commit-flow",
        },
      ],
    });
    const gitRunner = vi.fn().mockImplementation(async (_cwd: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (command.includes("rev-parse --abbrev-ref --symbolic-full-name @{upstream}")) {
        throw new Error("no upstream");
      }
      if (command.includes("diff --find-renames --find-copies --name-status HEAD --")) {
        return { stdout: "M\tsrc/mission.ts\n", stderr: "" };
      }
      if (command.includes("diff --find-renames --find-copies --numstat HEAD --")) {
        return { stdout: "3\t1\tsrc/mission.ts\n", stderr: "" };
      }
      if (command.includes("diff --find-renames --find-copies --patch --no-color HEAD --")) {
        return {
          stdout:
            "diff --git a/src/mission.ts b/src/mission.ts\n--- a/src/mission.ts\n+++ b/src/mission.ts\n@@ -1 +1 @@\n-old\n+new\n",
          stderr: "",
        };
      }
      throw new Error(`Unexpected git command: ${command}`);
    });
    const closeMissionStation = vi.fn().mockResolvedValue(undefined);
    const generateCommitDraft = vi
      .fn()
      .mockResolvedValue(
        "feat(SPI-110): prepare manual commit flow\n\n- add mission git controls\n- persist the draft",
      );
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: null,
      runGitCommand: gitRunner,
      closeMissionStation,
      generateCommitDraft,
      now: () => 500,
    });

    const result = await service.completeRun("run-1");

    expect(generateCommitDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({
          runId: "run-1",
          stationId: "mission:run-1",
          status: "done",
        }),
      }),
    );
    expect(closeMissionStation).toHaveBeenCalledWith("mission:run-1");
    expect(generateCommitDraft.mock.invocationCallOrder[0]).toBeLessThan(
      closeMissionStation.mock.invocationCallOrder[0],
    );
    expect(result.run).toMatchObject({
      status: "done",
      stationId: null,
      commitMessageDraft:
        "feat(SPI-110): prepare manual commit flow\n\n- add mission git controls\n- persist the draft",
    });
  });

  it("commits a completed run with the resolved mission git identity and clears the draft", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-111",
      ticketSummary: "Commit completed mission work",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-111",
      projectKey: "SPI",
      status: "done",
      commitMessageDraft: "feat(SPI-111): commit completed mission work\n\n- capture the mission changes",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-111-service-api",
          branchName: "feat/spi-111-commit-completed-mission-work",
        },
      ],
    });
    const gitRunner = vi.fn().mockImplementation(async (_cwd: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (command.includes("rev-parse --abbrev-ref --symbolic-full-name @{upstream}")) {
        throw new Error("no upstream");
      }
      if (command.includes("diff --find-renames --find-copies --name-status HEAD --")) {
        return { stdout: "M\tsrc/mission.ts\n", stderr: "" };
      }
      if (command.includes("diff --find-renames --find-copies --numstat HEAD --")) {
        return { stdout: "4\t2\tsrc/mission.ts\n", stderr: "" };
      }
      if (command.includes("diff --find-renames --find-copies --patch --no-color HEAD --")) {
        return {
          stdout:
            "diff --git a/src/mission.ts b/src/mission.ts\n--- a/src/mission.ts\n+++ b/src/mission.ts\n@@ -1 +1 @@\n-old\n+new\n",
          stderr: "",
        };
      }
      if (command === "add -u") {
        return { stdout: "", stderr: "" };
      }
      if (command.includes("commit --author=Shinra <shinra@example.com>")) {
        return { stdout: "[feat/spi-111 1234567] Commit\n", stderr: "" };
      }
      if (command === "rev-parse HEAD") {
        return { stdout: "1234567890abcdef\n", stderr: "" };
      }
      throw new Error(`Unexpected git command: ${command}`);
    });
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: null,
      runGitCommand: gitRunner,
      resolveMissionGitIdentity: vi.fn().mockResolvedValue({
        name: "Shinra",
        email: "shinra@example.com",
      }),
      now: () => 500,
    });

    const result = await service.commitRun(
      "run-1",
      "feat(SPI-111): commit completed mission work\n\n- capture the mission changes",
    );

    expect(result.commitSha).toBe("1234567890abcdef");
    expect(result.run.commitMessageDraft).toBeNull();
    expect(gitRunner).toHaveBeenCalledWith("C:\\Repos\\.spira-worktrees\\spi-111-service-api", ["add", "-u"]);
    expect(gitRunner).toHaveBeenCalledWith("C:\\Repos\\.spira-worktrees\\spi-111-service-api", [
      "-c",
      "user.name=Shinra",
      "-c",
      "user.email=shinra@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--author=Shinra <shinra@example.com>",
      "--cleanup=strip",
      "-m",
      "feat(SPI-111): commit completed mission work\n\n- capture the mission changes",
    ]);
  });

  it("publishes a completed run when the branch has no upstream", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-112",
      ticketSummary: "Publish mission branch",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-112",
      projectKey: "SPI",
      status: "done",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-112-service-api",
          branchName: "feat/spi-112-publish-mission-branch",
        },
      ],
    });
    let published = false;
    const gitRunner = vi.fn().mockImplementation(async (_cwd: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (command.includes("rev-parse --abbrev-ref --symbolic-full-name @{upstream}")) {
        if (!published) {
          throw new Error("no upstream");
        }
        return { stdout: "origin/feat/spi-112-publish-mission-branch\n", stderr: "" };
      }
      if (command.includes("diff --find-renames --find-copies --name-status HEAD --")) {
        return { stdout: "", stderr: "" };
      }
      if (command.includes("diff --find-renames --find-copies --numstat HEAD --")) {
        return { stdout: "", stderr: "" };
      }
      if (command.includes("diff --find-renames --find-copies --patch --no-color HEAD --")) {
        return { stdout: "", stderr: "" };
      }
      if (command === "rev-list --count HEAD --not --remotes=origin") {
        return { stdout: "1\n", stderr: "" };
      }
      if (command === "remote get-url origin") {
        return { stdout: "https://github.com/example/service-api.git\n", stderr: "" };
      }
      if (command === "symbolic-ref --short refs/remotes/origin/HEAD") {
        return { stdout: "origin/main\n", stderr: "" };
      }
      if (command.includes("push --set-upstream origin feat/spi-112-publish-mission-branch")) {
        published = true;
        return { stdout: "", stderr: "" };
      }
      if (command.includes("rev-list --left-right --count origin/feat/spi-112-publish-mission-branch...HEAD")) {
        return { stdout: "0 0\n", stderr: "" };
      }
      throw new Error(`Unexpected git command: ${command}`);
    });
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: null,
      runGitCommand: gitRunner,
      getMissionGitToken: () => "github-pat",
      now: () => 500,
    });

    const result = await service.publishRun("run-1");

    expect(result.action).toBe("publish");
    expect(result.gitState.upstreamBranch).toBe("origin/feat/spi-112-publish-mission-branch");
    expect(result.gitState.pullRequestUrls).toEqual({
      open: "https://github.com/example/service-api/pull/new/main...feat%2Fspi-112-publish-mission-branch",
      draft: "https://github.com/example/service-api/pull/new/main...feat%2Fspi-112-publish-mission-branch?draft=1",
    });
  });

  it("does not offer publish when a branch has no upstream and no unpublished commits", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-113",
      ticketSummary: "Idle mission branch",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-113",
      projectKey: "SPI",
      status: "done",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-113-service-api",
          branchName: "feat/spi-113-idle-mission-branch",
        },
      ],
    });
    const gitRunner = vi.fn().mockImplementation(async (_cwd: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (command.includes("rev-parse --abbrev-ref --symbolic-full-name @{upstream}")) {
        throw new Error("no upstream");
      }
      if (command.includes("diff --find-renames --find-copies --name-status HEAD --")) {
        return { stdout: "", stderr: "" };
      }
      if (command.includes("diff --find-renames --find-copies --numstat HEAD --")) {
        return { stdout: "", stderr: "" };
      }
      if (command.includes("diff --find-renames --find-copies --patch --no-color HEAD --")) {
        return { stdout: "", stderr: "" };
      }
      if (command === "rev-list --count HEAD --not --remotes=origin") {
        return { stdout: "0\n", stderr: "" };
      }
      throw new Error(`Unexpected git command: ${command}`);
    });
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: null,
      runGitCommand: gitRunner,
      now: () => 500,
    });

    const result = await service.getGitState("run-1");

    expect(result.gitState.pushAction).toBe("none");
  });
});
