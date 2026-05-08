import { describe, expect, it, vi } from "vitest";
import {
  type SpiraEventBus,
  clientFactory,
  createManager,
  createRuntimeMemoryDb,
  getDefaultProviderCapabilities,
} from "./session-manager.test-support.js";
import type { ProviderHostContinuityState, SessionManagerInternals } from "./session-manager.test-support.js";

describe("StationSessionManager", () => {
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

  it("requests native streaming for providers that support it", async () => {
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
        streaming: true,
      }),
    );
  });

  it("drives a streamed Azure turn through the unchanged station event path", async () => {
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
    internals.bus.on("assistant:delta", delta);
    internals.bus.on("assistant:tool-call", toolCall);
    internals.bus.on("assistant:tool-result", toolResult);
    internals.bus.on("assistant:response-end", responseEnd);
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

    await expect(manager.sendMessage("Check the bridge")).resolves.toBeUndefined();

    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        streaming: true,
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

  it("includes the current runtime model on final assistant responses when available", () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "openai-escalation" },
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals & { bus: SpiraEventBus };
    const responseEnd = vi.fn();
    internals.session = {
      sessionId: "openai-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.hostContinuityState = {
      providerId: "openai-escalation",
      model: "gpt-5.4",
      updatedAt: 1_000,
      messages: [],
    };
    internals.bus.on("assistant:response-end", responseEnd);

    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-2",
        content: "Escalation confirmed.",
      },
    });

    expect(responseEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "assistant-2",
        text: "Escalation confirmed.",
        model: "gpt-5.4",
      }),
    );
  });

  it("publishes an assistant model update when observed usage arrives after the reply", () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "openai-escalation" },
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals & { bus: SpiraEventBus };
    const modelUpdate = vi.fn();
    internals.session = {
      sessionId: "openai-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.bus.on("assistant:message-model", modelUpdate);

    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-3",
        content: "Observed model arrives later.",
      },
    });
    internals.handleSessionEvent({
      type: "session.idle",
      data: {
        usage: {
          model: "gpt-5.4",
          totalTokens: 42,
          source: "provider",
        },
      },
    });

    expect(modelUpdate).toHaveBeenCalledWith({
      messageId: "assistant-3",
      text: "Observed model arrives later.",
      timestamp: expect.any(Number),
      model: "gpt-5.4",
    });
  });

  it("uses Azure provider abort without clearing the live session", async () => {
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
      createSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.session = session;
    internals.activeSessionId = "azure-session";
    internals.currentState = "thinking";
    internals.promptInFlight = true;
    internals.activeToolCalls.set("call-1", { toolName: "spira_ui_get_snapshot" });
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.abortResponse()).resolves.toBeUndefined();

    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(session.disconnect).not.toHaveBeenCalled();
    expect(client.deleteSession).not.toHaveBeenCalled();
    expect(internals.activeSessionId).toBe("azure-session");
    expect(internals.promptInFlight).toBe(false);
    expect(internals.activeToolCalls.size).toBe(0);
    expect(persistence.save).not.toHaveBeenCalled();
  });

  it("deletes a timed-out Azure session from the provider cache", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "azure-timeout",
      abort: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: {
        persistentSessions: false,
        abortableTurns: true,
        sessionResumption: "host-managed" as const,
        turnCancellation: "provider-abort" as const,
        responseStreaming: "native" as const,
        usageReporting: "partial" as const,
        toolManifestMode: "literal" as const,
        modelSelection: "provider-default" as const,
        toolCalling: "native" as const,
      },
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.session = session;
    internals.activeSessionId = "azure-timeout";
    internals.currentState = "thinking";
    internals.promptInFlight = true;
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.stopTimedOutTurn(session)).resolves.toBeUndefined();

    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(client.deleteSession).toHaveBeenCalledWith("azure-timeout");
  });

  it("restores the last committed host continuity after an Azure timeout", async () => {
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
      sessionId: "azure-timeout",
      abort: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: getDefaultProviderCapabilities("azure-openai"),
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.session = session;
    internals.client = client as never;
    internals.activeSessionId = "azure-timeout";
    internals.currentState = "thinking";
    internals.promptInFlight = true;
    internals.hostContinuityState = interruptedContinuity;
    internals.resumableHostContinuityState = committedContinuity;
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.stopTimedOutTurn(session)).resolves.toBeUndefined();

    const persistedRuntimeSession = runtimeMemory.runtimeSessions.get("station:primary");
    const persistedRuntimeContract = persistedRuntimeSession?.contract as Record<string, unknown> | undefined;
    expect(internals.hostContinuityState).toEqual(committedContinuity);
    expect(internals.resumableHostContinuityState).toEqual(committedContinuity);
    expect(persistedRuntimeContract?.hostContinuity).toEqual(committedContinuity);
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
    bus.on("assistant:permission-request", permissionRequest);
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
    bus.on("assistant:permission-request", permissionRequest);
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

  it("requires interactive approval for the manual escalation tool", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "openai-escalation" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const bus = (manager as unknown as { bus: SpiraEventBus }).bus;
    const permissionRequest = vi.fn();
    bus.on("assistant:permission-request", permissionRequest);
    internals.session = {
      sessionId: "test-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const response = internals.handlePermissionRequest({
      kind: "custom-tool",
      toolName: "spira_escalate_session",
      toolCallId: "call-2",
      args: {},
    });
    const requestPayload = permissionRequest.mock.calls[0]?.[0];

    expect(requestPayload).toMatchObject({
      serverName: "Spira host runtime",
      toolName: "spira_escalate_session",
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
    bus.on("assistant:permission-request", permissionRequest);
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
});
