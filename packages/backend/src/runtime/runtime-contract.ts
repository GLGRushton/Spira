import { getProviderRuntimeFallbackPolicy } from "../provider/capability-fallback.js";
import type { PermissionRequestPayload } from "@spira/shared";
import type {
  ProviderCapabilities,
  ProviderId,
  ProviderModelSelectionMode,
  ProviderSessionResumptionMode,
  ProviderToolCallingMode,
  ProviderToolManifestMode,
  ProviderTurnCancellationMode,
} from "../provider/types.js";

export const RUNTIME_SESSION_KINDS = ["station", "subagent", "background"] as const;
export type RuntimeSessionKind = (typeof RUNTIME_SESSION_KINDS)[number];

export const RUNTIME_TURN_STATES = [
  "idle",
  "thinking",
  "streaming",
  "waiting_for_permission",
  "executing_tool",
  "completed",
  "cancelled",
  "error",
] as const;
export type RuntimeTurnState = (typeof RUNTIME_TURN_STATES)[number];

export const RUNTIME_ARTIFACT_KINDS = ["plan", "scratchpad", "context"] as const;
export type RuntimeArtifactKind = (typeof RUNTIME_ARTIFACT_KINDS)[number];

export const RUNTIME_CAPABILITY_SOURCES = [
  "host-tool",
  "host-resource",
  "mcp-tool",
  "synthetic-tool",
  "storage-tool",
  "mission-tool",
  "delegation-tool",
] as const;
export type RuntimeCapabilitySource = (typeof RUNTIME_CAPABILITY_SOURCES)[number];

export type RuntimeCapabilityDefinition = {
  capabilityId: string;
  displayName: string;
  source: RuntimeCapabilitySource;
  description: string;
  permissionMode: "read" | "write";
  requiresApproval: boolean;
};

export const PROVIDER_MANIFEST_PROJECTION_ACTIONS = [
  "expose-host-tool",
  "use-provider-built-in",
  "suppress-duplicate",
  "rename-host-tool",
] as const;
export type ProviderManifestProjectionAction = (typeof PROVIDER_MANIFEST_PROJECTION_ACTIONS)[number];

export type ProviderManifestProjectionRule = {
  capabilityId: string;
  providerId: ProviderId;
  action: ProviderManifestProjectionAction;
  preservesCapabilitySemantics: boolean;
  rationale: string;
  providerToolName?: string;
};

export type RuntimeProviderBinding = {
  providerId: ProviderId;
  model: string | null;
  providerSessionId: string | null;
  manifestMode: ProviderToolManifestMode;
  hostManifestHash: string;
  projectionHash: string;
  bindingRevision: number;
  boundAt: number;
  resumedAt?: number | null;
  terminatedAt?: number | null;
};

export type RuntimeSessionScopeRef = {
  stationId?: string | null;
  runId?: string | null;
  roomId?: string | null;
};

export type RuntimeArtifactRef = {
  kind: RuntimeArtifactKind;
  storageKey: string;
  updatedAt?: number | null;
};

export type RuntimeCheckpointRef = {
  checkpointId: string;
  kind: "session-summary" | "turn-snapshot";
  createdAt: number;
};

export type RuntimeCheckpointPayload = RuntimeCheckpointRef & {
  summary: string;
  artifactRefs: RuntimeArtifactRef[];
  turnState: RuntimeTurnContract;
  permissionState: RuntimePermissionState;
  cancellationState: RuntimeCancellationState;
  usageSummary: RuntimeUsageSummary;
  providerBinding: RuntimeProviderBinding;
};

export type RuntimePermissionState = {
  status: "idle" | "pending" | "resolved";
  pendingRequestIds: string[];
  lastResolvedAt?: number | null;
};

export type RuntimeCancellationState = {
  status: "idle" | "requested" | "completed";
  mode: ProviderTurnCancellationMode;
  requestedAt?: number | null;
  completedAt?: number | null;
};

export type RuntimeUsageSummary = {
  model: string | null;
  totalTokens: number | null;
  lastObservedAt: number | null;
  source: "provider" | "estimated" | "unknown";
};

