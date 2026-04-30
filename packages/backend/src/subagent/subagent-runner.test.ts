import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SpiraMemoryDatabase, getSpiraMemoryDbPath } from "@spira/memory-db";
import { type SubagentDomain, parseEnv } from "@spira/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDefaultProviderCapabilities } from "../provider/capability-fallback.js";
import type { ProviderClient, ProviderSession, ProviderSessionConfig, ProviderSessionEvent } from "../provider/types.js";
import { createRuntimeSessionContract } from "../runtime/runtime-contract.js";
import { RuntimeStore } from "../runtime/runtime-store.js";
import { SpiraEventBus } from "../util/event-bus.js";
import { SubagentRunner } from "./subagent-runner.js";

const tempDirs: string[] = [];
const openDatabases: SpiraMemoryDatabase[] = [];

const createTestRuntimeStore = () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "spira-subagent-runtime-"));
  tempDirs.push(tempDir);
  const database = SpiraMemoryDatabase.open(getSpiraMemoryDbPath(tempDir));
  openDatabases.push(database);
  return new RuntimeStore(database, "primary");
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close();
  }
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

const baseDomain: SubagentDomain = {
  id: "spira",
  label: "Spira Agent",
  serverIds: ["spira-ui"],
  delegationToolName: "delegate_to_spira",
  allowWrites: true,
  systemPrompt: "You control Spira.",
};

const createToolAggregator = () =>
  ({
    getToolsForServerIds: (serverIds: readonly string[]) =>
      serverIds.includes("spira-ui")
        ? [
            {
              serverId: "spira-ui",
              serverName: "Spira UI",
              name: "spira_ui_get_snapshot",
              description: "Read Spira snapshot.",
              inputSchema: { type: "object", properties: {}, additionalProperties: false },
              access: { mode: "read", source: "annotation" },
            },
          ]
        : [],
    getTools: () => [],
  }) as never;

const createSessionEvent = (type: ProviderSessionEvent["type"], data: Record<string, unknown>): ProviderSessionEvent =>
  ({ type, data }) as ProviderSessionEvent;

const createClient = (
  providerIdOrRunSession:
    | "copilot"
    | "azure-openai"
    | ((config: ProviderSessionConfig) => {
        sessionId: string;
        send: (payload: { prompt: string }) => Promise<void>;
        disconnect: () => Promise<void>;
      }),
  maybeRunSession?: (config: ProviderSessionConfig) => {
    sessionId: string;
    send: (payload: { prompt: string }) => Promise<void>;
    disconnect: () => Promise<void>;
  },
) => {
  const providerId = typeof providerIdOrRunSession === "function" ? "copilot" : providerIdOrRunSession;
  const runSession = (typeof providerIdOrRunSession === "function"
    ? providerIdOrRunSession
    : maybeRunSession) as (config: ProviderSessionConfig) => {
    sessionId: string;
    send: (payload: { prompt: string }) => Promise<void>;
    disconnect: () => Promise<void>;
  };
  const clientMock = {
    providerId,
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
    createSession: vi.fn((config: ProviderSessionConfig & { sessionId: string }) =>
      Promise.resolve(runSession(config)),
    ),
    resumeSession: vi.fn((sessionId: string, config: ProviderSessionConfig) =>
      Promise.resolve({
        ...runSession(config),
        sessionId,
      }),
    ),
    deleteSession: vi.fn(),
    getAuthStatus: vi.fn(),
    stop: vi.fn(),
  };

  return {
    clientMock,
    client: clientMock as unknown as ProviderClient,
  };
};

type SubagentRunnerInternals = {
  handlePermissionRequest(
    liveRun: {
      runtimeSessionId: string;
      lastPermissionResolvedAt: number | null;
      pendingPermissionRequestIds?: string[];
      runId?: string;
      roomId?: `agent:${string}`;
      startedAt?: number;
      writesAllowed?: boolean;
      keepAlive?: boolean;
      requestedModel?: string | null;
      toolLookup?: Map<string, unknown>;
      providerOverride?: "copilot" | "azure-openai" | null;
      client?: ProviderClient | null;
      session?: unknown;
      ownsClient?: boolean;
      providerSessionId?: string | null;
      hostManifestHash?: string | null;
      providerProjectionHash?: string | null;
      lastUserMessageId?: string | null;
      lastAssistantMessageId?: string | null;
      latestAssistantMessageText?: string | null;
      usageSummary?: { model: string | null; totalTokens: number | null; lastObservedAt: number | null; source: string };
      cancellationRequestedAt?: number | null;
      cancellationCompletedAt?: number | null;
      runtimeRecoveryContext?: null;
      fallbackRecoveryPrompt?: string | null;
      activeTurnPromise?: Promise<unknown> | null;
      currentContext?: unknown;
      closed?: boolean;
    },
    context: { runId: string },
    request: Record<string, unknown>,
  ): Promise<{ kind: string; feedback?: string }>;
};

