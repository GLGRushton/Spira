import { type SubagentDomain, parseEnv } from "@spira/shared";
import { describe, expect, it, vi } from "vitest";
import type { ProviderClient, ProviderSessionConfig, ProviderSessionEvent } from "../provider/types.js";
import { SpiraEventBus } from "../util/event-bus.js";
import { SubagentRunner } from "./subagent-runner.js";

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
  runSession: (config: ProviderSessionConfig) => {
    sessionId: string;
    send: (payload: { prompt: string }) => Promise<void>;
    disconnect: () => Promise<void>;
  },
) => {
  const clientMock = {
    capabilities: {
      persistentSessions: true,
      abortableTurns: true,
      sessionResumption: "provider-managed",
      turnCancellation: "provider-abort",
      responseStreaming: "native",
      usageReporting: "full",
    },
    createSession: vi.fn((config: ProviderSessionConfig & { sessionId: string }) => Promise.resolve(runSession(config))),
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
    expect(clientMock.createSession).toHaveBeenCalledTimes(1);
    expect(clientMock.resumeSession).toHaveBeenCalledTimes(1);
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

  it("keeps background runs alive for follow-up writes until stopped", async () => {
    const bus = new SpiraEventBus();
    const started = vi.fn();
    bus.on("subagent:started", started);
    const disconnect = vi.fn().mockResolvedValue(undefined);
    let sendCount = 0;

    const { client, clientMock } = createClient((config) => ({
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

    const recovered = runner.recover({
      agent_id: "run-recovered",
      runId: "run-recovered",
      roomId: "agent:subagent-run-recovered",
      domain: "spira",
      task: "Inspect Spira",
      status: "idle",
      allowWrites: true,
      startedAt: 1000,
      updatedAt: 1100,
      completedAt: 1100,
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
    expect(prompts[0]).toContain("[Recovered subagent context]");
    expect(prompts[0]).toContain("Follow-up request:\nContinue with a follow-up");
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

    const recovered = runner.recover({
      agent_id: "run-fallback",
      runId: "run-fallback",
      roomId: "agent:subagent-run-fallback",
      domain: "spira",
      task: "Inspect Spira",
      status: "idle",
      allowWrites: true,
      startedAt: 1000,
      updatedAt: 1100,
      completedAt: 1100,
      providerSessionId: "expired-session",
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
        { runId: "run-1" },
        {
          kind: "mcp",
          toolName: "vision_read_screen",
        },
      ),
    ).resolves.toEqual({ kind: "user-not-available" });
  });
});
