import type { SubagentEnvelope } from "@spira/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDefaultProviderCapabilities } from "../provider/capability-fallback.js";
import { createRuntimeSessionContract } from "../runtime/runtime-contract.js";
import { SpiraEventBus } from "../util/event-bus.js";
import { SubagentRunRegistry } from "./run-registry.js";

const createEnvelope = (overrides: Partial<SubagentEnvelope> = {}): SubagentEnvelope => ({
  runId: "run-1",
  domain: "spira",
  task: "Inspect Spira",
  status: "completed",
  retryCount: 0,
  startedAt: 1000,
  completedAt: 1200,
  durationMs: 200,
  followupNeeded: false,
  summary: "Finished inspection.",
  artifacts: [],
  stateChanges: [],
  toolCalls: [],
  errors: [],
  payload: null,
  ...overrides,
});

describe("SubagentRunRegistry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks running runs and stores the completed envelope", async () => {
    const registry = new SubagentRunRegistry();
    const completion = Promise.resolve(createEnvelope());

    const handle = registry.track(
      "spira",
      { task: "Inspect Spira", model: "gpt-5.5", mode: "background" },
      {
        runId: "run-1",
        roomId: "agent:subagent-run-1",
        startedAt: 1000,
        workingDirectory: "C:\\GitHub\\Spira",
        resultPromise: completion,
        write: async () => createEnvelope(),
        stop: async () => undefined,
      },
    );

    expect(handle).toMatchObject({
      agent_id: "run-1",
      runId: "run-1",
      roomId: "agent:subagent-run-1",
      domain: "spira",
      status: "running",
      startedAt: 1000,
    });
    expect(registry.get("run-1")).toMatchObject({
      runId: "run-1",
      status: "running",
      task: "Inspect Spira",
      requestedModel: "gpt-5.5",
      workingDirectory: "C:\\GitHub\\Spira",
    });

    await registry.waitFor("run-1");

    expect(registry.get("run-1")).toMatchObject({
      runId: "run-1",
      status: "idle",
      summary: "Finished inspection.",
      envelope: createEnvelope(),
    });
  });

  it("records the observed model from provider usage for delegated runs", () => {
    const bus = new SpiraEventBus();
    const registry = new SubagentRunRegistry({ bus });

    registry.track(
      "spira",
      { task: "Inspect Spira", model: "gpt-5.5", mode: "background" },
      {
        runId: "run-model",
        roomId: "agent:subagent-run-model",
        startedAt: 1000,
        resultPromise: new Promise(() => undefined),
        write: async () => createEnvelope({ runId: "run-model" }),
        stop: async () => undefined,
      },
    );

    bus.emit("provider:usage", {
      provider: "copilot",
      runId: "run-model",
      observedAt: 1100,
      model: "gpt-5.5",
      source: "provider",
    });

    expect(registry.get("run-model")).toMatchObject({
      runId: "run-model",
      observedModel: "gpt-5.5",
    });
  });

  it("prunes expired terminal runs on access", async () => {
    let currentTime = 1000;
    const registry = new SubagentRunRegistry({
      now: () => currentTime,
      retentionMs: 100,
    });

    registry.track(
      "spira",
      { task: "Inspect Spira", mode: "background" },
      {
        runId: "run-2",
        roomId: "agent:subagent-run-2",
        startedAt: 1000,
        resultPromise: Promise.resolve(createEnvelope({ runId: "run-2", completedAt: 1050 })),
        write: async () => createEnvelope({ runId: "run-2" }),
        stop: async () => undefined,
      },
    );

    await registry.waitFor("run-2");
    await registry.stop("run-2");
    expect(registry.get("run-2")).not.toBeNull();

    currentTime = 1200;

    expect(registry.get("run-2")).toBeNull();
    expect(registry.list()).toEqual([]);
  });

  it("captures failed background runs without rejecting waiters", async () => {
    const registry = new SubagentRunRegistry();

    registry.track(
      "spira",
      { task: "Inspect Spira", mode: "background" },
      {
        runId: "run-3",
        roomId: "agent:subagent-run-3",
        startedAt: 1000,
        resultPromise: Promise.reject(new Error("Subagent run failed")),
        write: async () => createEnvelope({ runId: "run-3" }),
        stop: async () => undefined,
      },
    );

    await expect(registry.waitFor("run-3")).resolves.toMatchObject({
      runId: "run-3",
      status: "failed",
      summary: "Subagent run failed",
    });
  });

  it("lists only active runs when includeCompleted is false", async () => {
    const registry = new SubagentRunRegistry();

    registry.track(
      "spira",
      { task: "Inspect Spira", mode: "background" },
      {
        runId: "run-4",
        roomId: "agent:subagent-run-4",
        startedAt: 1000,
        resultPromise: Promise.resolve(createEnvelope({ runId: "run-4" })),
        write: async () => createEnvelope({ runId: "run-4" }),
        stop: async () => undefined,
      },
    );

    registry.track(
      "spira",
      { task: "Inspect logs", mode: "background" },
      {
        runId: "run-5",
        roomId: "agent:subagent-run-5",
        startedAt: 1100,
        resultPromise: new Promise(() => undefined),
        write: async () => createEnvelope({ runId: "run-5" }),
        stop: async () => undefined,
      },
    );

    await registry.waitFor("run-4");

    expect(registry.list({ includeCompleted: false })).toEqual([
      expect.objectContaining({
        runId: "run-4",
        status: "idle",
      }),
      expect.objectContaining({
        runId: "run-5",
        status: "running",
      }),
    ]);
  });

  it("treats a zero timeout wait as an immediate snapshot read", async () => {
    const registry = new SubagentRunRegistry();

    registry.track(
      "spira",
      { task: "Inspect Spira", mode: "background" },
      {
        runId: "run-6",
        roomId: "agent:subagent-run-6",
        startedAt: 1000,
        resultPromise: new Promise(() => undefined),
        write: async () => createEnvelope({ runId: "run-6" }),
        stop: async () => undefined,
      },
    );

    await expect(registry.waitFor("run-6", 0)).resolves.toMatchObject({
      runId: "run-6",
      status: "running",
    });
  });

  it("writes follow-up input into an idle run and returns it to idle after the next turn", async () => {
    let resolveWrite: (value: SubagentEnvelope) => void = () => {
      throw new Error("write resolver was not set");
    };
    let writeResolverReady = false;
    const registry = new SubagentRunRegistry();

    registry.track(
      "spira",
      { task: "Inspect Spira", mode: "background" },
      {
        runId: "run-7",
        roomId: "agent:subagent-run-7",
        startedAt: 1000,
        resultPromise: Promise.resolve(createEnvelope({ runId: "run-7" })),
        write: async () =>
          new Promise<SubagentEnvelope>((resolve) => {
            resolveWrite = resolve;
            writeResolverReady = true;
          }),
        stop: async () => undefined,
      },
    );

    await registry.waitFor("run-7");
    await registry.write("run-7", "Keep going");

    expect(registry.get("run-7")).toMatchObject({
      runId: "run-7",
      status: "running",
    });
    expect(registry.get("run-7")?.expiresAt).toBeUndefined();

    expect(writeResolverReady).toBe(true);
    resolveWrite(createEnvelope({ runId: "run-7", summary: "Follow-up finished." }));
    await registry.waitFor("run-7");

    expect(registry.get("run-7")).toMatchObject({
      runId: "run-7",
      status: "idle",
      summary: "Follow-up finished.",
    });
  });

  it("cancels a live run and marks it cancelled", async () => {
    let stopped = false;
    const registry = new SubagentRunRegistry();

    registry.track(
      "spira",
      { task: "Inspect Spira", mode: "background" },
      {
        runId: "run-8",
        roomId: "agent:subagent-run-8",
        startedAt: 1000,
        resultPromise: new Promise(() => undefined),
        write: async () => createEnvelope({ runId: "run-8" }),
        stop: async () => {
          stopped = true;
        },
      },
    );

    await expect(registry.stop("run-8")).resolves.toMatchObject({
      runId: "run-8",
      status: "cancelled",
    });
    expect(stopped).toBe(true);
  });

  it("expires idle runs and prunes them after the retention window", async () => {
    vi.useFakeTimers();

    const registry = new SubagentRunRegistry({
      idleTimeoutMs: 50,
      retentionMs: 100,
    });

    registry.track(
      "spira",
      { task: "Inspect Spira", mode: "background" },
      {
        runId: "run-9",
        roomId: "agent:subagent-run-9",
        startedAt: 1000,
        resultPromise: Promise.resolve(createEnvelope({ runId: "run-9" })),
        write: async () => createEnvelope({ runId: "run-9" }),
        stop: async () => undefined,
      },
    );

    await registry.waitFor("run-9");
    expect(registry.get("run-9")).toMatchObject({
      runId: "run-9",
      status: "idle",
    });

    await vi.advanceTimersByTimeAsync(50);
    expect(registry.get("run-9")).toMatchObject({
      runId: "run-9",
      status: "expired",
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(registry.get("run-9")).toBeNull();
  });

  it("expires recovered idle runs even without a live launch handle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const persistedSnapshots: Record<string, unknown> = {};
    const registry = new SubagentRunRegistry({
      idleTimeoutMs: 50,
      retentionMs: 100,
      runtimeStore: {
        listPersistedSubagentRuns: () => [
          {
            agent_id: "run-10",
            runId: "run-10",
            roomId: "agent:subagent-run-10",
            domain: "spira",
            task: "Recovered task",
            status: "idle",
            startedAt: 1_000,
            updatedAt: 1_200,
            completedAt: 1_200,
            expiresAt: 5_000,
            summary: "Recovered turn finished.",
            envelope: createEnvelope({ runId: "run-10" }),
          },
        ],
        persistSubagentRun: (snapshot: { runId: string }) => {
          persistedSnapshots[snapshot.runId] = snapshot;
          return snapshot;
        },
        deleteSubagentRun: vi.fn(),
      } as never,
    });

    expect(registry.get("run-10")).toMatchObject({
      runId: "run-10",
      status: "idle",
    });

    await vi.advanceTimersByTimeAsync(50);

    expect(registry.get("run-10")).toMatchObject({
      runId: "run-10",
      status: "expired",
    });
    expect(persistedSnapshots["run-10"]).toMatchObject({
      runId: "run-10",
      status: "expired",
    });
  });

  it("re-arms idle expiry for recovered runs that were persisted without an expiry deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const persistedSnapshots: Record<string, unknown> = {};
    const registry = new SubagentRunRegistry({
      idleTimeoutMs: 50,
      retentionMs: 100,
      runtimeStore: {
        listPersistedSubagentRuns: () => [
          {
            agent_id: "run-10b",
            runId: "run-10b",
            roomId: "agent:subagent-run-10b",
            domain: "spira",
            task: "Recovered task",
            status: "idle",
            startedAt: 1_000,
            updatedAt: 1_200,
            completedAt: 1_200,
            summary: "Recovered turn finished.",
            envelope: createEnvelope({ runId: "run-10b" }),
          },
        ],
        persistSubagentRun: (snapshot: { runId: string }) => {
          persistedSnapshots[snapshot.runId] = snapshot;
          return snapshot;
        },
        deleteSubagentRun: vi.fn(),
      } as never,
    });

    expect(registry.get("run-10b")).toMatchObject({
      runId: "run-10b",
      status: "idle",
      expiresAt: 1_050,
    });

    await vi.advanceTimersByTimeAsync(50);

    expect(registry.get("run-10b")).toMatchObject({
      runId: "run-10b",
      status: "expired",
    });
    expect(persistedSnapshots["run-10b"]).toMatchObject({
      runId: "run-10b",
      status: "expired",
    });
  });

  it("prunes recovered terminal runs using their remaining persisted ttl", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const deleteSubagentRun = vi.fn();
    const registry = new SubagentRunRegistry({
      retentionMs: 500,
      runtimeStore: {
        listPersistedSubagentRuns: () => [
          {
            agent_id: "run-10c",
            runId: "run-10c",
            roomId: "agent:subagent-run-10c",
            domain: "spira",
            task: "Recovered task",
            status: "failed",
            startedAt: 900,
            updatedAt: 950,
            completedAt: 950,
            expiresAt: 1_050,
            summary: "Recovered failure.",
            envelope: createEnvelope({ runId: "run-10c", status: "failed" }),
          },
        ],
        persistSubagentRun: vi.fn(),
        deleteSubagentRun,
      } as never,
    });

    expect(registry.get("run-10c")).toMatchObject({
      runId: "run-10c",
      status: "failed",
    });

    await vi.advanceTimersByTimeAsync(49);
    expect(registry.get("run-10c")).toMatchObject({
      runId: "run-10c",
      status: "failed",
    });

    await vi.advanceTimersByTimeAsync(1);
    expect(registry.get("run-10c")).toBeNull();
    expect(deleteSubagentRun).toHaveBeenCalledWith("run-10c");
  });

  it("persists in-flight and completed tool call state for background runs", async () => {
    const bus = new SpiraEventBus();
    const persistedSnapshots: Record<string, unknown> = {};
    const registry = new SubagentRunRegistry({
      bus,
      runtimeStore: {
        listPersistedSubagentRuns: () => [],
        persistSubagentRun: (snapshot: { runId: string }) => {
          persistedSnapshots[snapshot.runId] = snapshot;
          return snapshot;
        },
        deleteSubagentRun: vi.fn(),
      } as never,
    });

    registry.track(
      "spira",
      { task: "Inspect Spira", mode: "background" },
      {
        runId: "run-11",
        roomId: "agent:subagent-run-11",
        startedAt: 1000,
        resultPromise: new Promise(() => undefined),
        write: async () => createEnvelope({ runId: "run-11" }),
        stop: async () => undefined,
      },
    );
    bus.emit("subagent:runtime-sync", {
      runId: "run-11",
      roomId: "agent:subagent-run-11",
      allowWrites: true,
      providerId: "copilot",
      providerSessionId: "provider-session-11",
      hostManifestHash: "host-manifest-11",
      providerProjectionHash: "projection-11",
    });
    bus.emit("subagent:tool-call", {
      runId: "run-11",
      roomId: "agent:subagent-run-11",
      callId: "call-1",
      toolName: "spira_ui_get_snapshot",
      args: {},
      startedAt: 1100,
    });
    bus.emit("subagent:tool-result", {
      runId: "run-11",
      roomId: "agent:subagent-run-11",
      callId: "call-1",
      toolName: "spira_ui_get_snapshot",
      status: "success",
      result: { activeView: "bridge" },
      startedAt: 1100,
      completedAt: 1200,
      durationMs: 100,
    });

    expect(persistedSnapshots["run-11"]).toMatchObject({
      runId: "run-11",
      allowWrites: true,
      providerId: "copilot",
      providerSessionId: "provider-session-11",
      hostManifestHash: "host-manifest-11",
      providerProjectionHash: "projection-11",
      activeToolCalls: [],
      toolCalls: [
        expect.objectContaining({
          callId: "call-1",
          toolName: "spira_ui_get_snapshot",
          status: "success",
        }),
      ],
    });
  });

  it("rehydrates recovered idle runs when a resumable launch can be reconstructed", async () => {
    const write = vi.fn(async () => createEnvelope({ runId: "run-12", summary: "Recovered follow-up finished." }));
    const stop = vi.fn(async () => undefined);
    const registry = new SubagentRunRegistry({
      runtimeStore: {
        listPersistedSubagentRuns: () => [
          {
            agent_id: "run-12",
            runId: "run-12",
            roomId: "agent:subagent-run-12",
            domain: "spira",
            task: "Recovered task",
            status: "idle",
            allowWrites: true,
            providerSessionId: "provider-session-12",
            hostManifestHash: "host-manifest-12",
            providerProjectionHash: "projection-12",
            activeToolCalls: [],
            toolCalls: [],
            startedAt: 1_000,
            updatedAt: 1_200,
            completedAt: 1_200,
            expiresAt: 5_000_000_000_000,
            summary: "Recovered turn finished.",
            envelope: createEnvelope({ runId: "run-12" }),
          },
        ],
        persistSubagentRun: vi.fn(),
        deleteSubagentRun: vi.fn(),
      } as never,
      recoverLaunch: () => ({ write, stop }),
    });

    await expect(registry.write("run-12", "Keep going")).resolves.toMatchObject({
      runId: "run-12",
      status: "running",
    });
    await expect(registry.waitFor("run-12")).resolves.toMatchObject({
      runId: "run-12",
      status: "idle",
      summary: "Recovered follow-up finished.",
    });
    expect(write).toHaveBeenCalledWith("Keep going");
  });

  it("fails recovered idle runs closed when restart cannot reconstruct follow-up state", () => {
    const persistedSnapshots: Record<string, unknown> = {};
    const queueProviderSessionCleanup = vi.fn();
    const drainPendingProviderSessionCleanup = vi.fn().mockResolvedValue(undefined);
    const registry = new SubagentRunRegistry({
      now: () => 5_000,
      retentionMs: 100,
      env: {} as never,
      runtimeStore: {
        listPersistedSubagentRuns: () => [
          {
            agent_id: "run-12b",
            runId: "run-12b",
            roomId: "agent:subagent-run-12b",
            domain: "spira",
            task: "Recovered task",
            status: "idle",
            providerId: "copilot",
            providerSessionId: "provider-session-12b",
            startedAt: 1_000,
            updatedAt: 1_200,
            completedAt: 1_200,
            summary: "Recovered turn finished.",
            envelope: createEnvelope({ runId: "run-12b" }),
          },
        ],
        persistSubagentRun: (snapshot: { runId: string }) => {
          persistedSnapshots[snapshot.runId] = snapshot;
          return snapshot;
        },
        getSubagentRuntimeSessionId: (runId: string) => `subagent:${runId}`,
        getRuntimeSession: () => null,
        queueProviderSessionCleanup,
        drainPendingProviderSessionCleanup,
        deleteSubagentRun: vi.fn(),
      } as never,
      recoverLaunch: () => null,
    });

    expect(registry.get("run-12b")).toMatchObject({
      runId: "run-12b",
      status: "failed",
    });
    expect(registry.list({ includeCompleted: false })).toEqual([]);
    expect(persistedSnapshots["run-12b"]).toMatchObject({
      runId: "run-12b",
      status: "failed",
    });
    expect(queueProviderSessionCleanup).toHaveBeenCalledWith("copilot", "provider-session-12b");
    expect(drainPendingProviderSessionCleanup).toHaveBeenCalled();
  });

  it("queues cleanup for unrecoverable idle runs from the runtime contract when the snapshot missed binding sync", () => {
    const queueProviderSessionCleanup = vi.fn();
    const registry = new SubagentRunRegistry({
      now: () => 5_000,
      retentionMs: 100,
      runtimeStore: {
        listPersistedSubagentRuns: () => [
          {
            agent_id: "run-12c",
            runId: "run-12c",
            roomId: "agent:subagent-run-12c",
            domain: "spira",
            task: "Recovered task",
            status: "idle",
            startedAt: 1_000,
            updatedAt: 1_200,
            completedAt: 1_200,
            summary: "Recovered turn finished.",
            envelope: createEnvelope({ runId: "run-12c" }),
          },
        ],
        getSubagentRuntimeSessionId: (runId: string) => `subagent:${runId}`,
        getRuntimeSession: () => ({
          providerBinding: {
            providerId: "copilot",
            providerSessionId: "contract-only-session",
          },
          providerSwitches: [],
        }),
        persistSubagentRun: vi.fn(),
        queueProviderSessionCleanup,
        drainPendingProviderSessionCleanup: vi.fn().mockResolvedValue(undefined),
        deleteSubagentRun: vi.fn(),
      } as never,
      env: {} as never,
      recoverLaunch: () => null,
    });

    expect(registry.get("run-12c")).toMatchObject({
      runId: "run-12c",
      status: "failed",
    });
    expect(queueProviderSessionCleanup).toHaveBeenCalledWith("copilot", "contract-only-session");
  });

  it("queues cleanup from the runtime contract as an atomic provider/session pair", () => {
    const queueProviderSessionCleanup = vi.fn();
    const registry = new SubagentRunRegistry({
      now: () => 5_000,
      retentionMs: 100,
      runtimeStore: {
        listPersistedSubagentRuns: () => [
          {
            agent_id: "run-12d",
            runId: "run-12d",
            roomId: "agent:subagent-run-12d",
            domain: "spira",
            task: "Recovered task",
            status: "idle",
            providerId: "copilot",
            providerSessionId: "stale-copilot-session",
            startedAt: 1_000,
            updatedAt: 1_200,
            completedAt: 1_200,
            summary: "Recovered turn finished.",
            envelope: createEnvelope({ runId: "run-12d" }),
          },
        ],
        getSubagentRuntimeSessionId: (runId: string) => `subagent:${runId}`,
        getRuntimeSession: () => ({
          providerBinding: {
            providerId: "azure-openai",
            providerSessionId: "fresh-azure-session",
            hostManifestHash: "host-hash",
            projectionHash: "projection-hash",
          },
        }),
        persistSubagentRun: vi.fn(),
        queueProviderSessionCleanup,
        drainPendingProviderSessionCleanup: vi.fn().mockResolvedValue(undefined),
        deleteSubagentRun: vi.fn(),
      } as never,
      env: {} as never,
      recoverLaunch: () => null,
    });

    expect(registry.get("run-12d")).toMatchObject({
      runId: "run-12d",
      status: "failed",
    });
    expect(queueProviderSessionCleanup).toHaveBeenCalledWith("azure-openai", "fresh-azure-session");
  });

  it("queues cleanup for legacy session-only snapshots using station provider switch history", () => {
    const queueProviderSessionCleanup = vi.fn();
    const registry = new SubagentRunRegistry({
      now: () => 5_000,
      retentionMs: 100,
      runtimeStore: {
        listPersistedSubagentRuns: () => [
          {
            agent_id: "run-12e",
            runId: "run-12e",
            roomId: "agent:subagent-run-12e",
            domain: "spira",
            task: "Recovered task",
            status: "idle",
            providerSessionId: "legacy-copilot-session",
            startedAt: 1_000,
            updatedAt: 1_500,
            completedAt: 1_500,
            summary: "Recovered turn finished.",
            envelope: createEnvelope({ runId: "run-12e" }),
          },
        ],
        getSubagentRuntimeSessionId: (runId: string) => `subagent:${runId}`,
        getStationRuntimeSessionId: () => "station:primary",
        getRuntimeSession: (runtimeSessionId: string) =>
          runtimeSessionId === "station:primary"
            ? createRuntimeSessionContract({
                runtimeSessionId: "station:primary",
                kind: "station",
                scope: { stationId: "primary" },
                workingDirectory: "C:\\GitHub\\Spira",
                hostManifestHash: "station-host-hash",
                providerProjectionHash: "station-projection-hash",
                providerId: "azure-openai",
                providerCapabilities: getDefaultProviderCapabilities("azure-openai"),
                providerSessionId: "active-azure-station-session",
                model: null,
                boundAt: 1_000,
                artifactRefs: [],
                checkpointRef: null,
                turnState: { state: "idle", activeToolCallIds: [] },
                permissionState: { status: "idle", pendingRequestIds: [] },
                cancellationState: { status: "idle" },
                usageSummary: { model: null, totalTokens: null, lastObservedAt: null, source: "unknown" },
                providerSwitches: [
                  {
                    switchId: "switch-legacy-idle",
                    fromProviderId: "copilot",
                    toProviderId: "azure-openai",
                    switchedAt: 2_000,
                    reason: "user-requested",
                    hostManifestHash: "station-host-hash",
                    projectionHash: "station-projection-hash",
                  },
                ],
              })
            : null,
        persistSubagentRun: vi.fn(),
        queueProviderSessionCleanup,
        drainPendingProviderSessionCleanup: vi.fn().mockResolvedValue(undefined),
        deleteSubagentRun: vi.fn(),
      } as never,
      env: {} as never,
      recoverLaunch: () => null,
    });

    expect(registry.get("run-12e")).toMatchObject({
      runId: "run-12e",
      status: "failed",
    });
    expect(queueProviderSessionCleanup).toHaveBeenCalledWith("copilot", "legacy-copilot-session");
  });

  it("fails persisted running runs closed during registry hydration", () => {
    const persistedSnapshots: Record<string, unknown> = {};
    const registry = new SubagentRunRegistry({
      now: () => 5_000,
      retentionMs: 100,
      runtimeStore: {
        listPersistedSubagentRuns: () => [
          {
            agent_id: "run-13",
            runId: "run-13",
            roomId: "agent:subagent-run-13",
            domain: "spira",
            task: "Interrupted task",
            status: "running",
            startedAt: 1_000,
            updatedAt: 1_200,
            activeToolCalls: [
              {
                callId: "call-1",
                toolName: "spira_ui_get_snapshot",
                status: "running",
                startedAt: 1_150,
              },
            ],
          },
        ],
        persistSubagentRun: (snapshot: { runId: string }) => {
          persistedSnapshots[snapshot.runId] = snapshot;
          return snapshot;
        },
        deleteSubagentRun: vi.fn(),
      } as never,
    });

    expect(registry.get("run-13")).toMatchObject({
      runId: "run-13",
      status: "failed",
      summary: "Delegated subagent run was interrupted before completion.",
      activeToolCalls: [],
      completedAt: 5_000,
    });
    expect(persistedSnapshots["run-13"]).toMatchObject({
      runId: "run-13",
      status: "failed",
      activeToolCalls: [],
      expiresAt: 5_100,
    });
  });
});
