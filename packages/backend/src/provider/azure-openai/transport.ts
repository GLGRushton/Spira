import { ProviderError } from "../../util/errors.js";
import type { ProviderToolDefinition } from "../types.js";
import type {
  AzureOpenAiChatResponse,
  AzureOpenAiChatStreamChunk,
  AzureOpenAiClientConfig,
  AzureOpenAiSessionState,
  AzureOpenAiToolCall,
} from "./session-state.js";
import { toAzureTools } from "./session-state.js";

type RequestAzureOpenAiCompletionOptions = {
  signal?: AbortSignal;
  streaming?: boolean;
  onContentDelta?: (deltaContent: string) => void;
};

const appendToolCallDelta = (
  toolCalls: AzureOpenAiToolCall[],
  deltas: NonNullable<NonNullable<AzureOpenAiChatStreamChunk["choices"]>[number]["delta"]>["tool_calls"],
): void => {
  if (!deltas) {
    return;
  }
  for (const delta of deltas) {
    const index = delta.index ?? toolCalls.length;
    const existing = toolCalls[index] ?? {
      id: delta.id ?? `tool-call-${index}`,
      type: "function" as const,
      function: {
        name: "",
        arguments: "",
      },
    };
    toolCalls[index] = {
      id: delta.id ?? existing.id,
      type: "function",
      function: {
        name: delta.function?.name ? `${existing.function.name}${delta.function.name}` : existing.function.name,
        arguments: `${existing.function.arguments}${delta.function?.arguments ?? ""}`,
      },
    };
  }
};

const getStreamingResponseChoice = (
  response: AzureOpenAiChatResponse,
): NonNullable<AzureOpenAiChatResponse["choices"]>[number] => {
  if (!response.choices?.[0]) {
    response.choices = [
      {
        message: {
          role: "assistant",
          content: "",
        },
        finish_reason: null,
      },
    ];
  } else if (!response.choices[0].message) {
    response.choices[0].message = {
      role: "assistant",
      content: "",
    };
  } else if (typeof response.choices[0].message.content !== "string" && response.choices[0].message.content !== null) {
    response.choices[0].message.content = "";
  }
  return response.choices[0];
};

const applyStreamChunk = (
  response: AzureOpenAiChatResponse,
  chunk: AzureOpenAiChatStreamChunk,
  onContentDelta?: (deltaContent: string) => void,
): void => {
  response.id ??= chunk.id;
  response.model ??= chunk.model;
  if (chunk.usage) {
    response.usage = {
      prompt_tokens: chunk.usage.prompt_tokens,
      completion_tokens: chunk.usage.completion_tokens,
      total_tokens: chunk.usage.total_tokens,
    };
  }
  const choiceChunk = chunk.choices?.[0];
  if (!choiceChunk) {
    return;
  }
  const choice = getStreamingResponseChoice(response);
  choice.finish_reason = choiceChunk.finish_reason ?? choice.finish_reason;
  const delta = choiceChunk.delta;
  if (!delta) {
    return;
  }
  if (delta.content) {
    const currentContent = typeof choice.message?.content === "string" ? choice.message.content : "";
    choice.message = {
      role: "assistant",
      content: `${currentContent}${delta.content}`,
      ...(choice.message?.tool_calls ? { tool_calls: choice.message.tool_calls } : {}),
    };
    onContentDelta?.(delta.content);
  }
  if (delta.tool_calls?.length) {
    const toolCalls = choice.message?.tool_calls ?? [];
    appendToolCallDelta(toolCalls, delta.tool_calls);
    choice.message = {
      role: "assistant",
      content: choice.message?.content ?? null,
      tool_calls: toolCalls,
    };
  }
};

const finalizeStreamResponse = (response: AzureOpenAiChatResponse): AzureOpenAiChatResponse => {
  const choice = response.choices?.[0];
  if (!choice?.message) {
    throw new ProviderError("Azure OpenAI returned no completion message.");
  }
  if (!choice.message.tool_calls?.length) {
    choice.message.tool_calls = undefined;
  }
  if (choice.message.tool_calls?.length && choice.message.content === "") {
    choice.message.content = null;
  }
  return response;
};

const readAzureOpenAiStreamResponse = async (
  response: Response,
  onContentDelta?: (deltaContent: string) => void,
): Promise<AzureOpenAiChatResponse> => {
  if (!response.body) {
    throw new ProviderError("Azure OpenAI returned no response body for a streaming request.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const accumulated: AzureOpenAiChatResponse = {};
  let buffer = "";
  let streamDone = false;

  const processEventBlock = (block: string): void => {
    const payload = block
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!payload) {
      return;
    }
    if (payload === "[DONE]") {
      streamDone = true;
      return;
    }
    const chunk = JSON.parse(payload) as AzureOpenAiChatStreamChunk;
    applyStreamChunk(accumulated, chunk, onContentDelta);
  };

  while (!streamDone) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const normalizedBuffer = buffer.replace(/\r\n/g, "\n");
    const eventBlocks = normalizedBuffer.split("\n\n");
    buffer = eventBlocks.pop() ?? "";
    for (const block of eventBlocks) {
      processEventBlock(block);
      if (streamDone) {
        break;
      }
    }
    if (done) {
      if (buffer.trim().length > 0) {
        processEventBlock(buffer.replace(/\r\n/g, "\n"));
      }
      break;
    }
  }

  return finalizeStreamResponse(accumulated);
};

export const requestAzureOpenAiCompletion = async (
  config: AzureOpenAiClientConfig,
  state: AzureOpenAiSessionState,
  tools: readonly ProviderToolDefinition[],
  options: RequestAzureOpenAiCompletionOptions = {},
): Promise<AzureOpenAiChatResponse> => {
  const url = new URL(
    `${config.endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions`,
  );
  url.searchParams.set("api-version", config.apiVersion);

  const response = await (config.fetchFn ?? fetch)(url, {
    method: "POST",
    headers: {
      "api-key": config.apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messages: state.messages,
      stream: options.streaming === true,
      ...(tools.length > 0
        ? {
            tools: toAzureTools(tools),
            tool_choice: "auto",
          }
        : {}),
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ProviderError(
      `Azure OpenAI request failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`,
    );
  }

  if (options.streaming) {
    return readAzureOpenAiStreamResponse(response, options.onContentDelta);
  }

  return (await response.json()) as AzureOpenAiChatResponse;
};