describe("SubagentRunner", () => {
  it("builds a structured envelope from a successful run", async () => {
    const bus = new SpiraEventBus();
    const started = vi.fn();
    const toolCall = vi.fn();
    const toolResult = vi.fn();
    const completed = vi.fn();
    bus.on("subagent:started", started);
    bus.on("subagent:tool-call", toolCall);
    bus.on("subagent:tool-result", toolResult);
    bus.on("subagent:completed", completed);

    const { client } = createClient((config) => ({
      sessionId: "subagent-session",
      send: async () => {
        config.onEvent?.(
          createSessionEvent("tool.execution_start", {
            toolCallId: "call-1",
            toolName: "spira_ui_get_snapshot",
            arguments: {},
          }),
        );
        config.onEvent?.(
          createSessionEvent("tool.execution_complete", {
            toolCallId: "call-1",
            success: true,
            result: { activeView: "bridge" },
          }),
        );
        config.onEvent?.(
          createSessionEvent("assistant.message", {
            messageId: "msg-1",
            content:
              '{"summary":"Read the current Spira snapshot.","payload":{"activeView":"bridge"},"stateChanges":[{"targetType":"spira-view","targetId":"bridge","action":"observed"}]}',
          }),
        );
        config.onEvent?.(createSessionEvent("session.idle", {}));
      },
      disconnect: vi.fn().mockResolvedValue(undefined),
    }));

    const runner = new SubagentRunner({
      bus,
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () => client,
      runIdFactory: () => "run-1",
      sessionIdFactory: () => "00000000-0000-0000-0000-000000000001",
      now: (() => {
        let current = 1000;
        return () => ++current;
      })(),
    });

    const envelope = await runner.run({ task: "Inspect Spira" });

    expect(envelope.status).toBe("completed");
    expect(envelope.summary).toBe("Read the current Spira snapshot.");
    expect(envelope.payload).toEqual({ activeView: "bridge" });
    expect(envelope.stateChanges).toEqual([
      {
        scope: "spira",
        targetType: "spira-view",
        targetId: "bridge",
        action: "observed",
      },
    ]);
    expect(envelope.toolCalls).toHaveLength(1);
    expect(started).toHaveBeenCalledTimes(1);
    expect(toolCall).toHaveBeenCalledTimes(1);
    expect(toolResult).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("persists subagent runtime sessions and ledger events against a real runtime store", async () => {
    const bus = new SpiraEventBus();
    const runtimeStore = createTestRuntimeStore();
    const database = (runtimeStore as unknown as { memoryDb: SpiraMemoryDatabase }).memoryDb;
    const { client } = createClient((config) => ({
      sessionId: "subagent-session-runtime",
      send: async () => {
        config.onEvent?.(
          createSessionEvent("assistant.message", {
            messageId: "msg-runtime",
            content: '{"summary":"Runtime persistence verified."}',
          }),
        );
        config.onEvent?.(createSessionEvent("session.idle", {}));
      },
      disconnect: vi.fn().mockResolvedValue(undefined),
    }));

    const runner = new SubagentRunner({
      bus,
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () => client,
      runtimeStore,
      stationId: "primary",
      runIdFactory: () => "run-runtime",
      sessionIdFactory: () => "00000000-0000-0000-0000-0000000000dd",
    });

    await expect(runner.run({ task: "Persist runtime state" })).resolves.toMatchObject({
      status: "completed",
      summary: "Runtime persistence verified.",
    });

    expect(runtimeStore.getRuntimeSession("subagent:run-runtime")).toMatchObject({
      runtimeSessionId: "subagent:run-runtime",
      scope: expect.objectContaining({
        stationId: "primary",
        runId: "run-runtime",
      }),
    });
    expect(runtimeStore.listRuntimeLedgerEvents("subagent:run-runtime")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "session.created" }),
        expect.objectContaining({ type: "user.message" }),
        expect.objectContaining({ type: "assistant.message" }),
      ]),
    );
  });

  it("requests host-buffered streaming for host-managed provider sessions", async () => {
    const bus = new SpiraEventBus();
    const createdSession = {
      sessionId: "azure-subagent-session",
      send: vi.fn(async () => {
        throw new Error("stop after create");
      }),
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
      },
      createSession: vi.fn().mockResolvedValue(createdSession),
      resumeSession: vi.fn(),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    const runner = new SubagentRunner({
      bus,
      env: parseEnv({ SPIRA_MODEL_PROVIDER: "azure-openai" }),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () => client as unknown as ProviderClient,
      runIdFactory: () => "run-streaming",
      sessionIdFactory: () => "00000000-0000-0000-0000-000000000099",
    });

    await expect(runner.run({ task: "Inspect Spira" })).resolves.toMatchObject({
      status: "failed",
      summary: "stop after create",
    });

    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        streaming: false,
      }),
    );
  });

  it("passes requested models into provider session creation", async () => {
    const bus = new SpiraEventBus();
    const setModel = vi.fn().mockResolvedValue(undefined);
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
      createSession: vi.fn(async (config: ProviderSessionConfig & { sessionId: string }) => ({
        sessionId: "subagent-session-model",
        setModel,
        send: async () => {
          config.onEvent?.(
            createSessionEvent("assistant.message", {
              messageId: "msg-model",
              content: '{"summary":"Used requested model."}',
            }),
          );
          config.onEvent?.(createSessionEvent("session.idle", {}));
        },
        disconnect: vi.fn().mockResolvedValue(undefined),
      })),
      resumeSession: vi.fn(),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    const runner = new SubagentRunner({
      bus,
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () => client as unknown as ProviderClient,
      sessionIdFactory: () => "00000000-0000-0000-0000-0000000000ac",
    });

    await runner.run({ task: "Inspect Spira", model: "gpt-5.5" });

    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.5",
      }),
    );
    expect(setModel).toHaveBeenCalledWith("gpt-5.5");
  });

  it("reapplies the requested model when resuming a background subagent session", async () => {
    const setModel = vi.fn().mockResolvedValue(undefined);
    const { client, clientMock } = createClient((config) => ({
      sessionId: "resumed-session",
      setModel,
      send: async () => {
        config.onEvent?.(
          createSessionEvent("assistant.message", {
            messageId: "msg-resume-model",
            content: '{"summary":"Resumed with the requested model."}',
          }),
        );
        config.onEvent?.(createSessionEvent("session.idle", {}));
      },
      disconnect: vi.fn().mockResolvedValue(undefined),
    }));

    const runner = new SubagentRunner({
      bus: new SpiraEventBus(),
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () => client,
    });
    const manifest = (
      runner as unknown as {
        getToolManifest(liveRun: { client: ProviderClient; writesAllowed: boolean; currentContext: null }): {
          hostManifestHash: string;
          projectionHash: string;
        };
      }
    ).getToolManifest({
      client,
      writesAllowed: false,
      currentContext: null,
    });

    const recovered = runner.recover({
      agent_id: "run-resume-model",
      runId: "run-resume-model",
      roomId: "agent:subagent-run-resume-model",
      domain: "spira",
      task: "Inspect Spira",
      providerId: "copilot",
      requestedModel: "claude-opus-4.7",
      status: "idle",
      allowWrites: false,
      providerSessionId: "persisted-model-session",
      hostManifestHash: manifest.hostManifestHash,
      providerProjectionHash: manifest.projectionHash,
      startedAt: 1,
      updatedAt: 2,
    });

    await recovered?.write("Continue.");

    expect(clientMock.resumeSession).toHaveBeenCalledWith(
      "persisted-model-session",
      expect.objectContaining({
        model: "claude-opus-4.7",
      }),
    );
    expect(setModel).toHaveBeenCalledWith("claude-opus-4.7");
  });

  it("retries once after an initial failure", async () => {
    const bus = new SpiraEventBus();
    const errored = vi.fn();
    bus.on("subagent:error", errored);

    let attempt = 0;
    const { client, clientMock } = createClient((config) => ({
      sessionId: `subagent-session-${++attempt}`,
      send: async () => {
        if (attempt === 1) {
          throw new Error("first attempt failed");
        }

        config.onEvent?.(
          createSessionEvent("assistant.message", {
            messageId: "msg-2",
            content: '{"summary":"Recovered after retry.","payload":{"attempt":2}}',
          }),
        );
        config.onEvent?.(createSessionEvent("session.idle", {}));
      },
      disconnect: vi.fn().mockResolvedValue(undefined),
    }));

    const runner = new SubagentRunner({
      bus,
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () => client,
      runIdFactory: () => `run-${attempt + 1}`,
      sessionIdFactory: () => `00000000-0000-0000-0000-00000000000${attempt + 1}` as const,
      retryDelayMs: 0,
    });

    const envelope = await runner.run({ task: "Inspect Spira" });

    expect(envelope.status).toBe("completed");
    expect(envelope.retryCount).toBe(1);
    expect(envelope.summary).toBe("Recovered after retry.");
    expect(errored).toHaveBeenCalledTimes(1);
    expect(errored.mock.calls[0]?.[0]?.runId).toBe(envelope.runId);
    expect(clientMock.createSession).toHaveBeenCalledTimes(2);
    expect(clientMock.resumeSession).not.toHaveBeenCalled();
  });

  it("emits error tool results when a session fails mid-tool", async () => {
    const bus = new SpiraEventBus();
    const toolResult = vi.fn();
    bus.on("subagent:tool-result", toolResult);

    const { client } = createClient((config) => ({
      sessionId: "subagent-session",
      send: async () => {
        config.onEvent?.(
          createSessionEvent("tool.execution_start", {
            toolCallId: "call-1",
            toolName: "spira_ui_get_snapshot",
            arguments: {},
          }),
        );
        config.onEvent?.(
          createSessionEvent("session.error", {
            message: "session failed",
          }),
        );
      },
      disconnect: vi.fn().mockResolvedValue(undefined),
    }));

    const runner = new SubagentRunner({
      bus,
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () => client,
      runIdFactory: () => "run-error",
      sessionIdFactory: () => "00000000-0000-0000-0000-000000000003",
      retryDelayMs: 0,
    });

    const envelope = await runner.run({ task: "Inspect Spira" });

    expect(envelope.status).toBe("partial");
    expect(toolResult).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: "call-1",
        toolName: "spira_ui_get_snapshot",
        status: "error",
        details: "session failed",
      }),
    );
  });

  it("waits for session idle before finalizing the latest assistant message", async () => {
    const bus = new SpiraEventBus();

    const { client } = createClient((config) => ({
      sessionId: "subagent-session",
      send: async () => {
        config.onEvent?.(
          createSessionEvent("assistant.message", {
            messageId: "msg-1",
            content: "Still working on it.",
          }),
        );
        config.onEvent?.(
          createSessionEvent("tool.execution_start", {
            toolCallId: "call-1",
            toolName: "spira_ui_get_snapshot",
            arguments: {},
          }),
        );
        config.onEvent?.(
          createSessionEvent("tool.execution_complete", {
            toolCallId: "call-1",
            success: true,
            result: { activeView: "bridge" },
          }),
        );
        config.onEvent?.(
          createSessionEvent("assistant.message", {
            messageId: "msg-2",
            content: '{"summary":"Finished after tool call.","payload":{"activeView":"bridge"}}',
          }),
        );
        config.onEvent?.(createSessionEvent("session.idle", {}));
      },
      disconnect: vi.fn().mockResolvedValue(undefined),
    }));

    const runner = new SubagentRunner({
      bus,
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () => client,
      runIdFactory: () => "run-latest",
      sessionIdFactory: () => "00000000-0000-0000-0000-000000000004",
    });

    const envelope = await runner.run({ task: "Inspect Spira" });

    expect(envelope.summary).toBe("Finished after tool call.");
    expect(envelope.payload).toEqual({ activeView: "bridge" });
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
  ])("keeps background runs alive for follow-up writes until stopped for $providerId", async ({ providerId, capabilities }) => {
    const bus = new SpiraEventBus();
    const started = vi.fn();
    bus.on("subagent:started", started);
    const disconnect = vi.fn().mockResolvedValue(undefined);
    let sendCount = 0;

    const { client, clientMock } = createClient(providerId, (config) => ({
      sessionId: "subagent-session-live",
      send: async ({ prompt }) => {
        sendCount += 1;
        if (sendCount === 1) {
          expect(prompt).toBe("Inspect Spira");
          config.onEvent?.(
            createSessionEvent("assistant.message", {
              messageId: "msg-1",
              content: '{"summary":"Initial inspection complete.","payload":{"step":1}}',
            }),
          );
          config.onEvent?.(createSessionEvent("session.idle", {}));
          return;
        }

        expect(prompt).toBe("Continue with a follow-up");
        config.onEvent?.(
          createSessionEvent("assistant.message", {
            messageId: "msg-2",
            content: '{"summary":"Follow-up complete.","payload":{"step":2}}',
          }),
        );
        config.onEvent?.(createSessionEvent("session.idle", {}));
      },
      disconnect,
    }));
    clientMock.capabilities = capabilities;

    const runner = new SubagentRunner({
      bus,
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () => client,
      runIdFactory: () => "run-live",
      sessionIdFactory: () => "00000000-0000-0000-0000-000000000005",
    });

    const launch = runner.launch({ task: "Inspect Spira", mode: "background" });
    const initialEnvelope = await launch.resultPromise;

    expect(initialEnvelope.summary).toBe("Initial inspection complete.");
    expect(clientMock.createSession).toHaveBeenCalledTimes(1);
    expect(started).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();

    const followupEnvelope = await launch.write("Continue with a follow-up");

    expect(followupEnvelope.summary).toBe("Follow-up complete.");
    expect(clientMock.createSession).toHaveBeenCalledTimes(1);
    expect(started).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();

    await launch.stop();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("persists provider switch history for background runs", async () => {
    const runtimeStore = createTestRuntimeStore();
    let activeProvider: "copilot" | "azure-openai" = "copilot";
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const copilot = createClient("copilot", (config) => ({
      sessionId: "subagent-session-copilot",
      send: async () => {
        config.onEvent?.(
          createSessionEvent("assistant.message", {
            messageId: "msg-copilot",
            content: '{"summary":"Initial inspection complete."}',
          }),
        );
        config.onEvent?.(createSessionEvent("session.idle", {}));
      },
      disconnect,
    }));
    const azure = createClient("azure-openai", (config) => ({
      sessionId: "subagent-session-azure",
      send: async () => {
        config.onEvent?.(
          createSessionEvent("assistant.message", {
            messageId: "msg-azure",
            content: '{"summary":"Follow-up complete on Azure."}',
          }),
        );
        config.onEvent?.(createSessionEvent("session.idle", {}));
      },
      disconnect,
    }));
    const runner = new SubagentRunner({
      bus: new SpiraEventBus(),
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      runtimeStore,
      getClient: async () => (activeProvider === "copilot" ? copilot.client : azure.client),
      runIdFactory: () => "run-switch",
      sessionIdFactory: () => "00000000-0000-0000-0000-0000000000ef",
    });

    const launch = runner.launch({ task: "Inspect Spira", mode: "background" });
    await expect(launch.resultPromise).resolves.toMatchObject({
      summary: "Initial inspection complete.",
    });

    activeProvider = "azure-openai";
    await runner.switchProvider("azure-openai", "policy");

    expect(runtimeStore.getRuntimeSession("subagent:run-switch")?.providerSwitches).toEqual([
      expect.objectContaining({
        fromProviderId: "copilot",
        toProviderId: "azure-openai",
        reason: "policy",
      }),
    ]);
    expect(runtimeStore.listRuntimeLedgerEvents("subagent:run-switch")).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "provider.switched" })]),
    );
  });

  it("rebuilds recovered background context when provider session persistence is unavailable", async () => {
    const bus = new SpiraEventBus();
    const prompts: string[] = [];
    const { client } = createClient((config) => ({
      sessionId: "subagent-session-recovered",
      send: async ({ prompt }) => {
        prompts.push(prompt);
        config.onEvent?.(
          createSessionEvent("assistant.message", {
            messageId: "msg-recovered",
            content: '{"summary":"Recovered follow-up complete.","payload":{"step":2}}',
          }),
        );
        config.onEvent?.(createSessionEvent("session.idle", {}));
      },
      disconnect: vi.fn().mockResolvedValue(undefined),
    }));
    const hostManagedClient = {
      ...client,
      capabilities: {
        persistentSessions: false,
        abortableTurns: false,
        sessionResumption: "host-managed",
        turnCancellation: "disconnect-and-reset",
        responseStreaming: "host-buffered",
        usageReporting: "partial",
      },
    } as ProviderClient;

    const runner = new SubagentRunner({
      bus,
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () => hostManagedClient,
      sessionIdFactory: () => "00000000-0000-0000-0000-0000000000aa",
    });
    const manifest = (
      runner as unknown as {
        getToolManifest(liveRun: { client: ProviderClient; writesAllowed: boolean; currentContext: null }): {
          hostManifestHash: string;
          projectionHash: string;
        };
      }
    ).getToolManifest({
      client: hostManagedClient,
      writesAllowed: true,
      currentContext: null,
    });

    const recovered = runner.recover({
      agent_id: "run-recovered",
      runId: "run-recovered",
      roomId: "agent:subagent-run-recovered",
      domain: "spira",
      task: "Inspect Spira",
      requestedModel: "gpt-5.5",
      status: "idle",
      allowWrites: true,
      startedAt: 1000,
      updatedAt: 1100,
      completedAt: 1100,
      hostManifestHash: manifest.hostManifestHash,
      providerProjectionHash: manifest.projectionHash,
      summary: "Initial inspection complete.",
      followupNeeded: true,
      toolCalls: [],
      envelope: {
        runId: "run-recovered",
        domain: "spira",
        task: "Inspect Spira",
        status: "completed",
        retryCount: 0,
        startedAt: 1000,
        completedAt: 1100,
        durationMs: 100,
        followupNeeded: true,
        summary: "Initial inspection complete.",
        artifacts: [],
        stateChanges: [],
        toolCalls: [],
        errors: [],
        payload: { step: 1 },
      },
    });

    expect(recovered).not.toBeNull();
    await expect(recovered?.write("Continue with a follow-up")).resolves.toMatchObject({
      summary: "Recovered follow-up complete.",
    });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("[Recovered subagent context]");
    expect(prompts[0]).toContain("Follow-up request:\nContinue with a follow-up");
    expect(prompts[0]).toContain("Task: Inspect Spira");
    expect((hostManagedClient.createSession as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      model: "gpt-5.5",
    });
  });

  it("falls back to a fresh session when recovered provider resume fails", async () => {
    const bus = new SpiraEventBus();
    const prompts: string[] = [];
    const { client, clientMock } = createClient((config) => ({
      sessionId: "subagent-session-fallback",
      send: async ({ prompt }) => {
        prompts.push(prompt);
        config.onEvent?.(
          createSessionEvent("assistant.message", {
            messageId: "msg-fallback",
            content: '{"summary":"Recovered on a fresh session.","payload":{"step":2}}',
          }),
        );
        config.onEvent?.(createSessionEvent("session.idle", {}));
      },
      disconnect: vi.fn().mockResolvedValue(undefined),
    }));
    clientMock.resumeSession.mockRejectedValueOnce(new Error("Session not found: expired-session"));

    const runner = new SubagentRunner({
      bus,
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () => client,
      sessionIdFactory: () => "00000000-0000-0000-0000-0000000000ab",
    });
    const manifest = (
      runner as unknown as {
        getToolManifest(liveRun: { client: ProviderClient; writesAllowed: boolean; currentContext: null }): {
          hostManifestHash: string;
          projectionHash: string;
        };
      }
    ).getToolManifest({
      client,
      writesAllowed: true,
      currentContext: null,
    });

    const recovered = runner.recover({
      agent_id: "run-fallback",
      runId: "run-fallback",
      roomId: "agent:subagent-run-fallback",
      domain: "spira",
      task: "Inspect Spira",
      providerId: "copilot",
      status: "idle",
      allowWrites: true,
      startedAt: 1000,
      updatedAt: 1100,
      completedAt: 1100,
      providerSessionId: "expired-session",
      hostManifestHash: manifest.hostManifestHash,
      providerProjectionHash: manifest.projectionHash,
      summary: "Initial inspection complete.",
      followupNeeded: true,
      toolCalls: [],
      envelope: {
        runId: "run-fallback",
        domain: "spira",
        task: "Inspect Spira",
        status: "completed",
        retryCount: 0,
        startedAt: 1000,
        completedAt: 1100,
        durationMs: 100,
        followupNeeded: true,
        summary: "Initial inspection complete.",
        artifacts: [],
        stateChanges: [],
        toolCalls: [],
        errors: [],
        payload: { step: 1 },
      },
    });

    await expect(recovered?.write("Continue with a follow-up")).resolves.toMatchObject({
      summary: "Recovered on a fresh session.",
    });
    expect(clientMock.resumeSession).toHaveBeenCalledWith("expired-session", expect.any(Object));
    expect(clientMock.createSession).toHaveBeenCalledTimes(1);
    expect(prompts[0]).toContain("[Recovered subagent context]");
  });

  it("recovers an idle subagent from the runtime contract binding when the snapshot missed provider-session sync", async () => {
    const runtimeStore = createTestRuntimeStore();
    const prompts: string[] = [];
    const { client, clientMock } = createClient((config) => ({
      sessionId: "contract-bound-session",
      send: async ({ prompt }) => {
        prompts.push(prompt);
        config.onEvent?.(
          createSessionEvent("assistant.message", {
            messageId: "msg-contract-recovery",
            content: '{"summary":"Recovered from contract binding."}',
          }),
        );
        config.onEvent?.(createSessionEvent("session.idle", {}));
      },
      disconnect: vi.fn().mockResolvedValue(undefined),
    }));
    const runner = new SubagentRunner({
      bus: new SpiraEventBus(),
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () => client,
      runtimeStore,
      stationId: "primary",
    });
    const manifest = (
      runner as unknown as {
        getToolManifest(liveRun: { client: ProviderClient; writesAllowed: boolean; currentContext: null }): {
          hostManifestHash: string;
          projectionHash: string;
        };
      }
    ).getToolManifest({
      client,
      writesAllowed: true,
      currentContext: null,
    });
    runtimeStore.persistRuntimeSession({
      runtimeSessionId: "subagent:run-contract-recovery",
      stationId: "primary",
      runId: "run-contract-recovery",
      kind: "subagent",
      contract: createRuntimeSessionContract({
        runtimeSessionId: "subagent:run-contract-recovery",
        kind: "subagent",
        scope: { runId: "run-contract-recovery", stationId: "primary" },
        workingDirectory: "C:\\GitHub\\Spira",
        hostManifestHash: manifest.hostManifestHash,
        providerProjectionHash: manifest.projectionHash,
        providerId: "copilot",
        providerCapabilities: client.capabilities,
        providerSessionId: "contract-bound-session",
        model: null,
        boundAt: 1000,
        artifactRefs: [],
        checkpointRef: null,
        turnState: { state: "idle", activeToolCallIds: [] },
        permissionState: { status: "idle", pendingRequestIds: [] },
        cancellationState: { status: "idle" },
        usageSummary: { model: null, totalTokens: null, lastObservedAt: null, source: "unknown" },
        providerSwitches: [],
      }),
    });

    const recovered = runner.recover({
      agent_id: "run-contract-recovery",
      runId: "run-contract-recovery",
      roomId: "agent:subagent-run-contract-recovery",
      domain: "spira",
      task: "Inspect Spira",
      providerId: "copilot",
      status: "idle",
      allowWrites: true,
      startedAt: 1000,
      updatedAt: 1100,
      completedAt: 1100,
      hostManifestHash: manifest.hostManifestHash,
      providerProjectionHash: manifest.projectionHash,
      summary: "Initial inspection complete.",
      followupNeeded: true,
      toolCalls: [],
      envelope: {
        runId: "run-contract-recovery",
        domain: "spira",
        task: "Inspect Spira",
        status: "completed",
        retryCount: 0,
        startedAt: 1000,
        completedAt: 1100,
        durationMs: 100,
        followupNeeded: true,
        summary: "Initial inspection complete.",
        artifacts: [],
        stateChanges: [],
        toolCalls: [],
        errors: [],
        payload: { step: 1 },
      },
    });

    await expect(recovered?.write("Continue with the bound session")).resolves.toMatchObject({
      summary: "Recovered from contract binding.",
    });
    expect(clientMock.resumeSession).toHaveBeenCalledWith("contract-bound-session", expect.any(Object));
    expect(prompts[0]).toContain("Follow-up request:\nContinue with the bound session");
  });

  it("prefers the runtime contract binding and provenance atomically over a stale snapshot pair", async () => {
    const runtimeStore = createTestRuntimeStore();
    const prompts: string[] = [];
    const { client, clientMock } = createClient("azure-openai", (config) => ({
      sessionId: "fresh-azure-session",
      send: async ({ prompt }) => {
        prompts.push(prompt);
        config.onEvent?.(
          createSessionEvent("assistant.message", {
            messageId: "msg-azure-contract-recovery",
            content: '{"summary":"Recovered from the runtime contract pair."}',
          }),
        );
        config.onEvent?.(createSessionEvent("session.idle", {}));
      },
      disconnect: vi.fn().mockResolvedValue(undefined),
    }));
    const runner = new SubagentRunner({
      bus: new SpiraEventBus(),
      env: parseEnv({ SPIRA_MODEL_PROVIDER: "copilot" }),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () => client,
      runtimeStore,
      stationId: "primary",
    });
    const manifest = (
      runner as unknown as {
        getToolManifest(liveRun: { client: ProviderClient; writesAllowed: boolean; currentContext: null }): {
          hostManifestHash: string;
          projectionHash: string;
        };
      }
    ).getToolManifest({
      client,
      writesAllowed: true,
      currentContext: null,
    });
    runtimeStore.persistRuntimeSession({
      runtimeSessionId: "subagent:run-atomic-contract-recovery",
      stationId: "primary",
      runId: "run-atomic-contract-recovery",
      kind: "subagent",
      contract: createRuntimeSessionContract({
        runtimeSessionId: "subagent:run-atomic-contract-recovery",
        kind: "subagent",
        scope: { runId: "run-atomic-contract-recovery", stationId: "primary" },
        workingDirectory: "C:\\GitHub\\Spira",
        hostManifestHash: manifest.hostManifestHash,
        providerProjectionHash: manifest.projectionHash,
        providerId: "azure-openai",
        providerCapabilities: client.capabilities,
        providerSessionId: "fresh-azure-session",
        model: null,
        boundAt: 1000,
        artifactRefs: [],
        checkpointRef: null,
        turnState: { state: "idle", activeToolCallIds: [] },
        permissionState: { status: "idle", pendingRequestIds: [] },
        cancellationState: { status: "idle" },
        usageSummary: { model: null, totalTokens: null, lastObservedAt: null, source: "unknown" },
        providerSwitches: [
          {
            switchId: "switch-atomic-contract-recovery",
            fromProviderId: "copilot",
            toProviderId: "azure-openai",
            switchedAt: 1050,
            reason: "user-requested",
            hostManifestHash: manifest.hostManifestHash,
            projectionHash: manifest.projectionHash,
          },
        ],
      }),
    });

    const recovered = runner.recover({
      agent_id: "run-atomic-contract-recovery",
      runId: "run-atomic-contract-recovery",
      roomId: "agent:subagent-run-atomic-contract-recovery",
      domain: "spira",
      task: "Inspect Spira",
      providerId: "copilot",
      providerSessionId: "stale-copilot-session",
      status: "idle",
      allowWrites: true,
      startedAt: 1000,
      updatedAt: 1100,
      completedAt: 1100,
      summary: "Initial inspection complete.",
      followupNeeded: true,
      toolCalls: [],
      envelope: {
        runId: "run-atomic-contract-recovery",
        domain: "spira",
        task: "Inspect Spira",
        status: "completed",
        retryCount: 0,
        startedAt: 1000,
        completedAt: 1100,
        durationMs: 100,
        followupNeeded: true,
        summary: "Initial inspection complete.",
        artifacts: [],
        stateChanges: [],
        toolCalls: [],
        errors: [],
        payload: { step: 1 },
      },
    });

    await expect(recovered?.write("Continue with the switched provider")).resolves.toMatchObject({
      summary: "Recovered from the runtime contract pair.",
    });
    expect(clientMock.resumeSession).toHaveBeenCalledWith("fresh-azure-session", expect.any(Object));
    expect(clientMock.deleteSession).not.toHaveBeenCalledWith("fresh-azure-session");
    expect(prompts[0]).toContain("Follow-up request:\nContinue with the switched provider");
  });

  it("infers the legacy session provider from station switch history instead of the current station provider", () => {
    const runtimeStore = createTestRuntimeStore();

    runtimeStore.persistRuntimeSession({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      runId: null,
      kind: "station",
      contract: createRuntimeSessionContract({
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
        boundAt: 1000,
        artifactRefs: [],
        checkpointRef: null,
        turnState: { state: "idle", activeToolCallIds: [] },
        permissionState: { status: "idle", pendingRequestIds: [] },
        cancellationState: { status: "idle" },
        usageSummary: { model: null, totalTokens: null, lastObservedAt: null, source: "unknown" },
        providerSwitches: [
          {
            switchId: "switch-station-provider",
            fromProviderId: "copilot",
            toProviderId: "azure-openai",
            switchedAt: 2000,
            reason: "user-requested",
            hostManifestHash: "station-host-hash",
            projectionHash: "station-projection-hash",
          },
        ],
      }),
    });

    const runner = new SubagentRunner({
      bus: new SpiraEventBus(),
      env: parseEnv({ SPIRA_MODEL_PROVIDER: "copilot" }),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      runtimeStore,
      stationId: "primary",
      initialProviderId: "azure-openai",
    });
    const manifest = (
      runner as unknown as {
        getToolManifest(liveRun: { client: ProviderClient; writesAllowed: boolean; currentContext: null }): {
          hostManifestHash: string;
          projectionHash: string;
        };
      }
    ).getToolManifest({
      client: { providerId: "copilot", capabilities: getDefaultProviderCapabilities("copilot") } as ProviderClient,
      writesAllowed: true,
      currentContext: null,
    });
    const binding = (
      runner as unknown as {
        getPersistedProviderBinding(
          snapshot: {
            providerSessionId: string;
            hostManifestHash: string;
            providerProjectionHash: string;
            startedAt: number;
            updatedAt: number;
            completedAt: number;
          },
          runtimeSession: null,
        ): { providerId: string | null; providerSessionId: string | null };
      }
    ).getPersistedProviderBinding(
      {
        providerSessionId: "legacy-copilot-session",
        hostManifestHash: manifest.hostManifestHash,
        providerProjectionHash: manifest.projectionHash,
        startedAt: 1000,
        updatedAt: 1500,
        completedAt: 1500,
      },
      null,
    );

    expect(binding).toMatchObject({
      providerId: "copilot",
      providerSessionId: "legacy-copilot-session",
    });
  });

  it("keeps recovered runs on the bound default provider even when the station is overridden", () => {
    const runtimeStore = createTestRuntimeStore();
    const runner = new SubagentRunner({
      bus: new SpiraEventBus(),
      env: parseEnv({ SPIRA_MODEL_PROVIDER: "copilot" }),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      runtimeStore,
      initialProviderId: "azure-openai",
    });
    const manifest = (
      runner as unknown as {
        getToolManifest(liveRun: { client: ProviderClient; writesAllowed: boolean; currentContext: null }): {
          hostManifestHash: string;
          projectionHash: string;
        };
      }
    ).getToolManifest({
      client: { providerId: "copilot", capabilities: getDefaultProviderCapabilities("copilot") } as ProviderClient,
      writesAllowed: true,
      currentContext: null,
    });

    const recovered = runner.recover({
      agent_id: "run-default-provider-recovery",
      runId: "run-default-provider-recovery",
      roomId: "agent:subagent-run-default-provider-recovery",
      domain: "spira",
      task: "Inspect Spira",
      providerId: "copilot",
      providerSessionId: "default-provider-session",
      hostManifestHash: manifest.hostManifestHash,
      providerProjectionHash: manifest.projectionHash,
      status: "idle",
      allowWrites: true,
      startedAt: 1000,
      updatedAt: 1100,
      completedAt: 1100,
      summary: "Initial inspection complete.",
      followupNeeded: true,
      toolCalls: [],
      envelope: {
        runId: "run-default-provider-recovery",
        domain: "spira",
        task: "Inspect Spira",
        status: "completed",
        retryCount: 0,
        startedAt: 1000,
        completedAt: 1100,
        durationMs: 100,
        followupNeeded: true,
        summary: "Initial inspection complete.",
        artifacts: [],
        stateChanges: [],
        toolCalls: [],
        errors: [],
        payload: { step: 1 },
      },
    });

    expect(recovered).not.toBeNull();
    const liveRun = (
      runner as unknown as {
        liveRuns: Map<string, { providerOverride: "copilot" | "azure-openai" | null }>;
      }
    ).liveRuns.get("run-default-provider-recovery");
    expect(liveRun?.providerOverride).toBe("copilot");
  });

  it("keeps recovered host-managed runs on their explicit provider without a provider session id", () => {
    const runtimeStore = createTestRuntimeStore();
    const runner = new SubagentRunner({
      bus: new SpiraEventBus(),
      env: parseEnv({ SPIRA_MODEL_PROVIDER: "copilot" }),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      runtimeStore,
      initialProviderId: "copilot",
    });
    const manifest = (
      runner as unknown as {
        getToolManifest(liveRun: { client: ProviderClient; writesAllowed: boolean; currentContext: null }): {
          hostManifestHash: string;
          projectionHash: string;
        };
      }
    ).getToolManifest({
      client: {
        providerId: "azure-openai",
        capabilities: getDefaultProviderCapabilities("azure-openai"),
      } as ProviderClient,
      writesAllowed: true,
      currentContext: null,
    });

    const recovered = runner.recover({
      agent_id: "run-host-managed-provider-recovery",
      runId: "run-host-managed-provider-recovery",
      roomId: "agent:subagent-run-host-managed-provider-recovery",
      domain: "spira",
      task: "Inspect Spira",
      providerId: "azure-openai",
      hostManifestHash: manifest.hostManifestHash,
      providerProjectionHash: manifest.projectionHash,
      status: "idle",
      allowWrites: true,
      startedAt: 1000,
      updatedAt: 1100,
      completedAt: 1100,
      summary: "Initial inspection complete.",
      followupNeeded: true,
      toolCalls: [],
      envelope: {
        runId: "run-host-managed-provider-recovery",
        domain: "spira",
        task: "Inspect Spira",
        status: "completed",
        retryCount: 0,
        startedAt: 1000,
        completedAt: 1100,
        durationMs: 100,
        followupNeeded: true,
        summary: "Initial inspection complete.",
        artifacts: [],
        stateChanges: [],
        toolCalls: [],
        errors: [],
        payload: { step: 1 },
      },
    });

    expect(recovered).not.toBeNull();
    const liveRun = (
      runner as unknown as {
        liveRuns: Map<string, { providerOverride: "copilot" | "azure-openai" | null; providerSessionId: string | null }>;
      }
    ).liveRuns.get("run-host-managed-provider-recovery");
    expect(liveRun).toMatchObject({
      providerOverride: "azure-openai",
      providerSessionId: null,
    });
  });

  it("recovers from the host checkpoint when manifest provenance drifts", async () => {
    const runtimeStore = createTestRuntimeStore();
    const prompts: string[] = [];
    const recoverySections: string[] = [];
    let sendCount = 0;
    const { client, clientMock } = createClient((config) => ({
      sessionId: sendCount === 0 ? "seed-subagent-session" : "fresh-subagent-session",
      send: async ({ prompt }) => {
        prompts.push(prompt);
        sendCount += 1;
        config.onEvent?.(
          createSessionEvent("assistant.message", {
            messageId: sendCount === 1 ? "msg-seed" : "msg-fresh-after-drift",
            content:
              sendCount === 1
                ? '{"summary":"Initial inspection complete."}'
                : '{"summary":"Recovered on a fresh manifest projection."}',
          }),
        );
        config.onEvent?.(createSessionEvent("session.idle", {}));
      },
      disconnect: vi.fn().mockResolvedValue(undefined),
    }));
    (clientMock.createSession as ReturnType<typeof vi.fn>).mockImplementation((config: ProviderSessionConfig) => {
      recoverySections.push(config.systemMessage.sections?.runtime_recovery?.content ?? "");
      return Promise.resolve({
        sessionId: sendCount === 0 ? "seed-subagent-session" : "fresh-subagent-session",
        send: async ({ prompt }: { prompt: string }) => {
          prompts.push(prompt);
          sendCount += 1;
          config.onEvent?.(
            createSessionEvent("assistant.message", {
              messageId: sendCount === 1 ? "msg-seed" : "msg-fresh-after-drift",
              content:
                sendCount === 1
                  ? '{"summary":"Initial inspection complete."}'
                  : '{"summary":"Recovered on a fresh manifest projection."}',
            }),
          );
          config.onEvent?.(createSessionEvent("session.idle", {}));
        },
        disconnect: vi.fn().mockResolvedValue(undefined),
      });
    });
    const seedRunner = new SubagentRunner({
      bus: new SpiraEventBus(),
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () => client,
      runtimeStore,
      stationId: "primary",
      runIdFactory: () => "run-stale-manifest",
      sessionIdFactory: () => "00000000-0000-0000-0000-0000000000ab",
    });

    await seedRunner.run({ task: "Inspect Spira", allowWrites: true });
    const persistedRuntimeSession = runtimeStore.getRuntimeSession("subagent:run-stale-manifest");
    expect(persistedRuntimeSession).not.toBeNull();
    runtimeStore.persistRuntimeSession({
      runtimeSessionId: "subagent:run-stale-manifest",
      stationId: "primary",
      runId: "run-stale-manifest",
      kind: "subagent",
      contract: {
        ...persistedRuntimeSession!,
        providerBinding: {
          ...persistedRuntimeSession!.providerBinding,
          providerSessionId: null,
        },
      },
    });

    const runner = new SubagentRunner({
      bus: new SpiraEventBus(),
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () => client,
      runtimeStore,
      stationId: "primary",
      sessionIdFactory: () => "00000000-0000-0000-0000-0000000000ac",
    });

    const recovered = runner.recover({
      agent_id: "run-stale-manifest",
      runId: "run-stale-manifest",
      roomId: "agent:subagent-run-stale-manifest",
      domain: "spira",
      task: "Inspect Spira",
      providerId: "copilot",
      status: "idle",
      allowWrites: true,
      providerSessionId: "stale-session",
      hostManifestHash: "stale-host-manifest",
      providerProjectionHash: "stale-projection",
      startedAt: 1000,
      updatedAt: 1100,
      completedAt: 1100,
      summary: "Initial inspection complete.",
      followupNeeded: true,
      toolCalls: [],
      envelope: {
        runId: "run-stale-manifest",
        domain: "spira",
        task: "Inspect Spira",
        status: "completed",
        retryCount: 0,
        startedAt: 1000,
        completedAt: 1100,
        durationMs: 100,
        followupNeeded: true,
        summary: "Initial inspection complete.",
        artifacts: [],
        stateChanges: [],
        toolCalls: [],
        errors: [],
      },
    });

    expect(recovered).not.toBeNull();
    await expect(recovered?.write("Continue after restart")).resolves.toMatchObject({
      summary: "Recovered on a fresh manifest projection.",
    });
    expect(clientMock.resumeSession).not.toHaveBeenCalled();
    expect(clientMock.createSession).toHaveBeenCalled();
    expect(clientMock.deleteSession).toHaveBeenCalledWith("stale-session");
    expect(prompts[1]).toBe("Continue after restart");
    expect(recoverySections[1]).toContain("Initial inspection complete.");
    expect(recoverySections[1]).toContain("Treat this host-owned recovery bundle as authoritative continuity state");
  });

  it("exposes host tools for review domains that opt into them", async () => {
    const capturedTools: string[][] = [];
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
      createSession: vi.fn(async (config: ProviderSessionConfig & { sessionId: string }) => {
        capturedTools.push(config.tools.map((tool) => tool.name));
        return {
          sessionId: "subagent-session-review",
          send: async () => {
            config.onEvent?.(
              createSessionEvent("assistant.message", {
                messageId: "msg-review",
                content: '{"summary":"Review complete."}',
              }),
            );
            config.onEvent?.(createSessionEvent("session.idle", {}));
          },
          disconnect: vi.fn().mockResolvedValue(undefined),
        };
      }),
      resumeSession: vi.fn(),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    const runner = new SubagentRunner({
      bus: new SpiraEventBus(),
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: {
        ...baseDomain,
        id: "code-review",
        label: "Code Review Agent",
        description: "Reviews repository code with host tools.",
        serverIds: [],
        allowWrites: false,
        allowHostTools: true,
        delegationToolName: "delegate_to_code_review",
      },
      getClient: async () => client as unknown as ProviderClient,
    });

    await runner.run({ task: "Review the repository", model: "gpt-5.5" });

    expect(capturedTools[0]).toEqual(expect.arrayContaining(["view", "glob", "rg"]));
    expect(capturedTools[0]).not.toContain("powershell");
    expect(capturedTools[0]).not.toContain("write_file");
    expect(capturedTools[0]).not.toContain("apply_patch");
    expect(capturedTools[0]).not.toContain("spira_ui_get_snapshot");
  });

  it("limits delegated MCP tools to the domain allowedToolNames list", async () => {
    const capturedTools: string[][] = [];
    const client = {
      providerId: "copilot" as const,
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed" as const,
        turnCancellation: "provider-abort" as const,
        responseStreaming: "native" as const,
        usageReporting: "full" as const,
      },
      createSession: vi.fn(async (config: ProviderSessionConfig & { sessionId: string }) => {
        capturedTools.push(config.tools.map((tool) => tool.name));
        return {
          sessionId: "subagent-session-allowed-tools",
          send: async () => {
            config.onEvent?.(
              createSessionEvent("assistant.message", {
                messageId: "msg-allowed-tools",
                content: '{"summary":"Scoped tools only."}',
              }),
            );
            config.onEvent?.(createSessionEvent("session.idle", {}));
          },
          disconnect: vi.fn().mockResolvedValue(undefined),
        };
      }),
      resumeSession: vi.fn(),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    const runner = new SubagentRunner({
      bus: new SpiraEventBus(),
      env: parseEnv({}),
      toolAggregator: {
        getToolsForServerIds: (serverIds: readonly string[]) =>
          serverIds.includes("spira-ui")
            ? [
                {
                  serverId: "spira-ui",
                  serverName: "Spira UI",
                  name: "spira_ui_get_snapshot",
                  description: "Read Spira snapshot.",
                  inputSchema: { type: "object", properties: {}, additionalProperties: false },
                  access: { mode: "read", source: "annotation" },
                },
                {
                  serverId: "spira-ui",
                  serverName: "Spira UI",
                  name: "spira_ui_mutate",
                  description: "Mutate Spira state.",
                  inputSchema: { type: "object", properties: {}, additionalProperties: false },
                  access: { mode: "write", source: "annotation" },
                },
              ]
            : [],
        getTools: () => [
          {
            serverId: "spira-ui",
            serverName: "Spira UI",
            name: "spira_ui_get_snapshot",
            description: "Read Spira snapshot.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            access: { mode: "read", source: "annotation" },
          },
          {
            serverId: "spira-ui",
            serverName: "Spira UI",
            name: "spira_ui_mutate",
            description: "Mutate Spira state.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            access: { mode: "write", source: "annotation" },
          },
        ],
      } as never,
      domain: {
        ...baseDomain,
        allowedToolNames: ["spira_ui_get_snapshot"],
      },
      getClient: async () => client as unknown as ProviderClient,
    });

    await runner.run({ task: "Inspect Spira" });

    expect(capturedTools[0]).toContain("spira_ui_get_snapshot");
    expect(capturedTools[0]).not.toContain("spira_ui_mutate");
  });

  it("emits provider usage when a subagent run completes", async () => {
    const bus = new SpiraEventBus();
    const usage = vi.fn();
    bus.on("provider:usage", usage);
    const { client } = createClient((config) => ({
      sessionId: "subagent-session-usage",
      send: async () => {
        config.onEvent?.(
          createSessionEvent("assistant.message", {
            messageId: "msg-usage",
            content: '{"summary":"Done."}',
          }),
        );
        config.onEvent?.(createSessionEvent("session.idle", {}));
      },
      disconnect: vi.fn().mockResolvedValue(undefined),
    }));

    const runner = new SubagentRunner({
      bus,
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () => client,
      runIdFactory: () => "run-usage",
      sessionIdFactory: () => "00000000-0000-0000-0000-000000000099",
      now: (() => {
        let current = 2000;
        return () => ++current;
      })(),
    });

    await runner.run({ task: "Inspect Spira" });

    expect(usage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "copilot",
        runId: "run-usage",
        sessionId: "subagent-session-usage",
      }),
    );
  });

  it("persists subagent waiting-for-permission state while approval is pending", async () => {
    const runtimeStore = createTestRuntimeStore();
    let releasePermission: ((result: { kind: "approve-once" }) => void) | undefined;
    const { client } = createClient((config) => ({
      sessionId: "subagent-session-permission",
      send: async () => {
        const permissionPromise = config.onPermissionRequest?.({
          kind: "mcp",
          toolName: "vision_read_screen",
          toolTitle: "Read screen",
          readOnly: true,
        });
        if (permissionPromise) {
          await permissionPromise;
        }
        config.onEvent?.(createSessionEvent("assistant.message", { messageId: "assistant-1", content: "{\"summary\":\"done\"}" }));
        config.onEvent?.(createSessionEvent("session.idle", { usage: { totalTokens: 3, source: "provider" } }));
      },
      disconnect: async () => undefined,
    }));
    const runner = new SubagentRunner({
      bus: new SpiraEventBus(),
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      runtimeStore,
      getClient: async () => client,
      onPermissionRequest: async () =>
        await new Promise<{ kind: "approve-once" }>((resolve) => {
          releasePermission = resolve;
        }),
    });

    const launch = runner.launch({ task: "Inspect Spira", mode: "background" });
    await vi.waitFor(() =>
      expect(runtimeStore.getRuntimeSession(`subagent:${launch.runId}`)).toMatchObject({
        permissionState: { status: "pending" },
        turnState: { state: "waiting_for_permission" },
      }),
    );

    const resolvePermission = releasePermission;
    if (!resolvePermission) {
      throw new Error("permission resolver was not captured");
    }
    resolvePermission({ kind: "approve-once" });
    await expect(launch.resultPromise).resolves.toMatchObject({ summary: "done" });
  });

  it("records requested and completed cancellation for stopped subagent runs", async () => {
    const runtimeStore = createTestRuntimeStore();
    const { client } = createClient(() => ({
      sessionId: "subagent-session-stop",
      send: async () =>
        await new Promise<void>(() => {
          // kept pending until stop()
        }),
      disconnect: async () => undefined,
    }));
    const runner = new SubagentRunner({
      bus: new SpiraEventBus(),
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      runtimeStore,
      getClient: async () => client,
    });

    const launch = runner.launch({ task: "Inspect Spira", mode: "background" });
    await vi.waitFor(() =>
      expect(runtimeStore.getRuntimeSession(`subagent:${launch.runId}`)).toMatchObject({
        turnState: { state: "thinking" },
      }),
    );

    await expect(launch.stop()).resolves.toBeUndefined();

    expect(runtimeStore.getRuntimeSession(`subagent:${launch.runId}`)).toMatchObject({
      cancellationState: {
        status: "completed",
      },
    });
    expect(
      runtimeStore
        .listRuntimeLedgerEvents(`subagent:${launch.runId}`)
        .map((event) => event.type)
        .filter((type) => type.startsWith("cancellation.")),
    ).toEqual(["cancellation.requested", "cancellation.completed"]);
  });

  it("does not retry a stopped subagent turn after cancellation", async () => {
    const send = vi.fn(async () => {
      await new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error("turn interrupted")), 0);
      });
    });
    const { client } = createClient(() => ({
      sessionId: "subagent-session-stop-no-retry",
      send,
      disconnect: async () => undefined,
    }));
    const runner = new SubagentRunner({
      bus: new SpiraEventBus(),
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () => client,
      retryDelayMs: 0,
    });

    const launch = runner.launch({ task: "Inspect Spira", mode: "background" });
    await launch.stop();
    await expect(launch.resultPromise).resolves.toMatchObject({ status: "failed", summary: "Subagent run cancelled." });
    expect(send).not.toHaveBeenCalled();
  });

  it("does not send a turn when cancellation wins during session acquisition", async () => {
    let releaseSession: (() => void) | null = null;
    const send = vi.fn().mockResolvedValue(undefined);
    const clientMock = {
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
      createSession: vi.fn(
        (_config: ProviderSessionConfig & { sessionId: string }): Promise<ProviderSession> =>
          new Promise<ProviderSession>((resolve) => {
            releaseSession = () =>
              resolve({
                sessionId: "subagent-session-cancelled-before-send",
                send,
                disconnect: vi.fn().mockResolvedValue(undefined),
              });
          }),
      ),
      resumeSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    } as unknown as ProviderClient & { deleteSession: ReturnType<typeof vi.fn> };
    const runner = new SubagentRunner({
      bus: new SpiraEventBus(),
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () => clientMock as ProviderClient,
      retryDelayMs: 0,
    });

    const launch = runner.launch({ task: "Inspect Spira", mode: "background" });
    await launch.stop();
    expect(releaseSession).not.toBeNull();
    releaseSession!();

    await expect(launch.resultPromise).resolves.toMatchObject({ status: "failed", summary: "Subagent run cancelled." });
    expect(send).not.toHaveBeenCalled();
    expect(clientMock.deleteSession).toHaveBeenCalledWith("subagent-session-cancelled-before-send");
  });

  it("applies a provider switch after an in-flight background turn settles", async () => {
    let activeProvider: "copilot" | "azure-openai" = "copilot";
    const firstTurn = { release: null as null | (() => void) };
    const bus = new SpiraEventBus();
    const runtimeSync = vi.fn();
    bus.on("subagent:runtime-sync", runtimeSync);
    const runtimeStore = createTestRuntimeStore();
    const copilot = createClient("copilot", (config) => ({
      sessionId: "subagent-session-copilot-pending",
      send: async () => {
        await new Promise<void>((resolve) => {
          firstTurn.release = resolve;
        });
        config.onEvent?.(createSessionEvent("assistant.message", { messageId: "copilot-msg-1", content: "done" }));
        config.onEvent?.(
          createSessionEvent("session.idle", { usage: { model: "gpt-5.5", totalTokens: 10, source: "provider" } }),
        );
      },
      disconnect: async () => undefined,
    }));
    const azure = createClient("azure-openai", (config) => ({
      sessionId: "subagent-session-azure-followup",
      send: async () => {
        config.onEvent?.(createSessionEvent("assistant.message", { messageId: "azure-msg-1", content: "done" }));
        config.onEvent?.(
          createSessionEvent("session.idle", { usage: { model: "gpt-5.5", totalTokens: 12, source: "provider" } }),
        );
      },
      disconnect: async () => undefined,
    }));
    const runner = new SubagentRunner({
      bus,
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      runtimeStore,
      getClient: async () => (activeProvider === "copilot" ? copilot.client : azure.client),
      retryDelayMs: 0,
    });

    const launch = runner.launch({ task: "Inspect Spira", mode: "background" });
    await vi.waitFor(() => expect(firstTurn.release).not.toBeNull());
    activeProvider = "azure-openai";
    await runner.switchProvider("azure-openai", "policy");

    const resumeFirstTurn = firstTurn.release;
    if (!resumeFirstTurn) {
      throw new Error("first turn resolver was not captured");
    }
    resumeFirstTurn();
    await expect(launch.resultPromise).resolves.toMatchObject({ summary: "done" });
    await expect(launch.write("Keep going")).resolves.toMatchObject({ summary: "done" });

    expect(runtimeStore.getRuntimeSession(`subagent:${launch.runId}`)?.providerSwitches).toEqual([
      expect.objectContaining({
        fromProviderId: "copilot",
        toProviderId: "azure-openai",
        reason: "policy",
      }),
    ]);
    expect(runtimeSync).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: launch.runId,
        providerId: "azure-openai",
        providerSessionId: null,
        hostManifestHash: null,
        providerProjectionHash: null,
      }),
    );
    expect(copilot.clientMock.deleteSession).toHaveBeenCalledWith("subagent-session-copilot-pending");
    expect(azure.clientMock.createSession).toHaveBeenCalled();
  });

  it("queues failed provider-managed subagent session cleanup for retry", async () => {
    const runtimeStore = createTestRuntimeStore();
    const database = (runtimeStore as unknown as { memoryDb: SpiraMemoryDatabase }).memoryDb;
    const { client, clientMock } = createClient((config) => ({
      sessionId: "subagent-session-cleanup-retry",
      send: async () => {
        config.onEvent?.(
          createSessionEvent("assistant.message", {
            messageId: "msg-cleanup-retry",
            content: '{"summary":"done"}',
          }),
        );
        config.onEvent?.(createSessionEvent("session.idle", {}));
      },
      disconnect: vi.fn().mockResolvedValue(undefined),
    }));
    clientMock.deleteSession.mockRejectedValue(new Error("temporary delete failure"));
    const runner = new SubagentRunner({
      bus: new SpiraEventBus(),
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      runtimeStore,
      getClient: async () => client,
    });

    const launch = runner.launch({ task: "Inspect Spira", mode: "background" });
    await expect(launch.resultPromise).resolves.toMatchObject({ summary: "done" });
    await expect(launch.stop()).resolves.toBeUndefined();

    expect(database.getSessionState("runtime.provider-session-cleanup")).toContain("subagent-session-cleanup-retry");
  });

  it("maps subagent auto-approved permissions to approve-once", async () => {
    const runner = new SubagentRunner({
      bus: new SpiraEventBus(),
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () =>
        createClient(() => {
          throw new Error("not used");
        }).client,
    });
    const internals = runner as unknown as SubagentRunnerInternals;

    await expect(
      internals.handlePermissionRequest(
        { runtimeSessionId: "subagent:run-1", lastPermissionResolvedAt: null, pendingPermissionRequestIds: [] },
        { runId: "run-1" },
        {
          kind: "read",
          path: "README.md",
        },
      ),
    ).resolves.toEqual({ kind: "approve-once" });
  });

  it("maps vision permission denials to user-not-available when no UI handler exists", async () => {
    const runner = new SubagentRunner({
      bus: new SpiraEventBus(),
      env: parseEnv({}),
      toolAggregator: createToolAggregator(),
      domain: baseDomain,
      getClient: async () =>
        createClient(() => {
          throw new Error("not used");
        }).client,
    });
    const internals = runner as unknown as SubagentRunnerInternals;

    await expect(
      internals.handlePermissionRequest(
        { runtimeSessionId: "subagent:run-1", lastPermissionResolvedAt: null, pendingPermissionRequestIds: [] },
        { runId: "run-1" },
        {
          kind: "mcp",
          toolName: "vision_read_screen",
        },
      ),
    ).resolves.toEqual({ kind: "user-not-available" });
  });
});
