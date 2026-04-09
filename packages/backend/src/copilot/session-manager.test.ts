import { type McpTool, parseEnv } from "@spira/shared";
import { describe, expect, it, vi } from "vitest";
import { CopilotError } from "../util/errors.js";
import { SpiraEventBus } from "../util/event-bus.js";
import { CopilotSessionManager } from "./session-manager.js";

type SessionManagerInternals = {
  session: {
    sessionId: string;
    disconnect: () => Promise<void>;
    send?: (payload: { prompt: string }) => Promise<void>;
  } | null;
  activeSessionId: string | null;
  currentState: "idle" | "thinking" | "listening" | "transcribing" | "speaking" | "error";
  registeredToolSignature: string | null;
  pendingToolRefreshSignature: string | null;
  refreshingSessionForToolChanges: Promise<void> | null;
  abortResponse(): Promise<void>;
  createSession(): Promise<{ sessionId: string; disconnect: () => Promise<void> }>;
  refreshSessionForToolChanges(): Promise<void>;
  handleSessionEvent(event: { type: "session.idle"; data: Record<string, never> }): void;
  getUpgradeToolInstructions(): string;
};

const createManager = (tools: McpTool[]) => {
  const bus = new SpiraEventBus();
  const aggregator = {
    getTools: () => tools,
  };

  return new CopilotSessionManager(bus, parseEnv({}), aggregator as never);
};

describe("CopilotSessionManager", () => {
  it("defers MCP session refresh until the active turn becomes idle", async () => {
    const tools: McpTool[] = [
      {
        serverId: "windows-system",
        serverName: "Windows System",
        name: "system_get_memory_info",
        description: "Read memory info.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ];
    const manager = createManager(tools);
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "test-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.session = session;
    internals.currentState = "thinking";
    internals.registeredToolSignature = JSON.stringify([]);

    await internals.refreshSessionForToolChanges();

    expect(session.disconnect).not.toHaveBeenCalled();
    expect(internals.pendingToolRefreshSignature).toBe(JSON.stringify(["windows-system:system_get_memory_info"]));

    internals.handleSessionEvent({ type: "session.idle", data: {} });
    await Promise.resolve();

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(internals.session).toBeNull();
    expect(internals.registeredToolSignature).toBeNull();
    expect(internals.pendingToolRefreshSignature).toBeNull();
  });

  it("refreshes immediately when the assistant is already idle", async () => {
    const tools: McpTool[] = [
      {
        serverId: "windows-system",
        serverName: "Windows System",
        name: "system_get_memory_info",
        description: "Read memory info.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ];
    const manager = createManager(tools);
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "test-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.session = session;
    internals.currentState = "idle";
    internals.registeredToolSignature = JSON.stringify([]);

    await internals.refreshSessionForToolChanges();

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(internals.session).toBeNull();
    expect(internals.registeredToolSignature).toBeNull();
    expect(internals.pendingToolRefreshSignature).toBeNull();
  });

  it("re-checks for a newer tool signature after an in-flight refresh completes", async () => {
    const tools: McpTool[] = [
      {
        serverId: "windows-system",
        serverName: "Windows System",
        name: "system_get_memory_info",
        description: "Read memory info.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ];
    const manager = createManager(tools);
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "test-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.session = session;
    internals.currentState = "idle";
    internals.registeredToolSignature = JSON.stringify([]);
    internals.refreshingSessionForToolChanges = Promise.resolve().then(() => {
      internals.refreshingSessionForToolChanges = null;
    });

    await internals.refreshSessionForToolChanges();

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(internals.session).toBeNull();
    expect(internals.registeredToolSignature).toBeNull();
  });

  it("advertises spira_propose_upgrade even when no vision tools are connected", () => {
    const manager = new CopilotSessionManager(
      new SpiraEventBus(),
      parseEnv({}),
      { getTools: () => [] } as never,
      async () => undefined,
    );
    const internals = manager as unknown as SessionManagerInternals;

    expect(internals.getUpgradeToolInstructions()).toContain("spira_propose_upgrade");
  });

  it("recreates the session and retries when the SDK reports Session not found", async () => {
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
      .mockResolvedValueOnce(freshSession);

    await expect(manager.sendMessage("hello")).resolves.toBeUndefined();

    expect(staleSession.send).toHaveBeenCalledTimes(1);
    expect(staleSession.disconnect).toHaveBeenCalledTimes(1);
    expect(freshSession.send).toHaveBeenCalledTimes(1);
    expect(getOrCreateSessionSpy).toHaveBeenCalledTimes(2);
  });

  it("resumes the persisted SDK session after disconnecting the live handle", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const resumedSession = {
      sessionId: "persisted-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      resumeSession: vi.fn().mockResolvedValue(resumedSession),
      createSession: vi.fn(),
    };

    internals.activeSessionId = "persisted-session";
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.createSession()).resolves.toBe(resumedSession);

    expect(client.resumeSession).toHaveBeenCalledTimes(1);
    expect(client.resumeSession).toHaveBeenCalledWith(
      "persisted-session",
      expect.objectContaining({
        clientName: "Spira",
        infiniteSessions: { enabled: true },
      }),
    );
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it("deletes the persisted SDK session when the user clears chat", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "persisted-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.session = session;
    internals.activeSessionId = "persisted-session";
    const deletePersistedSessionSpy = vi
      .spyOn(
        manager as unknown as { deletePersistedSession: (sessionId: string) => Promise<void> },
        "deletePersistedSession",
      )
      .mockResolvedValue(undefined);

    await expect(manager.clearSession()).resolves.toBeUndefined();

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(internals.activeSessionId).toBeNull();
    expect(deletePersistedSessionSpy).toHaveBeenCalledWith("persisted-session");
  });

  it("does not retry non-session-not-found send failures", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "test-session",
      send: vi.fn().mockRejectedValue(new Error("Boom")),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.session = session;
    const getOrCreateSessionSpy = vi
      .spyOn(manager as unknown as { getOrCreateSession: () => Promise<typeof session> }, "getOrCreateSession")
      .mockResolvedValue(session);

    await expect(manager.sendMessage("hello")).rejects.toBeInstanceOf(CopilotError);

    expect(session.disconnect).not.toHaveBeenCalled();
    expect(getOrCreateSessionSpy).toHaveBeenCalledTimes(1);
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

    internals.session = session;

    const sendPromise = manager.sendMessage("hello");
    await Promise.resolve();

    const abortPromise = internals.abortResponse();
    rejectSend?.(new Error("Aborted by test"));

    await expect(abortPromise).resolves.toBeUndefined();
    await expect(sendPromise).resolves.toBeUndefined();
    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(internals.currentState).toBe("idle");
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
});