export type RuntimeRecoveryPolicy = {
  primary: "checkpoint-replay";
  useProviderResumeWhenAvailable: boolean;
  useContinuityPreambleFallback: boolean;
  failClosedOnInterruptedTurn: boolean;
};

export type RuntimeProviderSwitchRecord = {
  switchId: string;
  fromProviderId: ProviderId;
  toProviderId: ProviderId;
  switchedAt: number;
  reason: "user-requested" | "recovery" | "policy";
  hostManifestHash: string;
  projectionHash: string;
  checkpointId?: string | null;
};

export type RuntimeLedgerEvent =
  | {
      eventId: string;
      sessionId: string;
      occurredAt: number;
      type: "session.created";
      payload: {
        kind: RuntimeSessionKind;
        scope: RuntimeSessionScopeRef;
        hostManifestHash: string;
        providerProjectionHash: string;
        providerId: ProviderId;
      };
    }
  | {
      eventId: string;
      sessionId: string;
      occurredAt: number;
      type: "provider.bound";
      payload: {
        bindingRevision: number;
        providerId: ProviderId;
        providerSessionId: string | null;
        hostManifestHash: string;
        projectionHash: string;
        checkpointId?: string | null;
      };
    }
  | {
      eventId: string;
      sessionId: string;
      occurredAt: number;
      type: "user.message";
      payload: {
        messageId: string;
        content: string;
      };
    }
  | {
      eventId: string;
      sessionId: string;
      occurredAt: number;
      type: "assistant.message_delta";
      payload: {
        messageId: string;
        deltaContent: string;
      };
    }
  | {
      eventId: string;
      sessionId: string;
      occurredAt: number;
      type: "assistant.message";
      payload: {
        messageId: string;
        content: string;
      };
    }
  | {
      eventId: string;
      sessionId: string;
      occurredAt: number;
      type: "tool.execution_started";
      payload: {
        toolCallId: string;
        toolName: string;
        arguments?: Record<string, unknown>;
      };
    }
  | {
      eventId: string;
      sessionId: string;
      occurredAt: number;
      type: "tool.execution_completed";
      payload: {
        toolCallId: string;
        toolName?: string;
        success: boolean;
        result?: unknown;
        errorMessage?: string;
      };
    }
  | {
      eventId: string;
      sessionId: string;
      occurredAt: number;
      type: "permission.requested";
      payload: PermissionRequestPayload;
    }
  | {
      eventId: string;
      sessionId: string;
      occurredAt: number;
      type: "permission.resolved";
      payload: {
        requestId: string;
        status: "approved" | "denied" | "expired";
      };
    }
  | {
      eventId: string;
      sessionId: string;
      occurredAt: number;
      type: "cancellation.requested";
      payload: {
        mode: ProviderTurnCancellationMode;
        requestedAt: number;
      };
    }
  | {
      eventId: string;
      sessionId: string;
      occurredAt: number;
      type: "cancellation.completed";
      payload: {
        mode: ProviderTurnCancellationMode;
        completedAt: number;
      };
    }
  | {
      eventId: string;
      sessionId: string;
      occurredAt: number;
      type: "provider.switched";
      payload: RuntimeProviderSwitchRecord;
    }
  | {
      eventId: string;
      sessionId: string;
      occurredAt: number;
      type: "turn.state_changed";
      payload: RuntimeTurnContract;
    }
  | {
      eventId: string;
      sessionId: string;
      occurredAt: number;
      type: "permission.state_changed";
      payload: RuntimePermissionState;
    }
  | {
      eventId: string;
      sessionId: string;
      occurredAt: number;
      type: "usage.recorded";
      payload: RuntimeUsageSummary;
    }
  | {
      eventId: string;
      sessionId: string;
      occurredAt: number;
      type: "checkpoint.created";
      payload: RuntimeCheckpointPayload;
    }
  | {
      eventId: string;
      sessionId: string;
      occurredAt: number;
      type: "recovery.completed";
      payload: {
        recoveredFrom: "provider-session" | "host-checkpoint" | "continuity-preamble";
        success: boolean;
        details?: string;
      };
    }
  | {
      eventId: string;
      sessionId: string;
      occurredAt: number;
      type: "host.resource_recorded";
      payload: {
        resourceId: string;
        kind: "powershell";
        status: "running" | "idle" | "completed" | "failed" | "unrecoverable" | "cancelled";
        outputCursor?: number;
      };
    };

