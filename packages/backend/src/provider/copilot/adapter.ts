import {
  CopilotClient,
  defineTool,
  type CopilotSession,
  type PermissionRequest,
  type PermissionRequestResult,
  type SessionConfig,
  type SessionEvent,
  type Tool,
} from "@github/copilot-sdk";
import type {
  ProviderAuthStatus,
  ProviderClient,
  ProviderPermissionRequest,
  ProviderPermissionResult,
  ProviderSession,
  ProviderSessionConfig,
  ProviderSessionEvent,
  ProviderToolDefinition,
  ProviderUsageSnapshot,
} from "../types.js";

const toUsageNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const toProviderUsageSnapshot = (data: Record<string, unknown>): ProviderUsageSnapshot => ({
  model: typeof data.model === "string" ? data.model : null,
  inputTokens: toUsageNumber(data.inputTokens) ?? toUsageNumber(data.promptTokens),
  outputTokens: toUsageNumber(data.outputTokens) ?? toUsageNumber(data.completionTokens),
  totalTokens: toUsageNumber(data.totalTokens),
  estimatedCostUsd: toUsageNumber(data.estimatedCostUsd),
  latencyMs: toUsageNumber(data.latencyMs),
  source: "provider",
});

const toProviderEvent = (event: SessionEvent): ProviderSessionEvent | null => {
  switch (event.type) {
    case "assistant.message_delta":
      return {
        type: "assistant.message_delta",
        data: {
          messageId: event.data.messageId,
          deltaContent: event.data.deltaContent,
        },
      };
    case "assistant.message":
      return {
        type: "assistant.message",
        data: {
          messageId: event.data.messageId,
          content: event.data.content,
        },
      };
    case "assistant.usage":
      return {
        type: "assistant.usage",
        data: toProviderUsageSnapshot(event.data as Record<string, unknown>),
      };
    case "tool.execution_start":
      return {
        type: "tool.execution_start",
        data: {
          toolCallId: event.data.toolCallId,
          toolName: event.data.toolName,
          arguments: event.data.arguments,
        },
      };
    case "tool.execution_complete":
      return {
        type: "tool.execution_complete",
        data: {
          toolCallId: event.data.toolCallId,
          success: event.data.success,
          result: event.data.result,
          error: event.data.error,
        },
      };
    case "session.error":
      return {
        type: "session.error",
        data: {
          ...event.data,
          message: event.data.message,
        },
      };
    case "session.idle":
      return {
        type: "session.idle",
        data: {
          ...(("usage" in event.data && event.data.usage && typeof event.data.usage === "object"
            ? { usage: toProviderUsageSnapshot(event.data.usage as Record<string, unknown>) }
            : {}) as object),
        },
      };
    default:
      return null;
  }
};

const toProviderPermissionRequest = (request: PermissionRequest): ProviderPermissionRequest => ({
  ...request,
});

const toCopilotPermissionResult = (result: ProviderPermissionResult): PermissionRequestResult => {
  switch (result.kind) {
    case "approve-once":
      return { kind: "approve-once" };
    case "reject":
      return { kind: "reject", ...(result.feedback ? { feedback: result.feedback } : {}) };
    case "user-not-available":
      return { kind: "user-not-available" };
  }
};

const toCopilotTools = (tools: readonly ProviderToolDefinition[]): Tool[] =>
  tools.map(
    (tool) =>
      defineTool(tool.name, {
        description: tool.description,
        parameters: tool.parameters,
        ...(tool.skipPermission !== undefined ? { skipPermission: tool.skipPermission } : {}),
        handler: tool.handler,
      }) as unknown as Tool,
  );

const toCopilotSessionConfig = (config: ProviderSessionConfig): SessionConfig => {
  return {
    clientName: config.clientName,
    ...(config.infiniteSessions ? { infiniteSessions: config.infiniteSessions } : {}),
    onEvent: (event) => {
      const providerEvent = toProviderEvent(event);
      if (providerEvent) {
        config.onEvent?.(providerEvent);
      }
    },
    onPermissionRequest: async (request) =>
      toCopilotPermissionResult(
        config.onPermissionRequest
          ? await config.onPermissionRequest(toProviderPermissionRequest(request))
          : { kind: "approve-once" },
      ),
    ...(config.streaming !== undefined ? { streaming: config.streaming } : {}),
    systemMessage: config.systemMessage,
    workingDirectory: config.workingDirectory,
    tools: toCopilotTools(config.tools),
  };
};

class CopilotProviderSession implements ProviderSession {
  constructor(private readonly session: CopilotSession) {}

  get sessionId(): string {
    return this.session.sessionId;
  }

  async send(payload: { prompt: string }): Promise<void> {
    await this.session.send(payload);
  }

  abort(): Promise<void> {
    const abortableSession = this.session as CopilotSession & { abort?: () => Promise<void> };
    return abortableSession.abort ? abortableSession.abort() : Promise.resolve();
  }

  disconnect(): Promise<void> {
    return this.session.disconnect();
  }
}

export class CopilotProviderClient implements ProviderClient {
  readonly providerId = "copilot" as const;
  readonly capabilities = {
    persistentSessions: true,
    abortableTurns: true,
    sessionResumption: "provider-managed",
    turnCancellation: "provider-abort",
    responseStreaming: "native",
    usageReporting: "full",
  } as const;

  constructor(private readonly client: CopilotClient) {}

  createSession(config: ProviderSessionConfig & { sessionId: string }): Promise<ProviderSession> {
    return this.client
      .createSession({
        ...toCopilotSessionConfig(config),
        sessionId: config.sessionId,
      })
      .then((session) => new CopilotProviderSession(session));
  }

  resumeSession(sessionId: string, config: ProviderSessionConfig): Promise<ProviderSession> {
    return this.client
      .resumeSession(sessionId, toCopilotSessionConfig(config))
      .then((session) => new CopilotProviderSession(session));
  }

  deleteSession(sessionId: string): Promise<void> {
    return this.client.deleteSession(sessionId);
  }

  getAuthStatus(): Promise<ProviderAuthStatus> {
    return this.client.getAuthStatus();
  }

  stop(): Promise<unknown[]> {
    return this.client.stop();
  }
}
