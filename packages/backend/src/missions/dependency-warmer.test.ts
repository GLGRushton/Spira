import type { ValidationProfileRecord } from "@spira/memory-db";
import type { TicketRunSummary } from "@spira/shared";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import {
  type DependencyWarmingResult,
  type SpawnCommand,
  warmRunDependencies,
} from "./dependency-warmer.js";

const silentLogger = pino({ level: "silent" });

const buildRun = (overrides: Partial<TicketRunSummary> = {}): TicketRunSummary => {
  const base: TicketRunSummary = {
  runId: "run-1",
  stationId: null,
  ticketId: "SPI-1",
  ticketSummary: "Warm me",
  ticketUrl: "https://example.test/SPI-1",
  projectKey: "SPI",
  status: "starting",
  statusMessage: null,
  commitMessageDraft: null,
  previousPassContext: null,
  startedAt: 1_000,
  createdAt: 1_000,
  updatedAt: 1_000,
  worktrees: [
    {
      repoRelativePath: "ClientApp",
      repoAbsolutePath: "C:\\Repos\\Spira\\ClientApp",
      worktreePath: "C:\\Repos\\.spira-worktrees\\spi-1\\ClientApp",
      branchName: "spi-1-warm-me",
      commitMessageDraft: null,
      cleanupState: "retained",
      createdAt: 1_000,
      updatedAt: 1_000,
    },
  ],
  submodules: [],
  attempts: [],
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
    missionPhase: "classification",
    missionPhaseUpdatedAt: 1_000,
    classification: null,
    plan: null,
    validations: [],
    proofStrategy: null,
    missionSummary: null,
  };
  return { ...base, ...overrides };
};

const buildRestoreProfile = (overrides: Partial<ValidationProfileRecord> = {}): ValidationProfileRecord => ({
  id: "global-spira-clientapp-restore",
  projectKey: "SPI",
  repoRelativePath: "ClientApp",
  label: "Spira ClientApp restore",
  kind: "restore",
  command: "npm ci",
  workingDirectory: ".",
  notes: null,
  confidence: 0.9,
  expectedRuntimeMs: 60_000,
  lastObservedRuntimeMs: null,
  prerequisites: [],
  source: "builtin",
  createdAt: 1_000,
  updatedAt: 1_000,
  ...overrides,
});

describe("warmRunDependencies (Phase 4.1)", () => {
  it("returns no results when there are no restore profiles", async () => {
    const spawnCommand = vi.fn();
    const results = await warmRunDependencies({
      run: buildRun(),
      validationProfiles: [
        buildRestoreProfile({ id: "x", kind: "build", command: "npm run build" }),
      ],
      logger: silentLogger,
      spawnCommand,
    });

    expect(results).toEqual([]);
    expect(spawnCommand).not.toHaveBeenCalled();
  });

  it("runs the highest-confidence restore profile per worktree and reports ok on exit 0", async () => {
    const spawnCommand: SpawnCommand = vi.fn().mockResolvedValue({
      exitCode: 0,
      signal: null,
      stderrTail: "",
      timedOut: false,
    });
    const onTaskStarted = vi.fn();
    const onTaskFinished = vi.fn<(result: DependencyWarmingResult) => void>();
    const results = await warmRunDependencies({
      run: buildRun(),
      validationProfiles: [
        buildRestoreProfile({ id: "low", confidence: 0.4 }),
        buildRestoreProfile({ id: "high", confidence: 0.95 }),
      ],
      logger: silentLogger,
      spawnCommand,
      onTaskStarted,
      onTaskFinished,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      profileId: "high",
      status: "ok",
      exitCode: 0,
      error: null,
    });
    expect(onTaskStarted).toHaveBeenCalledTimes(1);
    expect(onTaskFinished).toHaveBeenCalledTimes(1);
    expect(spawnCommand).toHaveBeenCalledWith("npm", ["ci"], expect.objectContaining({ cwd: expect.any(String) }));
  });

  it("prefers a worktree-scoped profile over an any-repo profile of equal confidence", async () => {
    const spawnCommand: SpawnCommand = vi
      .fn()
      .mockResolvedValue({ exitCode: 0, signal: null, stderrTail: "", timedOut: false });
    const results = await warmRunDependencies({
      run: buildRun(),
      validationProfiles: [
        buildRestoreProfile({ id: "any-repo", repoRelativePath: null, confidence: 0.9 }),
        buildRestoreProfile({ id: "scoped", repoRelativePath: "ClientApp", confidence: 0.9 }),
      ],
      logger: silentLogger,
      spawnCommand,
    });

    expect(results[0]?.profileId).toBe("scoped");
  });

  it("reports failed status when the spawn returns a non-zero exit", async () => {
    const spawnCommand: SpawnCommand = vi.fn().mockResolvedValue({
      exitCode: 1,
      signal: null,
      stderrTail: "ENOENT: package.json missing",
      timedOut: false,
    });
    const results = await warmRunDependencies({
      run: buildRun(),
      validationProfiles: [buildRestoreProfile()],
      logger: silentLogger,
      spawnCommand,
    });

    expect(results[0]).toMatchObject({
      status: "failed",
      exitCode: 1,
      error: "ENOENT: package.json missing",
    });
  });

  it("reports timed out failures with a wall-clock-shaped message", async () => {
    const spawnCommand: SpawnCommand = vi
      .fn()
      .mockResolvedValue({ exitCode: null, signal: "SIGTERM", stderrTail: "", timedOut: true });
    const results = await warmRunDependencies({
      run: buildRun(),
      validationProfiles: [buildRestoreProfile()],
      logger: silentLogger,
      spawnCommand,
      timeoutMs: 5_000,
    });

    expect(results[0]?.status).toBe("failed");
    expect(results[0]?.error).toMatch(/timed out after 5s/i);
  });

  it("skips profiles whose command uses shell metacharacters", async () => {
    const spawnCommand = vi.fn();
    const results = await warmRunDependencies({
      run: buildRun(),
      validationProfiles: [
        buildRestoreProfile({ command: "FOO=bar npm ci && echo done" }),
      ],
      logger: silentLogger,
      spawnCommand,
    });

    expect(results).toEqual([]);
    expect(spawnCommand).not.toHaveBeenCalled();
  });

  it("never throws when an inner spawn rejects unexpectedly; surfaces as failed status", async () => {
    const spawnCommand: SpawnCommand = vi.fn().mockRejectedValue(new Error("spawn ENOENT"));
    const results = await warmRunDependencies({
      run: buildRun(),
      validationProfiles: [buildRestoreProfile()],
      logger: silentLogger,
      spawnCommand,
    });

    expect(results[0]?.status).toBe("failed");
    expect(results[0]?.error).toBe("spawn ENOENT");
  });
});
