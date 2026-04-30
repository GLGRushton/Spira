import { randomUUID } from "node:crypto";
import type { Env } from "@spira/shared";
import type { Logger } from "pino";
import { ConfigError, ProviderError } from "../../util/errors.js";
import type {
  ProviderAuthStatus,
  ProviderClient,
  ProviderPermissionRequest,
  ProviderSession,
  ProviderSessionConfig,
  ProviderSystemMessage,
  ProviderToolDefinition,
  ProviderToolResultObject,
  ProviderUsageSnapshot,
} from "../types.js";

type FetchLike = typeof fetch;

type AzureOpenAiMessage =
  | {
      role: "system" | "user" | "tool";
      content: string;
      tool_call_id?: string;
    }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: AzureOpenAiToolCall[];
    };

type AzureOpenAiTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type AzureOpenAiToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type AzureOpenAiChatResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      role?: "assistant";
      content?: string | null;
      tool_calls?: AzureOpenAiToolCall[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type AzureOpenAiSessionState = {
  sessionId: string;
  messages: AzureOpenAiMessage[];
  abortController: AbortController | null;
};

type AzureOpenAiClientConfig = {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
  modelLabel?: string | null;
  fetchFn?: FetchLike;
};

const MISSION_SERVICE_TOOL_NAMES = new Set([
  "spira_start_mission_service",
  "spira_stop_mission_service",
  "spira_run_mission_proof",
]);

export type AzureOpenAiAuthStrategy = "azure-openai-key";

const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/, "");

const flattenSystemMessage = (message: ProviderSystemMessage): string => {
  const sections = Object.entries(message.sections ?? {})
    .map(([key, section]) => `${key}:\n${section.content}`)
    .filter((entry) => entry.trim().length > 0);
  return [message.content, ...sections].filter((entry) => entry.trim().length > 0).join("\n\n");
};

const toAzureTools = (tools: readonly ProviderToolDefinition[]): AzureOpenAiTool[] =>
  tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

