import { randomUUID } from "node:crypto";
import { ProviderError } from "../../util/errors.js";
import type {
  ProviderSessionConfig,
  ProviderSessionEvent,
  ProviderToolDefinition,
  ProviderToolResultObject,
  ProviderUsageSnapshot,
} from "../types.js";
import type { AzureOpenAiClientConfig, AzureOpenAiSessionState } from "./session-state.js";
import {
  accumulateUsageSnapshots,
  beginAzureTurnMessages,
  continueAzureTurnMessages,
  finishAzureTurnMessages,
  getAssistantMessage,
  getPermissionRequest,
  getUsageSnapshot,
  isAbortError,
  parseToolArguments,
  publishAzureHostContinuity,
  rollbackAzureTurnMessages,
  toToolResultImageContentParts,
  toToolResultMessage,
  tryEscalateAzureSession,
} from "./session-state.js";
import { requestAzureOpenAiCompletion } from "./transport.js";

const MAX_AZURE_TOOL_CALL_ITERATIONS = 12;
const MAX_AZURE_TURN_CONTINUATIONS = 32;

export const executeAzureOpenAiTool = async (
  tool: ProviderToolDefinition,
  toolCallId: string,
  args: Record<string, unknown>,
  config: ProviderSessionConfig,
): Promise<ProviderToolResultObject> => {
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
};

export const assertAzureSessionConnected = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw new ProviderError("Session not found: disconnected");
  }
};

const assertActiveAzureTurn = (state: AzureOpenAiSessionState, turnGeneration: number, signal?: AbortSignal): void => {
  if (state.turnGeneration !== turnGeneration || signal?.aborted) {
    throw new ProviderError("Session not found: disconnected");
  }
};

const isRetryableAzureRequestError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  const match = error.message.match(/Azure OpenAI request failed with (\d+)/);
  if (!match) {
    return false;
  }
  const status = Number(match[1]);
  return [408, 429, 500, 502, 503, 504].includes(status);
};

const hasExecutedToolCalls = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "executedToolCalls" in error && error.executedToolCalls === true;

const getAccumulatedUsage = (error: unknown): ProviderUsageSnapshot | null =>
  typeof error === "object" && error !== null && "accumulatedUsage" in error
    ? ((error.accumulatedUsage as ProviderUsageSnapshot | null | undefined) ?? null)
    : null;

const withTurnExecutionContext = (
  error: unknown,
  executedToolCalls: boolean,
  accumulatedUsage: ProviderUsageSnapshot | null,
): Error => {
  if (error instanceof Error) {
    return Object.assign(error, { executedToolCalls, accumulatedUsage });
  }
  return Object.assign(new Error(String(error)), { executedToolCalls, accumulatedUsage });
};

const needsTurnContinuation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "needsContinuation" in error && error.needsContinuation === true;

const getAzureEscalationReason = (error: unknown): string | null => {
  if (!(error instanceof Error)) {
    return null;
  }
  if (error.message === "Azure OpenAI returned no completion message.") {
    return "empty-response";
  }
  if (error.message === "Azure OpenAI returned an empty assistant response.") {
    return "empty-response";
  }
  if (error.message === "Azure OpenAI exceeded the maximum tool-call iterations for a single turn.") {
    return "tool-iteration-limit";
  }
  if (isRetryableAzureRequestError(error)) {
    return "retryable-provider-error";
  }
  return null;
};

