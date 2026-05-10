import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SpiraMemoryDatabase, getSpiraMemoryDbPath } from "@spira/memory-db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TicketRunService } from "./ticket-runs.js";

const tempDirs: string[] = [];
const openDatabases: SpiraMemoryDatabase[] = [];

const createTestDatabase = (): SpiraMemoryDatabase => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "spira-phase4-db-"));
  tempDirs.push(tempDir);
  const database = SpiraMemoryDatabase.open(getSpiraMemoryDbPath(tempDir));
  openDatabases.push(database);
  return database;
};

const createLogger = () => ({ warn: vi.fn(), debug: vi.fn() }) as never;

afterEach(() => {
  vi.restoreAllMocks();
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close();
  }
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (!directory) continue;
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("prompt order optimised for prompt caching", () => {
  it("emits the repo-guidance section before the ticket-specific lines on initial prompt", async () => {
    const database = createTestDatabase();
    database.upsertRepoProfile({
      projectKey: "SPI",
      displayName: "Spira platform",
      defaultBranch: "main",
      defaultBuildWorkingDirectory: ".",
      defaultRegistry: "https://npm.parliament.uk",
      registryHints: [],
      requiredEnvVars: [],
      requiredSdks: ["node 22"],
      userFacingCopyGlobs: [],
      uiTestGlobs: [],
      notes: null,
      description: null,
      source: "user",
    });
    database.upsertTicketRun({
      runId: "run-1",
      stationId: null,
      ticketId: "SPI-100",
      ticketSummary: "Stable prefix first",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-100",
      projectKey: "SPI",
      status: "ready",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-100\\service-api",
          branchName: "feat/spi-100",
        },
      ],
    });

    const launchMissionPass = vi.fn().mockResolvedValue({
      stationId: "mission:run-1",
      reusedLiveAttempt: false,
      completion: Promise.resolve({ status: "completed" as const, summary: "Done." }),
    });
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: null,
      launchMissionPass,
      warmRunDependencies: async () => [],
      attemptIdFactory: () => "attempt-1",
      now: () => 1234,
    });

    await service.startWork("run-1", "Operator follow-up.");

    const prompt = launchMissionPass.mock.calls[0]?.[0]?.prompt as string;
    expect(prompt).toBeDefined();

    const guidanceIndex = prompt.indexOf("## Repo guidance");
    const ticketLineIndex = prompt.indexOf("Work on ticket SPI-100");
    const operatorLineIndex = prompt.indexOf("Additional operator context");
    expect(guidanceIndex).toBeGreaterThanOrEqual(0);
    expect(ticketLineIndex).toBeGreaterThan(guidanceIndex);
    expect(operatorLineIndex).toBeGreaterThan(ticketLineIndex);
  });
});

describe("paginated mission timeline", () => {
  it("reports hasMore=false when fewer events than the limit exist", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-page",
      stationId: null,
      ticketId: "SPI-PAGE",
      ticketSummary: "Page me",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-PAGE",
      projectKey: "SPI",
      status: "ready",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-page\\service-api",
          branchName: "feat/spi-page",
        },
      ],
    });
    for (let index = 0; index < 3; index += 1) {
      database.appendMissionEvent({
        runId: "run-page",
        attemptId: null,
        stage: "system",
        eventType: "workspace-prepared",
        metadata: { status: "ready", worktreeCount: 1 },
      });
    }

    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: null,
    });

    const timeline = await service.getMissionTimeline("run-page", { limit: 10 });
    expect(timeline.events).toHaveLength(3);
    expect(timeline.hasMore).toBe(false);
  });

  it("reports hasMore=true and lets a follow-up beforeId fetch the next page", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-page",
      stationId: null,
      ticketId: "SPI-PAGE",
      ticketSummary: "Page me",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-PAGE",
      projectKey: "SPI",
      status: "ready",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-page\\service-api",
          branchName: "feat/spi-page",
        },
      ],
    });
    for (let index = 0; index < 12; index += 1) {
      database.appendMissionEvent({
        runId: "run-page",
        attemptId: null,
        stage: "system",
        eventType: "workspace-prepared",
        metadata: { status: "ready", worktreeCount: 1 },
      });
    }

    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: null,
    });

    const firstPage = await service.getMissionTimeline("run-page", { limit: 5 });
    expect(firstPage.events).toHaveLength(5);
    expect(firstPage.hasMore).toBe(true);

    const cursor = firstPage.events[firstPage.events.length - 1]?.id;
    expect(typeof cursor).toBe("number");

    const secondPage = await service.getMissionTimeline("run-page", { limit: 5, beforeId: cursor });
    expect(secondPage.events).toHaveLength(5);
    expect(secondPage.hasMore).toBe(true);

    const knownIds = new Set([...firstPage.events, ...secondPage.events].map((event) => event.id));
    // Two pages of five distinct events => 10 unique ids.
    expect(knownIds.size).toBe(10);
  });
});