const parseToolArguments = (rawArguments: string, toolName: string): Record<string, unknown> => {
  if (!rawArguments.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ProviderError(`Azure OpenAI returned invalid arguments for tool ${toolName}`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new ProviderError(`Azure OpenAI returned malformed arguments for tool ${toolName}`, error);
  }
};

const getPermissionRequest = (
  tool: ProviderToolDefinition,
  toolCallId: string,
  args: Record<string, unknown>,
): ProviderPermissionRequest => {
  if (tool.name.startsWith("vision_")) {
    return {
      kind: "mcp",
      toolCallId,
      serverName: "Spira Vision",
      toolName: tool.name,
      toolTitle: tool.description,
      args,
      readOnly: true,
    };
  }

  if (MISSION_SERVICE_TOOL_NAMES.has(tool.name)) {
    return {
      kind: "custom-tool",
      toolCallId,
      toolName: tool.name,
      toolTitle: tool.description,
      args,
      readOnly: false,
    };
  }

  return {
    kind: "custom-tool",
    toolCallId,
    toolName: tool.name,
    toolTitle: tool.description,
    args,
    readOnly: tool.skipPermission === true,
  };
};

const toToolResultMessage = (result: ProviderToolResultObject): string =>
  JSON.stringify({
    resultType: result.resultType,
    textResultForLlm: result.textResultForLlm,
    ...(result.error ? { error: result.error } : {}),
  });

const getUsageSnapshot = (
  response: AzureOpenAiChatResponse,
  fallbackModel: string | null | undefined,
): ProviderUsageSnapshot => ({
  model: response.model ?? fallbackModel ?? null,
  inputTokens: response.usage?.prompt_tokens ?? null,
  outputTokens: response.usage?.completion_tokens ?? null,
  totalTokens: response.usage?.total_tokens ?? null,
  estimatedCostUsd: null,
  latencyMs: null,
  source: response.usage ? "provider" : "unknown",
});

const accumulateUsageSnapshots = (
  accumulated: ProviderUsageSnapshot | null,
  next: ProviderUsageSnapshot,
): ProviderUsageSnapshot => ({
  model: next.model ?? accumulated?.model ?? null,
  inputTokens:
    (accumulated?.inputTokens ?? null) === null && next.inputTokens === null
      ? null
      : (accumulated?.inputTokens ?? 0) + (next.inputTokens ?? 0),
  outputTokens:
    (accumulated?.outputTokens ?? null) === null && next.outputTokens === null
      ? null
      : (accumulated?.outputTokens ?? 0) + (next.outputTokens ?? 0),
  totalTokens:
    (accumulated?.totalTokens ?? null) === null && next.totalTokens === null
      ? null
      : (accumulated?.totalTokens ?? 0) + (next.totalTokens ?? 0),
  estimatedCostUsd:
    (accumulated?.estimatedCostUsd ?? null) === null && next.estimatedCostUsd === null
      ? null
      : (accumulated?.estimatedCostUsd ?? 0) + (next.estimatedCostUsd ?? 0),
  latencyMs:
    (accumulated?.latencyMs ?? null) === null && next.latencyMs === null
      ? null
      : (accumulated?.latencyMs ?? 0) + (next.latencyMs ?? 0),
  source: accumulated?.source === "provider" || next.source === "provider" ? "provider" : "unknown",
});

const getAssistantMessage = (
  response: AzureOpenAiChatResponse,
): {
  content?: string | null;
  tool_calls?: AzureOpenAiToolCall[];
} => {
  const message = response.choices?.[0]?.message;
  if (!message) {
    throw new ProviderError("Azure OpenAI returned no completion message.");
  }
  return message;
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === "AbortError" ||
    error.message.includes("aborted") ||
    error.message.includes("The operation was aborted"));

const resolveAzureConfig = (env: Env): Omit<AzureOpenAiClientConfig, "fetchFn"> => {
  const endpoint = env.AZURE_OPENAI_ENDPOINT?.trim() ?? "";
  const apiKey = env.AZURE_OPENAI_API_KEY?.trim() ?? "";
  const deployment = env.AZURE_OPENAI_DEPLOYMENT?.trim() ?? "";
  const apiVersion = env.AZURE_OPENAI_API_VERSION.trim();

  if (!endpoint) {
    throw new ConfigError("AZURE_OPENAI_ENDPOINT is required when SPIRA_MODEL_PROVIDER=azure-openai.");
  }
  if (!apiKey) {
    throw new ConfigError("AZURE_OPENAI_API_KEY is required when SPIRA_MODEL_PROVIDER=azure-openai.");
  }
  if (!deployment) {
    throw new ConfigError("AZURE_OPENAI_DEPLOYMENT is required when SPIRA_MODEL_PROVIDER=azure-openai.");
  }

  return {
    endpoint: trimTrailingSlashes(endpoint),
    apiKey,
    deployment,
    apiVersion,
    modelLabel: env.AZURE_OPENAI_MODEL?.trim() || null,
  };
};

class AzureOpenAiProviderSession implements ProviderSession {
  private disconnected = false;

  constructor(
    private readonly state: AzureOpenAiSessionState,
    private readonly config: ProviderSessionConfig,
    private readonly client: AzureOpenAiProviderClient,
  ) {}

  get sessionId(): string {
    return this.state.sessionId;
  }

  async send(payload: { prompt: string }): Promise<void> {
    if (this.disconnected) {
      throw new ProviderError("Session not found: disconnected");
    }

    await this.client.runTurn(this.state, this.config, payload.prompt);
  }

  disconnect(): Promise<void> {
    this.disconnected = true;
    this.state.abortController?.abort();
    return Promise.resolve();
  }
}

export class AzureOpenAiProviderClient implements ProviderClient {
  readonly providerId = "azure-openai" as const;
  readonly capabilities = {
    persistentSessions: false,
    abortableTurns: false,
    sessionResumption: "host-managed",
    turnCancellation: "disconnect-and-reset",
    responseStreaming: "host-buffered",
    usageReporting: "partial",
    toolManifestMode: "literal",
    modelSelection: "provider-default",
    toolCalling: "native",
  } as const;
  private readonly sessions = new Map<string, AzureOpenAiSessionState>();
  private readonly fetchFn: FetchLike;

  constructor(private readonly config: AzureOpenAiClientConfig) {
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async createSession(config: ProviderSessionConfig & { sessionId: string }): Promise<ProviderSession> {
    const state: AzureOpenAiSessionState = {
      sessionId: config.sessionId,
      messages: [
        {
          role: "system",
          content: flattenSystemMessage(config.systemMessage),
        },
      ],
      abortController: null,
    };
    this.sessions.set(config.sessionId, state);
    return new AzureOpenAiProviderSession(state, config, this);
  }

  async resumeSession(sessionId: string, config: ProviderSessionConfig): Promise<ProviderSession> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new ProviderError(`Session not found: ${sessionId}`);
    }

    return new AzureOpenAiProviderSession(state, config, this);
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!this.sessions.delete(sessionId)) {
      throw new ProviderError(`Session not found: ${sessionId}`);
    }
  }

  getAuthStatus(): Promise<ProviderAuthStatus> {
    return Promise.resolve({
      isAuthenticated: true,
      authType: "api-key",
    });
  }

  stop(): Promise<unknown[]> {
    this.sessions.clear();
    return Promise.resolve([]);
  }

  async runTurn(state: AzureOpenAiSessionState, config: ProviderSessionConfig, prompt: string): Promise<void> {
    if (state.abortController) {
      state.abortController.abort();
    }
    const abortController = new AbortController();
    state.abortController = abortController;
    state.messages.push({ role: "user", content: prompt });
    const messageId = randomUUID();
    let accumulatedUsage: ProviderUsageSnapshot | null = null;

    try {
      for (let iteration = 0; iteration < 12; iteration += 1) {
        const startedAt = Date.now();
        const response = await this.requestCompletion(state, config.tools, abortController.signal);
        accumulatedUsage = accumulateUsageSnapshots(accumulatedUsage, {
          ...getUsageSnapshot(response, this.config.modelLabel),
          latencyMs: Date.now() - startedAt,
        });
        const assistantMessage = getAssistantMessage(response);
        const assistantContent = typeof assistantMessage.content === "string" ? assistantMessage.content : "";
        const toolCalls = assistantMessage.tool_calls ?? [];

        state.messages.push({
          role: "assistant",
          content: assistantMessage.content ?? null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });

        if (toolCalls.length > 0) {
          for (const toolCall of toolCalls) {
            this.assertSessionConnected(abortController.signal);
            const tool = config.tools.find((entry) => entry.name === toolCall.function.name);
            const args = parseToolArguments(toolCall.function.arguments, toolCall.function.name);
            config.onEvent?.({
              type: "tool.execution_start",
              data: {
                toolCallId: toolCall.id,
                toolName: toolCall.function.name,
                arguments: args,
              },
            });

            const result = tool
              ? await this.executeTool(tool, toolCall.id, args, config)
              : {
                  resultType: "failure" as const,
                  textResultForLlm: `Tool ${toolCall.function.name} is not registered in Spira.`,
                  error: `Unknown tool ${toolCall.function.name}`,
                };

            this.assertSessionConnected(abortController.signal);
            config.onEvent?.({
              type: "tool.execution_complete",
              data: {
                toolCallId: toolCall.id,
                success: result.resultType === "success",
                result,
                ...(result.error ? { error: { message: result.error } } : {}),
              },
            });

            state.messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: toToolResultMessage(result),
            });
          }

          continue;
        }

        if (!assistantContent.trim()) {
          throw new ProviderError("Azure OpenAI returned an empty assistant response.");
        }

        this.assertSessionConnected(abortController.signal);
        config.onEvent?.({
          type: "assistant.message_delta",
          data: {
            messageId,
            deltaContent: assistantContent,
          },
        });
        config.onEvent?.({
          type: "assistant.message",
          data: {
            messageId,
            content: assistantContent,
          },
        });
        config.onEvent?.({
          type: "session.idle",
          data: {
            ...(accumulatedUsage ? { usage: accumulatedUsage } : {}),
          },
        });
        return;
      }
    } catch (error) {
      if (abortController.signal.aborted || isAbortError(error)) {
        throw new ProviderError("Session not found: disconnected", error);
      }
      throw error;
    } finally {
      if (state.abortController === abortController) {
        state.abortController = null;
      }
    }

    throw new ProviderError("Azure OpenAI exceeded the maximum tool-call iterations for a single turn.");
  }

  private async requestCompletion(
    state: AzureOpenAiSessionState,
    tools: readonly ProviderToolDefinition[],
    signal?: AbortSignal,
  ): Promise<AzureOpenAiChatResponse> {
    const url = new URL(
      `${this.config.endpoint}/openai/deployments/${encodeURIComponent(this.config.deployment)}/chat/completions`,
    );
    url.searchParams.set("api-version", this.config.apiVersion);

    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        "api-key": this.config.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messages: state.messages,
        stream: false,
        ...(tools.length > 0
          ? {
              tools: toAzureTools(tools),
              tool_choice: "auto",
            }
          : {}),
      }),
      signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderError(
        `Azure OpenAI request failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`,
      );
    }

    return (await response.json()) as AzureOpenAiChatResponse;
  }

  private async executeTool(
    tool: ProviderToolDefinition,
    toolCallId: string,
    args: Record<string, unknown>,
    config: ProviderSessionConfig,
  ): Promise<ProviderToolResultObject> {
    if (!tool.skipPermission && config.onPermissionRequest) {
      const permission = await config.onPermissionRequest(getPermissionRequest(tool, toolCallId, args));
      if (permission.kind === "reject") {
        return {
          resultType: "failure",
          textResultForLlm: permission.feedback?.trim() || `Permission denied for tool ${tool.name}.`,
          ...(permission.feedback
            ? { error: permission.feedback }
            : { error: `Permission denied for tool ${tool.name}.` }),
        };
      }
      if (permission.kind === "user-not-available") {
        return {
          resultType: "failure",
          textResultForLlm: `The user is not available to approve tool ${tool.name} right now.`,
          error: `User not available to approve tool ${tool.name}.`,
        };
      }
    }

    try {
      return await tool.handler(args);
    } catch (error) {
      throw new ProviderError(`Azure OpenAI tool ${tool.name} failed`, error);
    }
  }

  private assertSessionConnected(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new ProviderError("Session not found: disconnected");
    }
  }
}

export const createAzureOpenAiProviderClient = async (
  env: Env,
  logger: Pick<Logger, "info">,
): Promise<{ client: AzureOpenAiProviderClient; strategy: AzureOpenAiAuthStrategy }> => {
  const client = new AzureOpenAiProviderClient(resolveAzureConfig(env));
  logger.info(
    {
      providerId: client.providerId,
      endpoint: trimTrailingSlashes(env.AZURE_OPENAI_ENDPOINT?.trim() ?? ""),
      deployment: env.AZURE_OPENAI_DEPLOYMENT?.trim() ?? "",
      strategy: "azure-openai-key",
    },
    "Using Azure OpenAI provider authentication",
  );
  return {
    client,
    strategy: "azure-openai-key",
  };
};
