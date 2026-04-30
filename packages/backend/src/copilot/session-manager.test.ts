import { type McpTool, parseEnv } from "@spira/shared";
import { describe, expect, it, vi } from "vitest";
import { getDefaultProviderCapabilities } from "../provider/capability-fallback.js";
import * as clientFactory from "../provider/client-factory.js";
import { createRuntimeCheckpointPayload, createRuntimeSessionContract } from "../runtime/runtime-contract.js";
import { CopilotError } from "../util/errors.js";
import { SpiraEventBus } from "../util/event-bus.js";
import { CopilotSessionManager } from "./session-manager.js";

type SessionManagerInternals = {
  session: {
    sessionId: string;
    disconnect: () => Promise<void>;
    send?: (payload: { prompt: string }) => Promise<void>;
  } | null;
  client: { providerId: string; stop?: () => Promise<unknown> } | null;
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
  getCurrentToolSignature(): string;
  getSessionConfig(
    expectedSessionId?: string | null,
    provider?: {
      providerId: "copilot" | "azure-openai";
      capabilities: {
        persistentSessions: boolean;
        abortableTurns: boolean;
        sessionResumption: "provider-managed" | "host-managed";
        turnCancellation: "provider-abort" | "disconnect-and-reset";
        responseStreaming: "native" | "host-buffered";
        usageReporting: "full" | "partial" | "none";
        toolManifestMode: "literal" | "projected";
        modelSelection: "session-scoped" | "provider-default";
        toolCalling: "native" | "none";
      };
    },
  ): { tools: Array<{ name: string }> };
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

const createRuntimeMemoryDb = (initialState: Record<string, unknown> | null = null) => {
  const runtimeStates: Array<Record<string, unknown>> = [];
  const runtimeSessions = new Map<string, Record<string, unknown>>();
  const runtimeLedgerEvents: Array<Record<string, unknown>> = [];
  const runtimeCheckpoints = new Map<string, Record<string, unknown>>();
  const sessionState = new Map<string, string | null>();
  return {
    runtimeStates,
    runtimeSessions,
    runtimeLedgerEvents,
    runtimeCheckpoints,
    sessionState,
    db: {
      listRuntimeSubagentRuns: () => [],
      upsertRuntimeStationState: (input: Record<string, unknown>) => {
        runtimeStates.push(input);
        return input;
      },
      getRuntimeStationState: () => initialState,
      upsertRuntimeSession: (input: Record<string, unknown>) => {
        runtimeSessions.set(String(input.runtimeSessionId), input);
        return {
          runtimeSessionId: input.runtimeSessionId,
          stationId: input.stationId ?? null,
          runId: input.runId ?? null,
          kind: input.kind,
          contract: input.contract,
          createdAt: 1,
          updatedAt: 1,
        };
      },
      getRuntimeSession: (runtimeSessionId: string) => {
        const input = runtimeSessions.get(runtimeSessionId);
        return input
          ? {
              runtimeSessionId,
              stationId: input.stationId ?? null,
              runId: input.runId ?? null,
              kind: input.kind,
              contract: input.contract,
              createdAt: 1,
              updatedAt: 1,
            }
          : null;
      },
      listRuntimeSessions: () => [...runtimeSessions.values()],
      appendRuntimeLedgerEvent: (input: Record<string, unknown>) => {
        const record = {
          id: runtimeLedgerEvents.length + 1,
          eventId: input.eventId,
          runtimeSessionId: input.runtimeSessionId,
          stationId: input.stationId ?? null,
          runId: input.runId ?? null,
          type: input.type,
          payload: input.payload,
          occurredAt: input.occurredAt ?? 1,
        };
        runtimeLedgerEvents.push(record);
        return record;
      },
      listRuntimeLedgerEvents: (runtimeSessionId: string) =>
        runtimeLedgerEvents.filter((event) => event.runtimeSessionId === runtimeSessionId),
      upsertRuntimeCheckpoint: (input: Record<string, unknown>) => {
        runtimeCheckpoints.set(String(input.checkpointId), input);
        return {
          checkpointId: input.checkpointId,
          runtimeSessionId: input.runtimeSessionId,
          stationId: input.stationId ?? null,
          runId: input.runId ?? null,
          kind: input.kind,
          summary: input.summary,
          payload: input.payload,
          createdAt: input.createdAt ?? 1,
        };
      },
      getRuntimeCheckpoint: (checkpointId: string) => {
        const input = runtimeCheckpoints.get(checkpointId);
        return input
          ? {
              checkpointId,
              runtimeSessionId: input.runtimeSessionId,
              stationId: input.stationId ?? null,
              runId: input.runId ?? null,
              kind: input.kind,
              summary: input.summary,
              payload: input.payload,
              createdAt: input.createdAt ?? 1,
            }
          : null;
      },
      getLatestRuntimeCheckpoint: (runtimeSessionId: string) =>
        [...runtimeCheckpoints.values()]
          .filter((checkpoint) => checkpoint.runtimeSessionId === runtimeSessionId)
          .sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0))[0] ?? null,
      upsertRuntimePermissionRequest: vi.fn(),
      resolveRuntimePermissionRequest: vi.fn(),
      appendProviderUsageRecord: vi.fn(),
      deleteRuntimeSubagentRun: vi.fn(),
      upsertRuntimeSubagentRun: vi.fn(),
      getSessionState: (key: string) => sessionState.get(key) ?? null,
      setSessionState: (key: string, value: string | null) => {
        if (value === null) {
          sessionState.delete(key);
          return;
        }
        sessionState.set(key, value);
      },
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
    expect(internals.pendingToolRefreshSignature).toBe(internals.getCurrentToolSignature());

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
    const deletePersistedSessionSpy = vi
      .spyOn(
        manager as unknown as { deletePersistedSession: (sessionId: string) => Promise<void> },
        "deletePersistedSession",
      )
      .mockResolvedValue(undefined);

    internals.session = session;
    internals.activeSessionId = "test-session";
    internals.currentState = "idle";
    internals.registeredToolSignature = JSON.stringify([]);

    await internals.refreshSessionForToolChanges();

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(deletePersistedSessionSpy).toHaveBeenCalledWith("test-session", "copilot");
    expect(internals.session).toBeNull();
    expect(internals.activeSessionId).toBeNull();
    expect(internals.registeredToolSignature).toBeNull();
    expect(internals.pendingToolRefreshSignature).toBeNull();
  });

  it("deletes the persisted provider session when tool drift is detected without a live handle", async () => {
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
    const deletePersistedSessionSpy = vi
      .spyOn(
        manager as unknown as { deletePersistedSession: (sessionId: string) => Promise<void> },
        "deletePersistedSession",
      )
      .mockResolvedValue(undefined);

    internals.session = null;
    internals.activeSessionId = "stale-session";
    internals.registeredToolSignature = JSON.stringify([]);

    await internals.refreshSessionForToolChanges();

    expect(deletePersistedSessionSpy).toHaveBeenCalledWith("stale-session", "copilot");
    expect(internals.activeSessionId).toBeNull();
    expect(internals.registeredToolSignature).toBe(internals.getCurrentToolSignature());
  });

  it("clears stale binding state even if tool-drift session deletion fails", async () => {
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
    vi.spyOn(
      manager as unknown as { deletePersistedSession: (sessionId: string) => Promise<void> },
      "deletePersistedSession",
    ).mockRejectedValue(new Error("delete failed"));

    internals.session = null;
    internals.activeSessionId = "stale-session";
    internals.registeredToolSignature = JSON.stringify([]);

    await internals.refreshSessionForToolChanges();

    expect(internals.activeSessionId).toBeNull();
    expect(internals.pendingToolRefreshSignature).toBe(internals.getCurrentToolSignature());
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

  it("exposes host-only delegation domains when subagents are enabled", () => {
    const manager = createManager([], {
      envInput: { SPIRA_SUBAGENTS_ENABLED: "true" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const toolNames = internals.getSessionConfig().tools.map((tool) => tool.name);

    expect(toolNames).toContain("delegate_to_code_review");
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
    const toolNames = internals
      .getSessionConfig(undefined, {
        providerId: "copilot",
        capabilities: {
          persistentSessions: true,
          abortableTurns: true,
          sessionResumption: "provider-managed",
          turnCancellation: "provider-abort",
          responseStreaming: "native",
          usageReporting: "full",
          toolManifestMode: "projected",
          modelSelection: "session-scoped",
          toolCalling: "native",
        },
      })
      .tools.map((tool) => tool.name);

    expect(toolNames).not.toContain("view");
    expect(toolNames).not.toContain("glob");
    expect(toolNames).not.toContain("rg");
  });

  it("keeps host tools for the azure-openai provider", () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const toolNames = internals
      .getSessionConfig(undefined, {
        providerId: "azure-openai",
        capabilities: {
          persistentSessions: false,
          abortableTurns: false,
          sessionResumption: "host-managed",
          turnCancellation: "disconnect-and-reset",
          responseStreaming: "host-buffered",
          usageReporting: "partial",
          toolManifestMode: "literal",
          modelSelection: "provider-default",
          toolCalling: "native",
        },
      })
      .tools.map((tool) => tool.name);

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
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], { memoryDb: runtimeMemory.db, stationId: "primary" });
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
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
      },
      resumeSession: vi.fn().mockResolvedValue(resumedSession),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };
    const manifest = (
      manager as unknown as {
        getCurrentToolManifest(provider: typeof client): { hostManifestHash: string; projectionHash: string };
      }
    ).getCurrentToolManifest(client);
    runtimeMemory.db.getRuntimeStationState = () => ({
      stationId: "primary",
      state: "idle",
      promptInFlight: false,
      activeSessionId: "persisted-session",
      hostManifestHash: manifest.hostManifestHash,
      providerProjectionHash: manifest.projectionHash,
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1,
      updatedAt: 1,
    });

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
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      sessionPersistence: persistence,
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
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
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
      },
      resumeSession: vi.fn().mockResolvedValue(resumedSession),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };
    const manifest = (
      manager as unknown as {
        getCurrentToolManifest(provider: typeof client): { hostManifestHash: string; projectionHash: string };
      }
    ).getCurrentToolManifest(client);
    runtimeMemory.db.getRuntimeStationState = () => ({
      stationId: "primary",
      state: "idle",
      promptInFlight: false,
      activeSessionId: "persisted-session",
      hostManifestHash: manifest.hostManifestHash,
      providerProjectionHash: manifest.projectionHash,
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1,
      updatedAt: 1,
    });

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

  it("discards persisted sessions when runtime manifest provenance is missing or stale", async () => {
    const persistence = {
      load: vi.fn().mockReturnValue("persisted-session"),
      save: vi.fn(),
    };
    const runtimeMemory = createRuntimeMemoryDb({
      stationId: "primary",
      state: "idle",
      promptInFlight: false,
      activeSessionId: "persisted-session",
      hostManifestHash: "stale-host-manifest",
      providerProjectionHash: "stale-projection",
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const manager = createManager([], {
      sessionPersistence: persistence,
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
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
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
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

    expect(client.resumeSession).not.toHaveBeenCalled();
    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect(client.deleteSession).toHaveBeenCalledWith("persisted-session");
    expect(persistence.save).toHaveBeenCalledWith(null);
    expect(runtimeMemory.runtimeStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hostManifestHash: expect.any(String),
          providerProjectionHash: expect.any(String),
        }),
      ]),
    );
  });

  it("queues stale persisted-session cleanup failures and continues with a fresh session", async () => {
    const persistence = {
      load: vi.fn().mockReturnValue("persisted-session"),
      save: vi.fn(),
    };
    const runtimeMemory = createRuntimeMemoryDb({
      stationId: "primary",
      state: "idle",
      promptInFlight: false,
      activeSessionId: "persisted-session",
      hostManifestHash: "stale-host-manifest",
      providerProjectionHash: "stale-projection",
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1,
      updatedAt: 1,
      providerId: "copilot",
    });
    const manager = createManager([], {
      sessionPersistence: persistence,
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const createdSession = {
      sessionId: "fresh-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "copilot" as const,
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed" as const,
        turnCancellation: "provider-abort" as const,
        responseStreaming: "native" as const,
        usageReporting: "full" as const,
        toolManifestMode: "projected" as const,
        modelSelection: "session-scoped" as const,
        toolCalling: "native" as const,
      },
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(createdSession),
      deleteSession: vi.fn().mockRejectedValue(new Error("delete failed")),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.createSession()).resolves.toBe(createdSession);

    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect(client.deleteSession).toHaveBeenCalledWith("persisted-session");
    expect(persistence.save).toHaveBeenCalledWith(null);
    expect(runtimeMemory.sessionState.get("runtime.provider-session-cleanup")).toBe(
      JSON.stringify([{ providerId: "copilot", sessionId: "persisted-session" }]),
    );
  });

  it("discards persisted sessions when runtime state points at a different active session id", async () => {
    const persistence = {
      load: vi.fn().mockReturnValue("persisted-session"),
      save: vi.fn(),
    };
    const runtimeMemory = createRuntimeMemoryDb({
      stationId: "primary",
      state: "idle",
      promptInFlight: false,
      activeSessionId: "other-session",
      hostManifestHash: "stale-host-manifest",
      providerProjectionHash: "stale-projection",
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const manager = createManager([], {
      sessionPersistence: persistence,
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
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
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
      },
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(createdSession),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };
    const manifest = (
      manager as unknown as {
        getCurrentToolManifest(provider: typeof client): { hostManifestHash: string; projectionHash: string };
      }
    ).getCurrentToolManifest(client);
    runtimeMemory.db.getRuntimeStationState = () => ({
      stationId: "primary",
      state: "idle",
      promptInFlight: false,
      activeSessionId: "other-session",
      hostManifestHash: manifest.hostManifestHash,
      providerProjectionHash: manifest.projectionHash,
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1,
      updatedAt: 1,
    });

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.createSession()).resolves.toBe(createdSession);

    expect(client.resumeSession).not.toHaveBeenCalled();
    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect(persistence.save).toHaveBeenCalledWith(null);
  });

  it("tries stale persisted-session cleanup across providers when runtime state points at a different active session id", async () => {
    const persistence = {
      load: vi.fn().mockReturnValue("persisted-session"),
      save: vi.fn(),
    };
    const runtimeMemory = createRuntimeMemoryDb({
      stationId: "primary",
      state: "idle",
      promptInFlight: false,
      activeSessionId: "other-session",
      providerId: "azure-openai",
      hostManifestHash: "stale-host-manifest",
      providerProjectionHash: "stale-projection",
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const manager = createManager([], {
      sessionPersistence: persistence,
      memoryDb: runtimeMemory.db,
      stationId: "primary",
      envInput: { SPIRA_MODEL_PROVIDER: "copilot" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const createdSession = {
      sessionId: "fresh-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const copilotClient = {
      providerId: "copilot" as const,
      capabilities: getDefaultProviderCapabilities("copilot"),
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(createdSession),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };
    const azureDeleteSession = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof copilotClient> },
      "getOrCreateClient",
    ).mockResolvedValue(copilotClient);
    vi.spyOn(clientFactory, "createProviderClientForProvider").mockImplementation(async (_env, providerId) => ({
      client:
        providerId === "azure-openai"
          ? ({
              providerId: "azure-openai",
              capabilities: getDefaultProviderCapabilities("azure-openai"),
              createSession: vi.fn(),
              resumeSession: vi.fn(),
              deleteSession: azureDeleteSession,
              getAuthStatus: vi.fn(),
              stop: vi.fn().mockResolvedValue([]),
            } as never)
          : (copilotClient as never),
      strategy: {} as never,
    }));

    await expect(internals.createSession()).resolves.toBe(createdSession);

    expect(copilotClient.deleteSession).toHaveBeenCalledWith("persisted-session");
    expect(azureDeleteSession).toHaveBeenCalledWith("persisted-session");
  });

  it("tries clearSession teardown across providers when runtime state points at a different active session id", async () => {
    const runtimeMemory = createRuntimeMemoryDb({
      stationId: "primary",
      state: "idle",
      promptInFlight: false,
      activeSessionId: "other-session",
      providerId: "azure-openai",
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const manager = createManager([], {
      memoryDb: runtimeMemory.db,
      stationId: "primary",
      envInput: { SPIRA_MODEL_PROVIDER: "copilot" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    internals.session = {
      sessionId: "persisted-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.client = {
      providerId: "copilot",
      stop: vi.fn().mockResolvedValue(undefined),
    } as never;
    internals.activeSessionId = "persisted-session";

    const deletePersistedSession = vi
      .spyOn(
        manager as unknown as {
          deletePersistedSession(sessionId: string, providerId: "copilot" | "azure-openai"): Promise<void>;
        },
        "deletePersistedSession",
      )
      .mockResolvedValue(undefined);

    await expect(manager.clearSession()).resolves.toBeUndefined();

    expect(deletePersistedSession).toHaveBeenNthCalledWith(1, "persisted-session", "copilot");
    expect(deletePersistedSession).toHaveBeenNthCalledWith(2, "persisted-session", "azure-openai");
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
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
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
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
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
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
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
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
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
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
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
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
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
    expect(deletePersistedSessionSpy).toHaveBeenCalledWith("persisted-session", "copilot");
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

  it("builds host continuity context from the runtime checkpoint for host-managed providers", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "station:primary",
      kind: "station",
      scope: { stationId: "primary" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-manifest-1",
      providerProjectionHash: "projection-1",
      providerId: "azure-openai",
      providerCapabilities: {
        persistentSessions: false,
        abortableTurns: false,
        sessionResumption: "host-managed",
        turnCancellation: "disconnect-and-reset",
        responseStreaming: "host-buffered",
        usageReporting: "partial",
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
      },
    });
    runtimeMemory.db.upsertRuntimeSession({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
      contract: runtimeSession,
    });
    runtimeMemory.db.upsertRuntimeCheckpoint({
      checkpointId: "checkpoint-1",
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "session-summary",
      summary: "Recovered the last Azure-hosted station turn.",
      payload: createRuntimeCheckpointPayload({
        checkpointId: "checkpoint-1",
        kind: "session-summary",
        createdAt: 1_000,
        summary: "Recovered the last Azure-hosted station turn.",
        artifactRefs: runtimeSession.artifactRefs,
        turnState: runtimeSession.turnState,
        permissionState: runtimeSession.permissionState,
        cancellationState: runtimeSession.cancellationState,
        usageSummary: runtimeSession.usageSummary,
        providerBinding: runtimeSession.providerBinding,
      }),
      createdAt: 1_000,
    });
    runtimeMemory.db.appendRuntimeLedgerEvent({
      eventId: "event-1",
      runtimeSessionId: "station:primary",
      stationId: "primary",
      type: "assistant.message",
      payload: {
        messageId: "assistant-1",
        content: "The renderer issue is isolated to the bridge panel.",
      },
      occurredAt: 1_100,
    });

    const session = {
      sessionId: "azure-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: {
        persistentSessions: false,
        abortableTurns: false,
        sessionResumption: "host-managed" as const,
        turnCancellation: "disconnect-and-reset" as const,
        responseStreaming: "host-buffered" as const,
        usageReporting: "partial" as const,
        toolManifestMode: "literal" as const,
        modelSelection: "provider-default" as const,
        toolCalling: "native" as const,
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

    await expect(
      manager.sendMessage("Continue fixing the renderer", {
        continuityPreamble: "[Recovered conversation memory]\nFallback conversation context.",
      }),
    ).resolves.toBeUndefined();

    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        systemMessage: expect.objectContaining({
          sections: expect.objectContaining({
            runtime_recovery: expect.objectContaining({
              content: expect.stringContaining("Recovered the last Azure-hosted station turn."),
            }),
          }),
        }),
      }),
    );
    expect(client.createSession.mock.calls[0]?.[0]?.systemMessage.sections.runtime_recovery.content).toContain(
      "The renderer issue is isolated to the bridge panel.",
    );
    expect(session.send).toHaveBeenCalledWith({
      prompt: "Continue fixing the renderer",
    });
  });

  it("switches providers without changing the host runtime session id", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: runtimeMemory.db,
      stationId: "primary",
      envInput: { SPIRA_MODEL_PROVIDER: "copilot" },
    });

    await expect(manager.switchProvider("azure-openai")).resolves.toBeUndefined();

    expect(runtimeMemory.runtimeSessions.get("station:primary")).toMatchObject({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
    });
    expect(runtimeMemory.runtimeLedgerEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runtimeSessionId: "station:primary",
          type: "provider.switched",
          payload: expect.objectContaining({
            fromProviderId: "copilot",
            toProviderId: "azure-openai",
          }),
        }),
      ]),
    );
  });

  it("deletes the previous provider-managed session before switching providers", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "copilot" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "active-copilot-session",
      send: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "copilot" as const,
      capabilities: getDefaultProviderCapabilities("copilot"),
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };
    internals.session = session as never;
    internals.client = client as never;
    internals.activeSessionId = "active-copilot-session";

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(manager.switchProvider("azure-openai")).resolves.toBeUndefined();

    expect(client.deleteSession).toHaveBeenCalledWith("active-copilot-session");
  });

  it("cleans up late-opened teardown sessions with the provider that created them", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "copilot" },
    });
    const internals = manager as unknown as SessionManagerInternals & {
      cleanupSessionOpenedDuringTeardown(
        session: { sessionId: string; disconnect: () => Promise<void> },
        providerId: "copilot" | "azure-openai",
      ): Promise<void>;
      providerOverride: "copilot" | "azure-openai" | null;
    };
    const session = {
      sessionId: "late-copilot-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.providerOverride = "azure-openai";
    internals.client = { providerId: "azure-openai", stop: vi.fn() } as never;

    const deletePersistedSession = vi
      .spyOn(
        manager as unknown as {
          deletePersistedSession(sessionId: string, providerId: "copilot" | "azure-openai"): Promise<void>;
        },
        "deletePersistedSession",
      )
      .mockResolvedValue(undefined);

    await expect(internals.cleanupSessionOpenedDuringTeardown(session, "copilot")).resolves.toBeUndefined();

    expect(deletePersistedSession).toHaveBeenCalledWith("late-copilot-session", "copilot");
  });

  it("does not tear down the active session for a no-op provider switch", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "copilot" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "active-copilot-session",
      send: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "copilot" as const,
      capabilities: getDefaultProviderCapabilities("copilot"),
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };
    internals.session = session as never;
    internals.client = client as never;

    await expect(manager.switchProvider("copilot")).resolves.toBeUndefined();

    expect(session.disconnect).not.toHaveBeenCalled();
    expect(client.stop).not.toHaveBeenCalled();
  });

  it("preserves a non-default provider override on a no-op switch", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "copilot" },
    });
    const internals = manager as unknown as SessionManagerInternals & { providerOverride: string | null };
    internals.providerOverride = "azure-openai";

    await expect(manager.switchProvider("azure-openai")).resolves.toBeUndefined();

    expect(internals.providerOverride).toBe("azure-openai");
  });

  it.each([
    {
      providerId: "copilot" as const,
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed" as const,
        turnCancellation: "provider-abort" as const,
        responseStreaming: "native" as const,
        usageReporting: "full" as const,
        toolManifestMode: "projected" as const,
        modelSelection: "session-scoped" as const,
        toolCalling: "native" as const,
      },
    },
    {
      providerId: "azure-openai" as const,
      capabilities: {
        persistentSessions: false,
        abortableTurns: false,
        sessionResumption: "host-managed" as const,
        turnCancellation: "disconnect-and-reset" as const,
        responseStreaming: "host-buffered" as const,
        usageReporting: "partial" as const,
        toolManifestMode: "literal" as const,
        modelSelection: "provider-default" as const,
        toolCalling: "native" as const,
      },
    },
  ])("preserves host runtime identity across multi-turn station flows for $providerId", async ({ providerId, capabilities }) => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: runtimeMemory.db,
      stationId: "primary",
      envInput: { SPIRA_MODEL_PROVIDER: providerId },
    });
    const internals = manager as unknown as SessionManagerInternals & { bus: SpiraEventBus };
    const usage = vi.fn();
    internals.bus.on("provider:usage", usage);

    let turnIndex = 0;
    const session = {
      sessionId: `${providerId}-station-session`,
      send: vi.fn().mockImplementation(async ({ prompt }: { prompt: string }) => {
        turnIndex += 1;
        expect(prompt).toBe(turnIndex === 1 ? "First turn" : "Second turn");
        internals.handleSessionEvent({
          type: "assistant.message",
          data: {
            messageId: `assistant-${turnIndex}`,
            content: `Reply ${turnIndex}`,
          },
        });
        internals.handleSessionEvent({
          type: "session.idle",
          data: {
            usage: {
              model: `${providerId}-model`,
              totalTokens: turnIndex * 10,
              source: "provider",
            },
          },
        });
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId,
      capabilities,
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

    await expect(manager.sendMessage("First turn")).resolves.toBeUndefined();
    await expect(manager.sendMessage("Second turn")).resolves.toBeUndefined();

    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect(session.send).toHaveBeenCalledTimes(2);
    expect(runtimeMemory.runtimeSessions.get("station:primary")).toMatchObject({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
      contract: expect.objectContaining({
        providerBinding: expect.objectContaining({
          providerId,
        }),
      }),
    });
    expect(runtimeMemory.runtimeLedgerEvents.filter((event) => event.type === "user.message")).toHaveLength(2);
    expect(runtimeMemory.runtimeLedgerEvents.filter((event) => event.type === "assistant.message")).toHaveLength(2);
    expect(runtimeMemory.runtimeLedgerEvents.filter((event) => event.type === "usage.recorded")).toHaveLength(2);
    expect(usage).toHaveBeenCalledTimes(2);
  });

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

  it("allows a fresh Azure turn after abort and ignores stale events from the disconnected session", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals & { bus: SpiraEventBus };
    const delta = vi.fn();
    internals.bus.on("copilot:delta", delta);
    let rejectStaleSend: ((error: Error) => void) | undefined;
    let staleOnEvent: ((event: { type: string; data: Record<string, unknown> }) => void) | undefined;
    let freshOnEvent: ((event: { type: string; data: Record<string, unknown> }) => void) | undefined;
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
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
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
    internals.bus.on("copilot:error", reportedError);
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
