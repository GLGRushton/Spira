import { StreamAssembler } from "./stream-handler.js";
import type { ProviderSessionEvent, ProviderUsageSnapshot } from "../provider/types.js";
import {
  createRuntimeCheckpointPayload,
  type RuntimeCheckpointPayload,
  type RuntimeSessionContract,
  type RuntimeTurnState,
} from "./runtime-contract.js";

export const appendAssistantDelta = (
  streamAssembler: StreamAssembler,
  messageId: string,
  deltaContent: string,
): void => {
  streamAssembler.append(messageId, deltaContent);
};

export const finalizeAssistantMessage = (
  streamAssembler: StreamAssembler,
  messageId: string,
  content: string,
): string => content || streamAssembler.finalize(messageId) || "";

export const registerToolExecutionStart = <TActiveToolCall>(
  activeToolCalls: Map<string, TActiveToolCall>,
  toolCallId: string,
  activeToolCall: TActiveToolCall,
): TActiveToolCall => {
  activeToolCalls.set(toolCallId, activeToolCall);
  return activeToolCall;
};

export const registerToolExecutionComplete = <TActiveToolCall, TToolRecord>(
  activeToolCalls: Map<string, TActiveToolCall>,
  toolCallId: string,
  buildToolRecord: (activeToolCall: TActiveToolCall | undefined) => TToolRecord,
): TToolRecord => {
  const activeToolCall = activeToolCalls.get(toolCallId);
  const toolRecord = buildToolRecord(activeToolCall);
  activeToolCalls.delete(toolCallId);
  return toolRecord;
};

export const flushErroredToolExecutions = <TActiveToolCall, TToolRecord>(
  activeToolCalls: Map<string, TActiveToolCall>,
  buildToolRecord: (toolCallId: string, activeToolCall: TActiveToolCall) => TToolRecord,
): TToolRecord[] => {
  const toolRecords: TToolRecord[] = [];
  for (const [toolCallId, activeToolCall] of activeToolCalls.entries()) {
    toolRecords.push(buildToolRecord(toolCallId, activeToolCall));
  }
  activeToolCalls.clear();
  return toolRecords;
};

export const normalizeTurnUsage = (
  currentUsage: ProviderUsageSnapshot | undefined,
  nextUsage: Partial<ProviderUsageSnapshot> | null | undefined,
  normalizeUsage: (snapshot: Partial<ProviderUsageSnapshot> | null | undefined) => ProviderUsageSnapshot,
): ProviderUsageSnapshot => normalizeUsage(nextUsage ?? currentUsage);

export const shouldResolveTurnCompletion = (
  latestAssistantText: string | undefined,
  idleObserved: boolean,
  activeToolCallCount: number,
): latestAssistantText is string => latestAssistantText !== undefined && idleObserved && activeToolCallCount === 0;

export const deriveRuntimeTurnState = (input: {
  isThinking: boolean;
  activeToolCallCount: number;
  isError?: boolean;
  isCancelled?: boolean;
  isCompleted?: boolean;
}): RuntimeTurnState => {
  if (input.isError) {
    return "error";
  }
  if (input.isCompleted) {
    return "completed";
  }
  if (input.isCancelled) {
    return "cancelled";
  }
  if (input.isThinking) {
    return input.activeToolCallCount > 0 ? "executing_tool" : "thinking";
  }
  return "idle";
};

export const createRuntimeCheckpointFromContract = (input: {
  checkpointId: string;
  kind: RuntimeCheckpointPayload["kind"];
  createdAt: number;
  summary: string;
  defaultSummary: string;
  contract: RuntimeSessionContract;
}): RuntimeCheckpointPayload =>
  createRuntimeCheckpointPayload({
    checkpointId: input.checkpointId,
    kind: input.kind,
    createdAt: input.createdAt,
    summary: input.summary.trim().slice(0, 500) || input.defaultSummary,
    artifactRefs: input.contract.artifactRefs,
    turnState: input.contract.turnState,
    permissionState: input.contract.permissionState,
    cancellationState: input.contract.cancellationState,
    usageSummary: input.contract.usageSummary,
    providerBinding: input.contract.providerBinding,
  });

export type SharedTurnEventState<TActiveToolCall> = {
  streamAssembler: StreamAssembler;
  activeToolCalls: Map<string, TActiveToolCall>;
  latestUsage: ProviderUsageSnapshot | undefined;
  latestAssistantText: string | undefined;
  lastAssistantMessageId: string | null;
  idleObserved: boolean;
};

export const updateRuntimeUsageSummary = (
  currentSummary: RuntimeSessionContract["usageSummary"],
  usage: ProviderUsageSnapshot,
  observedAt: number,
): RuntimeSessionContract["usageSummary"] => ({
  model: usage.model ?? currentSummary.model,
  totalTokens: usage.totalTokens ?? currentSummary.totalTokens,
  lastObservedAt: observedAt,
  source: usage.source,
});

