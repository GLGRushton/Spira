import type {
  RuntimeCancellationState,
  RuntimePermissionState,
  RuntimeTurnContract,
} from "./runtime-contract.js";
import { deriveRuntimeTurnState } from "./runtime-turn-engine.js";

export const buildRuntimeTurnContract = (input: {
  isThinking: boolean;
  activeToolCallIds: string[];
  lastUserMessageId: string | null;
  lastAssistantMessageId: string | null;
  waitingForPermission?: boolean;
  isError?: boolean;
  isCancelled?: boolean;
  isCompleted?: boolean;
}): RuntimeTurnContract => ({
  state:
    input.isError
      ? "error"
      : input.isCompleted
        ? "completed"
        : input.isCancelled
          ? "cancelled"
          : input.waitingForPermission
            ? "waiting_for_permission"
            : deriveRuntimeTurnState({
                isThinking: input.isThinking,
                activeToolCallCount: input.activeToolCallIds.length,
              }),
  activeToolCallIds: [...input.activeToolCallIds],
  lastUserMessageId: input.lastUserMessageId,
  lastAssistantMessageId: input.lastAssistantMessageId,
});

export const buildRuntimePermissionState = (input: {
  pendingRequestIds: string[];
  lastResolvedAt: number | null;
  defaultStatus?: RuntimePermissionState["status"];
}): RuntimePermissionState => ({
  status:
    input.pendingRequestIds.length > 0
      ? "pending"
      : input.defaultStatus ?? (input.lastResolvedAt !== null ? "resolved" : "idle"),
  pendingRequestIds: [...input.pendingRequestIds],
  lastResolvedAt: input.lastResolvedAt,
});

export const buildRuntimeCancellationState = (input: {
  requestedAt: number | null;
  completedAt: number | null;
  completed?: boolean;
}): Omit<RuntimeCancellationState, "mode"> => ({
  status: input.requestedAt ? "requested" : input.completed ? "completed" : "idle",
  requestedAt: input.requestedAt,
  completedAt: input.completedAt,
});

export const requestRuntimeCancellation = (requestedAt: number): {
  requestedAt: number;
  completedAt: null;
} => ({
  requestedAt,
  completedAt: null,
});

export const completeRuntimeCancellation = (completedAt: number): {
  requestedAt: null;
  completedAt: number;
} => ({
  requestedAt: null,
  completedAt,
});
