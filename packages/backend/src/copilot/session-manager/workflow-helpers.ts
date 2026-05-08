import type { AssistantState, WorkSessionPhase, WorkSessionSnapshot } from "@spira/shared";
import type { ProviderId, ProviderSessionEscalationResult } from "../../provider/types.js";
import type { RuntimeSessionContract, RuntimeWorkflowState } from "../../runtime/runtime-contract.js";
import { WORK_SESSION_WORKFLOW_PHASES } from "./shared.js";

type WorkflowPhase = RuntimeSessionContract["workflowState"]["phase"];
type WorkflowStatus = RuntimeSessionContract["workflowState"]["status"];
type WorkflowBlock = RuntimeSessionContract["workflowState"]["blockedBy"];
type WorkflowPhaseHistory = RuntimeSessionContract["workflowState"]["phaseHistory"];

export const shouldRestoreWorkSessionWorkflowState = (
  workflowState: RuntimeWorkflowState,
  activeWorkSession: WorkSessionSnapshot | null,
): boolean => {
  if (!activeWorkSession) {
    return false;
  }
  if (activeWorkSession.completedAt) {
    return true;
  }
  if (workflowState.phase === "complete" || workflowState.phase === "intake") {
    return true;
  }
  const workflowPhaseIndex = WORK_SESSION_WORKFLOW_PHASES.indexOf(workflowState.phase as WorkSessionPhase);
  const workSessionPhaseIndex = WORK_SESSION_WORKFLOW_PHASES.indexOf(activeWorkSession.currentPhase);
  return workflowPhaseIndex >= 0 && workSessionPhaseIndex >= 0 && workflowPhaseIndex <= workSessionPhaseIndex;
};

export const getOpenWorkflowPhaseIndex = (phaseHistory: WorkflowPhaseHistory, currentPhase: WorkflowPhase): number => {
  for (let index = phaseHistory.length - 1; index >= 0; index -= 1) {
    const candidate = phaseHistory[index];
    if (candidate?.phase === currentPhase && (candidate.completedAt ?? null) === null) {
      return index;
    }
  }
  for (let index = phaseHistory.length - 1; index >= 0; index -= 1) {
    if ((phaseHistory[index]?.completedAt ?? null) === null) {
      return index;
    }
  }
  return -1;
};

export const inferWorkflowPhaseForEscalation = (input: {
  workflowState: RuntimeWorkflowState;
  currentState: AssistantState;
  promptInFlight: boolean;
  activeToolCallCount: number;
}): WorkflowPhase => {
  if (input.workflowState.phase !== "intake" && input.workflowState.phase !== "complete") {
    return input.workflowState.phase;
  }
  const openPhaseIndex = getOpenWorkflowPhaseIndex(input.workflowState.phaseHistory, input.workflowState.phase);
  if (openPhaseIndex >= 0) {
    return input.workflowState.phaseHistory[openPhaseIndex]?.phase ?? input.workflowState.phase;
  }
  return input.currentState === "thinking" || input.promptInFlight || input.activeToolCallCount > 0
    ? "implement"
    : "plan";
};

export const upsertWorkflowPhaseHistoryEntry = (
  phaseHistory: WorkflowPhaseHistory,
  input: {
    phase: WorkflowPhase;
    status: WorkflowStatus;
    summary: string;
    providerId: ProviderId;
    model: string;
    occurredAt: number;
    blockedBy: WorkflowBlock;
  },
): WorkflowPhaseHistory => {
  let openPhaseIndex = -1;
  for (let index = phaseHistory.length - 1; index >= 0; index -= 1) {
    const candidate = phaseHistory[index];
    if (candidate?.phase === input.phase && (candidate.completedAt ?? null) === null) {
      openPhaseIndex = index;
      break;
    }
  }

  if (openPhaseIndex === -1) {
    return [
      ...phaseHistory,
      {
        phase: input.phase,
        status: input.status,
        summary: input.summary,
        providerId: input.providerId,
        model: input.model,
        startedAt: input.occurredAt,
        updatedAt: input.occurredAt,
        completedAt: input.status === "complete" ? input.occurredAt : null,
        blockedBy: input.blockedBy,
      },
    ];
  }

  return phaseHistory.map((entry, index) =>
    index !== openPhaseIndex
      ? entry
      : {
          ...entry,
          status: input.status,
          summary: input.summary,
          providerId: input.providerId,
          model: input.model,
          updatedAt: input.occurredAt,
          completedAt: input.status === "complete" ? input.occurredAt : null,
          blockedBy: input.blockedBy,
        },
  );
};

export const getEffectiveWorkflowBlock = (workflowState: RuntimeWorkflowState): WorkflowBlock => {
  if (workflowState.blockedBy) {
    return workflowState.blockedBy;
  }
  const openPhaseIndex = getOpenWorkflowPhaseIndex(workflowState.phaseHistory, workflowState.phase);
  return openPhaseIndex >= 0 ? (workflowState.phaseHistory[openPhaseIndex]?.blockedBy ?? null) : null;
};

