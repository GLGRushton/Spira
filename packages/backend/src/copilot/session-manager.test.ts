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
  promptInFlight: boolean;
  sessionOrigin: "created" | "resumed" | null;
  registeredToolSignature: string | null;
  pendingToolRefreshSignature: string | null;
  refreshingSessionForToolChanges: Promise<void> | null;
  abortResponse(): Promise<void>;
  createSession(): Promise<{ sessionId: string; disconnect: () => Promise<void> }>;
  refreshSessionForToolChanges(): Promise<void>;
  handleSessionEvent(event: { type: string; data: Record<string, unknown> }): void;
  handlePermissionRequest(request: Record<string, unknown>): Promise<{ kind: string; feedback?: string }>;
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
    memoryDb?: Record<string, unknown> | null;
    stationId?: string;
    requestedModel?: string | null;
  },
) => {
  const bus = new SpiraEventBus();
  const aggregator = {
    getTools: () => tools,
    getToolsForServerIds: (serverIds: readonly string[]) => tools.filter((tool) => serverIds.includes(tool.serverId)),
    getToolsExcludingServerIds: (serverIds: readonly string[]) =>
      tools.filter((tool) => !serverIds.includes(tool.serverId)),
  };
  const sessionOptions = options
    ? {
        sessionPersistence: options.sessionPersistence,
        allowUpgradeTools: options.allowUpgradeTools,
        memoryDb: options.memoryDb as never,
        stationId: options.stationId,
        requestedModel: options.requestedModel,
      }
    : undefined;

  return new CopilotSessionManager(
    bus,
    parseEnv(options?.envInput ?? {}),
    aggregator as never,
    options?.requestUpgradeProposal,
    options?.applyHotCapabilityUpgrade,
    sessionOptions,
  );
};

