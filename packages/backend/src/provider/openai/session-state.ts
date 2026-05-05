import type { Env } from "@spira/shared";
import { ConfigError, ProviderError } from "../../util/errors.js";
import type {
  ProviderHostContinuityMessage,
  ProviderHostContinuityState,
  ProviderId,
  ProviderPermissionRequest,
  ProviderSessionConfig,
  ProviderSystemMessage,
  ProviderToolDefinition,
  ProviderToolResultObject,
  ProviderUsageSnapshot,
} from "../types.js";

export type FetchLike = typeof fetch;
export type OpenAiProviderId = Extract<ProviderId, "openai" | "openai-escalation">;

export type OpenAiMessage =
  | {
      role: "system" | "user" | "tool";
      content: string;
      tool_call_id?: string;
    }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAiToolCall[];
    };

export type OpenAiTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type OpenAiToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type OpenAiChatResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      role?: "assistant";
      content?: string | null;
      tool_calls?: OpenAiToolCall[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export type OpenAiChatStreamChunk = {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: {
      role?: "assistant";
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export type OpenAiSessionState = {
  sessionId: string;
  providerId: OpenAiProviderId;
  messages: OpenAiMessage[];
  abortController: AbortController | null;
  turnGeneration: number;
  activeTurnMessageStartIndex: number | null;
  currentModel: string | null;
  escalationModel: string | null;
  autoEscalationEnabled: boolean;
  onHostContinuitySnapshot: ((snapshot: ProviderHostContinuityState) => void) | null;
};

export type OpenAiClientConfig = {
  providerId?: OpenAiProviderId;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  escalationModel?: string | null;
  fetchFn?: FetchLike;
};

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

const MISSION_SERVICE_TOOL_NAMES = new Set([
  "spira_start_mission_service",
  "spira_stop_mission_service",
  "spira_run_mission_proof",
]);

export const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/, "");

export const normalizeOpenAiBaseUrl = (value: string | null | undefined): string => {
  const trimmed = value?.trim() ?? "";
  return trimTrailingSlashes(trimmed || DEFAULT_OPENAI_BASE_URL);
};

export const flattenSystemMessage = (message: ProviderSystemMessage): string => {
  const sections = Object.entries(message.sections ?? {})
    .map(([key, section]) => `${key}:\n${section.content}`)
    .filter((entry) => entry.trim().length > 0);
  return [message.content, ...sections].filter((entry) => entry.trim().length > 0).join("\n\n");
};

export const createOpenAiSessionState = (
  config: ProviderSessionConfig & { sessionId: string },
  providerId: OpenAiProviderId,
  initialModel: string | null,
  escalationModel: string | null,
): OpenAiSessionState => ({
  sessionId: config.sessionId,
  providerId,
  messages:
    config.hostContinuity?.providerId === providerId && config.hostContinuity.messages.length > 0
      ? config.hostContinuity.messages.map((message): OpenAiMessage => {
          switch (message.role) {
            case "assistant":
              return {
                role: "assistant",
                content: message.content,
                ...(message.toolCalls
                  ? {
                      tool_calls: message.toolCalls.map((toolCall) => ({
                        id: toolCall.id,
                        type: "function",
                        function: {
                          name: toolCall.name,
                          arguments: toolCall.arguments,
                        },
                      })),
                    }
                  : {}),
              };
            case "tool":
              return {
                role: "tool",
                tool_call_id: message.toolCallId,
                content: message.content,
              };
            default:
              return {
                role: message.role,
                content: message.content,
              };
          }
        })
      : [
          {
            role: "system",
            content: flattenSystemMessage(config.systemMessage),
          },
        ],
  abortController: null,
  turnGeneration: 0,
  activeTurnMessageStartIndex: null,
  currentModel:
    config.hostContinuity?.providerId === providerId ? (config.hostContinuity.model ?? initialModel) : initialModel,
  escalationModel,
  autoEscalationEnabled: !config.model?.trim(),
  onHostContinuitySnapshot: config.onHostContinuitySnapshot ?? null,
});

const toHostContinuityMessage = (message: OpenAiMessage): ProviderHostContinuityMessage =>
  message.role === "assistant"
    ? {
        role: "assistant",
        content: message.content,
        ...(message.tool_calls
          ? {
              toolCalls: message.tool_calls.map((toolCall) => ({
                id: toolCall.id,
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
              })),
            }
          : {}),
      }
    : message.role === "tool"
      ? {
          role: "tool",
          toolCallId: message.tool_call_id ?? "",
          content: message.content,
        }
      : {
          role: message.role,
          content: message.content,
        };

export const publishOpenAiHostContinuity = (state: OpenAiSessionState): void => {
  state.onHostContinuitySnapshot?.({
    providerId: state.providerId,
    model: state.currentModel,
    messages: state.messages.map((message) => toHostContinuityMessage(message)),
    updatedAt: Date.now(),
  });
};

export const setOpenAiSessionModel = (state: OpenAiSessionState, model: string): void => {
  const trimmed = model.trim();
  if (!trimmed) {
    throw new ProviderError("OpenAI requires a non-empty model.");
  }
  state.currentModel = trimmed;
  state.autoEscalationEnabled = false;
  publishOpenAiHostContinuity(state);
};

export const tryEscalateOpenAiSession = (
  state: OpenAiSessionState,
): { fromModel: string | null; toModel: string } | null => {
  if (!state.autoEscalationEnabled || !state.escalationModel || state.currentModel === state.escalationModel) {
    return null;
  }

  const fromModel = state.currentModel;
  state.currentModel = state.escalationModel;
  state.autoEscalationEnabled = false;
  publishOpenAiHostContinuity(state);
  return {
    fromModel,
    toModel: state.escalationModel,
  };
};

export const escalateOpenAiSession = (
  state: OpenAiSessionState,
): { status: "escalated" | "already-escalated"; fromModel: string | null; toModel: string } => {
  if (!state.escalationModel) {
    throw new ProviderError("OpenAI escalation is unavailable for this session.");
  }
  if (state.currentModel === state.escalationModel) {
    return {
      status: "already-escalated",
      fromModel: state.currentModel,
      toModel: state.escalationModel,
    };
  }

  const fromModel = state.currentModel;
  state.currentModel = state.escalationModel;
  state.autoEscalationEnabled = false;
  publishOpenAiHostContinuity(state);
  return {
    status: "escalated",
    fromModel,
    toModel: state.escalationModel,
  };
};

export const beginOpenAiTurnMessages = (state: OpenAiSessionState, prompt: string): number => {
  const turnGeneration = state.turnGeneration + 1;
  state.turnGeneration = turnGeneration;
  state.activeTurnMessageStartIndex = state.messages.length;
  state.messages.push({ role: "user", content: prompt });
  publishOpenAiHostContinuity(state);
  return turnGeneration;
};

export const finishOpenAiTurnMessages = (state: OpenAiSessionState, turnGeneration: number): void => {
  if (state.turnGeneration === turnGeneration) {
    state.activeTurnMessageStartIndex = null;
  }
};

export const rollbackOpenAiTurnMessages = (state: OpenAiSessionState, turnGeneration?: number): void => {
  if (turnGeneration !== undefined && state.turnGeneration !== turnGeneration) {
    return;
  }
  if (state.activeTurnMessageStartIndex !== null) {
    state.messages.splice(state.activeTurnMessageStartIndex);
  }
  state.activeTurnMessageStartIndex = null;
  publishOpenAiHostContinuity(state);
};

export const abortOpenAiTurn = (state: OpenAiSessionState): void => {
  state.turnGeneration += 1;
  rollbackOpenAiTurnMessages(state);
  state.abortController?.abort();
};

export const toOpenAiTools = (tools: readonly ProviderToolDefinition[]): OpenAiTool[] =>
  tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

export const parseToolArguments = (rawArguments: string, toolName: string): Record<string, unknown> => {
  if (!rawArguments.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ProviderError(`OpenAI returned invalid arguments for tool ${toolName}`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new ProviderError(`OpenAI returned malformed arguments for tool ${toolName}`, error);
  }
};

export const getPermissionRequest = (
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

export const toToolResultMessage = (result: ProviderToolResultObject): string =>
  JSON.stringify({
    resultType: result.resultType,
    textResultForLlm: result.textResultForLlm,
    ...(result.error ? { error: result.error } : {}),
  });

export const getUsageSnapshot = (
  response: OpenAiChatResponse,
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

export const accumulateUsageSnapshots = (
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

export const getAssistantMessage = (
  response: OpenAiChatResponse,
): {
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
} => {
  const message = response.choices?.[0]?.message;
  if (!message) {
    throw new ProviderError("OpenAI returned no completion message.");
  }
  return message;
};

export const isAbortError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === "AbortError" ||
    error.message.includes("aborted") ||
    error.message.includes("The operation was aborted"));

export const resolveOpenAiConfig = (providerId: OpenAiProviderId, env: Env): Omit<OpenAiClientConfig, "fetchFn"> => {
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  const defaultModel = env.OPENAI_MODEL.trim();
  const escalationModel = env.OPENAI_ESCALATION_MODEL?.trim() ?? "";

  if (!apiKey) {
    throw new ConfigError(`OPENAI_API_KEY is required when SPIRA_MODEL_PROVIDER=${providerId}.`);
  }
  if (!defaultModel) {
    throw new ConfigError(`OPENAI_MODEL is required when SPIRA_MODEL_PROVIDER=${providerId}.`);
  }
  if (providerId === "openai-escalation" && !escalationModel) {
    throw new ConfigError("OPENAI_ESCALATION_MODEL is required when SPIRA_MODEL_PROVIDER=openai-escalation.");
  }

  return {
    providerId,
    apiKey,
    baseUrl: normalizeOpenAiBaseUrl(env.OPENAI_BASE_URL),
    defaultModel,
    escalationModel: providerId === "openai-escalation" ? escalationModel : null,
  };
};
