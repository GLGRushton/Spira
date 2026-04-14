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
  sessionOrigin: "created" | "resumed" | null;
  registeredToolSignature: string | null;
  pendingToolRefreshSignature: string | null;
  refreshingSessionForToolChanges: Promise<void> | null;
  abortResponse(): Promise<void>;
  createSession(): Promise<{ sessionId: string; disconnect: () => Promise<void> }>;
  refreshSessionForToolChanges(): Promise<void>;
  handleSessionEvent(event: { type: "session.idle"; data: Record<string, never> }): void;
  getSessionConfig(): { tools: Array<{ name: string }> };
};

const createManager = (
  tools: McpTool[],
  options?: {
    sessionPersistence?: {
      load(): string | null;
      save(sessionId: string | null): void;
    } | null;
    envInput?: Record<string, string | undefined>;
    allowUpgradeTools?: boolean;
    requestUpgradeProposal?: (() => Promise<void> | void) | undefined;
    applyHotCapabilityUpgrade?: (() => Promise<void> | void) | undefined;
  },
) => {
  const bus = new SpiraEventBus();
  const aggregator = {
    getTools: () => tools,
    getToolsForServerIds: (serverIds: readonly string[]) => tools.filter((tool) => serverIds.includes(tool.serverId)),
    getToolsExcludingServerIds: (serverIds: readonly string[]) =>
      tools.filter((tool) => !serverIds.includes(tool.serverId)),
  };

  return new CopilotSessionManager(
    bus,
    parseEnv(options?.envInput ?? {}),
    aggregator as never,
    options?.requestUpgradeProposal,
    options?.applyHotCapabilityUpgrade,
    options,
  );
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
    expect(internals.pendingToolRefreshSignature).toBe(JSON.stringify(["system_get_memory_info"]));

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

  it("replaces delegated MCP tools with delegation tools when subagents are enabled", () => {
    const manager = createManager(
      [
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
        {
          serverId: "memories",
          serverName: "Spira Memories",
          name: "spira_memory_list_entries",
          description: "List stored memories.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
        {
          serverId: "spira-ui",
          serverName: "Spira UI",
          name: "spira_ui_get_snapshot",
          description: "Read the current Spira snapshot.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      ],
      {
        envInput: { SPIRA_SUBAGENTS_ENABLED: "true" },
      },
    );
    const internals = manager as unknown as SessionManagerInternals;
    const toolNames = internals.getSessionConfig().tools.map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "delegate_to_windows",
        "delegate_to_spira",
        "spira_memory_list_entries",
        "read_subagent",
        "list_subagents",
        "write_subagent",
        "stop_subagent",
      ]),
    );
    expect(toolNames).not.toContain("system_get_memory_info");
    expect(toolNames).not.toContain("delegate_to_nexus");
  });

  it("includes the upgrade tool for stations that allow upgrades", () => {
    const manager = createManager([], {
      requestUpgradeProposal: vi.fn(),
      applyHotCapabilityUpgrade: vi.fn(),
    });
    const internals = manager as unknown as SessionManagerInternals;
    const toolNames = internals.getSessionConfig().tools.map((tool) => tool.name);

    expect(toolNames).toContain("spira_propose_upgrade");
  });

  it("omits the upgrade tool for stations that disable upgrades", () => {
    const manager = createManager([], {
      requestUpgradeProposal: vi.fn(),
      applyHotCapabilityUpgrade: vi.fn(),
      allowUpgradeTools: false,
    });
    const internals = manager as unknown as SessionManagerInternals;
    const toolNames = internals.getSessionConfig().tools.map((tool) => tool.name);

    expect(toolNames).not.toContain("spira_propose_upgrade");
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

  it("loads a persisted session id from session persistence on startup", async () => {
    const persistence = {
      load: vi.fn().mockReturnValue("persisted-session"),
      save: vi.fn(),
    };
    const manager = createManager([], { sessionPersistence: persistence });
    const internals = manager as unknown as SessionManagerInternals;
    const resumedSession = {
      sessionId: "persisted-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      resumeSession: vi.fn().mockResolvedValue(resumedSession),
      createSession: vi.fn(),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.createSession()).resolves.toBe(resumedSession);

    expect(persistence.load).toHaveBeenCalled();
    expect(client.resumeSession).toHaveBeenCalledWith(
      "persisted-session",
      expect.objectContaining({ clientName: "Spira" }),
    );
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it("saves the active session id through session persistence", async () => {
    const persistence = {
      load: vi.fn().mockReturnValue(null),
      save: vi.fn(),
    };
    const manager = createManager([], { sessionPersistence: persistence });
    const internals = manager as unknown as SessionManagerInternals;
    const createdSession = {
      sessionId: "fresh-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(createdSession),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.createSession()).resolves.toBe(createdSession);

    expect(persistence.save).toHaveBeenCalledWith("fresh-session");
  });

  it("deletes the persisted SDK session when the user clears chat", async () => {
    const persistence = {
      load: vi.fn().mockReturnValue("persisted-session"),
      save: vi.fn(),
    };
    const manager = createManager([], { sessionPersistence: persistence });
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
    expect(persistence.save).toHaveBeenCalledWith(null);
  });

  it("prepends continuity context only for fresh sessions", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "fresh-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.sessionOrigin = "created";
    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(
      manager.sendMessage("Continue fixing the renderer", { continuityPreamble: "[Recovered context]\nPrior work." }),
    ).resolves.toBeUndefined();

    expect(session.send).toHaveBeenCalledWith({
      prompt: "[Recovered context]\nPrior work.\n\nCurrent user request:\nContinue fixing the renderer",
    });
  });

  it("does not prepend continuity context for resumed sessions", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "persisted-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.sessionOrigin = "resumed";
    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(
      manager.sendMessage("Continue fixing the renderer", { continuityPreamble: "[Recovered context]" }),
    ).resolves.toBeUndefined();

    expect(session.send).toHaveBeenCalledWith({
      prompt: "Continue fixing the renderer",
    });
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
