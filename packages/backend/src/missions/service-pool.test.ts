import type { EventEmitter } from "node:events";
import type {
  MissionServiceMetrics,
  MissionServiceProcessSummary,
} from "@spira/shared";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { ConfigError } from "../util/errors.js";
import { MissionServicePool, type MissionServicePoolProfile } from "./service-pool.js";

const createLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
});

const fakeProfile = (overrides: Partial<MissionServicePoolProfile> = {}): MissionServicePoolProfile => ({
  profileId: "test-profile",
  profileName: "Test profile",
  kind: "project",
  launcher: "dotnet-project",
  repoRelativePath: "service-api",
  worktreePath: "C:\\Repos\\.spira-worktrees\\test\\service-api",
  projectName: "Test",
  projectRelativePath: "Test/Test.csproj",
  launchSettingsRelativePath: "Properties/launchSettings.json",
  urls: ["http://localhost:5000"],
  launchUrl: "http://localhost:5000",
  environmentName: "Development",
  isLaunchable: true,
  unavailableReason: null,
  launchPlan: {
    command: "dotnet",
    args: ["run"],
    cwd: "C:\\Repos\\Test",
    env: {},
  },
  ...overrides,
});

const fakeSummary = (
  state: MissionServiceProcessSummary["state"],
  overrides: Partial<MissionServiceProcessSummary> = {},
): MissionServiceProcessSummary => ({
  serviceId: "svc-1",
  runId: "run-1",
  profileId: "test-profile",
  profileName: "Test profile",
  kind: "project",
  launcher: "dotnet-project",
  repoRelativePath: "service-api",
  worktreePath: "C:\\Repos\\.spira-worktrees\\test\\service-api",
  projectName: "Test",
  projectRelativePath: "Test/Test.csproj",
  urls: ["http://localhost:5000"],
  launchUrl: "http://localhost:5000",
  state,
  pid: 1234,
  startedAt: 100,
  stoppedAt: state === "running" || state === "starting" ? null : 500,
  updatedAt: 500,
  exitCode: state === "error" ? 1 : state === "stopped" ? 0 : null,
  errorMessage: state === "error" ? "boom" : null,
  recentLogLines: [],
  childProcesses: [],
  metrics: { current: null, history: [] } satisfies MissionServiceMetrics,
  ...overrides,
});

interface PoolInternals {
  handles: Map<string, {
    serviceId: string;
    runId: string;
    profile: MissionServicePoolProfile;
    child: ChildProcess & EventEmitter;
    summary: MissionServiceProcessSummary;
    logs: unknown[];
    logRemainders: Record<string, string>;
    processTreePoll: NodeJS.Timeout | null;
    processTreeRefreshPromise: Promise<void> | null;
    stopPromise: Promise<void> | null;
    previousCpuByPid: Map<number, unknown>;
    metricsHistory: unknown[];
  }>;
  runServiceIds: Map<string, Set<string>>;
}

const seedHandle = (
  pool: MissionServicePool,
  summary: MissionServiceProcessSummary,
  profile: MissionServicePoolProfile,
): void => {
  const internals = pool as unknown as PoolInternals;
  internals.handles.set(summary.serviceId, {
    serviceId: summary.serviceId,
    runId: summary.runId,
    profile,
    child: { pid: summary.pid, removeListener: vi.fn() } as unknown as ChildProcess & EventEmitter,
    summary,
    logs: [],
    logRemainders: { stdout: "", stderr: "" },
    processTreePoll: null,
    processTreeRefreshPromise: null,
    stopPromise: null,
    previousCpuByPid: new Map(),
    metricsHistory: [],
  });
  const serviceIds = internals.runServiceIds.get(summary.runId) ?? new Set<string>();
  serviceIds.add(summary.serviceId);
  internals.runServiceIds.set(summary.runId, serviceIds);
};

describe("MissionServicePool.dismiss", () => {
  it("removes a stopped service from the pool and emits an update", () => {
    const onUpdate = vi.fn();
    const pool = new MissionServicePool({ logger: createLogger(), onUpdate });
    const profile = fakeProfile();
    seedHandle(pool, fakeSummary("stopped"), profile);

    pool.dismiss("run-1", "svc-1");

    expect(pool.getRunProcesses("run-1")).toEqual([]);
    expect(onUpdate).toHaveBeenCalledWith("run-1");
  });

  it("removes an errored service from the pool", () => {
    const pool = new MissionServicePool({ logger: createLogger() });
    const profile = fakeProfile();
    seedHandle(pool, fakeSummary("error"), profile);

    pool.dismiss("run-1", "svc-1");

    expect(pool.getRunProcesses("run-1")).toEqual([]);
  });

  it("throws when dismissing a running service", () => {
    const pool = new MissionServicePool({ logger: createLogger() });
    const profile = fakeProfile();
    seedHandle(pool, fakeSummary("running"), profile);

    expect(() => pool.dismiss("run-1", "svc-1")).toThrow(ConfigError);
    expect(pool.getRunProcesses("run-1")).toHaveLength(1);
  });

  it("throws when dismissing a starting service", () => {
    const pool = new MissionServicePool({ logger: createLogger() });
    const profile = fakeProfile();
    seedHandle(pool, fakeSummary("starting"), profile);

    expect(() => pool.dismiss("run-1", "svc-1")).toThrow(ConfigError);
  });

  it("returns silently when the service id is unknown", () => {
    const pool = new MissionServicePool({ logger: createLogger() });

    expect(() => pool.dismiss("run-1", "unknown-svc")).not.toThrow();
  });

  it("returns silently when the service id belongs to a different run", () => {
    const pool = new MissionServicePool({ logger: createLogger() });
    seedHandle(pool, fakeSummary("stopped"), fakeProfile());

    pool.dismiss("run-2", "svc-1");

    expect(pool.getRunProcesses("run-1")).toHaveLength(1);
  });

  it("clears the run entry when the last service is dismissed", () => {
    const pool = new MissionServicePool({ logger: createLogger() });
    seedHandle(pool, fakeSummary("stopped"), fakeProfile());

    pool.dismiss("run-1", "svc-1");

    const internals = pool as unknown as PoolInternals;
    expect(internals.runServiceIds.has("run-1")).toBe(false);
  });
});
