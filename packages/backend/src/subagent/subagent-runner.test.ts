import type { CopilotClient, SessionConfig, SessionEvent } from "@github/copilot-sdk";
import { type SubagentDomain, parseEnv } from "@spira/shared";
import { describe, expect, it, vi } from "vitest";
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
            },
          ]
        : [],
    getTools: () => [],
  }) as never;

const createSessionEvent = (type: SessionEvent["type"], data: Record<string, unknown>): SessionEvent =>
  ({ type, data }) as SessionEvent;

const createClient = (
  runSession: (config: SessionConfig) => {
    sessionId: string;
    send: (payload: { prompt: string }) => Promise<void>;
    disconnect: () => Promise<void>;
  },
) => {
  const clientMock = {
    createSession: vi.fn((config: SessionConfig) => Promise.resolve(runSession(config))),
  };

  return {
    clientMock,
    client: clientMock as unknown as CopilotClient,
  };
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
});