export const settleTurnCompletionIfReady = (input: {
  completionSettled: boolean;
  latestAssistantText: string | undefined;
  idleObserved: boolean;
  activeToolCallCount: number;
  settle: (assistantText: string) => void;
}): boolean => {
  if (
    input.completionSettled ||
    !shouldResolveTurnCompletion(input.latestAssistantText, input.idleObserved, input.activeToolCallCount)
  ) {
    return false;
  }

  input.settle(input.latestAssistantText);
  return true;
};

export const handleSharedTurnEvent = <TActiveToolCall, TToolRecord>(input: {
  state: SharedTurnEventState<TActiveToolCall>;
  event: ProviderSessionEvent;
  now: () => number;
  normalizeUsage: (snapshot: Partial<ProviderUsageSnapshot> | null | undefined) => ProviderUsageSnapshot;
  createActiveToolCall: (
    event: Extract<ProviderSessionEvent, { type: "tool.execution_start" }>,
    occurredAt: number,
  ) => TActiveToolCall;
  buildToolRecord: (
    activeToolCall: TActiveToolCall | undefined,
    event: Extract<ProviderSessionEvent, { type: "tool.execution_complete" }>,
    occurredAt: number,
  ) => TToolRecord;
  onAssistantDelta?: (
    event: Extract<ProviderSessionEvent, { type: "assistant.message_delta" }>,
    occurredAt: number,
  ) => void;
  onAssistantMessage?: (
    event: Extract<ProviderSessionEvent, { type: "assistant.message" }>,
    fullText: string,
    occurredAt: number,
  ) => void;
  onToolExecutionStart?: (
    event: Extract<ProviderSessionEvent, { type: "tool.execution_start" }>,
    activeToolCall: TActiveToolCall,
    occurredAt: number,
  ) => void;
  onToolExecutionComplete?: (
    event: Extract<ProviderSessionEvent, { type: "tool.execution_complete" }>,
    toolRecord: TToolRecord,
    occurredAt: number,
  ) => void;
  onAssistantUsage?: (
    usage: ProviderUsageSnapshot,
    event: Extract<ProviderSessionEvent, { type: "assistant.usage" }>,
    occurredAt: number,
  ) => void;
  onSessionIdle?: (
    usage: ProviderUsageSnapshot,
    event: Extract<ProviderSessionEvent, { type: "session.idle" }>,
    occurredAt: number,
  ) => void;
  onTurnReady?: (assistantText: string) => void;
}): boolean => {
  const occurredAt = input.now();
  switch (input.event.type) {
    case "assistant.message_delta":
      appendAssistantDelta(
        input.state.streamAssembler,
        input.event.data.messageId,
        input.event.data.deltaContent,
      );
      input.state.lastAssistantMessageId = input.event.data.messageId;
      input.onAssistantDelta?.(input.event, occurredAt);
      return true;

    case "assistant.message": {
      const fullText = finalizeAssistantMessage(
        input.state.streamAssembler,
        input.event.data.messageId,
        input.event.data.content,
      );
      input.state.lastAssistantMessageId = input.event.data.messageId;
      input.state.latestAssistantText = fullText;
      input.onAssistantMessage?.(input.event, fullText, occurredAt);
      if (
        input.onTurnReady &&
        shouldResolveTurnCompletion(
          input.state.latestAssistantText,
          input.state.idleObserved,
          input.state.activeToolCalls.size,
        )
      ) {
        input.onTurnReady(fullText);
      }
      return true;
    }

    case "tool.execution_start": {
      const activeToolCall = registerToolExecutionStart(
        input.state.activeToolCalls,
        input.event.data.toolCallId,
        input.createActiveToolCall(input.event, occurredAt),
      );
      input.onToolExecutionStart?.(input.event, activeToolCall, occurredAt);
      return true;
    }

    case "tool.execution_complete": {
      const completeEvent = input.event;
      const toolRecord = registerToolExecutionComplete(
        input.state.activeToolCalls,
        completeEvent.data.toolCallId,
        (activeToolCall) => input.buildToolRecord(activeToolCall, completeEvent, occurredAt),
      );
      input.onToolExecutionComplete?.(completeEvent, toolRecord, occurredAt);
      if (
        input.onTurnReady &&
        shouldResolveTurnCompletion(
          input.state.latestAssistantText,
          input.state.idleObserved,
          input.state.activeToolCalls.size,
        )
      ) {
        input.onTurnReady(input.state.latestAssistantText);
      }
      return true;
    }

    case "assistant.usage": {
      const usage = normalizeTurnUsage(input.state.latestUsage, input.event.data, input.normalizeUsage);
      input.state.latestUsage = usage;
      input.onAssistantUsage?.(usage, input.event, occurredAt);
      return true;
    }

    case "session.idle": {
      input.state.idleObserved = true;
      const usage = normalizeTurnUsage(input.state.latestUsage, input.event.data.usage, input.normalizeUsage);
      input.state.latestUsage = usage;
      input.onSessionIdle?.(usage, input.event, occurredAt);
      if (
        input.onTurnReady &&
        shouldResolveTurnCompletion(
          input.state.latestAssistantText,
          input.state.idleObserved,
          input.state.activeToolCalls.size,
        )
      ) {
        input.onTurnReady(input.state.latestAssistantText);
      }
      return true;
    }

    default:
      return false;
  }
};
