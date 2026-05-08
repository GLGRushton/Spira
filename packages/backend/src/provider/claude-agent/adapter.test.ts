import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const interruptMock = vi.fn();
const closeMock = vi.fn();
const setModelMock = vi.fn();
const createSdkMcpServerMock = vi.fn();
const toolMock = vi.fn();

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (params: unknown) => queryMock(params),
  createSdkMcpServer: (options: unknown) => createSdkMcpServerMock(options),
  tool: (...args: unknown[]) => toolMock(...args),
}));

const { ClaudeAgentProviderClient } = await import("./adapter.js");

const buildAsyncQuery = (messages: SDKMessage[]): Query => {
  const stack = [...messages];
  const queryObject = {
    [Symbol.asyncIterator]() {
      return queryObject;
    },
    next: async () => {
      const value = stack.shift();
      if (value === undefined) {
        return { value: undefined, done: true } as IteratorResult<SDKMessage, void>;
      }
      return { value, done: false } as IteratorResult<SDKMessage, void>;
    },
    return: async () => ({ value: undefined, done: true }) as IteratorResult<SDKMessage, void>,
    throw: async (error?: unknown) => {
      throw error;
    },
    interrupt: interruptMock,
    close: closeMock,
    setModel: setModelMock,
  };
  return queryObject as unknown as Query;
};

beforeEach(() => {
  queryMock.mockReset();
  interruptMock.mockReset().mockResolvedValue(undefined);
  closeMock.mockReset();
  setModelMock.mockReset().mockResolvedValue(undefined);
  createSdkMcpServerMock.mockReset().mockReturnValue({
    type: "sdk",
    name: "spira-tools",
    instance: {} as unknown,
  });
  toolMock.mockReset().mockImplementation((name: string) => ({ name }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ClaudeAgentProviderClient", () => {
  it("creates a session and routes assistant messages and result usage to onEvent", async () => {
    queryMock.mockImplementation(() =>
      buildAsyncQuery([
        {
          type: "system",
          subtype: "init",
          model: "claude-sonnet-4-6",
          apiKeySource: "oauth",
          uuid: "u-init",
          session_id: "session-1",
        } as unknown as SDKMessage,
        {
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "Hello!" }] },
          parent_tool_use_id: null,
          uuid: "u-assist",
          session_id: "session-1",
        } as unknown as SDKMessage,
        {
          type: "result",
          subtype: "success",
          duration_ms: 42,
          duration_api_ms: 30,
          is_error: false,
          num_turns: 1,
          result: "Hello!",
          stop_reason: "end_turn",
          total_cost_usd: 0.0001,
          usage: { input_tokens: 10, output_tokens: 5 },
          modelUsage: { "claude-sonnet-4-6": {} },
          permission_denials: [],
          uuid: "u-result",
          session_id: "session-1",
          errors: [],
        } as unknown as SDKMessage,
      ]),
    );

    const onEvent = vi.fn();
    const client = new ClaudeAgentProviderClient(null);

    const session = await client.createSession({
      sessionId: "session-1",
      clientName: "Spira",
      onEvent,
      onPermissionRequest: async () => ({ kind: "approve-once" }),
      systemMessage: { mode: "customize", content: "You are Shinra." },
      workingDirectory: "C:/GitHub/Spira",
      tools: [],
    });

    await session.send({ prompt: "Say hi" });

    const eventTypes = onEvent.mock.calls.map((call: unknown[]) => (call[0] as { type: string }).type);
    expect(eventTypes).toContain("assistant.message_delta");
    expect(eventTypes).toContain("assistant.message");
    expect(eventTypes).toContain("assistant.usage");
    expect(eventTypes).toContain("session.idle");
    const usageCall = onEvent.mock.calls.find(
      (call: unknown[]) => (call[0] as { type: string }).type === "assistant.usage",
    );
    expect((usageCall?.[0] as { data: { totalTokens: number | null } }).data.totalTokens).toBe(15);
  });

  it("interrupts the active query when abort is invoked", async () => {
    let resolveStream!: () => void;
    const blocked = new Promise<void>((resolve) => {
      resolveStream = resolve;
    });
    queryMock.mockImplementation(() => {
      const blockingIterator = {
        [Symbol.asyncIterator]() {
          return blockingIterator;
        },
        next: async () => {
          await blocked;
          return { value: undefined, done: true } as IteratorResult<SDKMessage, void>;
        },
        return: async () => ({ value: undefined, done: true }) as IteratorResult<SDKMessage, void>,
        throw: async (error?: unknown) => {
          throw error;
        },
        interrupt: interruptMock,
        close: closeMock,
        setModel: setModelMock,
      };
      return blockingIterator as unknown as Query;
    });

    const client = new ClaudeAgentProviderClient(null);
    const session = await client.createSession({
      sessionId: "session-2",
      clientName: "Spira",
      onEvent: vi.fn(),
      systemMessage: { mode: "customize", content: "You are Shinra." },
      workingDirectory: "C:/GitHub/Spira",
      tools: [],
    });

    const sendPromise = session.send({ prompt: "Hello" });
    await Promise.resolve();
    await session.abort?.();
    expect(interruptMock).toHaveBeenCalledTimes(1);
    resolveStream();
    await sendPromise;
  });

  it("getAuthStatus returns subscription auth without probing", async () => {
    const client = new ClaudeAgentProviderClient(null);
    const status = await client.getAuthStatus();
    expect(status.isAuthenticated).toBe(true);
    expect(status.authType).toBe("subscription");
  });
});
