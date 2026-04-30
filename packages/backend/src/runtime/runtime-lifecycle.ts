import { randomUUID } from "node:crypto";
import type { PermissionRequestPayload } from "@spira/shared";
import type { ProviderPermissionResult } from "../provider/types.js";
import {
  createRuntimeLedgerEvent,
  type RuntimeCheckpointPayload,
  type RuntimeLedgerEvent,
  type RuntimeSessionContract,
} from "./runtime-contract.js";
import type { RuntimeStore } from "./runtime-store.js";

const appendLifecycleEvent = (
  runtimeStore: RuntimeStore | null | undefined,
  event: RuntimeLedgerEvent,
): RuntimeLedgerEvent | null => runtimeStore?.appendRuntimeLedgerEvent(createRuntimeLedgerEvent(event)) ?? null;

export const appendRuntimeLifecycleEvent = (
  runtimeStore: RuntimeStore | null | undefined,
  runtimeSessionId: string | null,
  event: Omit<RuntimeLedgerEvent, "sessionId"> | null,
): RuntimeLedgerEvent | null => {
  if (!runtimeStore || !runtimeSessionId || !event) {
    return null;
  }

  return appendLifecycleEvent(runtimeStore, {
    ...event,
    sessionId: runtimeSessionId,
  } as RuntimeLedgerEvent);
};

export const recordRuntimeSessionCreated = (
  runtimeStore: RuntimeStore | null | undefined,
  input: {
    runtimeSessionId: string;
    kind: RuntimeSessionContract["kind"];
    scope: RuntimeSessionContract["scope"];
    hostManifestHash: string;
    providerProjectionHash: string;
    providerId: RuntimeSessionContract["providerBinding"]["providerId"];
    occurredAt: number;
  },
): RuntimeLedgerEvent | null =>
  appendLifecycleEvent(runtimeStore, {
    eventId: randomUUID(),
    sessionId: input.runtimeSessionId,
    occurredAt: input.occurredAt,
    type: "session.created",
    payload: {
      kind: input.kind,
      scope: input.scope,
      hostManifestHash: input.hostManifestHash,
      providerProjectionHash: input.providerProjectionHash,
      providerId: input.providerId,
    },
  });

export const recordRuntimeUserMessage = (
  runtimeStore: RuntimeStore | null | undefined,
  runtimeSessionId: string | null,
  input: {
    messageId: string;
    content: string;
    occurredAt: number;
  },
): RuntimeLedgerEvent | null =>
  appendRuntimeLifecycleEvent(runtimeStore, runtimeSessionId, {
    eventId: randomUUID(),
    occurredAt: input.occurredAt,
    type: "user.message",
    payload: {
      messageId: input.messageId,
      content: input.content,
    },
  });

export const recordRuntimeTurnStateChanged = (
  runtimeStore: RuntimeStore | null | undefined,
  runtimeSessionId: string | null,
  input: {
    turnState: RuntimeSessionContract["turnState"];
    occurredAt: number;
  },
): RuntimeLedgerEvent | null =>
  appendRuntimeLifecycleEvent(runtimeStore, runtimeSessionId, {
    eventId: randomUUID(),
    occurredAt: input.occurredAt,
    type: "turn.state_changed",
    payload: input.turnState,
  });

export const recordRuntimeAssistantMessageDelta = (
  runtimeStore: RuntimeStore | null | undefined,
  runtimeSessionId: string | null,
  input: {
    messageId: string;
    deltaContent: string;
    occurredAt: number;
  },
): RuntimeLedgerEvent | null =>
  appendRuntimeLifecycleEvent(runtimeStore, runtimeSessionId, {
    eventId: randomUUID(),
    occurredAt: input.occurredAt,
    type: "assistant.message_delta",
    payload: {
      messageId: input.messageId,
      deltaContent: input.deltaContent,
    },
  });

export const recordRuntimeAssistantMessage = (
  runtimeStore: RuntimeStore | null | undefined,
  runtimeSessionId: string | null,
  input: {
    messageId: string;
    content: string;
    occurredAt: number;
  },
): RuntimeLedgerEvent | null =>
  appendRuntimeLifecycleEvent(runtimeStore, runtimeSessionId, {
    eventId: randomUUID(),
    occurredAt: input.occurredAt,
    type: "assistant.message",
    payload: {
      messageId: input.messageId,
      content: input.content,
    },
  });

export const recordRuntimeToolExecutionStarted = (
  runtimeStore: RuntimeStore | null | undefined,
  runtimeSessionId: string | null,
  input: {
    toolCallId: string;
    toolName: string;
    arguments?: Record<string, unknown>;
    occurredAt: number;
  },
): RuntimeLedgerEvent | null =>
  appendRuntimeLifecycleEvent(runtimeStore, runtimeSessionId, {
    eventId: randomUUID(),
    occurredAt: input.occurredAt,
    type: "tool.execution_started",
    payload: {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      ...(input.arguments ? { arguments: input.arguments } : {}),
    },
  });

export const recordRuntimeToolExecutionCompleted = (
  runtimeStore: RuntimeStore | null | undefined,
  runtimeSessionId: string | null,
  input: {
    toolCallId: string;
    toolName?: string;
    success: boolean;
    result?: unknown;
    errorMessage?: string;
    occurredAt: number;
  },
): RuntimeLedgerEvent | null =>
  appendRuntimeLifecycleEvent(runtimeStore, runtimeSessionId, {
    eventId: randomUUID(),
    occurredAt: input.occurredAt,
    type: "tool.execution_completed",
    payload: {
      toolCallId: input.toolCallId,
      ...(input.toolName ? { toolName: input.toolName } : {}),
      success: input.success,
      ...(input.result !== undefined ? { result: input.result } : {}),
      ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    },
  });