export type RuntimeTurnContract = {
  state: RuntimeTurnState;
  activeToolCallIds: string[];
  lastUserMessageId?: string | null;
  lastAssistantMessageId?: string | null;
};

export type RuntimeSessionContract = {
  runtimeSessionId: string;
  kind: RuntimeSessionKind;
  scope: RuntimeSessionScopeRef;
  workingDirectory: string;
  hostManifestHash: string;
  providerProjectionHash: string;
  artifactRefs: RuntimeArtifactRef[];
  checkpointRef: RuntimeCheckpointRef | null;
  turnState: RuntimeTurnContract;
  permissionState: RuntimePermissionState;
  cancellationState: RuntimeCancellationState;
  usageSummary: RuntimeUsageSummary;
  recoveryPolicy: RuntimeRecoveryPolicy;
  providerSwitches: RuntimeProviderSwitchRecord[];
  permissionPolicy: "host-authoritative";
  continuityPolicy: "provider-session" | "host-continuity";
  cancellationPolicy: ProviderTurnCancellationMode;
  streamingPolicy: "native" | "host-buffered";
  providerBinding: RuntimeProviderBinding;
};

export type ProviderContractFacts = {
  providerId: ProviderId;
  sessionResumption: ProviderSessionResumptionMode;
  turnCancellation: ProviderTurnCancellationMode;
  responseStreaming: ProviderCapabilities["responseStreaming"];
  usageReporting: ProviderCapabilities["usageReporting"];
  toolManifestMode: ProviderToolManifestMode;
  modelSelection: ProviderModelSelectionMode;
  toolCalling: ProviderToolCallingMode;
};

export type ProviderContractAccelerators = {
  nativeSessionReuse: boolean;
  nativeAbort: boolean;
  nativeStreaming: boolean;
  providerUsageTelemetry: boolean;
  requiresToolManifestProjection: boolean;
};

export type ProviderContractProfile = {
  facts: ProviderContractFacts;
  accelerators: ProviderContractAccelerators;
  runtimePolicy: ReturnType<typeof getProviderRuntimeFallbackPolicy>;
};

export const buildProviderContractProfile = (
  providerId: ProviderId,
  capabilities: ProviderCapabilities,
): ProviderContractProfile => {
  const runtimePolicy = getProviderRuntimeFallbackPolicy(capabilities);
  return {
    facts: {
      providerId,
      sessionResumption: capabilities.sessionResumption,
      turnCancellation: capabilities.turnCancellation,
      responseStreaming: capabilities.responseStreaming,
      usageReporting: capabilities.usageReporting,
      toolManifestMode: capabilities.toolManifestMode,
      modelSelection: capabilities.modelSelection,
      toolCalling: capabilities.toolCalling,
    },
    accelerators: {
      nativeSessionReuse: capabilities.persistentSessions,
      nativeAbort: capabilities.abortableTurns,
      nativeStreaming: capabilities.responseStreaming === "native",
      providerUsageTelemetry: capabilities.usageReporting === "full",
      requiresToolManifestProjection: capabilities.toolManifestMode === "projected",
    },
    runtimePolicy,
  };
};

