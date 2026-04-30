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
  finishAzureTurnMessages,
  getAssistantMessage,
  getPermissionRequest,
  getUsageSnapshot,
  isAbortError,
  parseToolArguments,
  publishAzureHostContinuity,
  rollbackAzureTurnMessages,
  toToolResultMessage,
} from "./session-state.js";
import { requestAzureOpenAiCompletion } from "./transport.js";

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

export const runAzureOpenAiTurn = async (
  clientConfig: AzureOpenAiClientConfig,
  state: AzureOpenAiSessionState,
  config: ProviderSessionConfig,
  prompt: string,
  logger: { info(entry: object, message: string): void },
): Promise<void> => {
  if (state.abortController) {
    state.abortController.abort();
  }
  const abortController = new AbortController();
  state.abortController = abortController;
  const turnGeneration = beginAzureTurnMessages(state, prompt);
  logger.info(
    {
      providerId: "azure-openai",
      sessionId: state.sessionId,
      deployment: clientConfig.deployment,
      model: config.model ?? clientConfig.modelLabel ?? clientConfig.deployment,
      promptLength: prompt.length,
    },
    "Dispatching prompt through provider",
  );
  let accumulatedUsage: ProviderUsageSnapshot | null = null;
  let turnCompleted = false;
  const emitTurnEvent = (event: ProviderSessionEvent): void => {
    if (state.turnGeneration !== turnGeneration || abortController.signal.aborted) {
      return;
    }
    config.onEvent?.(event);
  };

  try {
    for (let iteration = 0; iteration < 12; iteration += 1) {
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
        ...getUsageSnapshot(response, clientConfig.modelLabel),
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
      throw new ProviderError("Session not found: disconnected", error);
    }
    throw error;
  } finally {
    if (turnCompleted) {
      finishAzureTurnMessages(state, turnGeneration);
    }
    if (state.abortController === abortController) {
      state.abortController = null;
    }
  }

  rollbackAzureTurnMessages(state, turnGeneration);
  throw new ProviderError("Azure OpenAI exceeded the maximum tool-call iterations for a single turn.");
};