export const recordRuntimeProviderBound = (
  runtimeStore: RuntimeStore | null | undefined,
  runtimeSessionId: string | null,
  input: {
    bindingRevision: number;
    providerId: RuntimeSessionContract["providerBinding"]["providerId"];
    providerSessionId: string | null;
    hostManifestHash: string;
    projectionHash: string;
    checkpointId: string | null;
    occurredAt: number;
  },
): RuntimeLedgerEvent | null =>
  appendRuntimeLifecycleEvent(runtimeStore, runtimeSessionId, {
    eventId: randomUUID(),
    occurredAt: input.occurredAt,
    type: "provider.bound",
    payload: {
      bindingRevision: input.bindingRevision,
      providerId: input.providerId,
      providerSessionId: input.providerSessionId,
      hostManifestHash: input.hostManifestHash,
      projectionHash: input.projectionHash,
      checkpointId: input.checkpointId,
    },
  });

export const recordRuntimeRecoveryCompleted = (
  runtimeStore: RuntimeStore | null | undefined,
  runtimeSessionId: string | null,
  input: {
    recoveredFrom: "provider-session" | "host-checkpoint" | "continuity-preamble";
    success: boolean;
    occurredAt: number;
  },
): RuntimeLedgerEvent | null =>
  appendRuntimeLifecycleEvent(runtimeStore, runtimeSessionId, {
    eventId: randomUUID(),
    occurredAt: input.occurredAt,
    type: "recovery.completed",
    payload: {
      recoveredFrom: input.recoveredFrom,
      success: input.success,
    },
  });

export const recordRuntimePermissionRequested = (
  runtimeStore: RuntimeStore | null | undefined,
  runtimeSessionId: string | null,
  payload: PermissionRequestPayload,
  occurredAt: number,
): RuntimeLedgerEvent | null =>
  appendRuntimeLifecycleEvent(runtimeStore, runtimeSessionId, {
    eventId: randomUUID(),
    occurredAt,
    type: "permission.requested",
    payload,
  });

export const toRuntimePermissionResolutionStatus = (
  result: ProviderPermissionResult,
): "approved" | "denied" | "expired" =>
  result.kind === "approve-once" ? "approved" : result.kind === "reject" ? "denied" : "expired";

export const recordRuntimePermissionResolved = (
  runtimeStore: RuntimeStore | null | undefined,
  runtimeSessionId: string | null,
  input: {
    requestId: string;
    status: "approved" | "denied" | "expired";
    occurredAt: number;
  },
): RuntimeLedgerEvent | null =>
  appendRuntimeLifecycleEvent(runtimeStore, runtimeSessionId, {
    eventId: randomUUID(),
    occurredAt: input.occurredAt,
    type: "permission.resolved",
    payload: {
      requestId: input.requestId,
      status: input.status,
    },
  });

export const recordRuntimeCancellationRequested = (
  runtimeStore: RuntimeStore | null | undefined,
  runtimeSessionId: string | null,
  input: {
    mode: RuntimeSessionContract["cancellationPolicy"];
    requestedAt: number;
  },
): RuntimeLedgerEvent | null =>
  appendRuntimeLifecycleEvent(runtimeStore, runtimeSessionId, {
    eventId: randomUUID(),
    occurredAt: input.requestedAt,
    type: "cancellation.requested",
    payload: {
      mode: input.mode,
      requestedAt: input.requestedAt,
    },
  });

export const recordRuntimeCancellationCompleted = (
  runtimeStore: RuntimeStore | null | undefined,
  runtimeSessionId: string | null,
  input: {
    mode: RuntimeSessionContract["cancellationPolicy"];
    completedAt: number;
  },
): RuntimeLedgerEvent | null =>
  appendRuntimeLifecycleEvent(runtimeStore, runtimeSessionId, {
    eventId: randomUUID(),
    occurredAt: input.completedAt,
    type: "cancellation.completed",
    payload: {
      mode: input.mode,
      completedAt: input.completedAt,
    },
  });

export const recordRuntimeUsageObserved = (
  runtimeStore: RuntimeStore | null | undefined,
  runtimeSessionId: string | null,
  input: {
    model: string | null;
    totalTokens: number | null;
    source: "provider" | "estimated" | "unknown";
    observedAt: number;
  },
): RuntimeLedgerEvent | null =>
  appendRuntimeLifecycleEvent(runtimeStore, runtimeSessionId, {
    eventId: randomUUID(),
    occurredAt: input.observedAt,
    type: "usage.recorded",
    payload: {
      model: input.model,
      totalTokens: input.totalTokens,
      lastObservedAt: input.observedAt,
      source: input.source,
    },
  });

export const persistRuntimeCheckpointLifecycle = (
  runtimeStore: RuntimeStore | null | undefined,
  input: {
    runtimeSessionId: string;
    checkpoint: RuntimeCheckpointPayload;
    scope?: { stationId?: string | null; runId?: string | null };
    persistCheckpointRef: (checkpointRef: RuntimeSessionContract["checkpointRef"]) => RuntimeSessionContract | null;
  },
): RuntimeCheckpointPayload | null => {
  if (!runtimeStore) {
    return null;
  }

  runtimeStore.persistRuntimeCheckpoint(input.runtimeSessionId, input.checkpoint, input.scope);
  input.persistCheckpointRef({
    checkpointId: input.checkpoint.checkpointId,
    kind: input.checkpoint.kind,
    createdAt: input.checkpoint.createdAt,
  });
  appendRuntimeLifecycleEvent(runtimeStore, input.runtimeSessionId, {
    eventId: randomUUID(),
    occurredAt: input.checkpoint.createdAt,
    type: "checkpoint.created",
    payload: input.checkpoint,
  });
  return input.checkpoint;
};
