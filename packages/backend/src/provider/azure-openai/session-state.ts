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
export type AzureOpenAiProviderId = Extract<ProviderId, "azure-openai" | "azure-openai-escalation">;

export type AzureOpenAiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type AzureOpenAiMessage =
  | {
      role: "system" | "tool";
      content: string;
      tool_call_id?: string;
    }
  | {
      role: "user";
      content: string | AzureOpenAiContentPart[];
    }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: AzureOpenAiToolCall[];
    };

export type AzureOpenAiTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type AzureOpenAiToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type AzureOpenAiChatResponse = {
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

export type AzureOpenAiChatStreamChunk = {
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

export type AzureOpenAiSessionState = {
  sessionId: string;
  providerId: AzureOpenAiProviderId;
  messages: AzureOpenAiMessage[];
  abortController: AbortController | null;
  turnGeneration: number;
  activeTurnMessageStartIndex: number | null;
  currentDeployment: string;
  hostContinuityModel: string | null;
  escalationDeployment: string | null;
  escalationModelLabel: string | null;
  autoEscalationEnabled: boolean;
  onHostContinuitySnapshot: ((snapshot: ProviderHostContinuityState) => void) | null;
};

export type AzureOpenAiClientConfig = {
  providerId?: AzureOpenAiProviderId;
  endpoint: string;
  apiKey: string;
  deployment: string;
  escalationDeployment?: string | null;
  apiVersion: string;
  modelLabel?: string | null;
  escalationModelLabel?: string | null;
  fetchFn?: FetchLike;
};

const MISSION_SERVICE_TOOL_NAMES = new Set([
  "spira_start_mission_service",
  "spira_stop_mission_service",
  "spira_run_mission_proof",
]);

export const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/, "");

export const flattenSystemMessage = (message: ProviderSystemMessage): string => {
  const sections = Object.entries(message.sections ?? {})
    .map(([key, section]) => `${key}:\n${section.content}`)
    .filter((entry) => entry.trim().length > 0);
  return [message.content, ...sections].filter((entry) => entry.trim().length > 0).join("\n\n");
};

const getAzureRouteLabel = (deployment: string, modelLabel: string | null | undefined): string =>
  modelLabel?.trim() || deployment;

export const resolveAzureCurrentDeployment = (
  providerId: AzureOpenAiProviderId,
  continuityModel: string,
  deployment: string,
  modelLabel: string | null,
  escalationDeployment: string | null,
  escalationModelLabel: string | null,
): string => {
  if (providerId !== "azure-openai-escalation" || !escalationDeployment) {
    return deployment;
  }

  const baseRouteLabel = getAzureRouteLabel(deployment, modelLabel);
  const escalationRouteLabel = getAzureRouteLabel(escalationDeployment, escalationModelLabel);
  return escalationRouteLabel !== baseRouteLabel && continuityModel === escalationRouteLabel
    ? escalationDeployment
    : deployment;
};

export const createAzureOpenAiSessionState = (
  config: ProviderSessionConfig & { sessionId: string },
  providerId: AzureOpenAiProviderId,
  deployment: string,
  modelLabel: string | null,
  escalationDeployment: string | null,
  escalationModelLabel: string | null,
): AzureOpenAiSessionState => {
  const continuityModel =
    config.hostContinuity?.providerId === providerId
      ? (config.hostContinuity.model ?? getAzureRouteLabel(deployment, modelLabel))
      : getAzureRouteLabel(deployment, modelLabel);
  const currentDeployment =
    config.hostContinuity?.providerId === providerId
      ? config.hostContinuity.deployment?.trim() ||
        resolveAzureCurrentDeployment(
          providerId,
          continuityModel,
          deployment,
          modelLabel,
          escalationDeployment,
          escalationModelLabel,
        )
      : deployment;
  return {
    sessionId: config.sessionId,
    providerId,
    messages:
      config.hostContinuity?.providerId === providerId && config.hostContinuity.messages.length > 0
        ? config.hostContinuity.messages.map((message): AzureOpenAiMessage => {
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
    currentDeployment,
    hostContinuityModel: continuityModel,
    escalationDeployment,
    escalationModelLabel,
    autoEscalationEnabled: escalationDeployment !== null,
    onHostContinuitySnapshot: config.onHostContinuitySnapshot ?? null,
  };
};

const flattenContentForContinuity = (content: string | AzureOpenAiContentPart[]): string => {
  if (typeof content === "string") {
    return content;
  }
  return content
    .map((part) =>
      part.type === "text"
        ? part.text
        : "[image attachment dropped from continuity to save space]",
    )
    .join("\n");
};

const toHostContinuityMessage = (message: AzureOpenAiMessage): ProviderHostContinuityMessage =>
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
      : message.role === "user"
        ? {
            role: "user",
            content: flattenContentForContinuity(message.content),
          }
        : {
            role: message.role,
            content: message.content,
          };

export const publishAzureHostContinuity = (state: AzureOpenAiSessionState): void => {
  state.onHostContinuitySnapshot?.({
    providerId: state.providerId,
    model: state.hostContinuityModel,
    deployment: state.currentDeployment,
    messages: state.messages.map((message) => toHostContinuityMessage(message)),
    updatedAt: Date.now(),
  });
};

export const tryEscalateAzureSession = (
  state: AzureOpenAiSessionState,
): { fromDeployment: string; toDeployment: string; fromModel: string | null; toModel: string } | null => {
  if (
    !state.autoEscalationEnabled ||
    !state.escalationDeployment ||
    state.currentDeployment === state.escalationDeployment
  ) {
    return null;
  }

  const fromDeployment = state.currentDeployment;
  const fromModel = state.hostContinuityModel;
  const toDeployment = state.escalationDeployment;
  const toModel = getAzureRouteLabel(toDeployment, state.escalationModelLabel);
  state.currentDeployment = toDeployment;
  state.hostContinuityModel = toModel;
  state.autoEscalationEnabled = false;
  publishAzureHostContinuity(state);
  return {
    fromDeployment,
    toDeployment,
    fromModel,
    toModel,
  };
};

export const escalateAzureSession = (
  state: AzureOpenAiSessionState,
): {
  status: "escalated" | "already-escalated";
  fromDeployment: string;
  toDeployment: string;
  fromModel: string | null;
  toModel: string;
} => {
  if (!state.escalationDeployment) {
    throw new ProviderError("Azure OpenAI escalation is unavailable for this session.");
  }

  const toDeployment = state.escalationDeployment;
  const toModel = getAzureRouteLabel(toDeployment, state.escalationModelLabel);
  if (state.currentDeployment === toDeployment) {
    return {
      status: "already-escalated",
      fromDeployment: state.currentDeployment,
      toDeployment,
      fromModel: state.hostContinuityModel,
      toModel,
    };
  }

  const fromDeployment = state.currentDeployment;
  const fromModel = state.hostContinuityModel;
  state.currentDeployment = toDeployment;
  state.hostContinuityModel = toModel;
  state.autoEscalationEnabled = false;
  publishAzureHostContinuity(state);
  return {
    status: "escalated",
    fromDeployment,
    toDeployment,
    fromModel,
    toModel,
  };
};

export const beginAzureTurnMessages = (state: AzureOpenAiSessionState, prompt: string): number => {
  const turnGeneration = state.turnGeneration + 1;
  state.turnGeneration = turnGeneration;
  state.activeTurnMessageStartIndex = state.messages.length;
  state.messages.push({ role: "user", content: prompt });
  publishAzureHostContinuity(state);
  return turnGeneration;
};

export const continueAzureTurnMessages = (state: AzureOpenAiSessionState): number => {
  const turnGeneration = state.turnGeneration + 1;
  state.turnGeneration = turnGeneration;
  // Continuations stay inside the same logical user turn so abort/fatal rollback can still clear it all.
  publishAzureHostContinuity(state);
  return turnGeneration;
};

export const finishAzureTurnMessages = (state: AzureOpenAiSessionState, turnGeneration: number): void => {
  if (state.turnGeneration === turnGeneration) {
    state.activeTurnMessageStartIndex = null;
  }
};

export const rollbackAzureTurnMessages = (state: AzureOpenAiSessionState, turnGeneration?: number): void => {
  if (turnGeneration !== undefined && state.turnGeneration !== turnGeneration) {
    return;
  }
  if (state.activeTurnMessageStartIndex !== null) {
    state.messages.splice(state.activeTurnMessageStartIndex);
  }
  state.activeTurnMessageStartIndex = null;
  publishAzureHostContinuity(state);
};

export const abortAzureTurn = (state: AzureOpenAiSessionState): void => {
  state.turnGeneration += 1;
  rollbackAzureTurnMessages(state);
  state.abortController?.abort();
};

export const toAzureTools = (tools: readonly ProviderToolDefinition[]): AzureOpenAiTool[] =>
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
      throw new ProviderError(`Azure OpenAI returned invalid arguments for tool ${toolName}`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new ProviderError(`Azure OpenAI returned malformed arguments for tool ${toolName}`, error);
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

export const toToolResultImageContentParts = (
  result: ProviderToolResultObject,
): AzureOpenAiContentPart[] | null => {
  const imageBlocks = (result.content ?? []).filter(
    (block): block is { type: "image"; mimeType: string; base64: string } => block.type === "image",
  );
  if (imageBlocks.length === 0) {
    return null;
  }
  const parts: AzureOpenAiContentPart[] = [
    {
      type: "text",
      text: "Attached image(s) returned by the previous tool call.",
    },
  ];
  for (const block of imageBlocks) {
    parts.push({
      type: "image_url",
      image_url: { url: `data:${block.mimeType};base64,${block.base64}` },
    });
  }
  return parts;
};

export const getUsageSnapshot = (
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

export const isAbortError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === "AbortError" ||
    error.message.includes("aborted") ||
    error.message.includes("The operation was aborted"));

export const resolveAzureConfig = (
  providerId: AzureOpenAiProviderId,
  env: Env,
): Omit<AzureOpenAiClientConfig, "fetchFn"> => {
  const endpoint = env.AZURE_OPENAI_ENDPOINT?.trim() ?? "";
  const apiKey = env.AZURE_OPENAI_API_KEY?.trim() ?? "";
  const deployment = env.AZURE_OPENAI_DEPLOYMENT?.trim() ?? "";
  const escalationDeployment = env.AZURE_OPENAI_ESCALATION_DEPLOYMENT?.trim() ?? "";
  const apiVersion = env.AZURE_OPENAI_API_VERSION.trim();

  if (!endpoint) {
    throw new ConfigError(`AZURE_OPENAI_ENDPOINT is required when SPIRA_MODEL_PROVIDER=${providerId}.`);
  }
  if (!apiKey) {
    throw new ConfigError(`AZURE_OPENAI_API_KEY is required when SPIRA_MODEL_PROVIDER=${providerId}.`);
  }
  if (!deployment) {
    throw new ConfigError(`AZURE_OPENAI_DEPLOYMENT is required when SPIRA_MODEL_PROVIDER=${providerId}.`);
  }
  if (providerId === "azure-openai-escalation" && !escalationDeployment) {
    throw new ConfigError(
      "AZURE_OPENAI_ESCALATION_DEPLOYMENT is required when SPIRA_MODEL_PROVIDER=azure-openai-escalation.",
    );
  }

  return {
    providerId,
    endpoint: trimTrailingSlashes(endpoint),
    apiKey,
    deployment,
    escalationDeployment: providerId === "azure-openai-escalation" ? escalationDeployment : null,
    apiVersion,
    modelLabel: env.AZURE_OPENAI_MODEL?.trim() || null,
    escalationModelLabel:
      providerId === "azure-openai-escalation" ? env.AZURE_OPENAI_ESCALATION_MODEL?.trim() || null : null,
  };
};
