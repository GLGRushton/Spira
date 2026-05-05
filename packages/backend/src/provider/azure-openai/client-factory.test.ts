import { parseEnv } from "@spira/shared";
import { describe, expect, it, vi } from "vitest";
import type { ProviderSessionConfig, ProviderSessionEvent } from "../types.js";
import { AzureOpenAiProviderClient, createAzureOpenAiProviderClient } from "./client-factory.js";

const textEncoder = new TextEncoder();

const createResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Bad Request",
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

const createStreamResponse = (events: string[], status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Bad Request",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(textEncoder.encode(event));
        }
        controller.close();
      },
    }),
    json: async () => {
      throw new Error("json() should not be used for Azure streaming responses");
    },
    text: async () => events.join(""),
  }) as unknown as Response;

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
        createStreamResponse([
          `data: ${JSON.stringify({
            id: "resp-1",
            model: "gpt-4.1",
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-1",
                      type: "function",
                      function: {
                        name: "spira_ui_get_snapshot",
                        arguments: "",
                      },
                    },
                  ],
                },
              },
            ],
          })}\n\n`,
          `data: ${JSON.stringify({
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: {
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
          })}\n\n`,
          "data: [DONE]\n\n",
        ]),
      )
      .mockResolvedValueOnce(
        createStreamResponse([
          `data: ${JSON.stringify({
            id: "resp-2",
            model: "gpt-4.1",
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  content: "Snapshot ",
                },
              },
            ],
          })}\n\n`,
          `data: ${JSON.stringify({
            choices: [
              {
                index: 0,
                delta: {
                  content: "captured.",
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 20,
              completion_tokens: 6,
              total_tokens: 26,
            },
          })}\n\n`,
          "data: [DONE]\n\n",
        ]),
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
      "assistant.message_delta",
      "assistant.message",
      "session.idle",
    ]);
    expect(onEvent).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: "assistant.message_delta",
        data: expect.objectContaining({
          deltaContent: "Snapshot ",
        }),
      }),
    );
    expect(onEvent).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        type: "assistant.message_delta",
        data: expect.objectContaining({
          deltaContent: "captured.",
        }),
      }),
    );
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
    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body)).stream).toBe(true);
    expect(JSON.parse(String(fetchFn.mock.calls[1]?.[1]?.body)).stream).toBe(true);
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

  it("rebuilds Azure request history from host-owned continuity state", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      createResponse({
        id: "resp-host-1",
        model: "gpt-4.1",
        choices: [
          {
            message: {
              role: "assistant",
              content: "Still on it.",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 18,
          completion_tokens: 3,
          total_tokens: 21,
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
      sessionId: "session-host",
      clientName: "Spira",
      infiniteSessions: { enabled: true },
      onPermissionRequest: async () => ({ kind: "approve-once" }),
      streaming: false,
      systemMessage: {
        mode: "customize",
        content: "You are Shinra.",
      },
      hostContinuity: {
        providerId: "azure-openai",
        model: "gpt-4.1",
        updatedAt: 1,
        messages: [
          { role: "system", content: "Persisted system." },
          { role: "user", content: "First request" },
          { role: "assistant", content: "First reply" },
        ],
      },
      workingDirectory: "C:\\GitHub\\Spira",
      tools: [],
    } satisfies ProviderSessionConfig & { sessionId: string });

    await session.send({ prompt: "Second request" });

    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body)).messages).toEqual([
      { role: "system", content: "Persisted system." },
      { role: "user", content: "First request" },
      { role: "assistant", content: "First reply" },
      { role: "user", content: "Second request" },
    ]);
  });

  it("surfaces assistant text that arrives alongside Azure tool calls", async () => {
    const onEvent = vi.fn<(event: ProviderSessionEvent) => void>();
    const handler = vi.fn(async () => ({
      resultType: "success" as const,
      textResultForLlm: '{"activeView":"bridge"}',
    }));
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        createResponse({
          id: "resp-mixed-1",
          model: "gpt-4.1",
          choices: [
            {
              message: {
                role: "assistant",
                content: "Let me check.",
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
            prompt_tokens: 10,
            completion_tokens: 3,
            total_tokens: 13,
          },
        }),
      )
      .mockResolvedValueOnce(
        createResponse({
          id: "resp-mixed-2",
          model: "gpt-4.1",
          choices: [
            {
              message: {
                role: "assistant",
                content: "Done.",
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 2,
            total_tokens: 14,
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
      sessionId: "session-mixed",
      clientName: "Spira",
      infiniteSessions: { enabled: true },
      onEvent,
      onPermissionRequest: async () => ({ kind: "approve-once" }),
      streaming: false,
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

    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual([
      "assistant.message_delta",
      "assistant.message",
      "tool.execution_start",
      "tool.execution_complete",
      "assistant.message_delta",
      "assistant.message",
      "session.idle",
    ]);
    expect(onEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "assistant.message",
        data: expect.objectContaining({
          content: "Let me check.",
        }),
      }),
    );
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

  it("aborts an in-flight request without disconnecting the Azure session", async () => {
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(
        async (_url: URL, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("The operation was aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      )
      .mockResolvedValueOnce(
        createResponse({
          id: "resp-4",
          model: "gpt-4.1",
          choices: [
            {
              message: {
                role: "assistant",
                content: "Recovered.",
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
    const client = new AzureOpenAiProviderClient({
      endpoint: "https://example.openai.azure.com",
      apiKey: "secret",
      deployment: "shinra",
      apiVersion: "2024-10-21",
      modelLabel: "gpt-4.1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const session = await client.createSession({
      sessionId: "session-4",
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
    await session.abort?.();

    await expect(sendPromise).rejects.toThrow("Session not found: disconnected");
    await expect(session.send({ prompt: "Retry the bridge" })).resolves.toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchFn.mock.calls[1]?.[1]?.body)).messages).toEqual([
      {
        role: "system",
        content: "You are Shinra.",
      },
      {
        role: "user",
        content: "Retry the bridge",
      },
    ]);
  });

  it("does not retain an aborted assistant reply in the next Azure request", async () => {
    const sessionRef: { current?: Awaited<ReturnType<AzureOpenAiProviderClient["createSession"]>> } = {};
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(async () => {
        queueMicrotask(() => {
          void sessionRef.current?.abort?.();
        });
        return createResponse({
          id: "resp-race-1",
          model: "gpt-4.1",
          choices: [
            {
              message: {
                role: "assistant",
                content: "Hello from the aborted turn.",
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 4,
            completion_tokens: 5,
            total_tokens: 9,
          },
        });
      })
      .mockResolvedValueOnce(
        createResponse({
          id: "resp-race-2",
          model: "gpt-4.1",
          choices: [
            {
              message: {
                role: "assistant",
                content: "Fresh turn only.",
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 4,
            completion_tokens: 3,
            total_tokens: 7,
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

    sessionRef.current = await client.createSession({
      sessionId: "session-race",
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

    await expect(sessionRef.current.send({ prompt: "First" })).rejects.toThrow("Session not found: disconnected");
    await expect(sessionRef.current.send({ prompt: "Second" })).resolves.toBeUndefined();
    expect(JSON.parse(String(fetchFn.mock.calls[1]?.[1]?.body)).messages).toEqual([
      {
        role: "system",
        content: "You are Shinra.",
      },
      {
        role: "user",
        content: "Second",
      },
    ]);
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

  it("escalates the experimental Azure provider to its configured fallback deployment", async () => {
    const onEvent = vi.fn<(event: ProviderSessionEvent) => void>();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        createResponse({
          id: "resp-empty",
          model: "gpt-4.1-mini",
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 0,
            total_tokens: 5,
          },
        }),
      )
      .mockResolvedValueOnce(
        createResponse({
          id: "resp-escalated",
          model: "gpt-4.1",
          choices: [
            {
              message: {
                role: "assistant",
                content: "Escalated answer.",
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 9,
            completion_tokens: 3,
            total_tokens: 12,
          },
        }),
      );
    const client = new AzureOpenAiProviderClient({
      providerId: "azure-openai-escalation",
      endpoint: "https://example.openai.azure.com",
      apiKey: "secret",
      deployment: "shinra-mini",
      escalationDeployment: "shinra-full",
      apiVersion: "2024-10-21",
      modelLabel: "gpt-4.1-mini",
      escalationModelLabel: "gpt-4.1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const onHostContinuitySnapshot = vi.fn();

    const session = await client.createSession({
      sessionId: "session-escalation",
      clientName: "Spira",
      streaming: false,
      systemMessage: {
        mode: "customize",
        content: "You are Shinra.",
      },
      onEvent,
      onHostContinuitySnapshot,
      workingDirectory: "C:\\GitHub\\Spira",
      tools: [],
    } satisfies ProviderSessionConfig & { sessionId: string });

    await session.send({ prompt: "Escalate if needed" });

    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("/deployments/shinra-mini/");
    expect(String(fetchFn.mock.calls[1]?.[0])).toContain("/deployments/shinra-full/");
    expect(onHostContinuitySnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providerId: "azure-openai-escalation",
        model: "gpt-4.1",
      }),
    );
    expect(onEvent).toHaveBeenCalledWith({
      type: "session.idle",
      data: {
        usage: expect.objectContaining({
          totalTokens: 17,
          inputTokens: 14,
          outputTokens: 3,
          model: "gpt-4.1",
          source: "provider",
          latencyMs: expect.any(Number),
        }),
      },
    });
  });

  it("requires the escalation deployment when the experimental Azure provider is selected", async () => {
    await expect(
      createAzureOpenAiProviderClient(
        parseEnv({
          SPIRA_MODEL_PROVIDER: "azure-openai-escalation",
          AZURE_OPENAI_API_KEY: "secret",
          AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
          AZURE_OPENAI_DEPLOYMENT: "shinra-mini",
        }),
        { info: vi.fn() },
        "azure-openai-escalation",
      ),
    ).rejects.toThrow(
      "AZURE_OPENAI_ESCALATION_DEPLOYMENT is required when SPIRA_MODEL_PROVIDER=azure-openai-escalation.",
    );
  });

  it("keeps the escalated deployment when resuming an experimental Azure session from continuity", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      createResponse({
        id: "resp-resume",
        model: "gpt-4.1",
        choices: [
          {
            message: {
              role: "assistant",
              content: "Resumed.",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 7,
          completion_tokens: 2,
          total_tokens: 9,
        },
      }),
    );
    const client = new AzureOpenAiProviderClient({
      providerId: "azure-openai-escalation",
      endpoint: "https://example.openai.azure.com",
      apiKey: "secret",
      deployment: "shinra-mini",
      escalationDeployment: "shinra-full",
      apiVersion: "2024-10-21",
      modelLabel: "gpt-4.1-mini",
      escalationModelLabel: "gpt-4.1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await client.createSession({
      sessionId: "session-resume",
      clientName: "Spira",
      streaming: false,
      systemMessage: {
        mode: "customize",
        content: "You are Shinra.",
      },
      workingDirectory: "C:\\GitHub\\Spira",
      tools: [],
    } satisfies ProviderSessionConfig & { sessionId: string });

    const resumed = await client.resumeSession("session-resume", {
      clientName: "Spira",
      streaming: false,
      systemMessage: {
        mode: "customize",
        content: "You are Shinra.",
      },
      hostContinuity: {
        providerId: "azure-openai-escalation",
        model: "gpt-4.1",
        deployment: "shinra-full",
        updatedAt: 1,
        messages: [
          { role: "system", content: "Persisted system." },
          { role: "user", content: "Earlier prompt" },
        ],
      },
      workingDirectory: "C:\\GitHub\\Spira",
      tools: [],
    });

    await resumed.send({ prompt: "Resume the escalated session" });

    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("/deployments/shinra-full/");
  });

  it("keeps a resumed base Azure session on the base deployment even when labels match", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      createResponse({
        id: "resp-resume-base",
        model: "gpt-4.1",
        choices: [
          {
            message: {
              role: "assistant",
              content: "Still on base.",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 7,
          completion_tokens: 2,
          total_tokens: 9,
        },
      }),
    );
    const client = new AzureOpenAiProviderClient({
      providerId: "azure-openai-escalation",
      endpoint: "https://example.openai.azure.com",
      apiKey: "secret",
      deployment: "shinra-mini",
      escalationDeployment: "shinra-full",
      apiVersion: "2024-10-21",
      modelLabel: "gpt-4.1",
      escalationModelLabel: "gpt-4.1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await client.createSession({
      sessionId: "session-resume-base",
      clientName: "Spira",
      streaming: false,
      systemMessage: {
        mode: "customize",
        content: "You are Shinra.",
      },
      workingDirectory: "C:\\GitHub\\Spira",
      tools: [],
    } satisfies ProviderSessionConfig & { sessionId: string });

    const resumed = await client.resumeSession("session-resume-base", {
      clientName: "Spira",
      streaming: false,
      systemMessage: {
        mode: "customize",
        content: "You are Shinra.",
      },
      hostContinuity: {
        providerId: "azure-openai-escalation",
        model: "gpt-4.1",
        deployment: "shinra-mini",
        updatedAt: 1,
        messages: [
          { role: "system", content: "Persisted system." },
          { role: "user", content: "Earlier prompt" },
        ],
      },
      workingDirectory: "C:\\GitHub\\Spira",
      tools: [],
    });

    await resumed.send({ prompt: "Resume the base session" });

    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("/deployments/shinra-mini/");
  });

  it("preserves the in-memory base deployment when legacy continuity omits deployment metadata", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      createResponse({
        id: "resp-resume-base-legacy",
        model: "gpt-4.1",
        choices: [
          {
            message: {
              role: "assistant",
              content: "Still on base.",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 7,
          completion_tokens: 2,
          total_tokens: 9,
        },
      }),
    );
    const client = new AzureOpenAiProviderClient({
      providerId: "azure-openai-escalation",
      endpoint: "https://example.openai.azure.com",
      apiKey: "secret",
      deployment: "shinra-mini",
      escalationDeployment: "shinra-full",
      apiVersion: "2024-10-21",
      modelLabel: "gpt-4.1",
      escalationModelLabel: "gpt-4.1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await client.createSession({
      sessionId: "session-resume-base-legacy",
      clientName: "Spira",
      streaming: false,
      systemMessage: {
        mode: "customize",
        content: "You are Shinra.",
      },
      workingDirectory: "C:\\GitHub\\Spira",
      tools: [],
    } satisfies ProviderSessionConfig & { sessionId: string });

    const resumed = await client.resumeSession("session-resume-base-legacy", {
      clientName: "Spira",
      streaming: false,
      systemMessage: {
        mode: "customize",
        content: "You are Shinra.",
      },
      hostContinuity: {
        providerId: "azure-openai-escalation",
        model: "gpt-4.1",
        updatedAt: 1,
        messages: [
          { role: "system", content: "Persisted system." },
          { role: "user", content: "Earlier prompt" },
        ],
      },
      workingDirectory: "C:\\GitHub\\Spira",
      tools: [],
    });

    await resumed.send({ prompt: "Resume the legacy base session" });

    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("/deployments/shinra-mini/");
  });

  it("does not let a model label suppress Azure escalation routing", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        createResponse({
          id: "resp-empty-model",
          model: "gpt-4.1-mini",
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 4,
            completion_tokens: 0,
            total_tokens: 4,
          },
        }),
      )
      .mockResolvedValueOnce(
        createResponse({
          id: "resp-escalated-model",
          model: "gpt-4.1",
          choices: [
            {
              message: {
                role: "assistant",
                content: "Escalated despite the label.",
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
      providerId: "azure-openai-escalation",
      endpoint: "https://example.openai.azure.com",
      apiKey: "secret",
      deployment: "shinra-mini",
      escalationDeployment: "shinra-full",
      apiVersion: "2024-10-21",
      modelLabel: "gpt-4.1-mini",
      escalationModelLabel: "gpt-4.1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const session = await client.createSession({
      sessionId: "session-model-label",
      clientName: "Spira",
      model: "user-requested-label",
      streaming: false,
      systemMessage: {
        mode: "customize",
        content: "You are Shinra.",
      },
      workingDirectory: "C:\\GitHub\\Spira",
      tools: [],
    } satisfies ProviderSessionConfig & { sessionId: string });

    await session.send({ prompt: "Escalate even with a model label present" });

    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("/deployments/shinra-mini/");
    expect(String(fetchFn.mock.calls[1]?.[0])).toContain("/deployments/shinra-full/");
  });

  it("starts fresh experimental Azure sessions on the base deployment even when both labels match", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      createResponse({
        id: "resp-base",
        model: "gpt-4.1",
        choices: [
          {
            message: {
              role: "assistant",
              content: "Base deployment first.",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 2,
          total_tokens: 7,
        },
      }),
    );
    const client = new AzureOpenAiProviderClient({
      providerId: "azure-openai-escalation",
      endpoint: "https://example.openai.azure.com",
      apiKey: "secret",
      deployment: "shinra-mini",
      escalationDeployment: "shinra-full",
      apiVersion: "2024-10-21",
      modelLabel: "gpt-4.1",
      escalationModelLabel: "gpt-4.1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const session = await client.createSession({
      sessionId: "session-same-labels",
      clientName: "Spira",
      streaming: false,
      systemMessage: {
        mode: "customize",
        content: "You are Shinra.",
      },
      workingDirectory: "C:\\GitHub\\Spira",
      tools: [],
    } satisfies ProviderSessionConfig & { sessionId: string });

    await session.send({ prompt: "Stay on the base deployment first" });

    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("/deployments/shinra-mini/");
  });

  it("does not replay an Azure tool turn on the escalation deployment after a later provider error", async () => {
    const handler = vi.fn(async () => ({
      resultType: "success" as const,
      textResultForLlm: '{"activeView":"bridge"}',
    }));
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        createResponse({
          id: "resp-tool",
          model: "gpt-4.1-mini",
          choices: [
            {
              message: {
                role: "assistant",
                content: "Let me check.",
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
            prompt_tokens: 8,
            completion_tokens: 2,
            total_tokens: 10,
          },
        }),
      )
      .mockResolvedValueOnce(createResponse({ error: "busy" }, 503));
    const client = new AzureOpenAiProviderClient({
      providerId: "azure-openai-escalation",
      endpoint: "https://example.openai.azure.com",
      apiKey: "secret",
      deployment: "shinra-mini",
      escalationDeployment: "shinra-full",
      apiVersion: "2024-10-21",
      modelLabel: "gpt-4.1-mini",
      escalationModelLabel: "gpt-4.1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const session = await client.createSession({
      sessionId: "session-tool-error",
      clientName: "Spira",
      streaming: false,
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

    await expect(session.send({ prompt: "Do not replay tools" })).rejects.toThrow(
      "Azure OpenAI request failed with 503",
    );
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("/deployments/shinra-mini/");
    expect(String(fetchFn.mock.calls[1]?.[0])).toContain("/deployments/shinra-mini/");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
