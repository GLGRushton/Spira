import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SpiraMemoryDatabase, getSpiraMemoryDbPath } from "@spira/memory-db";
import type { TicketRunSummary } from "@spira/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TicketRunService, buildTicketRunBranchName, buildTicketRunWorktreePath } from "./ticket-runs.js";

const tempDirs: string[] = [];
const openDatabases: SpiraMemoryDatabase[] = [];
type EnsureRunSubmodulesTarget = {
  ensureRunSubmodules: (run: TicketRunSummary) => Promise<TicketRunSummary>;
};

const createTestDatabase = (): SpiraMemoryDatabase => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "spira-ticket-run-db-"));
  tempDirs.push(tempDir);
  const database = SpiraMemoryDatabase.open(getSpiraMemoryDbPath(tempDir));
  openDatabases.push(database);
  return database;
};

afterEach(() => {
  vi.restoreAllMocks();

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
      path.join("C:\\Repos", ".spira-worktrees", "spi-123", "service-api"),
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

    expect(gitRunner).toHaveBeenNthCalledWith(1, "C:\\Repos\\service-api", [
      "branch",
      "--list",
      "--format=%(refname:short)",
      "feat/spi-101-start-missions-pickup",
    ]);
    expect(gitRunner).toHaveBeenNthCalledWith(2, "C:\\Repos\\service-api", [
      "worktree",
      "add",
      "-b",
      "feat/spi-101-start-missions-pickup",
      path.join("C:\\Repos", ".spira-worktrees", "spi-101", "service-api"),
    ]);
    expect(gitRunner).toHaveBeenCalledTimes(2);
    expect(transitionTicket).toHaveBeenCalledWith("SPI-101");
    expect(result.reusedExistingRun).toBe(false);
    expect(result.run.status).toBe("ready");
    expect(result.snapshot.runs).toHaveLength(1);
    expect(result.run.worktrees[0]).toMatchObject({
      repoRelativePath: "service-api",
      repoAbsolutePath: "C:\\Repos\\service-api",
      branchName: "feat/spi-101-start-missions-pickup",
      worktreePath: path.join("C:\\Repos", ".spira-worktrees", "spi-101", "service-api"),
      cleanupState: "retained",
    });
  });

  it("starts a multi-repo run beneath a shared mission directory", async () => {
    const database = createTestDatabase();
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
            {
              name: "web-app",
              relativePath: "web-app",
              absolutePath: "C:\\Repos\\web-app",
              hasSubmodules: false,
              mappedProjectKeys: ["SPI"],
            },
          ],
          mappings: [
            {
              projectKey: "SPI",
              repoRelativePaths: ["service-api", "web-app"],
              missingRepoRelativePaths: [],
              updatedAt: 100,
            },
          ],
        }),
      },
      youTrackService: null,
      runGitCommand: gitRunner,
      runIdFactory: () => "run-1",
      now: () => 1234,
    });

    const result = await service.startRun({
      ticketId: "SPI-150",
      ticketSummary: "Coordinate repo changes",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-150",
      projectKey: "SPI",
    });

    const missionDirectory = path.join("C:\\Repos", ".spira-worktrees", "spi-150");
    expect(gitRunner).toHaveBeenNthCalledWith(1, "C:\\Repos\\service-api", [
      "branch",
      "--list",
      "--format=%(refname:short)",
      "feat/spi-150-coordinate-repo-changes",
    ]);
    expect(gitRunner).toHaveBeenNthCalledWith(2, "C:\\Repos\\service-api", [
      "worktree",
      "add",
      "-b",
      "feat/spi-150-coordinate-repo-changes",
      path.join(missionDirectory, "service-api"),
    ]);
    expect(gitRunner).toHaveBeenNthCalledWith(3, "C:\\Repos\\web-app", [
      "branch",
      "--list",
      "--format=%(refname:short)",
      "feat/spi-150-coordinate-repo-changes",
    ]);
    expect(gitRunner).toHaveBeenNthCalledWith(4, "C:\\Repos\\web-app", [
      "worktree",
      "add",
      "-b",
      "feat/spi-150-coordinate-repo-changes",
      path.join(missionDirectory, "web-app"),
    ]);
    expect(gitRunner).toHaveBeenCalledTimes(4);
    expect(result.run.worktrees).toHaveLength(2);
    expect(result.run.worktrees.map((worktree) => worktree.repoRelativePath)).toEqual(["service-api", "web-app"]);
    expect(new Set(result.run.worktrees.map((worktree) => path.dirname(worktree.worktreePath)))).toEqual(
      new Set([missionDirectory]),
    );
  });

  it("hydrates submodules in new managed worktrees when the repo declares them", async () => {
    const database = createTestDatabase();
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
              hasSubmodules: true,
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
      runGitCommand: gitRunner,
      runIdFactory: () => "run-1",
      now: () => 1234,
    });

    await service.startRun({
      ticketId: "SPI-151",
      ticketSummary: "Hydrate submodules",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-151",
      projectKey: "SPI",
    });

    const worktreePath = path.join("C:\\Repos", ".spira-worktrees", "spi-151", "service-api");
    expect(gitRunner).toHaveBeenNthCalledWith(1, "C:\\Repos\\service-api", [
      "branch",
      "--list",
      "--format=%(refname:short)",
      "feat/spi-151-hydrate-submodules",
    ]);
    expect(gitRunner).toHaveBeenNthCalledWith(2, "C:\\Repos\\service-api", [
      "worktree",
      "add",
      "-b",
      "feat/spi-151-hydrate-submodules",
      worktreePath,
    ]);
    expect(gitRunner).toHaveBeenNthCalledWith(3, worktreePath, ["submodule", "update", "--init", "--recursive"]);
    expect(gitRunner).toHaveBeenCalledTimes(3);
  });

  it("uses the mission GitHub PAT when hydrating GitHub submodules", async () => {
    const database = createTestDatabase();
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
              hasSubmodules: true,
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
      runGitCommand: gitRunner,
      getMissionGitToken: () => "github-pat",
      runIdFactory: () => "run-1",
      now: () => 1234,
    });

    await service.startRun({
      ticketId: "SPI-151",
      ticketSummary: "Hydrate submodules",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-151",
      projectKey: "SPI",
    });

    const worktreePath = path.join("C:\\Repos", ".spira-worktrees", "spi-151", "service-api");
    const authHeader = Buffer.from("x-access-token:github-pat").toString("base64");
    expect(gitRunner).toHaveBeenNthCalledWith(3, worktreePath, [
      "-c",
      `http.https://github.com/.extraheader=AUTHORIZATION: basic ${authHeader}`,
      "submodule",
      "update",
      "--init",
      "--recursive",
    ]);
    expect(gitRunner).toHaveBeenCalledTimes(3);
  });

  it("fails startup and rolls back newly created worktrees when submodule hydration fails", async () => {
    const database = createTestDatabase();
    const worktreePath = path.join("C:\\Repos", ".spira-worktrees", "spi-152", "service-api");
    let branchCreated = false;
    const gitRunner = vi.fn().mockImplementation(async (cwd: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (
        cwd === "C:\\Repos\\service-api" &&
        command === "branch --list --format=%(refname:short) feat/spi-152-fail-submodule-hydration"
      ) {
        return { stdout: branchCreated ? "feat/spi-152-fail-submodule-hydration\n" : "", stderr: "" };
      }
      if (
        cwd === "C:\\Repos\\service-api" &&
        command === `worktree add -b feat/spi-152-fail-submodule-hydration ${worktreePath}`
      ) {
        branchCreated = true;
        return { stdout: "", stderr: "" };
      }
      if (cwd === worktreePath && command === "submodule update --init --recursive") {
        throw new Error("Submodule auth failed");
      }
      if (cwd === "C:\\Repos\\service-api" && command === `worktree remove --force ${worktreePath}`) {
        return { stdout: "", stderr: "" };
      }
      if (cwd === "C:\\Repos\\service-api" && command === "branch -D feat/spi-152-fail-submodule-hydration") {
        branchCreated = false;
        return { stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected git command in ${cwd}: ${command}`);
    });
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
              hasSubmodules: true,
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
      runGitCommand: gitRunner,
      runIdFactory: () => "run-1",
      now: () => 1234,
    });

    const result = await service.startRun({
      ticketId: "SPI-152",
      ticketSummary: "Fail submodule hydration",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-152",
      projectKey: "SPI",
    });

    expect(result.run.status).toBe("error");
    expect(result.run.statusMessage).toBe("Failed to hydrate submodules for service-api.");
    expect(gitRunner).toHaveBeenNthCalledWith(1, "C:\\Repos\\service-api", [
      "branch",
      "--list",
      "--format=%(refname:short)",
      "feat/spi-152-fail-submodule-hydration",
    ]);
    expect(gitRunner).toHaveBeenNthCalledWith(2, "C:\\Repos\\service-api", [
      "worktree",
      "add",
      "-b",
      "feat/spi-152-fail-submodule-hydration",
      worktreePath,
    ]);
    expect(gitRunner).toHaveBeenNthCalledWith(3, worktreePath, ["submodule", "update", "--init", "--recursive"]);
    expect(gitRunner).toHaveBeenNthCalledWith(4, "C:\\Repos\\service-api", [
      "worktree",
      "remove",
      "--force",
      worktreePath,
    ]);
    expect(gitRunner).toHaveBeenNthCalledWith(5, "C:\\Repos\\service-api", [
      "branch",
      "--list",
      "--format=%(refname:short)",
      "feat/spi-152-fail-submodule-hydration",
    ]);
    expect(gitRunner).toHaveBeenNthCalledWith(6, "C:\\Repos\\service-api", [
      "branch",
      "-D",
      "feat/spi-152-fail-submodule-hydration",
    ]);
    expect(gitRunner).toHaveBeenCalledTimes(6);
  });

  it("surfaces a mission GitHub PAT hint when private submodule auth is missing", async () => {
    const database = createTestDatabase();
    const worktreePath = path.join("C:\\Repos", ".spira-worktrees", "spi-153", "service-api");
    let branchCreated = false;
    const gitRunner = vi.fn().mockImplementation(async (cwd: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (
        cwd === "C:\\Repos\\service-api" &&
        command === "branch --list --format=%(refname:short) feat/spi-153-private-submodule-auth"
      ) {
        return { stdout: branchCreated ? "feat/spi-153-private-submodule-auth\n" : "", stderr: "" };
      }
      if (
        cwd === "C:\\Repos\\service-api" &&
        command === `worktree add -b feat/spi-153-private-submodule-auth ${worktreePath}`
      ) {
        branchCreated = true;
        return { stdout: "", stderr: "" };
      }
      if (cwd === worktreePath && command === "submodule update --init --recursive") {
        throw new Error(
          "Command failed: git submodule update --init --recursive\nfatal: Cannot prompt because user interactivity has been disabled.\nfatal: could not read Username for 'https://github.com': terminal prompts disabled\n",
        );
      }
      if (cwd === "C:\\Repos\\service-api" && command === `worktree remove --force ${worktreePath}`) {
        return { stdout: "", stderr: "" };
      }
      if (cwd === "C:\\Repos\\service-api" && command === "branch -D feat/spi-153-private-submodule-auth") {
        branchCreated = false;
        return { stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected git command in ${cwd}: ${command}`);
    });
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
              hasSubmodules: true,
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
      runGitCommand: gitRunner,
      runIdFactory: () => "run-1",
      now: () => 1234,
    });

    const result = await service.startRun({
      ticketId: "SPI-153",
      ticketSummary: "Private submodule auth",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-153",
      projectKey: "SPI",
    });

    expect(result.run.status).toBe("error");
    expect(result.run.statusMessage).toBe(
      "Failed to hydrate submodules for service-api. Set a mission GitHub PAT in Settings so Spira can clone private GitHub submodules.",
    );
    expect(gitRunner).toHaveBeenNthCalledWith(3, worktreePath, ["submodule", "update", "--init", "--recursive"]);
    expect(gitRunner).toHaveBeenNthCalledWith(6, "C:\\Repos\\service-api", [
      "branch",
      "-D",
      "feat/spi-153-private-submodule-auth",
    ]);
    expect(gitRunner).toHaveBeenCalledTimes(6);
  });

  it("reuses an existing local mission branch when recreating a missing worktree", async () => {
    const database = createTestDatabase();
    const gitRunner = vi.fn().mockImplementation(async (cwd: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (
        cwd === "C:\\Repos\\service-api" &&
        command === "branch --list --format=%(refname:short) feat/spi-154-reuse-existing-branch"
      ) {
        return { stdout: "feat/spi-154-reuse-existing-branch\n", stderr: "" };
      }
      if (
        cwd === "C:\\Repos\\service-api" &&
        command ===
          `worktree add ${path.join("C:\\Repos", ".spira-worktrees", "spi-154", "service-api")} feat/spi-154-reuse-existing-branch`
      ) {
        return { stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected git command in ${cwd}: ${command}`);
    });
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
      runGitCommand: gitRunner,
      runIdFactory: () => "run-1",
      now: () => 1234,
    });

    const result = await service.startRun({
      ticketId: "SPI-154",
      ticketSummary: "Reuse existing branch",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-154",
      projectKey: "SPI",
    });

    expect(result.run.status).toBe("ready");
    expect(gitRunner).toHaveBeenNthCalledWith(2, "C:\\Repos\\service-api", [
      "worktree",
      "add",
      path.join("C:\\Repos", ".spira-worktrees", "spi-154", "service-api"),
      "feat/spi-154-reuse-existing-branch",
    ]);
    expect(gitRunner).toHaveBeenCalledTimes(2);
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
      path.join("C:\\Repos", ".spira-worktrees", "spi-104", "service-api"),
    ]);
  });

  it("resumes a starting run with an existing worktree instead of recreating it", async () => {
    const database = createTestDatabase();
    const worktreePath = mkdtempSync(path.join(os.tmpdir(), "spira-existing-worktree-"));
    tempDirs.push(worktreePath);
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
          worktreePath,
          branchName: "feat/spi-105-resume-interrupted-run",
        },
      ],
    });
    const gitRunner = vi.fn().mockImplementation(async (cwd: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (cwd === worktreePath && command === "rev-parse --git-dir") {
        return { stdout: ".git\n", stderr: "" };
      }
      throw new Error(`Unexpected git command in ${cwd}: ${command}`);
    });
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

    expect(gitRunner).toHaveBeenCalledTimes(1);
    expect(gitRunner).toHaveBeenCalledWith(worktreePath, ["rev-parse", "--git-dir"]);
    expect(transitionTicket).toHaveBeenCalledWith("SPI-105");
    expect(result.run.status).toBe("ready");
  });

  it("rehydrates submodules when resuming an interrupted start", async () => {
    const database = createTestDatabase();
    const worktreePath = mkdtempSync(path.join(os.tmpdir(), "spira-existing-worktree-"));
    tempDirs.push(worktreePath);
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
          worktreePath,
          branchName: "feat/spi-105-resume-interrupted-run",
        },
      ],
    });
    const gitRunner = vi.fn().mockImplementation(async (cwd: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (cwd === worktreePath && command === "rev-parse --git-dir") {
        return { stdout: ".git\n", stderr: "" };
      }
      if (cwd === worktreePath && command === "submodule update --init --recursive") {
        return { stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected git command in ${cwd}: ${command}`);
    });
    const transitionTicket = vi.fn().mockResolvedValue(undefined);
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
              hasSubmodules: true,
              mappedProjectKeys: ["SPI"],
            },
          ],
          mappings: [],
        }),
      },
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

    expect(gitRunner).toHaveBeenCalledTimes(2);
    expect(gitRunner).toHaveBeenNthCalledWith(1, worktreePath, ["rev-parse", "--git-dir"]);
    expect(gitRunner).toHaveBeenNthCalledWith(2, worktreePath, ["submodule", "update", "--init", "--recursive"]);
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

  it("retries an errored continuation when earlier review attempts already exist", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-108",
      ticketSummary: "Recover failed continuation",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-108",
      projectKey: "SPI",
      status: "error",
      statusMessage: "Failed to start mission work.",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-108-service-api",
          branchName: "feat/spi-108-recover-failed-continuation",
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
        reusedLiveAttempt: false,
        completion: Promise.resolve({ status: "completed", summary: "Recovery pass landed." }),
      }),
      attemptIdFactory: () => "attempt-2",
      now: () => 200,
    });

    const result = await service.continueWork("run-1", "Retry the follow-up pass with more diagnostics.");
    expect(result.reusedLiveAttempt).toBe(false);
    expect(result.run.status).toBe("working");
    expect(result.run.attempts[1]).toMatchObject({
      attemptId: "attempt-2",
      sequence: 2,
      prompt: "Retry the follow-up pass with more diagnostics.",
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

  it("closes a review-clean run and releases its mission station", async () => {
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
      if (command === "remote get-url origin") {
        return { stdout: "https://github.com/example/service-api.git\n", stderr: "" };
      }
      if (command === "symbolic-ref --short refs/remotes/origin/HEAD") {
        return { stdout: "origin/main\n", stderr: "" };
      }
      if (command.includes("rev-parse --abbrev-ref --symbolic-full-name @{upstream}")) {
        throw new Error("no upstream");
      }
      if (command === "status --porcelain=v1 --untracked-files=all --ignore-submodules=none") {
        return { stdout: "", stderr: "" };
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
      if (command === "ls-files --others --exclude-standard -z") {
        return { stdout: "", stderr: "" };
      }
      if (command === "rev-list --count HEAD --not --remotes=origin") {
        return { stdout: "0\n", stderr: "" };
      }
      throw new Error(`Unexpected git command: ${command}`);
    });
    const stopRunServices = vi.fn().mockResolvedValue(undefined);
    const closeMissionStation = vi.fn().mockResolvedValue(undefined);
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: null,
      runGitCommand: gitRunner,
      stopRunServices,
      closeMissionStation,
      now: () => 500,
    });

    const result = await service.completeRun("run-1");

    expect(stopRunServices).toHaveBeenCalledWith("run-1");
    expect(closeMissionStation).toHaveBeenCalledWith("mission:run-1");
    expect(result.run).toMatchObject({
      status: "done",
      stationId: null,
      statusMessage: "Mission closed.",
      commitMessageDraft: null,
    });
  });

  it("blocks closing when review work remains", async () => {
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
      if (command === "remote get-url origin") {
        return { stdout: "https://github.com/example/service-api.git\n", stderr: "" };
      }
      if (command === "symbolic-ref --short refs/remotes/origin/HEAD") {
        return { stdout: "origin/main\n", stderr: "" };
      }
      if (command.includes("rev-parse --abbrev-ref --symbolic-full-name @{upstream}")) {
        throw new Error("no upstream");
      }
      if (command === "status --porcelain=v1 --untracked-files=all --ignore-submodules=none") {
        return { stdout: " M src/mission.ts\n", stderr: "" };
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
      if (command === "ls-files --others --exclude-standard -z") {
        return { stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected git command: ${command}`);
    });
    const closeMissionStation = vi.fn().mockResolvedValue(undefined);
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: null,
      runGitCommand: gitRunner,
      closeMissionStation,
      now: () => 500,
    });

    await expect(service.completeRun("run-1")).rejects.toThrow(
      "Finish the remaining mission review work before closing SPI-110: service-api.",
    );
    expect(closeMissionStation).not.toHaveBeenCalled();
  });

  it("blocks closing while a proof run is still active", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-1",
      stationId: "mission:run-1",
      ticketId: "SPI-110",
      ticketSummary: "Wait for proof completion",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-110",
      projectKey: "SPI",
      status: "awaiting-review",
      createdAt: 100,
      startedAt: 100,
      worktrees: [],
      proof: {
        status: "running",
        lastProofRunId: "proof-1",
        lastProofProfileId: "builtin:legapp-admin-ui-proof:run-1:web-app",
        lastProofAt: null,
        lastProofSummary: null,
        staleReason: null,
      },
      proofRuns: [
        {
          proofRunId: "proof-1",
          profileId: "builtin:legapp-admin-ui-proof:run-1:web-app",
          profileLabel: "LegApp Admin UI proof",
          status: "running",
          summary: "Proof is in flight.",
          startedAt: 150,
          completedAt: null,
          exitCode: null,
          command: "dotnet test .\\LegApp.Admin.UI.Tests\\LegApp.Admin.UI.Tests.csproj",
          artifacts: [],
        },
      ],
    });
    const closeMissionStation = vi.fn().mockResolvedValue(undefined);
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: null,
      closeMissionStation,
      now: () => 500,
    });

    await expect(service.completeRun("run-1")).rejects.toThrow(
      "Wait for the active proof run to finish before closing SPI-110.",
    );
    expect(closeMissionStation).not.toHaveBeenCalled();
  });

  it("runs a discovered mission proof and persists the result", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-111",
      ticketSummary: "Prove mission completion",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-111",
      projectKey: "SPI",
      status: "awaiting-review",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "web-app",
          repoAbsolutePath: "C:\\Repos\\web-app",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-111\\web-app",
          branchName: "feat/spi-111-prove-mission-completion",
        },
      ],
    });
    const discoverMissionProofProfiles = vi.fn().mockResolvedValue([
      {
        profileId: "builtin:legapp-admin-ui-proof:run-1:web-app",
        label: "LegApp Admin UI proof",
        description: "Runs the discovered Playwright harness.",
        kind: "playwright-dotnet-nunit" as const,
        repoRelativePath: "web-app",
        projectRelativePath: "LegApp.Admin.UI.Tests\\LegApp.Admin.UI.Tests.csproj",
        runSettingsRelativePath: "LegApp.Admin.UI.Tests\\TestConfiguration.runsettings",
        command: "dotnet",
        args: ["test", ".\\LegApp.Admin.UI.Tests\\LegApp.Admin.UI.Tests.csproj"],
        workingDirectory: "C:\\Repos\\.spira-worktrees\\spi-111\\web-app",
      },
    ]);
    const runMissionProof = vi.fn().mockResolvedValue({
      status: "passed" as const,
      summary: "UI proof passed.",
      startedAt: 200,
      completedAt: 260,
      exitCode: 0,
      command: "dotnet test .\\LegApp.Admin.UI.Tests\\LegApp.Admin.UI.Tests.csproj",
      artifacts: [
        {
          artifactId: "artifact-1",
          label: "Proof report",
          kind: "report" as const,
          path: "C:\\Repos\\.spira-worktrees\\spi-111\\.spira-proof\\proof-1\\summary.json",
          fileUrl: "file:///C:/Repos/.spira-worktrees/spi-111/.spira-proof/proof-1/summary.json",
        },
      ],
    });
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: null,
      discoverMissionProofProfiles,
      runMissionProof,
      runIdFactory: () => "proof-1",
      now: () => 200,
    });

    const result = await service.runProof("run-1", "builtin:legapp-admin-ui-proof:run-1:web-app");

    expect(discoverMissionProofProfiles).toHaveBeenCalledTimes(1);
    expect(runMissionProof).toHaveBeenCalledWith(
      expect.objectContaining({
        proofRunId: "proof-1",
      }),
    );
    expect(result.run.proof).toMatchObject({
      status: "passed",
      lastProofRunId: "proof-1",
      lastProofProfileId: "builtin:legapp-admin-ui-proof:run-1:web-app",
      lastProofAt: 260,
      lastProofSummary: "UI proof passed.",
    });
    expect(result.proofSnapshot).toMatchObject({
      profiles: [
        {
          profileId: "builtin:legapp-admin-ui-proof:run-1:web-app",
          repoRelativePath: "web-app",
        },
      ],
      proof: {
        status: "passed",
      },
      proofRuns: [
        {
          proofRunId: "proof-1",
          status: "passed",
        },
      ],
    });
    expect(database.getTicketRun("run-1")).toMatchObject({
      proof: {
        status: "passed",
        lastProofRunId: "proof-1",
      },
      proofRuns: [
        {
          proofRunId: "proof-1",
          status: "passed",
          artifacts: [
            {
              artifactId: "artifact-1",
              kind: "report",
            },
          ],
        },
      ],
    });
  });

  it("commits an awaiting-review run with the resolved mission git identity and clears the draft", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-111",
      ticketSummary: "Commit completed mission work",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-111",
      projectKey: "SPI",
      status: "awaiting-review",
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
      if (command === "add -A") {
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
    expect(gitRunner).toHaveBeenCalledWith("C:\\Repos\\.spira-worktrees\\spi-111-service-api", ["add", "-A"]);
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

  it("publishes an awaiting-review run when the branch has no upstream", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-112",
      ticketSummary: "Publish mission branch",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-112",
      projectKey: "SPI",
      status: "awaiting-review",
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
      status: "awaiting-review",
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

  it("includes untracked files in mission git state", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-117",
      ticketSummary: "Track untracked files",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-117",
      projectKey: "SPI",
      status: "awaiting-review",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-117-service-api",
          branchName: "feat/spi-117-track-untracked-files",
        },
      ],
    });
    const gitRunner = vi.fn().mockImplementation(async (_cwd: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (command === "remote get-url origin") {
        return { stdout: "https://github.com/example/service-api.git\n", stderr: "" };
      }
      if (command === "symbolic-ref --short refs/remotes/origin/HEAD") {
        return { stdout: "origin/main\n", stderr: "" };
      }
      if (command.includes("rev-parse --abbrev-ref --symbolic-full-name @{upstream}")) {
        return { stdout: "origin/feat/spi-117-track-untracked-files\n", stderr: "" };
      }
      if (command.startsWith("rev-list --left-right --count")) {
        return { stdout: "0 0\n", stderr: "" };
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
      if (command === "ls-files --others --exclude-standard -z") {
        return { stdout: "src/new-file.ts\u0000", stderr: "" };
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

    expect(result.gitState.hasDiff).toBe(true);
    expect(result.gitState.files).toEqual([
      {
        path: "src/new-file.ts",
        previousPath: null,
        status: "A",
        additions: null,
        deletions: null,
        patch: "",
      },
    ]);
  });

  it("builds a review snapshot for shared submodule missions", async () => {
    const database = createTestDatabase();
    const branchName = "feat/spi-118-review-shared-submodule";
    const canonicalUrl = "github.com/example/legapp-common";
    const missionRoot = mkdtempSync(path.join(os.tmpdir(), "spira-review-snapshot-"));
    tempDirs.push(missionRoot);
    const serviceApiWorktreePath = path.join(missionRoot, "service-api");
    const webAppWorktreePath = path.join(missionRoot, "web-app");
    const serviceApiSubmodulePath = path.join(serviceApiWorktreePath, "Submodules", "LegAppCommon");
    const webAppSubmodulePath = path.join(webAppWorktreePath, "Submodules", "LegAppCommon");
    mkdirSync(serviceApiWorktreePath, { recursive: true });
    mkdirSync(webAppWorktreePath, { recursive: true });
    writeFileSync(
      path.join(serviceApiWorktreePath, ".gitmodules"),
      '[submodule "LegAppCommon"]\n\tpath = Submodules\\LegAppCommon\n\turl = https://github.com/example/legapp-common.git\n',
    );
    writeFileSync(
      path.join(webAppWorktreePath, ".gitmodules"),
      '[submodule "LegAppCommon"]\n\tpath = Submodules\\LegAppCommon\n\turl = https://github.com/example/legapp-common.git\n',
    );
    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-118",
      ticketSummary: "Review shared submodule state once",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-118",
      projectKey: "SPI",
      status: "awaiting-review",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: serviceApiWorktreePath,
          branchName,
        },
        {
          repoRelativePath: "web-app",
          repoAbsolutePath: "C:\\Repos\\web-app",
          worktreePath: webAppWorktreePath,
          branchName,
        },
      ],
      submodules: [],
    });
    const gitRunner = vi.fn().mockImplementation(async (cwd: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (
        (cwd === serviceApiWorktreePath || cwd === webAppWorktreePath) &&
        command === "config --file .gitmodules --get-regexp ^submodule\\..*\\.(path|url)$"
      ) {
        return {
          stdout:
            "submodule.LegAppCommon.path Submodules\\LegAppCommon\nsubmodule.LegAppCommon.url https://github.com/example/legapp-common.git\n",
          stderr: "",
        };
      }
      if (command === "remote get-url origin") {
        if (cwd === serviceApiWorktreePath) {
          return { stdout: "https://github.com/example/service-api.git\n", stderr: "" };
        }
        if (cwd === webAppWorktreePath) {
          return { stdout: "https://github.com/example/web-app.git\n", stderr: "" };
        }
        return { stdout: "https://github.com/example/legapp-common.git\n", stderr: "" };
      }
      if (command === "symbolic-ref --short refs/remotes/origin/HEAD") {
        return { stdout: "origin/main\n", stderr: "" };
      }
      if (command.includes("rev-parse --abbrev-ref --symbolic-full-name @{upstream}")) {
        return { stdout: `origin/${branchName}\n`, stderr: "" };
      }
      if (command.startsWith("rev-list --left-right --count")) {
        return { stdout: "0 0\n", stderr: "" };
      }
      if (command === "status --porcelain=v1 --untracked-files=all --ignore-submodules=none") {
        if (cwd === serviceApiWorktreePath || cwd === webAppWorktreePath) {
          return { stdout: " M Submodules\\LegAppCommon\n", stderr: "" };
        }
        if (cwd === serviceApiSubmodulePath || cwd === webAppSubmodulePath) {
          return { stdout: " M Shared\\Thing.cs\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      }
      if (command === "rev-parse HEAD") {
        return { stdout: "1234567890abcdef\n", stderr: "" };
      }
      if (command === "ls-files --others --exclude-standard -z") {
        return { stdout: "", stderr: "" };
      }
      if (cwd === serviceApiSubmodulePath || cwd === webAppSubmodulePath) {
        if (command.includes("diff --find-renames --find-copies --name-status HEAD --")) {
          return { stdout: "M\tShared\\Thing.cs\n", stderr: "" };
        }
        if (command.includes("diff --find-renames --find-copies --numstat HEAD --")) {
          return { stdout: "1\t1\tShared\\Thing.cs\n", stderr: "" };
        }
        if (command.includes("diff --find-renames --find-copies --patch --no-color HEAD --")) {
          return {
            stdout:
              "diff --git a/Shared/Thing.cs b/Shared/Thing.cs\n--- a/Shared/Thing.cs\n+++ b/Shared/Thing.cs\n@@ -1 +1 @@\n-old\n+new\n",
            stderr: "",
          };
        }
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
      throw new Error(`Unexpected git command in ${cwd}: ${command}`);
    });
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: null,
      runGitCommand: gitRunner,
      now: () => 500,
    });

    const result = await service.getReviewSnapshot("run-1");

    expect(result.run.submodules).toEqual([
      expect.objectContaining({
        canonicalUrl,
        name: "LegAppCommon",
      }),
    ]);
    expect(result.reviewSnapshot.visibleSubmoduleUrls).toEqual([canonicalUrl]);
    expect(result.reviewSnapshot.visibleRepoPaths).toEqual(["service-api", "web-app"]);
    expect(result.reviewSnapshot.canClose).toBe(false);
    expect(result.reviewSnapshot.repoEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          repoRelativePath: "service-api",
          error: null,
          gitState: expect.objectContaining({
            blockedBySubmoduleCanonicalUrls: [canonicalUrl],
          }),
        }),
        expect.objectContaining({
          repoRelativePath: "web-app",
          error: null,
          gitState: expect.objectContaining({
            blockedBySubmoduleCanonicalUrls: [canonicalUrl],
          }),
        }),
      ]),
    );
  });

  it("keeps review closure blocked when a managed submodule fails to load", async () => {
    const database = createTestDatabase();
    const branchName = "feat/spi-119-review-submodule-error";
    const canonicalUrl = "github.com/example/legapp-common";
    const missionRoot = mkdtempSync(path.join(os.tmpdir(), "spira-review-snapshot-error-"));
    tempDirs.push(missionRoot);
    const worktreePath = path.join(missionRoot, "service-api");
    const submoduleWorktreePath = path.join(worktreePath, "Submodules", "LegAppCommon");
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(
      path.join(worktreePath, ".gitmodules"),
      '[submodule "LegAppCommon"]\n\tpath = Submodules\\LegAppCommon\n\turl = https://github.com/example/legapp-common.git\n',
    );
    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-119",
      ticketSummary: "Review shared submodule load error",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-119",
      projectKey: "SPI",
      status: "awaiting-review",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath,
          branchName,
        },
      ],
      submodules: [
        {
          canonicalUrl,
          name: "LegAppCommon",
          branchName,
          commitMessageDraft: null,
          parentRefs: [
            {
              parentRepoRelativePath: "service-api",
              submodulePath: "Submodules\\LegAppCommon",
              submoduleWorktreePath,
            },
          ],
        },
      ],
    });
    const gitRunner = vi.fn().mockImplementation(async (cwd: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (cwd === worktreePath && command === "config --file .gitmodules --get-regexp ^submodule\\..*\\.(path|url)$") {
        return {
          stdout:
            "submodule.LegAppCommon.path Submodules\\LegAppCommon\nsubmodule.LegAppCommon.url https://github.com/example/legapp-common.git\n",
          stderr: "",
        };
      }
      if (cwd === worktreePath && command === "remote get-url origin") {
        return { stdout: "https://github.com/example/service-api.git\n", stderr: "" };
      }
      if (cwd === worktreePath && command === "symbolic-ref --short refs/remotes/origin/HEAD") {
        return { stdout: "origin/main\n", stderr: "" };
      }
      if (cwd === worktreePath && command.includes("rev-parse --abbrev-ref --symbolic-full-name @{upstream}")) {
        return { stdout: `origin/${branchName}\n`, stderr: "" };
      }
      if (cwd === worktreePath && command.startsWith("rev-list --left-right --count")) {
        return { stdout: "0 0\n", stderr: "" };
      }
      if (cwd === worktreePath && command === "status --porcelain=v1 --untracked-files=all --ignore-submodules=none") {
        return { stdout: "", stderr: "" };
      }
      if (cwd === worktreePath && command === "rev-parse HEAD") {
        return { stdout: "1234567890abcdef\n", stderr: "" };
      }
      if (cwd === worktreePath && command === "ls-files --others --exclude-standard -z") {
        return { stdout: "", stderr: "" };
      }
      if (cwd === worktreePath && command.includes("diff --find-renames --find-copies --name-status HEAD --")) {
        return { stdout: "", stderr: "" };
      }
      if (cwd === worktreePath && command.includes("diff --find-renames --find-copies --numstat HEAD --")) {
        return { stdout: "", stderr: "" };
      }
      if (cwd === worktreePath && command.includes("diff --find-renames --find-copies --patch --no-color HEAD --")) {
        return { stdout: "", stderr: "" };
      }
      if (cwd === submoduleWorktreePath) {
        throw new Error("Submodule state unavailable");
      }
      throw new Error(`Unexpected git command in ${cwd}: ${command}`);
    });
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: null,
      runGitCommand: gitRunner,
      now: () => 500,
    });

    const result = await service.getReviewSnapshot("run-1");

    expect(result.reviewSnapshot.canClose).toBe(false);
    expect(result.reviewSnapshot.visibleSubmoduleUrls).toEqual([canonicalUrl]);
    expect(result.reviewSnapshot.submoduleEntries).toEqual([
      expect.objectContaining({
        canonicalUrl,
        gitState: null,
        error: "Submodule state unavailable",
      }),
    ]);
    expect(result.reviewSnapshot.repoEntries).toEqual([
      expect.objectContaining({
        repoRelativePath: "service-api",
        error: null,
        gitState: expect.objectContaining({
          blockedBySubmoduleCanonicalUrls: [canonicalUrl],
        }),
      }),
    ]);
  });

  it("persists commit drafts on the selected repo worktree", async () => {
    const database = createTestDatabase();
    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-114",
      ticketSummary: "Target repo commit draft",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-114",
      projectKey: "SPI",
      status: "awaiting-review",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-114\\service-api",
          branchName: "feat/spi-114-target-repo-commit-draft",
          commitMessageDraft: null,
        },
        {
          repoRelativePath: "web-app",
          repoAbsolutePath: "C:\\Repos\\web-app",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-114\\web-app",
          branchName: "feat/spi-114-target-repo-commit-draft",
          commitMessageDraft: null,
        },
      ],
    });
    const gitRunner = vi.fn().mockImplementation(async (cwd: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (command === "remote get-url origin") {
        return {
          stdout: cwd.endsWith("\\web-app")
            ? "https://github.com/example/web-app.git\n"
            : "https://github.com/example/service-api.git\n",
          stderr: "",
        };
      }
      if (command.includes("rev-parse --abbrev-ref --symbolic-full-name @{upstream}")) {
        throw new Error("no upstream");
      }
      if (command.includes("diff --find-renames --find-copies --name-status HEAD --")) {
        return { stdout: cwd.endsWith("\\web-app") ? "M\tsrc/app.tsx\n" : "", stderr: "" };
      }
      if (command.includes("diff --find-renames --find-copies --numstat HEAD --")) {
        return { stdout: cwd.endsWith("\\web-app") ? "2\t1\tsrc/app.tsx\n" : "", stderr: "" };
      }
      if (command.includes("diff --find-renames --find-copies --patch --no-color HEAD --")) {
        return {
          stdout: cwd.endsWith("\\web-app")
            ? "diff --git a/src/app.tsx b/src/app.tsx\n--- a/src/app.tsx\n+++ b/src/app.tsx\n@@ -1 +1 @@\n-old\n+new\n"
            : "",
          stderr: "",
        };
      }
      if (command === "rev-list --count HEAD --not --remotes=origin") {
        return { stdout: "0\n", stderr: "" };
      }
      throw new Error(`Unexpected git command in ${cwd}: ${command}`);
    });
    const service = new TicketRunService({
      memoryDb: database,
      logger: createLogger(),
      projectRegistry: { getSnapshot: async () => ({ workspaceRoot: null, repos: [], mappings: [] }) },
      youTrackService: null,
      runGitCommand: gitRunner,
      now: () => 500,
    });

    const result = await service.setCommitDraft("run-1", "feat(SPI-114): polish web app", "web-app");

    expect(result.gitState.repoRelativePath).toBe("web-app");
    expect(result.gitState.commitMessageDraft).toBe("feat(SPI-114): polish web app");
    expect(result.run.commitMessageDraft).toBeNull();
    expect(result.run.worktrees).toMatchObject([
      {
        repoRelativePath: "service-api",
        commitMessageDraft: null,
      },
      {
        repoRelativePath: "web-app",
        commitMessageDraft: "feat(SPI-114): polish web app",
      },
    ]);
    expect(new Set(gitRunner.mock.calls.map(([cwd]) => cwd))).toEqual(
      new Set(["C:\\Repos\\.spira-worktrees\\spi-114\\web-app"]),
    );
  });

  it("commits a managed submodule during awaiting review and clears its draft", async () => {
    const database = createTestDatabase();
    const parentWorktreePath = "C:\\Repos\\.spira-worktrees\\spi-201\\service-api";
    const submoduleWorktreePath = `${parentWorktreePath}\\Submodules\\LegAppCommon`;
    const branchName = "feat/spi-201-update-shared-common";
    const canonicalUrl = "github.com/example/legapp-common";
    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-201",
      ticketSummary: "Update shared common models",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-201",
      projectKey: "SPI",
      status: "awaiting-review",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: parentWorktreePath,
          branchName,
        },
      ],
      submodules: [
        {
          canonicalUrl,
          name: "LegAppCommon",
          branchName,
          commitMessageDraft: "feat(SPI-201): update shared common models",
          parentRefs: [
            {
              parentRepoRelativePath: "service-api",
              submodulePath: "Submodules\\LegAppCommon",
              submoduleWorktreePath,
            },
          ],
        },
      ],
    });
    let committed = false;
    const gitRunner = vi.fn().mockImplementation(async (cwd: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (
        cwd === parentWorktreePath &&
        command === "config --file .gitmodules --get-regexp ^submodule\\..*\\.(path|url)$"
      ) {
        return {
          stdout:
            "submodule.LegAppCommon.path Submodules\\LegAppCommon\nsubmodule.LegAppCommon.url https://github.com/example/legapp-common.git\n",
          stderr: "",
        };
      }
      if (cwd !== submoduleWorktreePath) {
        throw new Error(`Unexpected git command in ${cwd}: ${command}`);
      }
      if (command === "remote get-url origin") {
        return { stdout: "https://github.com/example/legapp-common.git\n", stderr: "" };
      }
      if (command === "symbolic-ref --short refs/remotes/origin/HEAD") {
        return { stdout: "origin/main\n", stderr: "" };
      }
      if (command.includes("rev-parse --abbrev-ref --symbolic-full-name @{upstream}")) {
        throw new Error("no upstream");
      }
      if (command.includes("diff --find-renames --find-copies --name-status HEAD --")) {
        return { stdout: committed ? "" : "M\tLegApp.Common.Models/Api/Request.cs\n", stderr: "" };
      }
      if (command.includes("diff --find-renames --find-copies --numstat HEAD --")) {
        return { stdout: committed ? "" : "3\t1\tLegApp.Common.Models/Api/Request.cs\n", stderr: "" };
      }
      if (command.includes("diff --find-renames --find-copies --patch --no-color HEAD --")) {
        return {
          stdout: committed
            ? ""
            : "diff --git a/LegApp.Common.Models/Api/Request.cs b/LegApp.Common.Models/Api/Request.cs\n--- a/LegApp.Common.Models/Api/Request.cs\n+++ b/LegApp.Common.Models/Api/Request.cs\n@@ -1 +1 @@\n-old\n+new\n",
          stderr: "",
        };
      }
      if (command === "rev-list --count HEAD --not --remotes=origin") {
        return { stdout: committed ? "1\n" : "0\n", stderr: "" };
      }
      if (command === "rev-parse HEAD") {
        return {
          stdout: committed
            ? "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n"
            : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
          stderr: "",
        };
      }
      if (command === "branch --show-current") {
        return { stdout: committed ? `${branchName}\n` : "", stderr: "" };
      }
      if (command === `checkout -B ${branchName}`) {
        return { stdout: "", stderr: "" };
      }
      if (command === "add -A") {
        return { stdout: "", stderr: "" };
      }
      if (command.includes("commit --author=Shinra <shinra@example.com>")) {
        committed = true;
        return { stdout: "[feat/spi-201 1234567] Commit\n", stderr: "" };
      }
      throw new Error(`Unexpected git command in ${cwd}: ${command}`);
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
    vi.spyOn(service as unknown as EnsureRunSubmodulesTarget, "ensureRunSubmodules").mockImplementation(
      async (run) => run,
    );

    const result = await service.commitSubmodule("run-1", canonicalUrl, "feat(SPI-201): update shared common models");

    expect(result.commitSha).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(result.run.submodules[0]?.commitMessageDraft).toBeNull();
    expect(result.gitState.pushAction).toBe("publish");
    expect(gitRunner).toHaveBeenCalledWith(submoduleWorktreePath, ["add", "-A"]);
  });

  it("publishes a managed submodule once and aligns every parent repo to the same commit", async () => {
    const database = createTestDatabase();
    const branchName = "feat/spi-202-sync-shared-common";
    const canonicalUrl = "github.com/example/legapp-common";
    const primaryParentWorktreePath = "C:\\Repos\\.spira-worktrees\\spi-202\\service-api";
    const secondaryParentWorktreePath = "C:\\Repos\\.spira-worktrees\\spi-202\\web-app";
    const primarySubmodulePath = `${primaryParentWorktreePath}\\Submodules\\LegAppCommon`;
    const secondarySubmodulePath = `${secondaryParentWorktreePath}\\Submodules\\LegAppCommon`;
    const ancestorSha = "1111111111111111111111111111111111111111";
    const canonicalSha = "2222222222222222222222222222222222222222";
    let published = false;
    let secondaryAligned = false;

    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-202",
      ticketSummary: "Publish shared common once",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-202",
      projectKey: "SPI",
      status: "awaiting-review",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: primaryParentWorktreePath,
          branchName,
        },
        {
          repoRelativePath: "web-app",
          repoAbsolutePath: "C:\\Repos\\web-app",
          worktreePath: secondaryParentWorktreePath,
          branchName,
        },
      ],
      submodules: [
        {
          canonicalUrl,
          name: "LegAppCommon",
          branchName,
          commitMessageDraft: null,
          parentRefs: [
            {
              parentRepoRelativePath: "service-api",
              submodulePath: "Submodules\\LegAppCommon",
              submoduleWorktreePath: primarySubmodulePath,
            },
            {
              parentRepoRelativePath: "web-app",
              submodulePath: "Submodules\\LegAppCommon",
              submoduleWorktreePath: secondarySubmodulePath,
            },
          ],
        },
      ],
    });

    const gitRunner = vi.fn().mockImplementation(async (cwd: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (
        (cwd === primaryParentWorktreePath || cwd === secondaryParentWorktreePath) &&
        command === "config --file .gitmodules --get-regexp ^submodule\\..*\\.(path|url)$"
      ) {
        return {
          stdout:
            "submodule.LegAppCommon.path Submodules\\LegAppCommon\nsubmodule.LegAppCommon.url https://github.com/example/legapp-common.git\n",
          stderr: "",
        };
      }
      if (cwd === primarySubmodulePath || cwd === secondarySubmodulePath) {
        if (command === "remote get-url origin") {
          return { stdout: "https://github.com/example/legapp-common.git\n", stderr: "" };
        }
        if (command === "symbolic-ref --short refs/remotes/origin/HEAD") {
          return { stdout: "origin/main\n", stderr: "" };
        }
        if (command.includes("rev-parse --abbrev-ref --symbolic-full-name @{upstream}")) {
          if (published && cwd === primarySubmodulePath) {
            return { stdout: `origin/${branchName}\n`, stderr: "" };
          }
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
          return { stdout: cwd === primarySubmodulePath && !published ? "1\n" : "0\n", stderr: "" };
        }
        if (command.startsWith("rev-list --left-right --count")) {
          return { stdout: "0 0\n", stderr: "" };
        }
        if (command === "rev-parse HEAD") {
          return {
            stdout: cwd === primarySubmodulePath || secondaryAligned ? `${canonicalSha}\n` : `${ancestorSha}\n`,
            stderr: "",
          };
        }
        if (command === "branch --show-current") {
          return { stdout: cwd === primarySubmodulePath ? `${branchName}\n` : "", stderr: "" };
        }
        if (command.includes(`push --set-upstream origin ${branchName}`)) {
          published = true;
          return { stdout: "", stderr: "" };
        }
        if (command === `fetch origin ${branchName}`) {
          return { stdout: "", stderr: "" };
        }
        if (command === `checkout --detach ${canonicalSha}`) {
          secondaryAligned = true;
          return { stdout: "", stderr: "" };
        }
        if (
          command === `rev-parse --verify ${ancestorSha}^{commit}` ||
          command === `rev-parse --verify ${canonicalSha}^{commit}`
        ) {
          return { stdout: `${command.includes(canonicalSha) ? canonicalSha : ancestorSha}\n`, stderr: "" };
        }
        if (command === `merge-base --is-ancestor ${ancestorSha} ${canonicalSha}`) {
          return { stdout: "", stderr: "" };
        }
      }

      if (cwd === primaryParentWorktreePath || cwd === secondaryParentWorktreePath) {
        if (command === "add Submodules\\LegAppCommon") {
          return { stdout: "", stderr: "" };
        }
      }

      throw new Error(`Unexpected git command in ${cwd}: ${command}`);
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
    vi.spyOn(service as unknown as EnsureRunSubmodulesTarget, "ensureRunSubmodules").mockImplementation(
      async (run) => run,
    );

    const result = await service.publishSubmodule("run-1", canonicalUrl);

    expect(result.action).toBe("publish");
    expect(result.gitState.pushAction).toBe("none");
    expect(result.gitState.parents.every((parent) => parent.isAligned)).toBe(true);
    expect(gitRunner).toHaveBeenCalledWith(secondarySubmodulePath, ["fetch", "origin", branchName]);
    expect(gitRunner).toHaveBeenCalledWith(secondarySubmodulePath, ["checkout", "--detach", canonicalSha]);
    expect(gitRunner).toHaveBeenCalledWith(primaryParentWorktreePath, ["add", "Submodules\\LegAppCommon"]);
    expect(gitRunner).toHaveBeenCalledWith(secondaryParentWorktreePath, ["add", "Submodules\\LegAppCommon"]);
  });

  it("retries managed submodule parent alignment after the remote is already up to date", async () => {
    const database = createTestDatabase();
    const branchName = "feat/spi-203-realign-shared-common";
    const canonicalUrl = "github.com/example/legapp-common";
    const primaryParentWorktreePath = "C:\\Repos\\.spira-worktrees\\spi-203\\service-api";
    const secondaryParentWorktreePath = "C:\\Repos\\.spira-worktrees\\spi-203\\web-app";
    const primarySubmodulePath = `${primaryParentWorktreePath}\\Submodules\\LegAppCommon`;
    const secondarySubmodulePath = `${secondaryParentWorktreePath}\\Submodules\\LegAppCommon`;
    const canonicalSha = "3333333333333333333333333333333333333333";
    const previousSha = "2222222222222222222222222222222222222222";
    let secondaryAligned = false;

    database.upsertTicketRun({
      runId: "run-1",
      ticketId: "SPI-203",
      ticketSummary: "Retry shared common alignment",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-203",
      projectKey: "SPI",
      status: "awaiting-review",
      createdAt: 100,
      startedAt: 100,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: primaryParentWorktreePath,
          branchName,
        },
        {
          repoRelativePath: "web-app",
          repoAbsolutePath: "C:\\Repos\\web-app",
          worktreePath: secondaryParentWorktreePath,
          branchName,
        },
      ],
      submodules: [
        {
          canonicalUrl,
          name: "LegAppCommon",
          branchName,
          commitMessageDraft: null,
          parentRefs: [
            {
              parentRepoRelativePath: "service-api",
              submodulePath: "Submodules\\LegAppCommon",
              submoduleWorktreePath: primarySubmodulePath,
            },
            {
              parentRepoRelativePath: "web-app",
              submodulePath: "Submodules\\LegAppCommon",
              submoduleWorktreePath: secondarySubmodulePath,
            },
          ],
        },
      ],
    });

    const gitRunner = vi.fn().mockImplementation(async (cwd: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (
        (cwd === primaryParentWorktreePath || cwd === secondaryParentWorktreePath) &&
        command === "config --file .gitmodules --get-regexp ^submodule\\..*\\.(path|url)$"
      ) {
        return {
          stdout:
            "submodule.LegAppCommon.path Submodules\\LegAppCommon\nsubmodule.LegAppCommon.url https://github.com/example/legapp-common.git\n",
          stderr: "",
        };
      }
      if (cwd === primarySubmodulePath || cwd === secondarySubmodulePath) {
        if (command === "remote get-url origin") {
          return { stdout: "https://github.com/example/legapp-common.git\n", stderr: "" };
        }
        if (command === "symbolic-ref --short refs/remotes/origin/HEAD") {
          return { stdout: "origin/main\n", stderr: "" };
        }
        if (command.includes("rev-parse --abbrev-ref --symbolic-full-name @{upstream}")) {
          return { stdout: `origin/${branchName}\n`, stderr: "" };
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
        if (command === "ls-files --others --exclude-standard -z") {
          return { stdout: "", stderr: "" };
        }
        if (command.startsWith("rev-list --left-right --count")) {
          return { stdout: "0 0\n", stderr: "" };
        }
        if (command === "rev-parse HEAD") {
          return {
            stdout: cwd === primarySubmodulePath || secondaryAligned ? `${canonicalSha}\n` : `${previousSha}\n`,
            stderr: "",
          };
        }
        if (command === "branch --show-current") {
          return { stdout: cwd === primarySubmodulePath ? `${branchName}\n` : "", stderr: "" };
        }
        if (command === `fetch origin ${branchName}`) {
          return { stdout: "", stderr: "" };
        }
        if (command === `checkout --detach ${canonicalSha}`) {
          secondaryAligned = true;
          return { stdout: "", stderr: "" };
        }
        if (
          command === `rev-parse --verify ${previousSha}^{commit}` ||
          command === `rev-parse --verify ${canonicalSha}^{commit}`
        ) {
          return { stdout: `${command.includes(canonicalSha) ? canonicalSha : previousSha}\n`, stderr: "" };
        }
        if (command === `merge-base --is-ancestor ${previousSha} ${canonicalSha}`) {
          return { stdout: "", stderr: "" };
        }
      }

      if (cwd === primaryParentWorktreePath || cwd === secondaryParentWorktreePath) {
        if (command === "add Submodules\\LegAppCommon") {
          return { stdout: "", stderr: "" };
        }
      }

      throw new Error(`Unexpected git command in ${cwd}: ${command}`);
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
    vi.spyOn(service as unknown as EnsureRunSubmodulesTarget, "ensureRunSubmodules").mockImplementation(
      async (run) => run,
    );

    const result = await service.pushSubmodule("run-1", canonicalUrl);

    expect(result.action).toBe("push");
    expect(result.gitState.pushAction).toBe("none");
    expect(result.gitState.parents.every((parent) => parent.isAligned)).toBe(true);
    expect(gitRunner).not.toHaveBeenCalledWith(primarySubmodulePath, expect.arrayContaining(["push"]));
    expect(gitRunner).toHaveBeenCalledWith(secondarySubmodulePath, ["fetch", "origin", branchName]);
    expect(gitRunner).toHaveBeenCalledWith(secondarySubmodulePath, ["checkout", "--detach", canonicalSha]);
    expect(gitRunner).toHaveBeenCalledWith(primaryParentWorktreePath, ["add", "Submodules\\LegAppCommon"]);
    expect(gitRunner).toHaveBeenCalledWith(secondaryParentWorktreePath, ["add", "Submodules\\LegAppCommon"]);
  });
});
