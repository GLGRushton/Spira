import { describe, expect, it, vi } from "vitest";
import type { ProviderSessionConfig } from "../types.js";
import { CopilotProviderClient } from "./adapter.js";

describe("CopilotProviderClient", () => {
  it("ignores unsupported SDK lifecycle events instead of surfacing undefined provider events", async () => {
    const onEvent = vi.fn();
    const sdkClient = {
      createSession: vi.fn(async (config: ProviderSessionConfig & { sessionId: string }) => {
        config.onEvent?.({ type: "session.start", data: {} } as never);
        config.onEvent?.({
          type: "assistant.message",
          data: { messageId: "msg-1", content: "Hello" },
        } as never);
        return {
          sessionId: config.sessionId,
          send: vi.fn().mockResolvedValue("ok"),
          disconnect: vi.fn().mockResolvedValue(undefined),
        };
      }),
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
      },
      resumeSession: vi.fn(),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    const client = new CopilotProviderClient(sdkClient as never);

    await client.createSession({
      sessionId: "session-1",
      clientName: "Spira",
      infiniteSessions: { enabled: true },
      onEvent,
      streaming: true,
      onPermissionRequest: async () => ({ kind: "approve-once" }),
      systemMessage: {
        mode: "customize",
        content: "You are Shinra.",
      },
      workingDirectory: "C:\\GitHub\\Spira",
      tools: [],
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({
      type: "assistant.message",
      data: { messageId: "msg-1", content: "Hello" },
    });
  });

  it("normalizes SDK usage events and exposes abort when available", async () => {
    const onEvent = vi.fn();
    const abort = vi.fn().mockResolvedValue(undefined);
    const sdkClient = {
      createSession: vi.fn(async (config: ProviderSessionConfig & { sessionId: string }) => {
        config.onEvent?.({
          type: "assistant.usage",
          data: {
            model: "gpt-5.4",
            inputTokens: 12,
            outputTokens: 4,
            totalTokens: 16,
            latencyMs: 250,
          },
        } as never);
        config.onEvent?.({ type: "session.idle", data: {} } as never);
        return {
          sessionId: config.sessionId,
          send: vi.fn().mockResolvedValue("ok"),
          abort,
          disconnect: vi.fn().mockResolvedValue(undefined),
        };
      }),
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
      },
      resumeSession: vi.fn(),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    const client = new CopilotProviderClient(sdkClient as never);

    const session = await client.createSession({
      sessionId: "session-2",
      clientName: "Spira",
      infiniteSessions: { enabled: true },
      onEvent,
      streaming: true,
      onPermissionRequest: async () => ({ kind: "approve-once" }),
      systemMessage: {
        mode: "customize",
        content: "You are Shinra.",
      },
      workingDirectory: "C:\\GitHub\\Spira",
      tools: [],
    });

    await session.abort?.();

    expect(onEvent).toHaveBeenCalledWith({
      type: "assistant.usage",
      data: expect.objectContaining({
        model: "gpt-5.4",
        totalTokens: 16,
        source: "provider",
      }),
    });
    expect(abort).toHaveBeenCalledTimes(1);
  });
});
