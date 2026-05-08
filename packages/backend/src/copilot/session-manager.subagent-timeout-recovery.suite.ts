import { describe, expect, it, vi } from "vitest";
import {
  AssistantError,
  type SpiraEventBus,
  createManager,
  createRuntimeMemoryDb,
  getDefaultProviderCapabilities,
} from "./session-manager.test-support.js";
import type { ProviderHostContinuityState, SessionManagerInternals } from "./session-manager.test-support.js";

describe("StationSessionManager", () => {
  it("recovers delegated subagents with their persisted working directory", () => {
    const manager = createManager([], { workingDirectory: "C:\\GitHub\\Spira\\station-worktree" } as never);
    const internals = manager as unknown as SessionManagerInternals & {
      createSubagentRunner: ReturnType<typeof vi.fn>;
      subagentRunners: Map<string, unknown>;
      recoverManagedSubagent(snapshot: Record<string, unknown>): unknown;
    };
    const recover = vi.fn().mockReturnValue({ write: vi.fn(), stop: vi.fn() });
    internals.subagentRunners = new Map();
    internals.createSubagentRunner = vi.fn().mockReturnValue({ recover });

    internals.recoverManagedSubagent({
      agent_id: "run-recovered",
      runId: "run-recovered",
      roomId: "agent:subagent-run-recovered",
      domain: "spira",
      task: "Inspect Spira",
      status: "idle",
      startedAt: 1000,
      updatedAt: 1100,
      workingDirectory: "C:\\GitHub\\Spira\\mission-worktree",
    });

    expect(internals.createSubagentRunner).toHaveBeenCalledWith(
      expect.objectContaining({ id: "spira" }),
      "C:\\GitHub\\Spira\\mission-worktree",
    );
    expect(recover).toHaveBeenCalledWith(
      expect.objectContaining({
        workingDirectory: "C:\\GitHub\\Spira\\mission-worktree",
      }),
    );
    expect(internals.subagentRunners.size).toBe(1);
  });

  it("propagates provider switches to recovered delegated subagents", async () => {
    const manager = createManager([], {
      workingDirectory: "C:\\GitHub\\Spira\\station-worktree",
      envInput: { SPIRA_MODEL_PROVIDER: "copilot" },
    } as never);
    const internals = manager as unknown as SessionManagerInternals & {
      createSubagentRunner: ReturnType<typeof vi.fn>;
      subagentRunners: Map<string, unknown>;
      recoverManagedSubagent(snapshot: Record<string, unknown>): unknown;
    };
    const switchProvider = vi.fn().mockResolvedValue(undefined);
    const recover = vi.fn().mockReturnValue({ write: vi.fn(), stop: vi.fn() });
    internals.subagentRunners = new Map();
    internals.createSubagentRunner = vi.fn().mockReturnValue({ recover, switchProvider });

    internals.recoverManagedSubagent({
      agent_id: "run-recovered",
      runId: "run-recovered",
      roomId: "agent:subagent-run-recovered",
      domain: "spira",
      task: "Inspect Spira",
      status: "idle",
      startedAt: 1000,
      updatedAt: 1100,
      workingDirectory: "C:\\GitHub\\Spira\\mission-worktree",
    });

    await manager.switchProvider("azure-openai");

    expect(switchProvider).toHaveBeenCalledWith("azure-openai", "user-requested");
  });

  it("does not cache recovered subagent runners when recovery fails closed", () => {
    const manager = createManager([], { workingDirectory: "C:\\GitHub\\Spira\\station-worktree" } as never);
    const internals = manager as unknown as SessionManagerInternals & {
      createSubagentRunner: ReturnType<typeof vi.fn>;
      subagentRunners: Map<string, unknown>;
      recoverManagedSubagent(snapshot: Record<string, unknown>): unknown;
    };
    internals.subagentRunners = new Map();
    internals.createSubagentRunner = vi.fn().mockReturnValue({ recover: vi.fn().mockReturnValue(null) });

    const recovered = internals.recoverManagedSubagent({
      agent_id: "run-recovered",
      runId: "run-recovered",
      roomId: "agent:subagent-run-recovered",
      domain: "spira",
      task: "Inspect Spira",
      status: "idle",
      startedAt: 1000,
      updatedAt: 1100,
      workingDirectory: "C:\\GitHub\\Spira\\mission-worktree",
    });

    expect(recovered).toBeNull();
    expect(internals.subagentRunners.size).toBe(0);
  });

  it("does not retry non-session-not-found send failures", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "test-session",
      send: vi.fn().mockImplementation(async () => {
        internals.handleSessionEvent({
          type: "tool.execution_start",
          data: {
            toolCallId: "call-1",
            toolName: "view",
            arguments: {},
          },
        });
        throw new Error("Boom");
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.session = session;
    const getOrCreateSessionSpy = vi
      .spyOn(manager as unknown as { getOrCreateSession: () => Promise<typeof session> }, "getOrCreateSession")
      .mockResolvedValue(session);

    await expect(manager.sendMessage("hello")).rejects.toBeInstanceOf(AssistantError);

    expect(session.disconnect).not.toHaveBeenCalled();
    expect(getOrCreateSessionSpy).toHaveBeenCalledTimes(1);
    expect(internals.activeToolCalls.size).toBe(0);
  });

  it("allows tool-active turns to continue well past twenty seconds", async () => {
    vi.useFakeTimers();
    try {
      const manager = createManager([]);
      const internals = manager as unknown as SessionManagerInternals;
      const session = {
        sessionId: "test-session",
        send: vi.fn().mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              setTimeout(() => {
                internals.handleSessionEvent({
                  type: "tool.execution_start",
                  data: {
                    toolCallId: "call-1",
                    toolName: "view",
                    arguments: {},
                  },
                });
              }, 10_000);
              setTimeout(() => {
                internals.handleSessionEvent({
                  type: "tool.execution_complete",
                  data: {
                    toolCallId: "call-1",
                    success: true,
                    result: { lines: 1 },
                  },
                });
              }, 11_000);
              setTimeout(() => {
                internals.handleSessionEvent({
                  type: "assistant.message_delta",
                  data: {
                    messageId: "message-1",
                    deltaContent: "Done.",
                  },
                });
              }, 25_000);
              setTimeout(() => {
                internals.handleSessionEvent({
                  type: "assistant.message",
                  data: {
                    messageId: "message-1",
                    content: "Done.",
                  },
                });
              }, 25_100);
              setTimeout(() => {
                internals.handleSessionEvent({
                  type: "session.idle",
                  data: {},
                });
                resolve();
              }, 40_000);
            }),
        ),
        disconnect: vi.fn().mockResolvedValue(undefined),
      };

      internals.session = session;

      const sendPromise = manager.sendMessage("hello");
      await vi.advanceTimersByTimeAsync(41_000);

      await expect(sendPromise).resolves.toBeUndefined();
      expect(session.send).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not time out while a tool is still running", async () => {
    vi.useFakeTimers();
    try {
      const manager = createManager([]);
      const internals = manager as unknown as SessionManagerInternals;
      const session = {
        sessionId: "test-session",
        send: vi.fn().mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              setTimeout(() => {
                internals.handleSessionEvent({
                  type: "tool.execution_start",
                  data: {
                    toolCallId: "call-1",
                    toolName: "powershell",
                    arguments: { command: "pnpm test" },
                  },
                });
              }, 10_000);
              setTimeout(() => {
                internals.handleSessionEvent({
                  type: "tool.execution_complete",
                  data: {
                    toolCallId: "call-1",
                    success: true,
                    result: { exitCode: 0 },
                  },
                });
              }, 140_000);
              setTimeout(() => {
                internals.handleSessionEvent({
                  type: "session.idle",
                  data: {},
                });
                resolve();
              }, 141_000);
            }),
        ),
        disconnect: vi.fn().mockResolvedValue(undefined),
      };

      internals.session = session;

      const sendPromise = manager.sendMessage("hello");
      await vi.advanceTimersByTimeAsync(142_000);

      await expect(sendPromise).resolves.toBeUndefined();
      expect(session.disconnect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out stalled turns after activity stops", async () => {
    vi.useFakeTimers();
    try {
      const manager = createManager([]);
      const internals = manager as unknown as SessionManagerInternals;
      const session = {
        sessionId: "test-session",
        send: vi.fn().mockImplementation(
          () =>
            new Promise<void>(() => {
              setTimeout(() => {
                internals.handleSessionEvent({
                  type: "assistant.message_delta",
                  data: {
                    messageId: "message-1",
                    deltaContent: "Working",
                  },
                });
              }, 10_000);
            }),
        ),
        disconnect: vi.fn().mockResolvedValue(undefined),
      };

      internals.session = session;

      const sendPromise = manager.sendMessage("hello");
      const sendExpectation = expect(sendPromise).rejects.toThrow("Turn stalled while waiting for activity");
      await vi.advanceTimersByTimeAsync(131_000);

      await sendExpectation;
      expect(session.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the same watchdog budget across a missing-session retry", async () => {
    vi.useFakeTimers();
    try {
      const manager = createManager([]);
      const staleSession = {
        sessionId: "stale-session",
        send: vi.fn().mockImplementation(
          () =>
            new Promise<void>((_resolve, reject) => {
              setTimeout(() => {
                reject(new Error("Request session.send failed with message: Session not found: stale-session"));
              }, 119_000);
            }),
        ),
        disconnect: vi.fn().mockResolvedValue(undefined),
      };
      const freshSession = {
        sessionId: "fresh-session",
        send: vi.fn().mockImplementation(() => new Promise<void>(() => undefined)),
        disconnect: vi.fn().mockResolvedValue(undefined),
      };

      vi.spyOn(manager as unknown as { getOrCreateSession: () => Promise<typeof staleSession> }, "getOrCreateSession")
        .mockResolvedValueOnce(staleSession)
        .mockResolvedValueOnce(freshSession);

      const sendPromise = manager.sendMessage("hello");
      const sendExpectation = expect(sendPromise).rejects.toThrow("Timed out while waiting");

      await vi.advanceTimersByTimeAsync(119_000);
      await vi.advanceTimersByTimeAsync(2_000);

      await sendExpectation;
      expect(staleSession.send).toHaveBeenCalledTimes(1);
      expect(freshSession.send).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts an in-flight response without surfacing an error", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    let rejectSend: ((error: Error) => void) | undefined;
    const session = {
      sessionId: "test-session",
      send: vi.fn().mockImplementation(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectSend = reject;
          }),
      ),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: true,
        abortableTurns: false,
        sessionResumption: "provider-managed" as const,
        turnCancellation: "disconnect-and-reset" as const,
        responseStreaming: "native" as const,
        usageReporting: "full" as const,
        toolManifestMode: "projected" as const,
        modelSelection: "session-scoped" as const,
        toolCalling: "native" as const,
      },
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.session = session;
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    const sendPromise = manager.sendMessage("hello");
    for (let index = 0; index < 5 && !rejectSend; index += 1) {
      await Promise.resolve();
    }

    const abortPromise = internals.abortResponse();
    rejectSend?.(new Error("Aborted by test"));

    await expect(abortPromise).resolves.toBeUndefined();
    await expect(sendPromise).resolves.toBeUndefined();
    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(internals.currentState).toBe("idle");
  });

  it("allows a fresh Azure turn after provider abort on the same session", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals & { bus: SpiraEventBus };
    const delta = vi.fn();
    internals.bus.on("assistant:delta", delta);
    let rejectFirstSend: ((error: Error) => void) | undefined;
    const session = {
      sessionId: "azure-session",
      send: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectFirstSend = reject;
            }),
        )
        .mockImplementationOnce(async () => {
          internals.handleSessionEvent({
            type: "assistant.message_delta",
            data: {
              messageId: "fresh-1",
              deltaContent: "Fresh reply",
            },
          });
          internals.handleSessionEvent({
            type: "assistant.message",
            data: {
              messageId: "fresh-1",
              content: "Fresh reply",
            },
          });
          internals.handleSessionEvent({
            type: "session.idle",
            data: {},
          });
        }),
      abort: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: false,
        abortableTurns: true,
        sessionResumption: "host-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "partial",
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
      },
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(session),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    const firstSend = manager.sendMessage("First");
    for (let index = 0; index < 5 && session.send.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    internals.session = session;
    await expect(internals.abortResponse()).resolves.toBeUndefined();
    const secondSend = manager.sendMessage("Second");
    rejectFirstSend?.(new Error("Session not found: disconnected"));
    await expect(firstSend).resolves.toBeUndefined();
    await expect(secondSend).resolves.toBeUndefined();
    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(session.disconnect).not.toHaveBeenCalled();
    expect(session.send).toHaveBeenCalledTimes(2);
    expect(delta).toHaveBeenCalledWith("fresh-1", "Fresh reply");
  });

  it("restores the last committed host continuity after Azure abort", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const committedContinuity: ProviderHostContinuityState = {
      providerId: "azure-openai",
      model: "gpt-4.1",
      updatedAt: 900,
      messages: [{ role: "assistant", content: "Committed reply." }],
    };
    const interruptedContinuity: ProviderHostContinuityState = {
      providerId: "azure-openai",
      model: "gpt-4.1",
      updatedAt: 1_000,
      messages: [
        { role: "assistant", content: "Committed reply." },
        { role: "user", content: "Interrupted request" },
      ],
    };
    const session = {
      sessionId: "azure-session",
      abort: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: getDefaultProviderCapabilities("azure-openai"),
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.session = session;
    internals.client = client as never;
    internals.activeSessionId = "azure-session";
    internals.currentState = "thinking";
    internals.promptInFlight = true;
    internals.hostContinuityState = interruptedContinuity;
    internals.resumableHostContinuityState = committedContinuity;
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.abortResponse()).resolves.toBeUndefined();

    const persistedRuntimeSession = runtimeMemory.runtimeSessions.get("station:primary");
    const persistedRuntimeContract = persistedRuntimeSession?.contract as Record<string, unknown> | undefined;
    expect(internals.hostContinuityState).toEqual(committedContinuity);
    expect(internals.resumableHostContinuityState).toEqual(committedContinuity);
    expect(persistedRuntimeContract?.hostContinuity).toEqual(committedContinuity);
  });

  it("does not retry a missing session after tool activity was already observed", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const staleSession = {
      sessionId: "stale-session",
      send: vi.fn().mockImplementation(async () => {
        internals.handleSessionEvent({
          type: "tool.execution_start",
          data: {
            toolCallId: "call-1",
            toolName: "spira_ui_get_snapshot",
            arguments: {},
          },
        });
        internals.handleSessionEvent({
          type: "tool.execution_complete",
          data: {
            toolCallId: "call-1",
            success: true,
            result: { activeView: "bridge" },
          },
        });
        throw new Error("Request session.send failed with message: Session not found: stale-session");
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const freshSession = {
      sessionId: "fresh-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.session = staleSession;
    internals.activeSessionId = "stale-session";
    const getOrCreateSessionSpy = vi
      .spyOn(manager as unknown as { getOrCreateSession: () => Promise<typeof staleSession> }, "getOrCreateSession")
      .mockResolvedValueOnce(staleSession)
      .mockResolvedValueOnce(freshSession);

    await expect(manager.sendMessage("hello")).rejects.toBeInstanceOf(AssistantError);

    expect(getOrCreateSessionSpy).toHaveBeenCalledTimes(1);
    expect(freshSession.send).not.toHaveBeenCalled();
  });

  it("does not retry a recovered send after the response is aborted", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const staleSession = {
      sessionId: "stale-session",
      send: vi
        .fn()
        .mockRejectedValue(new Error("Request session.send failed with message: Session not found: stale-session")),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const freshSession = {
      sessionId: "fresh-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.session = staleSession;
    const getOrCreateSessionSpy = vi
      .spyOn(manager as unknown as { getOrCreateSession: () => Promise<typeof staleSession> }, "getOrCreateSession")
      .mockResolvedValueOnce(staleSession)
      .mockImplementationOnce(async () => {
        await internals.abortResponse();
        return freshSession;
      });

    await expect(manager.sendMessage("hello")).resolves.toBeUndefined();

    expect(staleSession.send).toHaveBeenCalledTimes(1);
    expect(staleSession.disconnect).toHaveBeenCalledTimes(1);
    expect(freshSession.send).not.toHaveBeenCalled();
    expect(getOrCreateSessionSpy).toHaveBeenCalledTimes(2);
  });

  it("suppresses copilot errors when clearSession tears down a missing-session retry", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals & { bus: SpiraEventBus };
    const staleSession = {
      sessionId: "stale-session",
      send: vi
        .fn()
        .mockRejectedValue(new Error("Request session.send failed with message: Session not found: stale-session")),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const reportedError = vi.fn();

    internals.session = staleSession;
    internals.activeSessionId = "stale-session";
    internals.bus.on("assistant:error", reportedError);
    vi.spyOn(
      manager as unknown as { invalidateExpiredSession: (session: typeof staleSession) => Promise<void> },
      "invalidateExpiredSession",
    ).mockImplementation(async () => {
      await manager.clearSession();
    });

    await expect(manager.sendMessage("hello")).resolves.toBeUndefined();

    expect(staleSession.send).toHaveBeenCalledTimes(1);
    expect(staleSession.disconnect).toHaveBeenCalledTimes(1);
    expect(reportedError).not.toHaveBeenCalled();
  });
});