export const createRuntimeSessionContract = (input: {
  runtimeSessionId: string;
  kind: RuntimeSessionKind;
  workingDirectory: string;
  hostManifestHash: string;
  providerProjectionHash: string;
  providerId: ProviderId;
  providerCapabilities: ProviderCapabilities;
  providerSessionId?: string | null;
  model?: string | null;
  scope?: RuntimeSessionScopeRef;
  boundAt?: number;
  resumedAt?: number | null;
  terminatedAt?: number | null;
  artifactRefs?: readonly RuntimeArtifactRef[];
  checkpointRef?: RuntimeCheckpointRef | null;
  turnState?: RuntimeTurnContract;
  permissionState?: RuntimePermissionState;
  cancellationState?: Omit<RuntimeCancellationState, "mode">;
  usageSummary?: RuntimeUsageSummary;
  providerSwitches?: readonly RuntimeProviderSwitchRecord[];
  bindingRevision?: number;
}): RuntimeSessionContract => {
  const runtimePolicy = getProviderRuntimeFallbackPolicy(input.providerCapabilities);
  return {
    runtimeSessionId: input.runtimeSessionId,
    kind: input.kind,
    scope: input.scope ?? {},
    workingDirectory: input.workingDirectory,
    hostManifestHash: input.hostManifestHash,
    providerProjectionHash: input.providerProjectionHash,
    artifactRefs:
      input.artifactRefs?.map((artifact) => ({ ...artifact })) ??
      RUNTIME_ARTIFACT_KINDS.map((kind) => ({
        kind,
        storageKey: `${input.runtimeSessionId}:${kind}`,
        updatedAt: null,
      })),
    checkpointRef: input.checkpointRef ?? null,
    turnState: input.turnState ?? {
      state: "idle",
      activeToolCallIds: [],
      lastUserMessageId: null,
      lastAssistantMessageId: null,
    },
    permissionState: input.permissionState ?? {
      status: "idle",
      pendingRequestIds: [],
      lastResolvedAt: null,
    },
    cancellationState: {
      status: input.cancellationState?.status ?? "idle",
      mode: runtimePolicy.cancellation,
      requestedAt: input.cancellationState?.requestedAt ?? null,
      completedAt: input.cancellationState?.completedAt ?? null,
    },
    usageSummary: input.usageSummary ?? {
      model: input.model ?? null,
      totalTokens: null,
      lastObservedAt: null,
      source: "unknown",
    },
    recoveryPolicy: {
      primary: "checkpoint-replay",
      useProviderResumeWhenAvailable: runtimePolicy.continuity === "provider-session",
      useContinuityPreambleFallback: true,
      failClosedOnInterruptedTurn: true,
    },
    providerSwitches:
      input.providerSwitches?.map((record) => ({
        ...record,
        checkpointId: record.checkpointId ?? null,
      })) ?? [],
    permissionPolicy: "host-authoritative",
    continuityPolicy: runtimePolicy.continuity,
    cancellationPolicy: runtimePolicy.cancellation,
    streamingPolicy: runtimePolicy.streaming,
    providerBinding: {
      providerId: input.providerId,
      model: input.model ?? null,
      providerSessionId: input.providerSessionId ?? null,
      manifestMode: input.providerCapabilities.toolManifestMode,
      hostManifestHash: input.hostManifestHash,
        projectionHash: input.providerProjectionHash,
        bindingRevision: input.bindingRevision ?? input.providerSwitches?.length ?? 0,
        boundAt: input.boundAt ?? Date.now(),
        resumedAt: input.resumedAt ?? null,
        terminatedAt: input.terminatedAt ?? null,
    },
  };
};

export const createRuntimeCheckpointPayload = (input: {
  checkpointId: string;
  kind: RuntimeCheckpointPayload["kind"];
  createdAt: number;
  summary: string;
  artifactRefs: readonly RuntimeArtifactRef[];
  turnState: RuntimeTurnContract;
  permissionState: RuntimePermissionState;
  cancellationState: RuntimeCancellationState;
  usageSummary: RuntimeUsageSummary;
  providerBinding: RuntimeProviderBinding;
}): RuntimeCheckpointPayload => ({
  checkpointId: input.checkpointId,
  kind: input.kind,
  createdAt: input.createdAt,
  summary: input.summary,
  artifactRefs: input.artifactRefs.map((artifact) => ({ ...artifact })),
  turnState: { ...input.turnState, activeToolCallIds: [...input.turnState.activeToolCallIds] },
  permissionState: {
    ...input.permissionState,
    pendingRequestIds: [...input.permissionState.pendingRequestIds],
  },
  cancellationState: { ...input.cancellationState },
  usageSummary: { ...input.usageSummary },
  providerBinding: { ...input.providerBinding },
});

