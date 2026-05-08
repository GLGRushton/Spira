import { describe, expect, it, vi } from "vitest";
import {
  type SpiraEventBus,
  StationSessionManager,
  clientFactory,
  createManager,
  createRuntimeCheckpointPayload,
  createRuntimeMemoryDb,
  createRuntimeSessionContract,
  getDefaultProviderCapabilities,
} from "./session-manager.test-support.js";
import type {
  ProviderHostContinuityState,
  ProviderSessionConfig,
  SessionManagerInternals,
} from "./session-manager.test-support.js";

describe("StationSessionManager", () => {
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
        abortableTurns: true,
        sessionResumption: "host-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
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
        workflowState: runtimeSession.workflowState,
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

  it("rebuilds a fresh Azure session from persisted host continuity state", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manifestSpy = vi
      .spyOn(
        StationSessionManager.prototype as unknown as {
          getCurrentToolManifest: () => { hostManifestHash: string; projectionHash: string };
        },
        "getCurrentToolManifest",
      )
      .mockReturnValue({
        hostManifestHash: "host-manifest-1",
        projectionHash: "projection-1",
      });
    const systemHashSpy = vi
      .spyOn(
        StationSessionManager.prototype as unknown as { getCurrentSystemMessageHash(): string },
        "getCurrentSystemMessageHash",
      )
      .mockReturnValue("system-hash-1");
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "station:primary",
      kind: "station",
      scope: { stationId: "primary" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-manifest-1",
      providerProjectionHash: "projection-1",
      providerId: "azure-openai",
      providerCapabilities: getDefaultProviderCapabilities("azure-openai"),
      hostContinuity: {
        providerId: "azure-openai",
        model: "gpt-4.1",
        systemMessageHash: "system-hash-1",
        updatedAt: 1_000,
        messages: [
          { role: "system", content: "Persisted system." },
          { role: "user", content: "First request" },
          { role: "assistant", content: "First reply" },
        ],
      },
    });
    runtimeMemory.db.upsertRuntimeSession({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
      contract: runtimeSession,
    });

    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const session = {
      sessionId: "azure-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: getDefaultProviderCapabilities("azure-openai"),
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
    vi.spyOn(
      manager as unknown as {
        getCurrentToolManifest: () => { hostManifestHash: string; projectionHash: string };
      },
      "getCurrentToolManifest",
    ).mockReturnValue({
      hostManifestHash: "host-manifest-1",
      projectionHash: "projection-1",
    });

    try {
      await expect(
        manager.sendMessage("Second request", {
          continuityPreamble: "[Recovered conversation memory]\nFallback conversation context.",
        }),
      ).resolves.toBeUndefined();
    } finally {
      manifestSpy.mockRestore();
      systemHashSpy.mockRestore();
    }

    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        hostContinuity: expect.objectContaining({
          providerId: "azure-openai",
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "user", content: "First request" }),
            expect.objectContaining({ role: "assistant", content: "First reply" }),
          ]),
        }),
        systemMessage: expect.objectContaining({
          sections: expect.not.objectContaining({
            runtime_recovery: expect.anything(),
          }),
        }),
      }),
    );
    expect(session.send).toHaveBeenCalledWith({
      prompt: "Second request",
    });
  });

  it("does not reuse interrupted Azure host continuity state for a fresh session", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "station:primary",
      kind: "station",
      scope: { stationId: "primary" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-manifest-1",
      providerProjectionHash: "projection-1",
      providerId: "azure-openai",
      providerCapabilities: getDefaultProviderCapabilities("azure-openai"),
      turnState: {
        state: "thinking",
        activeToolCallIds: [],
        lastUserMessageId: "user-1",
        lastAssistantMessageId: null,
      },
      hostContinuity: {
        providerId: "azure-openai",
        model: "gpt-4.1",
        updatedAt: 1_000,
        messages: [
          { role: "system", content: "Persisted system." },
          { role: "user", content: "Interrupted request" },
        ],
      },
    });
    runtimeMemory.db.upsertRuntimeSession({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
      contract: runtimeSession,
    });

    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const session = {
      sessionId: "azure-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: getDefaultProviderCapabilities("azure-openai"),
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
    vi.spyOn(
      manager as unknown as {
        getCurrentToolManifest: () => { hostManifestHash: string; projectionHash: string };
      },
      "getCurrentToolManifest",
    ).mockReturnValue({
      hostManifestHash: "host-manifest-1",
      projectionHash: "projection-1",
    });

    await expect(manager.sendMessage("Second request")).resolves.toBeUndefined();

    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        hostContinuity: null,
      }),
    );
  });

  it("reuses committed Azure host continuity after restart from an error state", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manifestSpy = vi
      .spyOn(
        StationSessionManager.prototype as unknown as {
          getCurrentToolManifest: () => { hostManifestHash: string; projectionHash: string };
        },
        "getCurrentToolManifest",
      )
      .mockReturnValue({
        hostManifestHash: "host-manifest-1",
        projectionHash: "projection-1",
      });
    const systemHashSpy = vi
      .spyOn(
        StationSessionManager.prototype as unknown as { getCurrentSystemMessageHash(): string },
        "getCurrentSystemMessageHash",
      )
      .mockReturnValue("system-hash-1");
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "station:primary",
      kind: "station",
      scope: { stationId: "primary" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-manifest-1",
      providerProjectionHash: "projection-1",
      providerId: "azure-openai",
      providerCapabilities: getDefaultProviderCapabilities("azure-openai"),
      turnState: {
        state: "error",
        activeToolCallIds: [],
        lastUserMessageId: "user-1",
        lastAssistantMessageId: "assistant-1",
      },
      hostContinuity: {
        providerId: "azure-openai",
        model: "gpt-4.1",
        systemMessageHash: "system-hash-1",
        updatedAt: 1_000,
        messages: [
          { role: "system", content: "Persisted system." },
          { role: "user", content: "Last committed request" },
          { role: "assistant", content: "Last committed reply" },
        ],
      },
    });
    runtimeMemory.db.upsertRuntimeSession({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
      contract: runtimeSession,
    });

    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const session = {
      sessionId: "azure-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: getDefaultProviderCapabilities("azure-openai"),
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
    vi.spyOn(
      manager as unknown as {
        getCurrentToolManifest: () => { hostManifestHash: string; projectionHash: string };
      },
      "getCurrentToolManifest",
    ).mockReturnValue({
      hostManifestHash: "host-manifest-1",
      projectionHash: "projection-1",
    });

    try {
      await expect(manager.sendMessage("Second request")).resolves.toBeUndefined();
    } finally {
      manifestSpy.mockRestore();
      systemHashSpy.mockRestore();
    }

    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        hostContinuity: expect.objectContaining({
          providerId: "azure-openai",
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "user", content: "Last committed request" }),
            expect.objectContaining({ role: "assistant", content: "Last committed reply" }),
          ]),
        }),
      }),
    );
  });

  it("forces a fresh Azure session after session.error so rolled-back continuity is reused", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const committedContinuity: ProviderHostContinuityState = {
      providerId: "azure-openai",
      model: "gpt-4.1",
      systemMessageHash: "system-hash-1",
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
    const createdSession = {
      sessionId: "azure-fresh",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: getDefaultProviderCapabilities("azure-openai"),
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(createdSession),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.client = client as never;
    internals.session = {
      sessionId: "azure-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.activeSessionId = "azure-session";
    internals.currentState = "thinking";
    internals.hostContinuityState = interruptedContinuity;
    internals.resumableHostContinuityState = committedContinuity;
    internals.resumableHostContinuityHostManifestHash = "host-manifest-1";
    internals.resumableHostContinuityProjectionHash = "projection-1";
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);
    vi.spyOn(
      manager as unknown as { getCurrentSystemMessageHash(): string },
      "getCurrentSystemMessageHash",
    ).mockReturnValue("system-hash-1");
    vi.spyOn(
      manager as unknown as {
        getCurrentToolManifest: () => { hostManifestHash: string; projectionHash: string };
      },
      "getCurrentToolManifest",
    ).mockReturnValue({
      hostManifestHash: "host-manifest-1",
      projectionHash: "projection-1",
    });

    internals.handleSessionEvent({
      type: "session.error",
      data: {
        errorType: "internal_error",
        message: "Azure blew a fuse.",
      },
    });
    await Promise.resolve();

    expect(client.deleteSession).toHaveBeenCalledWith("azure-session");
    expect(internals.activeSessionId).toBeNull();

    await expect(internals.createSession()).resolves.toBe(createdSession);

    expect(client.resumeSession).not.toHaveBeenCalled();
    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        hostContinuity: expect.objectContaining({
          providerId: "azure-openai",
          messages: [expect.objectContaining({ role: "assistant", content: "Committed reply." })],
        }),
      }),
    );
  });

  it("does not reuse in-memory Azure continuity when the tool projection has changed", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const createdSession = {
      sessionId: "azure-fresh",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: getDefaultProviderCapabilities("azure-openai"),
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(createdSession),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.resumableHostContinuityState = {
      providerId: "azure-openai",
      model: "gpt-4.1",
      updatedAt: 1_000,
      messages: [{ role: "assistant", content: "Committed reply." }],
    };
    internals.resumableHostContinuityHostManifestHash = "old-host-manifest";
    internals.resumableHostContinuityProjectionHash = "old-projection";
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);
    vi.spyOn(
      manager as unknown as {
        getCurrentToolManifest: () => { hostManifestHash: string; projectionHash: string };
      },
      "getCurrentToolManifest",
    ).mockReturnValue({
      hostManifestHash: "new-host-manifest",
      projectionHash: "new-projection",
    });

    await expect(internals.createSession()).resolves.toBe(createdSession);

    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        hostContinuity: null,
      }),
    );
  });

  it("clears Azure continuity instead of re-tagging it after session.error with projection drift", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const client = {
      providerId: "azure-openai" as const,
      capabilities: getDefaultProviderCapabilities("azure-openai"),
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.client = client as never;
    internals.session = {
      sessionId: "azure-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.activeSessionId = "azure-session";
    internals.currentState = "thinking";
    internals.boundHostManifestHash = "old-host-manifest";
    internals.boundProviderProjectionHash = "old-projection";
    internals.hostContinuityState = {
      providerId: "azure-openai",
      model: "gpt-4.1",
      systemMessageHash: "system-hash-1",
      updatedAt: 1_000,
      messages: [{ role: "assistant", content: "Committed reply." }],
    };
    internals.resumableHostContinuityState = internals.hostContinuityState;
    internals.resumableHostContinuityHostManifestHash = "old-host-manifest";
    internals.resumableHostContinuityProjectionHash = "old-projection";
    vi.spyOn(
      manager as unknown as { getCurrentSystemMessageHash(): string },
      "getCurrentSystemMessageHash",
    ).mockReturnValue("system-hash-1");
    vi.spyOn(
      manager as unknown as {
        getCurrentToolManifest: () => { hostManifestHash: string; projectionHash: string };
      },
      "getCurrentToolManifest",
    ).mockReturnValue({
      hostManifestHash: "new-host-manifest",
      projectionHash: "new-projection",
    });

    internals.handleSessionEvent({
      type: "session.error",
      data: {
        errorType: "internal_error",
        message: "Azure blew a fuse.",
      },
    });
    await Promise.resolve();

    const persistedRuntimeSession = runtimeMemory.runtimeSessions.get("station:primary");
    const persistedRuntimeContract = persistedRuntimeSession?.contract as Record<string, unknown> | undefined;
    expect(persistedRuntimeContract?.hostContinuity).toBeNull();
  });

  it("persists Azure host continuity snapshots into the runtime session contract", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const session = {
      sessionId: "azure-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: getDefaultProviderCapabilities("azure-openai"),
      resumeSession: vi.fn(),
      createSession: vi.fn().mockImplementation(async (config: ProviderSessionConfig & { sessionId: string }) => {
        config.onHostContinuitySnapshot?.({
          providerId: "azure-openai",
          model: "gpt-4.1",
          updatedAt: 1_000,
          messages: [
            { role: "system", content: "Persisted system." },
            { role: "user", content: "First request" },
            { role: "assistant", content: "First reply" },
          ],
        });
        return session;
      }),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(manager.sendMessage("Second request")).resolves.toBeUndefined();

    const persistedRuntimeSession = runtimeMemory.runtimeSessions.get("station:primary");
    const persistedRuntimeContract = persistedRuntimeSession?.contract as Record<string, unknown> | undefined;
    expect(persistedRuntimeSession?.runtimeSessionId).toBe("station:primary");
    expect(persistedRuntimeContract?.hostContinuity).toMatchObject({
      providerId: "azure-openai",
      model: "gpt-4.1",
      messages: [
        { role: "system", content: "Persisted system." },
        { role: "user", content: "First request" },
        { role: "assistant", content: "First reply" },
      ],
    });
  });

  it("ignores late Azure host continuity snapshots from a torn-down session", () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const config = internals.getSessionConfig(undefined, {
      providerId: "azure-openai",
      capabilities: getDefaultProviderCapabilities("azure-openai"),
    }) as ProviderSessionConfig;

    internals.activeSessionId = "azure-session";
    internals.sessionTeardownEpoch += 1;
    config.onHostContinuitySnapshot?.({
      providerId: "azure-openai",
      model: "gpt-4.1",
      updatedAt: 1_000,
      messages: [{ role: "assistant", content: "Too late." }],
    });

    expect(internals.hostContinuityState).toBeNull();
    expect(runtimeMemory.runtimeSessions.get("station:primary")).toBeUndefined();
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

  it("clears persisted Azure host continuity when switching providers", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "station:primary",
      kind: "station",
      scope: { stationId: "primary" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-manifest-1",
      providerProjectionHash: "projection-1",
      providerId: "azure-openai",
      providerCapabilities: getDefaultProviderCapabilities("azure-openai"),
      hostContinuity: {
        providerId: "azure-openai",
        model: "gpt-4.1",
        updatedAt: 1_000,
        messages: [{ role: "assistant", content: "Old Azure reply." }],
      },
    });
    runtimeMemory.db.upsertRuntimeSession({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
      contract: runtimeSession,
    });
    const manager = createManager([], {
      memoryDb: runtimeMemory.db,
      stationId: "primary",
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
    });

    await expect(manager.switchProvider("copilot")).resolves.toBeUndefined();

    const persistedRuntimeSession = runtimeMemory.runtimeSessions.get("station:primary");
    const persistedRuntimeContract = persistedRuntimeSession?.contract as Record<string, unknown> | undefined;
    const providerBinding = persistedRuntimeContract?.providerBinding as Record<string, unknown> | undefined;
    expect(persistedRuntimeSession?.runtimeSessionId).toBe("station:primary");
    expect(persistedRuntimeContract?.hostContinuity).toBeNull();
    expect(providerBinding?.providerId).toBe("copilot");
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

  it("prefers the configured provider over a stale persisted runtime binding after restart", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const persistedSession = createRuntimeSessionContract({
      runtimeSessionId: "station:primary",
      kind: "station",
      scope: { stationId: "primary" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-manifest-1",
      providerProjectionHash: "projection-1",
      providerId: "copilot",
      providerCapabilities: getDefaultProviderCapabilities("copilot"),
    });
    runtimeMemory.db.upsertRuntimeSession({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
      contract: persistedSession,
    });
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const createProviderClientForProvider = vi
      .spyOn(clientFactory, "createProviderClientForProvider")
      .mockResolvedValue({
        client: {
          providerId: "azure-openai",
          capabilities: getDefaultProviderCapabilities("azure-openai"),
          createSession: vi.fn(),
          resumeSession: vi.fn(),
          deleteSession: vi.fn(),
          getAuthStatus: vi.fn(),
          stop: vi.fn().mockResolvedValue([]),
        } as never,
        strategy: "azure-openai-key",
      });

    await expect((manager as unknown as { createClient(): Promise<unknown> }).createClient()).resolves.toBeDefined();

    expect(createProviderClientForProvider).toHaveBeenCalledWith(
      expect.any(Object),
      "azure-openai",
      expect.any(Object),
    );
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
        abortableTurns: true,
        sessionResumption: "host-managed" as const,
        turnCancellation: "provider-abort" as const,
        responseStreaming: "native" as const,
        usageReporting: "partial" as const,
        toolManifestMode: "literal" as const,
        modelSelection: "provider-default" as const,
        toolCalling: "native" as const,
      },
    },
  ])(
    "preserves host runtime identity across multi-turn station flows for $providerId",
    async ({ providerId, capabilities }) => {
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
    },
  );
});
