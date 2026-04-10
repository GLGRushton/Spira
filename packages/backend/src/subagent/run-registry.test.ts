import type { SubagentEnvelope } from "@spira/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
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
      { task: "Inspect Spira", mode: "background" },
      {
        runId: "run-1",
        roomId: "agent:subagent-run-1",
        startedAt: 1000,
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
    });

    await registry.waitFor("run-1");

    expect(registry.get("run-1")).toMatchObject({
      runId: "run-1",
      status: "idle",
      summary: "Finished inspection.",
      envelope: createEnvelope(),
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
});
