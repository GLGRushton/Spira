import { describe, expect, it, vi } from "vitest";
import type { ProviderSessionConfig, ProviderSessionEvent } from "../types.js";
import { AzureOpenAiProviderClient } from "./client-factory.js";

const createResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Bad Request",
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

describe("AzureOpenAiProviderClient", () => {
  it("runs host-owned tool calls and emits normalized usage", async () => {
    const onEvent = vi.fn<(event: ProviderSessionEvent) => void>();
    const handler = vi.fn(async () => ({
      resultType: "success" as const,
      textResultForLlm: '{"activeView":"bridge"}',
    }));
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        createResponse({
          id: "resp-1",
          model: "gpt-4.1",
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "spira_ui_get_snapshot",
                      arguments: "{}",
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 4,
            total_tokens: 16,
          },
        }),
      )
      .mockResolvedValueOnce(
        createResponse({
          id: "resp-2",
          model: "gpt-4.1",
          choices: [
            {
              message: {
                role: "assistant",
                content: "Snapshot captured.",
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 6,
            total_tokens: 26,
          },
        }),
      );
    const client = new AzureOpenAiProviderClient({
      endpoint: "https://example.openai.azure.com",
      apiKey: "secret",
      deployment: "shinra",
      apiVersion: "2024-10-21",
      modelLabel: "gpt-4.1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const session = await client.createSession({
      sessionId: "session-1",
      clientName: "Spira",
      infiniteSessions: { enabled: true },
      onEvent,
      onPermissionRequest: async () => ({ kind: "approve-once" }),
      streaming: true,
      systemMessage: {
        mode: "customize",
        content: "You are Shinra.",
      },
      workingDirectory: "C:\\GitHub\\Spira",
      tools: [
        {
          name: "spira_ui_get_snapshot",
          description: "Read Spira snapshot.",
          parameters: { type: "object", properties: {}, additionalProperties: false },
          handler,
        },
      ],
    } satisfies ProviderSessionConfig & { sessionId: string });

    await session.send({ prompt: "Check the bridge" });

    expect(handler).toHaveBeenCalledWith({});
    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual([
      "tool.execution_start",
      "tool.execution_complete",
      "assistant.message_delta",
      "assistant.message",
      "session.idle",
    ]);
    expect(onEvent).toHaveBeenCalledWith({
      type: "session.idle",
      data: {
        usage: expect.objectContaining({
          model: "gpt-4.1",
          inputTokens: 32,
          outputTokens: 10,
          totalTokens: 42,
          source: "provider",
          latencyMs: expect.any(Number),
        }),
      },
    });
  });

  it("fails closed when asked to resume an unknown host-managed session", async () => {
    const client = new AzureOpenAiProviderClient({
      endpoint: "https://example.openai.azure.com",
      apiKey: "secret",
      deployment: "shinra",
      apiVersion: "2024-10-21",
      modelLabel: null,
      fetchFn: vi.fn() as unknown as typeof fetch,
    });

    await expect(
      client.resumeSession("missing-session", {
        clientName: "Spira",
        infiniteSessions: { enabled: true },
        onPermissionRequest: async () => ({ kind: "approve-once" }),
        streaming: true,
        systemMessage: {
          mode: "customize",
          content: "You are Shinra.",
        },
        workingDirectory: "C:\\GitHub\\Spira",
        tools: [],
      }),
    ).rejects.toThrow("Session not found: missing-session");
  });

  it("maps denied tool permissions into failed tool results without calling the tool handler", async () => {
    const onEvent = vi.fn<(event: ProviderSessionEvent) => void>();
    const handler = vi.fn(async () => ({
      resultType: "success" as const,
      textResultForLlm: '{"activeView":"bridge"}',
    }));
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        createResponse({
          id: "resp-1",
          model: "gpt-4.1",
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "vision_read_screen",
                      arguments: "{}",
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 4,
            total_tokens: 16,
          },
        }),
      )
      .mockResolvedValueOnce(
        createResponse({
          id: "resp-2",
          model: "gpt-4.1",
          choices: [
            {
              message: {
                role: "assistant",
                content: "Permission denied.",
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 6,
            completion_tokens: 2,
            total_tokens: 8,
          },
        }),
      );
    const client = new AzureOpenAiProviderClient({
      endpoint: "https://example.openai.azure.com",
      apiKey: "secret",
      deployment: "shinra",
      apiVersion: "2024-10-21",
      modelLabel: "gpt-4.1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const session = await client.createSession({
      sessionId: "session-2",
      clientName: "Spira",
      infiniteSessions: { enabled: true },
      onEvent,
      onPermissionRequest: async () => ({ kind: "reject", feedback: "No screen access." }),
      streaming: false,
      systemMessage: {
        mode: "customize",
        content: "You are Shinra.",
      },
      workingDirectory: "C:\\GitHub\\Spira",
      tools: [
        {
          name: "vision_read_screen",
          description: "Read the screen.",
          parameters: { type: "object", properties: {}, additionalProperties: false },
          handler,
        },
      ],
    } satisfies ProviderSessionConfig & { sessionId: string });

    await session.send({ prompt: "Check the screen" });

    expect(handler).not.toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith({
      type: "tool.execution_complete",
      data: expect.objectContaining({
        toolCallId: "call-1",
        success: false,
        error: { message: "No screen access." },
      }),
    });
  });

  it("aborts an in-flight host-buffered request when the session disconnects", async () => {
    const fetchFn = vi.fn().mockImplementation(
      async (_url: URL, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
    const client = new AzureOpenAiProviderClient({
      endpoint: "https://example.openai.azure.com",
      apiKey: "secret",
      deployment: "shinra",
      apiVersion: "2024-10-21",
      modelLabel: "gpt-4.1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const session = await client.createSession({
      sessionId: "session-3",
      clientName: "Spira",
      infiniteSessions: { enabled: true },
      onPermissionRequest: async () => ({ kind: "approve-once" }),
      streaming: false,
      systemMessage: {
        mode: "customize",
        content: "You are Shinra.",
      },
      workingDirectory: "C:\\GitHub\\Spira",
      tools: [],
    } satisfies ProviderSessionConfig & { sessionId: string });

    const sendPromise = session.send({ prompt: "Check the bridge" });
    await Promise.resolve();
    await session.disconnect();

    await expect(sendPromise).rejects.toThrow("Session not found: disconnected");
  });

  it("logs the provider path whenever a prompt is sent", async () => {
    const logger = {
      info: vi.fn(),
    };
    const fetchFn = vi.fn().mockResolvedValue(
      createResponse({
        id: "resp-log",
        model: "gpt-4.1",
        choices: [
          {
            message: {
              role: "assistant",
              content: "Logged.",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 4,
          completion_tokens: 2,
          total_tokens: 6,
        },
      }),
    );
    const client = new AzureOpenAiProviderClient(
      {
        endpoint: "https://example.openai.azure.com",
        apiKey: "secret",
        deployment: "shinra",
        apiVersion: "2024-10-21",
        modelLabel: "gpt-4.1",
        fetchFn: fetchFn as unknown as typeof fetch,
      },
      logger,
    );

    const session = await client.createSession({
      sessionId: "session-log",
      clientName: "Spira",
      streaming: false,
      systemMessage: {
        mode: "customize",
        content: "You are Shinra.",
      },
      workingDirectory: "C:\\GitHub\\Spira",
      tools: [],
    } satisfies ProviderSessionConfig & { sessionId: string });

    await session.send({ prompt: "Trace the Azure path" });

    expect(logger.info).toHaveBeenCalledWith(
      {
        providerId: "azure-openai",
        sessionId: "session-log",
        deployment: "shinra",
        model: "gpt-4.1",
        promptLength: "Trace the Azure path".length,
      },
      "Dispatching prompt through provider",
    );
  });
});
