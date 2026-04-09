import type { AssistantState, SpiraUiAssistantDockSummary, SpiraUiView } from "@spira/shared";
import type { ChatMessage, ToolCallEntry } from "./stores/chat-store.js";
import { shouldDisplayToolName } from "./tool-display.js";

const ACTIVE_TOOL_STATUSES = new Set<ToolCallEntry["status"]>(["pending", "running"]);

const WORKING_STATE_COPY: Partial<Record<AssistantState, string>> = {
  listening: "Listening for input",
  transcribing: "Transcribing audio",
  thinking: "Preparing response",
  speaking: "Delivering response",
  error: "Attention required",
};

const clampText = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;

const formatAssistantStateLabel = (state: AssistantState): string => state.charAt(0).toUpperCase() + state.slice(1);

const formatToolName = (toolName: string): string =>
  toolName
    .split(/[_-]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const summarizeToolDetail = (details?: string): string | undefined => {
  if (!details) {
    return undefined;
  }

  const firstLine = details
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .find(Boolean);
  if (!firstLine || firstLine.startsWith("{") || firstLine.startsWith("[")) {
    return undefined;
  }

  return clampText(firstLine.replace(/[.;:,]+$/, ""), 88);
};

const findLastMatchingIndex = (messages: ChatMessage[], predicate: (message: ChatMessage) => boolean): number => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (predicate(messages[index])) {
      return index;
    }
  }

  return -1;
};

const getLatestAssistantMessage = (messages: ChatMessage[]): ChatMessage | undefined => {
  const trailingMessage = messages.at(-1);
  if (trailingMessage?.role === "assistant") {
    return trailingMessage;
  }

  return [...messages].reverse().find((message) => message.role === "assistant");
};

const getLatestActiveToolCall = (message?: ChatMessage): ToolCallEntry | undefined =>
  [...(message?.toolCalls ?? [])]
    .reverse()
    .find((entry) => shouldDisplayToolName(entry.name) && ACTIVE_TOOL_STATUSES.has(entry.status));

const summarizeResponsePreview = (content: string): string | undefined => {
  const normalized = normalizeWhitespace(content);
  return normalized ? clampText(normalized, 220) : undefined;
};

export interface ShinraStatusContext {
  lastAssistantMessage?: ChatMessage;
  hasCurrentResponse: boolean;
  isResponseState: boolean;
  stateLabel: string;
  workSummary?: string;
  statusLine: string;
}

export const getShinraStatusContext = ({
  assistantState,
  isStreaming,
  messages,
}: {
  assistantState: AssistantState;
  isStreaming: boolean;
  messages: ChatMessage[];
}): ShinraStatusContext => {
  const lastAssistantMessage = getLatestAssistantMessage(messages);
  const lastAssistantIndex = lastAssistantMessage
    ? findLastMatchingIndex(messages, (message) => message.id === lastAssistantMessage.id)
    : -1;
  const lastUserIndex = findLastMatchingIndex(messages, (message) => message.role === "user");
  const isResponseState = assistantState === "thinking" || assistantState === "speaking" || isStreaming;
  const hasCurrentResponse = Boolean(lastAssistantMessage?.content.trim()) && lastAssistantIndex > lastUserIndex;
  const activeToolCall = getLatestActiveToolCall(lastAssistantMessage);
  const toolSummary = activeToolCall
    ? (summarizeToolDetail(activeToolCall.details) ??
      `${activeToolCall.status === "pending" ? "Queueing" : "Running"} ${formatToolName(activeToolCall.name)}`)
    : undefined;
  const workSummary = toolSummary ?? WORKING_STATE_COPY[assistantState];
  const stateLabel = formatAssistantStateLabel(assistantState);

  return {
    lastAssistantMessage,
    hasCurrentResponse,
    isResponseState,
    stateLabel,
    workSummary,
    statusLine: workSummary ? `${stateLabel} - ${workSummary}` : `${stateLabel} - Standing by`,
  };
};

export const buildAssistantDockSummary = ({
  activeView,
  assistantState,
  isStreaming,
  messages,
}: {
  activeView: SpiraUiView;
  assistantState: AssistantState;
  isStreaming: boolean;
  messages: ChatMessage[];
}): SpiraUiAssistantDockSummary => {
  const context = getShinraStatusContext({ assistantState, isStreaming, messages });
  const visible = activeView !== "bridge";

  return {
    visible,
    expanded: visible && context.isResponseState && context.hasCurrentResponse,
    workSummary: context.workSummary,
    responsePreview: context.hasCurrentResponse
      ? summarizeResponsePreview(context.lastAssistantMessage?.content ?? "")
      : undefined,
  };
};