const runAzureOpenAiTurnOnce = async (
  clientConfig: AzureOpenAiClientConfig,
  state: AzureOpenAiSessionState,
  config: ProviderSessionConfig,
  prompt: string,
  logger: { info(entry: object, message: string): void },
  initialUsage: ProviderUsageSnapshot | null = null,
  isContinuation = false,
): Promise<void> => {
  if (state.abortController) {
    state.abortController.abort();
  }
  const abortController = new AbortController();
  state.abortController = abortController;
  const turnGeneration = isContinuation ? continueAzureTurnMessages(state) : beginAzureTurnMessages(state, prompt);
  logger.info(
    {
      providerId: state.providerId,
      sessionId: state.sessionId,
      deployment: state.currentDeployment,
      model: state.hostContinuityModel ?? config.model ?? clientConfig.modelLabel ?? state.currentDeployment,
      promptLength: prompt.length,
    },
    "Dispatching prompt through provider",
  );
  let executedToolCalls = false;
  let accumulatedUsage: ProviderUsageSnapshot | null = initialUsage;
  let turnCompleted = false;
  const emitTurnEvent = (event: ProviderSessionEvent): void => {
    if (state.turnGeneration !== turnGeneration || abortController.signal.aborted) {
      return;
    }
    config.onEvent?.(event);
  };

  try {
    for (let iteration = 0; iteration < MAX_AZURE_TOOL_CALL_ITERATIONS; iteration += 1) {
      const startedAt = Date.now();
      let emittedStreamDelta = false;
      const messageId = randomUUID();
      const response = await requestAzureOpenAiCompletion(clientConfig, state, config.tools, {
        signal: abortController.signal,
        streaming: config.streaming === true,
        onContentDelta: (deltaContent) => {
          emittedStreamDelta = true;
          emitTurnEvent({
            type: "assistant.message_delta",
            data: {
              messageId,
              deltaContent,
            },
          });
        },
      });
      assertActiveAzureTurn(state, turnGeneration, abortController.signal);
      accumulatedUsage = accumulateUsageSnapshots(accumulatedUsage, {
        ...getUsageSnapshot(response, state.hostContinuityModel ?? clientConfig.modelLabel ?? state.currentDeployment),
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
      publishAzureHostContinuity(state);

      if (toolCalls.length > 0) {
        if (assistantContent.trim()) {
          if (!emittedStreamDelta) {
            emitTurnEvent({
              type: "assistant.message_delta",
              data: {
                messageId,
                deltaContent: assistantContent,
              },
            });
          }
          emitTurnEvent({
            type: "assistant.message",
            data: {
              messageId,
              content: assistantContent,
            },
          });
        }

        for (const toolCall of toolCalls) {
          executedToolCalls = true;
          assertActiveAzureTurn(state, turnGeneration, abortController.signal);
          assertAzureSessionConnected(abortController.signal);
          const tool = config.tools.find((entry) => entry.name === toolCall.function.name);
          const args = parseToolArguments(toolCall.function.arguments, toolCall.function.name);
          emitTurnEvent({
            type: "tool.execution_start",
            data: {
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              arguments: args,
            },
          });

          const result = tool
            ? await executeAzureOpenAiTool(tool, toolCall.id, args, config)
            : {
                resultType: "failure" as const,
                textResultForLlm: `Tool ${toolCall.function.name} is not registered in Spira.`,
                error: `Unknown tool ${toolCall.function.name}`,
              };

          assertActiveAzureTurn(state, turnGeneration, abortController.signal);
          assertAzureSessionConnected(abortController.signal);
          emitTurnEvent({
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
          const imageParts = toToolResultImageContentParts(result);
          if (imageParts) {
            state.messages.push({
              role: "user",
              content: imageParts,
            });
          }
          publishAzureHostContinuity(state);
        }

        continue;
      }

      if (!assistantContent.trim()) {
        throw new ProviderError("Azure OpenAI returned an empty assistant response.");
      }

      assertActiveAzureTurn(state, turnGeneration, abortController.signal);
      assertAzureSessionConnected(abortController.signal);
      if (!emittedStreamDelta) {
        emitTurnEvent({
          type: "assistant.message_delta",
          data: {
            messageId,
            deltaContent: assistantContent,
          },
        });
      }
      emitTurnEvent({
        type: "assistant.message",
        data: {
          messageId,
          content: assistantContent,
        },
      });
      emitTurnEvent({
        type: "session.idle",
        data: {
          ...(accumulatedUsage ? { usage: accumulatedUsage } : {}),
        },
      });
      turnCompleted = true;
      return;
    }
  } catch (error) {
    rollbackAzureTurnMessages(state, turnGeneration);
    if (abortController.signal.aborted || isAbortError(error)) {
      throw withTurnExecutionContext(
        new ProviderError("Session not found: disconnected", error),
        executedToolCalls,
        accumulatedUsage,
      );
    }
    throw withTurnExecutionContext(error, executedToolCalls, accumulatedUsage);
  } finally {
    if (turnCompleted) {
      finishAzureTurnMessages(state, turnGeneration);
    }
    if (state.abortController === abortController) {
      state.abortController = null;
    }
  }

  throw withTurnExecutionContext(
    Object.assign(new ProviderError("Azure OpenAI exceeded the maximum tool-call iterations for a single turn."), {
      needsContinuation: true,
    }),
    executedToolCalls,
    accumulatedUsage,
  );
};

export const runAzureOpenAiTurn = async (
  clientConfig: AzureOpenAiClientConfig,
  state: AzureOpenAiSessionState,
  config: ProviderSessionConfig,
  prompt: string,
  logger: { info(entry: object, message: string): void },
): Promise<void> => {
  let accumulatedUsage: ProviderUsageSnapshot | null = null;
  let continuationCount = 0;
  let isContinuation = false;
  while (true) {
    try {
      await runAzureOpenAiTurnOnce(clientConfig, state, config, prompt, logger, accumulatedUsage, isContinuation);
      return;
    } catch (error) {
      accumulatedUsage = getAccumulatedUsage(error);
      if (needsTurnContinuation(error)) {
        const escalation = tryEscalateAzureSession(state);
        if (escalation) {
          logger.info(
            {
              providerId: state.providerId,
              sessionId: state.sessionId,
              reason: "tool-iteration-limit",
              fromDeployment: escalation.fromDeployment,
              toDeployment: escalation.toDeployment,
              fromModel: escalation.fromModel,
              toModel: escalation.toModel,
            },
            "Escalating provider session",
          );
        }
        if (continuationCount >= MAX_AZURE_TURN_CONTINUATIONS) {
          rollbackAzureTurnMessages(state);
          throw error;
        }
        continuationCount += 1;
        isContinuation = true;
        logger.info(
          {
            providerId: state.providerId,
            sessionId: state.sessionId,
            continuationCount,
            deployment: state.currentDeployment,
            ...(state.hostContinuityModel ? { model: state.hostContinuityModel } : {}),
          },
          "Continuing provider turn after tool-call iteration limit",
        );
        continue;
      }
      const reason = hasExecutedToolCalls(error) ? null : getAzureEscalationReason(error);
      const escalation = reason ? tryEscalateAzureSession(state) : null;
      if (!reason || !escalation) {
        throw error;
      }

      logger.info(
        {
          providerId: state.providerId,
          sessionId: state.sessionId,
          reason,
          fromDeployment: escalation.fromDeployment,
          toDeployment: escalation.toDeployment,
          fromModel: escalation.fromModel,
          toModel: escalation.toModel,
        },
        "Escalating provider session",
      );
    }
  }
};