const createRuntimeMemoryDb = () => {
  const runtimeStates: Array<Record<string, unknown>> = [];
  return {
    runtimeStates,
    db: {
      listRuntimeSubagentRuns: () => [],
      upsertRuntimeStationState: (input: Record<string, unknown>) => {
        runtimeStates.push(input);
        return input;
      },
      getRuntimeStationState: () => null,
      upsertRuntimePermissionRequest: vi.fn(),
      resolveRuntimePermissionRequest: vi.fn(),
      appendProviderUsageRecord: vi.fn(),
      deleteRuntimeSubagentRun: vi.fn(),
      upsertRuntimeSubagentRun: vi.fn(),
    },
  };
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

  it("omits duplicated host tools when using the copilot provider", () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "copilot" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const toolNames = internals.getSessionConfig().tools.map((tool) => tool.name);

    expect(toolNames).not.toContain("view");
    expect(toolNames).not.toContain("glob");
    expect(toolNames).not.toContain("rg");
  });

  it("keeps host tools for the azure-openai provider", () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const toolNames = internals.getSessionConfig().tools.map((tool) => tool.name);

    expect(toolNames).toEqual(expect.arrayContaining(["view", "glob", "rg"]));
  });

  it("includes the requested station model in the session config", () => {
    const manager = createManager([], {
      requestedModel: "gpt-5.5",
    });
    const internals = manager as unknown as SessionManagerInternals & { getSessionConfig(): { model?: string } };

    expect(internals.getSessionConfig()).toMatchObject({
      model: "gpt-5.5",
    });
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

  it("applies the requested model before sending a station prompt", async () => {
    const manager = createManager([], {
      requestedModel: "gpt-5.5",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "model-session",
      send: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Use the requested model")).resolves.toBeUndefined();

    expect(session.setModel).toHaveBeenCalledWith("gpt-5.5");
    expect(session.setModel.mock.invocationCallOrder[0]).toBeLessThan(session.send.mock.invocationCallOrder[0] ?? 0);
  });

  it("emits provider usage when a turn becomes idle", () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals & { bus: SpiraEventBus };
    const usage = vi.fn();
    internals.activeSessionId = "session-usage";
    internals.session = {
      sessionId: "session-usage",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.bus.on("provider:usage", usage);

    internals.handleSessionEvent({ type: "session.idle", data: {} });

    expect(usage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "copilot",
        sessionId: "session-usage",
        source: "unknown",
      }),
    );
  });

  it("uses normalized assistant usage when the provider reports it before idle", () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals & { bus: SpiraEventBus };
    const usage = vi.fn();
    internals.activeSessionId = "session-usage";
    internals.session = {
      sessionId: "session-usage",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.bus.on("provider:usage", usage);

    internals.handleSessionEvent({
      type: "assistant.usage",
      data: {
        model: "gpt-5.4",
        totalTokens: 16,
        source: "provider",
      },
    });
    internals.handleSessionEvent({ type: "session.idle", data: {} });

    expect(usage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "copilot",
        sessionId: "session-usage",
        model: "gpt-5.4",
        totalTokens: 16,
        source: "provider",
      }),
    );
  });

  it("persists station runtime tool-call state", () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    internals.session = {
      sessionId: "tool-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.activeSessionId = "tool-session";

    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-1",
        toolName: "vision_read_screen",
        arguments: { target: "screen" },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-1",
        result: { ok: true },
      },
    });

    expect(memory.runtimeStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stationId: "primary",
          activeToolCalls: [
            expect.objectContaining({
              callId: "tool-1",
              toolName: "vision_read_screen",
            }),
          ],
        }),
        expect.objectContaining({
          stationId: "primary",
          activeToolCalls: [],
        }),
      ]),
    );
  });

  it("resumes the persisted SDK session after disconnecting the live handle", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const resumedSession = {
      sessionId: "persisted-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
      },
      resumeSession: vi.fn().mockResolvedValue(resumedSession),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
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
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
      },
      resumeSession: vi.fn().mockResolvedValue(resumedSession),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
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
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
      },
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(createdSession),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.createSession()).resolves.toBe(createdSession);

    expect(persistence.save).toHaveBeenCalledWith("fresh-session");
  });

  it("does not load a persisted session id for providers without durable session support", async () => {
    const persistence = {
      load: vi.fn().mockReturnValue("persisted-session"),
      save: vi.fn(),
    };
    const manager = createManager([], {
      sessionPersistence: persistence,
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const createdSession = {
      sessionId: "azure-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: false,
        abortableTurns: false,
        sessionResumption: "host-managed",
        turnCancellation: "disconnect-and-reset",
        responseStreaming: "host-buffered",
        usageReporting: "partial",
      },
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(createdSession),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.createSession()).resolves.toBe(createdSession);

    expect(persistence.load).not.toHaveBeenCalled();
    expect(client.resumeSession).not.toHaveBeenCalled();
    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect(persistence.save).toHaveBeenCalledWith(null);
  });

  it("requests host-buffered streaming for providers without native streaming", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const createdSession = {
      sessionId: "azure-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: false,
        abortableTurns: false,
        sessionResumption: "host-managed",
        turnCancellation: "disconnect-and-reset",
        responseStreaming: "host-buffered",
        usageReporting: "partial",
      },
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(createdSession),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.createSession()).resolves.toBe(createdSession);

    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        streaming: false,
      }),
    );
  });

  it("drives a host-buffered Azure turn through the unchanged station event path", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals & { bus: SpiraEventBus };
    const delta = vi.fn();
    const toolCall = vi.fn();
    const toolResult = vi.fn();
    const responseEnd = vi.fn();
    const usage = vi.fn();
    internals.bus.on("copilot:delta", delta);
    internals.bus.on("copilot:tool-call", toolCall);
    internals.bus.on("copilot:tool-result", toolResult);
    internals.bus.on("copilot:response-end", responseEnd);
    internals.bus.on("provider:usage", usage);
    const session = {
      sessionId: "azure-session",
      send: vi.fn(async () => {
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
        internals.handleSessionEvent({
          type: "assistant.message_delta",
          data: {
            messageId: "msg-1",
            deltaContent: "Snapshot captured.",
          },
        });
        internals.handleSessionEvent({
          type: "assistant.message",
          data: {
            messageId: "msg-1",
            content: "Snapshot captured.",
          },
        });
        internals.handleSessionEvent({
          type: "session.idle",
          data: {
            usage: {
              model: "gpt-4.1",
              totalTokens: 42,
              source: "provider",
            },
          },
        });
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: false,
        abortableTurns: false,
        sessionResumption: "host-managed",
        turnCancellation: "disconnect-and-reset",
        responseStreaming: "host-buffered",
        usageReporting: "partial",
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

    await expect(manager.sendMessage("Check the bridge")).resolves.toBeUndefined();

    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        streaming: false,
      }),
    );
    expect(toolCall).toHaveBeenCalledWith("call-1", "spira_ui_get_snapshot", {});
    expect(toolResult).toHaveBeenCalledWith("call-1", { activeView: "bridge" });
    expect(delta).toHaveBeenCalledWith("msg-1", "Snapshot captured.");
    expect(responseEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "msg-1",
        text: "Snapshot captured.",
      }),
    );
    expect(usage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "azure-openai",
        sessionId: "azure-session",
        totalTokens: 42,
        source: "provider",
      }),
    );
  });

  it("invalidates non-abortable provider sessions when aborting a response", async () => {
    const persistence = {
      load: vi.fn().mockReturnValue(null),
      save: vi.fn(),
    };
    const manager = createManager([], {
      sessionPersistence: persistence,
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "azure-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: false,
        abortableTurns: false,
        sessionResumption: "host-managed",
        turnCancellation: "disconnect-and-reset",
        responseStreaming: "host-buffered",
        usageReporting: "partial",
      },
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.session = session;
    internals.activeSessionId = "azure-session";
    internals.currentState = "thinking";
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.abortResponse()).resolves.toBeUndefined();

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(client.deleteSession).toHaveBeenCalledWith("azure-session");
    expect(internals.activeSessionId).toBeNull();
    expect(persistence.save).toHaveBeenCalledWith(null);
  });

  it("persists and clears an abort marker around response cancellation", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "copilot-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
      },
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.session = session;
    internals.activeSessionId = "copilot-session";
    internals.currentState = "thinking";
    internals.promptInFlight = true;
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.abortResponse()).resolves.toBeUndefined();

    expect(memory.runtimeStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stationId: "primary",
          abortRequestedAt: expect.any(Number),
        }),
        expect.objectContaining({
          stationId: "primary",
          state: "idle",
          abortRequestedAt: null,
        }),
      ]),
    );
  });

  it("uses provider abort without disconnecting the live session when supported", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "copilot-session",
      abort: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
      },
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.session = session;
    internals.activeSessionId = "copilot-session";
    internals.currentState = "thinking";
    internals.promptInFlight = true;
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.abortResponse()).resolves.toBeUndefined();

    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(session.disconnect).not.toHaveBeenCalled();
    expect(internals.activeSessionId).toBe("copilot-session");
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

  it("maps auto-approved SDK permission requests to approve-once", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;

    await expect(
      internals.handlePermissionRequest({
        kind: "read",
        path: "README.md",
      }),
    ).resolves.toEqual({ kind: "approve-once" });
  });

  it("maps interactive permission approvals to approve-once", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const bus = (manager as unknown as { bus: SpiraEventBus }).bus;
    const permissionRequest = vi.fn();
    bus.on("copilot:permission-request", permissionRequest);
    internals.session = {
      sessionId: "test-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const response = internals.handlePermissionRequest({
      kind: "mcp",
      serverName: "Vision",
      toolName: "vision_read_screen",
      toolTitle: "Read screen",
      readOnly: true,
    });
    const requestId = permissionRequest.mock.calls[0]?.[0]?.requestId;

    expect(typeof requestId).toBe("string");
    expect(manager.resolvePermissionRequest(requestId, true)).toBe(true);
    await expect(response).resolves.toEqual({ kind: "approve-once" });
  });

  it("requires interactive approval for host-owned mutating tools", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const bus = (manager as unknown as { bus: SpiraEventBus }).bus;
    const permissionRequest = vi.fn();
    bus.on("copilot:permission-request", permissionRequest);
    internals.session = {
      sessionId: "test-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const response = internals.handlePermissionRequest({
      kind: "custom-tool",
      toolName: "apply_patch",
      toolCallId: "call-1",
      args: { patch: "*** Begin Patch\n*** End Patch\n" },
    });
    const requestPayload = permissionRequest.mock.calls[0]?.[0];

    expect(requestPayload).toMatchObject({
      serverName: "Spira host runtime",
      toolName: "apply_patch",
      readOnly: false,
    });
    expect(manager.resolvePermissionRequest(requestPayload.requestId, true)).toBe(true);
    await expect(response).resolves.toEqual({ kind: "approve-once" });
  });

  it("maps interactive permission denials to reject", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const bus = (manager as unknown as { bus: SpiraEventBus }).bus;
    const permissionRequest = vi.fn();
    bus.on("copilot:permission-request", permissionRequest);
    internals.session = {
      sessionId: "test-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const response = internals.handlePermissionRequest({
      kind: "mcp",
      serverName: "Vision",
      toolName: "vision_read_screen",
      toolTitle: "Read screen",
      readOnly: true,
    });
    const requestId = permissionRequest.mock.calls[0]?.[0]?.requestId;

    expect(typeof requestId).toBe("string");
    expect(manager.resolvePermissionRequest(requestId, false)).toBe(true);
    await expect(response).resolves.toEqual({ kind: "reject" });
  });

  it("maps unavailable interactive approvals to user-not-available", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;

    await expect(
      internals.handlePermissionRequest({
        kind: "mcp",
        serverName: "Vision",
        toolName: "vision_read_screen",
        toolTitle: "Read screen",
        readOnly: true,
      }),
    ).resolves.toEqual({ kind: "user-not-available" });
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

  it("recovers delegated subagents with their persisted working directory", () => {
    const manager = createManager([], { workingDirectory: "C:\\GitHub\\Spira\\station-worktree" } as never);
    const internals = manager as unknown as SessionManagerInternals & {
      createSubagentRunner: ReturnType<typeof vi.fn>;
      recoverManagedSubagent(snapshot: Record<string, unknown>): unknown;
    };
    const recover = vi.fn().mockReturnValue({ write: vi.fn(), stop: vi.fn() });
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
    const client = {
      capabilities: {
        persistentSessions: true,
        abortableTurns: false,
        sessionResumption: "provider-managed" as const,
        turnCancellation: "disconnect-and-reset" as const,
        responseStreaming: "native" as const,
        usageReporting: "full" as const,
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

  it("allows a fresh Azure turn after abort and ignores stale events from the disconnected session", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals & { bus: SpiraEventBus };
    const delta = vi.fn();
    internals.bus.on("copilot:delta", delta);
    let rejectStaleSend: ((error: Error) => void) | undefined;
    let staleOnEvent:
      | ((event: { type: string; data: Record<string, unknown> }) => void)
      | undefined;
    let freshOnEvent:
      | ((event: { type: string; data: Record<string, unknown> }) => void)
      | undefined;
    const staleSession = {
      sessionId: "stale-session",
      send: vi.fn().mockImplementation(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectStaleSend = reject;
          }),
      ),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const freshSession = {
      sessionId: "fresh-session",
      send: vi.fn().mockImplementation(async () => {
        freshOnEvent?.({
          type: "assistant.message_delta",
          data: {
            messageId: "fresh-1",
            deltaContent: "Fresh reply",
          },
        });
        freshOnEvent?.({
          type: "assistant.message",
          data: {
            messageId: "fresh-1",
            content: "Fresh reply",
          },
        });
        freshOnEvent?.({
          type: "session.idle",
          data: {},
        });
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: false,
        abortableTurns: false,
        sessionResumption: "host-managed",
        turnCancellation: "disconnect-and-reset",
        responseStreaming: "host-buffered",
        usageReporting: "partial",
      },
      resumeSession: vi.fn(),
      createSession: vi.fn().mockImplementation(async (config) => {
        if (!staleOnEvent) {
          staleOnEvent = config.onEvent;
          return staleSession;
        }
        freshOnEvent = config.onEvent;
        return freshSession;
      }),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    const firstSend = manager.sendMessage("First");
    await Promise.resolve();
    await expect(internals.abortResponse()).resolves.toBeUndefined();

    const secondSend = manager.sendMessage("Second");
    staleOnEvent?.({
      type: "assistant.message_delta",
      data: {
        messageId: "stale-1",
        deltaContent: "Stale reply",
      },
    });
    rejectStaleSend?.(new Error("Session not found: disconnected"));

    await expect(firstSend).resolves.toBeUndefined();
    await expect(secondSend).resolves.toBeUndefined();
    expect(freshSession.send).toHaveBeenCalledTimes(1);
    expect(delta).not.toHaveBeenCalledWith("stale-1", "Stale reply");
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

    await expect(manager.sendMessage("hello")).rejects.toBeInstanceOf(CopilotError);

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
});