export const buildWorkflowReviewState = (input: {
  workflowState: RuntimeWorkflowState;
  status: RuntimeWorkflowState["review"]["status"];
  origin?: RuntimeWorkflowState["review"]["origin"];
  summary?: string | null;
  failureReason?: string | null;
  runId?: string | null;
  attempt?: number;
  occurredAt: number;
  providerId: ProviderId;
  model: string;
}): RuntimeWorkflowState => {
  const reviewSummary =
    input.summary ??
    (input.status === "running"
      ? "Review running."
      : input.status === "completed"
        ? "Review completed."
        : input.status === "relaunching"
          ? "Relaunching review."
          : input.status === "missing"
            ? "Review run is missing."
            : input.status === "stalled"
              ? "Review appears stalled."
              : "Review failed.");
  const failureReason =
    input.status === "failed" || input.status === "missing" || input.status === "stalled"
      ? (input.failureReason ?? reviewSummary)
      : null;
  const blockedBy =
    input.status === "failed" || input.status === "missing" || input.status === "stalled"
      ? {
          kind: "review" as const,
          reason: failureReason ?? reviewSummary,
          pendingRequestIds: [],
          blockedAt: input.occurredAt,
        }
      : null;
  const workflowStatus =
    input.status === "completed"
      ? "complete"
      : input.status === "stalled"
        ? "stalled"
        : blockedBy
          ? "blocked"
          : "active";

  return {
    ...input.workflowState,
    phase: "review",
    status: workflowStatus,
    summary: reviewSummary,
    updatedAt: input.occurredAt,
    blockedBy,
    phaseHistory: upsertWorkflowPhaseHistoryEntry(input.workflowState.phaseHistory, {
      phase: "review",
      status: workflowStatus,
      summary: reviewSummary,
      providerId: input.providerId,
      model: input.model,
      occurredAt: input.occurredAt,
      blockedBy,
    }),
    review: {
      ...input.workflowState.review,
      status: input.status,
      attempt: input.attempt ?? input.workflowState.review.attempt,
      runId: input.runId === undefined ? (input.workflowState.review.runId ?? null) : input.runId,
      ...(input.origin !== undefined ? { origin: input.origin } : {}),
      summary: reviewSummary,
      failureReason,
      lastUpdatedAt: input.occurredAt,
    },
  };
};

export const syncOpenWorkflowPhaseEntryBlocking = (
  phaseHistory: WorkflowPhaseHistory,
  currentPhase: WorkflowPhase,
  status: WorkflowStatus,
  blockedBy: WorkflowBlock,
  updatedAt: number,
): WorkflowPhaseHistory => {
  const openPhaseIndex = getOpenWorkflowPhaseIndex(phaseHistory, currentPhase);
  if (openPhaseIndex === -1) {
    return phaseHistory;
  }

  return phaseHistory.map((entry, index) =>
    index !== openPhaseIndex
      ? entry
      : {
          ...entry,
          status,
          updatedAt,
          blockedBy,
        },
  );
};

export const clearOpenWorkflowPhaseEntryBlocking = (
  phaseHistory: WorkflowPhaseHistory,
  currentPhase: WorkflowPhase,
  updatedAt: number,
): WorkflowPhaseHistory => {
  const openPhaseIndex = getOpenWorkflowPhaseIndex(phaseHistory, currentPhase);
  if (openPhaseIndex === -1) {
    return phaseHistory;
  }

  return phaseHistory.map((entry, index) =>
    index !== openPhaseIndex
      ? entry
      : {
          ...entry,
          status: (entry.completedAt ?? null) !== null ? "complete" : "active",
          updatedAt,
          blockedBy: null,
        },
  );
};

export const buildWorkflowStateForSessionEscalation = (input: {
  workflowState: RuntimeWorkflowState;
  result: ProviderSessionEscalationResult;
  currentState: AssistantState;
  promptInFlight: boolean;
  activeToolCallCount: number;
  pendingRequestIds: string[];
  occurredAt: number;
  handoffId: string;
}): RuntimeWorkflowState => {
  const phase = inferWorkflowPhaseForEscalation({
    workflowState: input.workflowState,
    currentState: input.currentState,
    promptInFlight: input.promptInFlight,
    activeToolCallCount: input.activeToolCallCount,
  });
  const currentBlock = getEffectiveWorkflowBlock(input.workflowState);
  const existingNonApprovalBlock = currentBlock && currentBlock.kind !== "approval" ? currentBlock : null;
  const blockedBy =
    input.pendingRequestIds.length > 0 && !existingNonApprovalBlock
      ? {
          kind: "approval" as const,
          reason: "Permission request is pending while the escalated session continues the active phase.",
          pendingRequestIds: input.pendingRequestIds,
          blockedAt: input.occurredAt,
        }
      : existingNonApprovalBlock;
  const status = blockedBy ? "blocked" : "active";
  const summary =
    blockedBy && blockedBy.kind !== "approval"
      ? input.result.status === "already-escalated"
        ? `Escalation target ${input.result.toModel} already active; ${phase} remains blocked by ${blockedBy.kind}.`
        : `Escalated from ${input.result.fromModel ?? "provider default"} to ${input.result.toModel}; ${phase} remains blocked by ${blockedBy.kind}.`
      : input.result.status === "already-escalated"
        ? `Escalation target ${input.result.toModel} already active; continuing ${phase}.`
        : `Escalated from ${input.result.fromModel ?? "provider default"} to ${input.result.toModel}; continuing ${phase}.`;

  return {
    ...input.workflowState,
    phase,
    status,
    summary,
    updatedAt: input.occurredAt,
    phaseHistory: upsertWorkflowPhaseHistoryEntry(input.workflowState.phaseHistory, {
      phase,
      status,
      summary,
      providerId: input.result.providerId,
      model: input.result.toModel,
      occurredAt: input.occurredAt,
      blockedBy,
    }),
    handoffs:
      input.result.status === "escalated"
        ? [
            ...input.workflowState.handoffs,
            {
              handoffId: input.handoffId,
              kind: "model-escalation" as const,
              phase,
              reason: "manual-session-escalation",
              continuationMode: blockedBy ? "blocked" : "continue-current-phase",
              occurredAt: input.occurredAt,
              fromProviderId: input.result.providerId,
              toProviderId: input.result.providerId,
              fromModel: input.result.fromModel,
              toModel: input.result.toModel,
            },
          ]
        : input.workflowState.handoffs,
    blockedBy,
  };
};
