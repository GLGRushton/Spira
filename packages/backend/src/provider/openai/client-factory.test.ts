import { parseEnv } from "@spira/shared";
import { describe, expect, it, vi } from "vitest";
import type { ProviderSessionConfig, ProviderSessionEvent } from "../types.js";
import { OpenAiProviderClient, createOpenAiProviderClient } from "./client-factory.js";

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
      throw new Error("json() should not be used for OpenAI streaming responses");
    },
    text: async () => events.join(""),
  }) as unknown as Response;

const createToolCallResponse = (model: string, callId: string) =>
  createResponse({
    id: `resp-${callId}`,
    model,
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: callId,
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
  });

const createAssistantResponse = (model: string, content: string) =>
  createResponse({
    id: `resp-${model}-${content.length}`,
    model,
    choices: [
      {
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 6,
      completion_tokens: 3,
      total_tokens: 9,
    },
  });

describe("OpenAiProviderClient", () => {
  it("runs tool calls and forwards the selected model to OpenAI", async () => {
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
            model: "gpt-5.5",
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
            model: "gpt-5.5",
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
    const client = new OpenAiProviderClient({
      apiKey: "secret",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5.4",
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
    await session.setModel?.("gpt-5.5");

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
    expect(onEvent).toHaveBeenCalledWith({
      type: "session.idle",
      data: {
        usage: expect.objectContaining({
          model: "gpt-5.5",
          inputTokens: 32,
          outputTokens: 10,
          totalTokens: 42,
          source: "provider",
          latencyMs: expect.any(Number),
        }),
      },
    });
    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: "gpt-5.5",
      stream_options: { include_usage: true },
    });
    expect(fetchFn.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer secret",
    });
  });

  it("fails closed when asked to resume an unknown host-managed session", async () => {
    const client = new OpenAiProviderClient({
      apiKey: "secret",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5.4",
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

  it("escalates the experimental OpenAI provider to its configured fallback model", async () => {
    const onEvent = vi.fn<(event: ProviderSessionEvent) => void>();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        createResponse({
          id: "resp-empty",
          model: "gpt-5.4",
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
            prompt_tokens: 6,
            completion_tokens: 0,
            total_tokens: 6,
          },
        }),
      )
      .mockResolvedValueOnce(
        createResponse({
          id: "resp-escalated",
          model: "gpt-5.5",
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
            prompt_tokens: 8,
            completion_tokens: 3,
            total_tokens: 11,
          },
        }),
      );
    const client = new OpenAiProviderClient({
      providerId: "openai-escalation",
      apiKey: "secret",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5.4",
      escalationModel: "gpt-5.5",
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

    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toMatchObject({ model: "gpt-5.4" });
    expect(JSON.parse(String(fetchFn.mock.calls[1]?.[1]?.body))).toMatchObject({ model: "gpt-5.5" });
    expect(onHostContinuitySnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providerId: "openai-escalation",
        model: "gpt-5.5",
      }),
    );
    expect(onEvent).toHaveBeenCalledWith({
      type: "session.idle",
      data: {
        usage: expect.objectContaining({
          totalTokens: 17,
          inputTokens: 14,
          outputTokens: 3,
          model: "gpt-5.5",
          source: "provider",
          latencyMs: expect.any(Number),
        }),
      },
    });
  });

  it("requires the escalation model when the experimental OpenAI provider is selected", async () => {
    await expect(
      createOpenAiProviderClient(
        parseEnv({
          SPIRA_MODEL_PROVIDER: "openai-escalation",
          OPENAI_API_KEY: "secret",
          OPENAI_MODEL: "gpt-5.4",
        }),
        { info: vi.fn() },
        "openai-escalation",
      ),
    ).rejects.toThrow("OPENAI_ESCALATION_MODEL is required when SPIRA_MODEL_PROVIDER=openai-escalation.");
  });

  it("escalates when OpenAI returns no completion message at all", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        createResponse({
          id: "resp-missing-message",
          choices: [],
        }),
      )
      .mockResolvedValueOnce(
        createResponse({
          id: "resp-escalated",
          model: "gpt-5.5",
          choices: [
            {
              message: {
                role: "assistant",
                content: "Recovered on escalation.",
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 8,
            completion_tokens: 4,
            total_tokens: 12,
          },
        }),
      );
    const client = new OpenAiProviderClient({
      providerId: "openai-escalation",
      apiKey: "secret",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5.4",
      escalationModel: "gpt-5.5",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const session = await client.createSession({
      sessionId: "session-no-message",
      clientName: "Spira",
      streaming: false,
      systemMessage: {
        mode: "customize",
        content: "You are Shinra.",
      },
      workingDirectory: "C:\\GitHub\\Spira",
      tools: [],
    } satisfies ProviderSessionConfig & { sessionId: string });

    await session.send({ prompt: "Recover from an empty provider payload" });

    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toMatchObject({ model: "gpt-5.4" });
    expect(JSON.parse(String(fetchFn.mock.calls[1]?.[1]?.body))).toMatchObject({ model: "gpt-5.5" });
  });

  it("does not replay a tool turn on the escalation model after a later provider error", async () => {
    const handler = vi.fn(async () => ({
      resultType: "success" as const,
      textResultForLlm: '{"activeView":"bridge"}',
    }));
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        createResponse({
          id: "resp-tool",
          model: "gpt-5.4",
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
    const client = new OpenAiProviderClient({
      providerId: "openai-escalation",
      apiKey: "secret",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5.4",
      escalationModel: "gpt-5.5",
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

    await expect(session.send({ prompt: "Do not replay tools" })).rejects.toThrow("OpenAI request failed with 503");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toMatchObject({ model: "gpt-5.4" });
    expect(JSON.parse(String(fetchFn.mock.calls[1]?.[1]?.body))).toMatchObject({ model: "gpt-5.4" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("continues across the tool-call iteration limit without replaying the user prompt", async () => {
    const handler = vi.fn(async () => ({
      resultType: "success" as const,
      textResultForLlm: '{"activeView":"bridge"}',
    }));
    const fetchFn = vi.fn();
    for (let iteration = 0; iteration < 12; iteration += 1) {
      fetchFn.mockResolvedValueOnce(createToolCallResponse("gpt-5.4", `call-${iteration + 1}`));
    }
    fetchFn.mockResolvedValueOnce(createAssistantResponse("gpt-5.5", "Recovered after continuing."));
    const client = new OpenAiProviderClient({
      providerId: "openai-escalation",
      apiKey: "secret",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5.4",
      escalationModel: "gpt-5.5",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const session = await client.createSession({
      sessionId: "session-continued-limit",
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

    await expect(session.send({ prompt: "Keep going until the mission is done" })).resolves.toBeUndefined();

    expect(fetchFn).toHaveBeenCalledTimes(13);
    expect(handler).toHaveBeenCalledTimes(12);
    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toMatchObject({ model: "gpt-5.4" });
    expect(JSON.parse(String(fetchFn.mock.calls[12]?.[1]?.body))).toMatchObject({ model: "gpt-5.5" });

    const finalRequest = JSON.parse(String(fetchFn.mock.calls[12]?.[1]?.body));
    expect(finalRequest.messages.filter((message: { role: string }) => message.role === "user")).toEqual([
      expect.objectContaining({ role: "user", content: "Keep going until the mission is done" }),
    ]);
    expect(finalRequest.messages.filter((message: { role: string }) => message.role === "tool")).toHaveLength(12);
  });

  it("rolls back the entire unfinished turn when a continued turn is aborted", async () => {
    const handler = vi.fn(async () => ({
      resultType: "success" as const,
      textResultForLlm: '{"activeView":"bridge"}',
    }));
    const fetchFn = vi.fn();
    for (let iteration = 0; iteration < 12; iteration += 1) {
      fetchFn.mockResolvedValueOnce(createToolCallResponse("gpt-5.4", `call-${iteration + 1}`));
    }
    fetchFn.mockImplementationOnce(
      async (_url: string, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
    fetchFn.mockResolvedValueOnce(createAssistantResponse("gpt-5.4", "Fresh retry only."));
    const client = new OpenAiProviderClient({
      apiKey: "secret",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5.4",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const session = await client.createSession({
      sessionId: "session-aborted-continuation",
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

    const sendPromise = session.send({ prompt: "Keep going" });
    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(13);
    });
    await session.abort?.();

    await expect(sendPromise).rejects.toThrow("Session not found: disconnected");
    await expect(session.send({ prompt: "Retry" })).resolves.toBeUndefined();

    const retryRequest = JSON.parse(String(fetchFn.mock.calls[13]?.[1]?.body));
    expect(retryRequest.messages).toEqual([
      { role: "system", content: "You are Shinra." },
      { role: "user", content: "Retry" },
    ]);
  });
});