export const createRuntimeLedgerEvent = (event: RuntimeLedgerEvent): RuntimeLedgerEvent => {
  switch (event.type) {
    case "checkpoint.created":
      return {
        eventId: event.eventId,
        sessionId: event.sessionId,
        occurredAt: event.occurredAt,
        type: event.type,
        payload: createRuntimeCheckpointPayload(event.payload),
      };
    case "session.created":
      return {
        eventId: event.eventId,
        sessionId: event.sessionId,
        occurredAt: event.occurredAt,
        type: event.type,
        payload: { ...event.payload },
      };
    case "provider.bound":
      return {
        eventId: event.eventId,
        sessionId: event.sessionId,
        occurredAt: event.occurredAt,
        type: event.type,
        payload: { ...event.payload },
      };
    case "provider.switched":
      return {
        eventId: event.eventId,
        sessionId: event.sessionId,
        occurredAt: event.occurredAt,
        type: event.type,
        payload: { ...event.payload },
      };
    case "user.message":
      return {
        eventId: event.eventId,
        sessionId: event.sessionId,
        occurredAt: event.occurredAt,
        type: event.type,
        payload: { ...event.payload },
      };
    case "assistant.message_delta":
      return {
        eventId: event.eventId,
        sessionId: event.sessionId,
        occurredAt: event.occurredAt,
        type: event.type,
        payload: { ...event.payload },
      };
    case "assistant.message":
      return {
        eventId: event.eventId,
        sessionId: event.sessionId,
        occurredAt: event.occurredAt,
        type: event.type,
        payload: { ...event.payload },
      };
    case "tool.execution_started":
      return {
        eventId: event.eventId,
        sessionId: event.sessionId,
        occurredAt: event.occurredAt,
        type: event.type,
        payload: {
          ...event.payload,
          ...(event.payload.arguments ? { arguments: { ...event.payload.arguments } } : {}),
        },
      };
    case "tool.execution_completed":
      return {
        eventId: event.eventId,
        sessionId: event.sessionId,
        occurredAt: event.occurredAt,
        type: event.type,
        payload: { ...event.payload },
      };
    case "permission.requested":
      return {
        eventId: event.eventId,
        sessionId: event.sessionId,
        occurredAt: event.occurredAt,
        type: event.type,
        payload: {
          ...event.payload,
          ...("args" in event.payload && event.payload.args ? { args: { ...event.payload.args } } : {}),
        },
      };
    case "permission.resolved":
      return {
        eventId: event.eventId,
        sessionId: event.sessionId,
        occurredAt: event.occurredAt,
        type: event.type,
        payload: { ...event.payload },
      };
    case "cancellation.requested":
      return {
        eventId: event.eventId,
        sessionId: event.sessionId,
        occurredAt: event.occurredAt,
        type: event.type,
        payload: { ...event.payload },
      };
    case "cancellation.completed":
      return {
        eventId: event.eventId,
        sessionId: event.sessionId,
        occurredAt: event.occurredAt,
        type: event.type,
        payload: { ...event.payload },
      };
    case "turn.state_changed":
      return {
        eventId: event.eventId,
        sessionId: event.sessionId,
        occurredAt: event.occurredAt,
        type: event.type,
        payload: {
          ...event.payload,
          activeToolCallIds: [...event.payload.activeToolCallIds],
        },
      };
    case "permission.state_changed":
      return {
        eventId: event.eventId,
        sessionId: event.sessionId,
        occurredAt: event.occurredAt,
        type: event.type,
        payload: {
          ...event.payload,
          pendingRequestIds: [...event.payload.pendingRequestIds],
        },
      };
    case "usage.recorded":
      return {
        eventId: event.eventId,
        sessionId: event.sessionId,
        occurredAt: event.occurredAt,
        type: event.type,
        payload: { ...event.payload },
      };
    case "recovery.completed":
      return {
        eventId: event.eventId,
        sessionId: event.sessionId,
        occurredAt: event.occurredAt,
        type: event.type,
        payload: { ...event.payload },
      };
    case "host.resource_recorded":
      return {
        eventId: event.eventId,
        sessionId: event.sessionId,
        occurredAt: event.occurredAt,
        type: event.type,
        payload: { ...event.payload },
      };
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
};