describe("proof discovery cache", () => {
  it("walks the filesystem once per worktree path and reuses the cached result on follow-up calls", async () => {
    const database = createTestDatabase();
    const worktreeRoot = mkdtempSync(path.join(os.tmpdir(), "spira-phase4-worktree-"));
    tempDirs.push(worktreeRoot);

    const projectDir = path.join(worktreeRoot, "LegApp.Admin.UI.Tests");
    const baseDir = path.join(projectDir, "PageTests", "Bases");
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(
      path.join(projectDir, "LegApp.Admin.UI.Tests.csproj"),
      "<Project>Microsoft.Playwright.NUnit</Project>",
    );
    writeFileSync(
      path.join(baseDir, "IsolatedPageTestBase.cs"),
      "namespace X { public class Y { void M() { AddTestProceduralAzureADAuthentication(); } } }",
    );

    database.upsertTicketRun({
      runId: "run-cache",
      stationId: null,
      ticketId: "SPI-CACHE",
      ticketSummary: "Cache me",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-CACHE",
      projectKey: "SPI",
      status: "awaiting-review",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "web-app",
          repoAbsolutePath: "C:\\Repos\\web-app",
          worktreePath: worktreeRoot,
          branchName: "feat/spi-cache",
        },
      ],
    });

    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: null,
    });

    const first = await service.getProofSnapshot("run-cache");
    expect(first.proofSnapshot.profiles).toHaveLength(1);
    const firstProfileId = first.proofSnapshot.profiles[0]?.profileId;

    // Even after the underlying csproj contents change, the cache returns the original
    // profile — invalidation only happens via removeManagedWorktree. The point of the
    // cache is that file checks have a real per-call cost and the discovery is stable
    // across the lifetime of a mission.
    writeFileSync(path.join(projectDir, "LegApp.Admin.UI.Tests.csproj"), "<Project>nope</Project>");
    const second = await service.getProofSnapshot("run-cache");
    expect(second.proofSnapshot.profiles[0]?.profileId).toBe(firstProfileId);
  });
});

describe("usable-worktree cache", () => {
  it("only runs `rev-parse --git-dir` once per worktree path across repeated startRun resumes", async () => {
    const database = createTestDatabase();
    const worktreePath = mkdtempSync(path.join(os.tmpdir(), "spira-phase4-validate-"));
    tempDirs.push(worktreePath);

    database.upsertTicketRun({
      runId: "run-validate",
      ticketId: "SPI-VAL",
      ticketSummary: "Validate me",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-VAL",
      projectKey: "SPI",
      // "starting" → startRun treats this as a recoverable resume and walks the worktrees.
      status: "starting",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath,
          branchName: "feat/spi-val",
        },
      ],
    });

    const gitRunner = vi.fn().mockImplementation(async (_cwd: string, args: readonly string[]) => {
      if (args.join(" ") === "rev-parse --git-dir") {
        return { stdout: ".git\n", stderr: "" };
      }
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    });

    const transitionTicket = vi.fn().mockResolvedValue(undefined);
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: { transitionTicketToInProgress: transitionTicket },
      runGitCommand: gitRunner,
      warmRunDependencies: async () => [],
      now: () => 1234,
    });

    // First startRun resumes the recoverable run; rev-parse fires once.
    const first = await service.startRun({
      ticketId: "SPI-VAL",
      ticketSummary: "Validate me",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-VAL",
      projectKey: "SPI",
    });
    expect(first.run.status).toBe("ready");
    const callsAfterFirst = gitRunner.mock.calls.length;
    expect(callsAfterFirst).toBe(1);

    // Force the run back to "starting" so a follow-up startRun re-attempts recovery
    // against the same worktree. The cache should keep the second pass at zero git
    // calls for the rev-parse check.
    const previous = database.getTicketRun("run-validate");
    if (!previous) throw new Error("expected run to persist");
    database.upsertTicketRun({
      ...previous,
      status: "starting",
      worktrees: previous.worktrees.map((worktree) => ({
        repoRelativePath: worktree.repoRelativePath,
        repoAbsolutePath: worktree.repoAbsolutePath,
        worktreePath: worktree.worktreePath,
        branchName: worktree.branchName,
        commitMessageDraft: worktree.commitMessageDraft,
        cleanupState: worktree.cleanupState,
        createdAt: worktree.createdAt,
        updatedAt: worktree.updatedAt,
      })),
    });
    await service.startRun({
      ticketId: "SPI-VAL",
      ticketSummary: "Validate me",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-VAL",
      projectKey: "SPI",
    });
    expect(gitRunner.mock.calls.length).toBe(callsAfterFirst);
  });
});
