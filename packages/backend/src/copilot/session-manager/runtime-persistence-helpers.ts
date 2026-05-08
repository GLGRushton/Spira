import type { RuntimeStationToolCallRecord } from "@spira/memory-db";
import type { AssistantState, StationId } from "@spira/shared";
import type { ProviderClient, ProviderHostContinuityState, ProviderId } from "../../provider/types.js";
import type {
  RuntimeCheckpointPayload,
  RuntimeLedgerEvent,
  RuntimeSessionContract,
  RuntimeUsageSummary,
} from "../../runtime/runtime-contract.js";
import type { RuntimeStore } from "../../runtime/runtime-store.js";
import {
  appendStationRuntimeLedgerEventIfSession,
  buildStationRuntimeRecoverySection,
  createStationRuntimeCheckpoint,
  getStationManagerRuntimeSessionId,
  persistStationRuntimeSessionContract,
  recordStationRuntimeUserMessage,
  syncStationRuntimeState,
} from "../../runtime/station-runtime-persistence.js";
import type { PendingPermissionRequest } from "./shared.js";

export interface RuntimePersistenceHelperContext {
  runtimeStore: RuntimeStore;
  stationId: StationId | null;
  workingDirectory: string | null;
  configuredProviderId: ProviderId;
  activeSessionId: string | null;
  boundHostManifestHash: string | null;
  boundProviderProjectionHash: string | null;
  currentState: AssistantState;
  promptInFlight: boolean;
  activeToolCalls: Map<string, RuntimeStationToolCallRecord>;
  abortRequestedAt: number | null;
  requestedModel: string | null;
  runtimeUsageSummary: RuntimeUsageSummary;
  workflowState: RuntimeSessionContract["workflowState"];
  sessionOrigin: "created" | "resumed" | null;
  lastRuntimeUserMessageId: string | null;
  lastRuntimeAssistantMessageId: string | null;
  pendingPermissionRequests: Map<string, PendingPermissionRequest>;
  lastPermissionResolvedAt: number | null;
  lastCancellationCompletedAt: number | null;
  hostContinuityState: ProviderHostContinuityState | null;
  resumableHostContinuityState: ProviderHostContinuityState | null;
  resumableHostContinuityHostManifestHash: string | null;
  resumableHostContinuityProjectionHash: string | null;
  activeRecoverySource: "host-checkpoint" | "continuity-preamble" | "host-transcript" | null;
  client: ProviderClient | null;
  reconcileWorkflowPermissionBlocking: () => void;
  getProviderCapabilities: () => ProviderClient["capabilities"];
  getCurrentToolManifest: (provider?: Pick<ProviderClient, "providerId" | "capabilities">) => {
    hostManifestHash: string;
    projectionHash: string;
  };
  getCurrentSystemMessageHash: () => string;
  setActiveRecoverySource: (source: "host-checkpoint" | "continuity-preamble" | "host-transcript" | null) => void;
}

export const getRuntimeSessionIdHelper = (context: Pick<RuntimePersistenceHelperContext, "stationId">): string | null =>
  getStationManagerRuntimeSessionId(context.stationId);

export const buildRuntimePersistenceContextHelper = (context: RuntimePersistenceHelperContext) => ({
  runtimeStore: context.runtimeStore,
  stationId: context.stationId,
  workingDirectory: context.workingDirectory,
  configuredProviderId: context.configuredProviderId,
  activeSessionId: context.activeSessionId,
  boundHostManifestHash: context.boundHostManifestHash,
  boundProviderProjectionHash: context.boundProviderProjectionHash,
  currentState: context.currentState,
  promptInFlight: context.promptInFlight,
  activeToolCalls: context.activeToolCalls,
  abortRequestedAt: context.abortRequestedAt,
  requestedModel: context.requestedModel,
  runtimeUsageSummary: context.runtimeUsageSummary,
  workflowState: context.workflowState,
  sessionOrigin: context.sessionOrigin,
  lastRuntimeUserMessageId: context.lastRuntimeUserMessageId,
  lastRuntimeAssistantMessageId: context.lastRuntimeAssistantMessageId,
  pendingPermissionRequests: context.pendingPermissionRequests,
  lastPermissionResolvedAt: context.lastPermissionResolvedAt,
  lastCancellationCompletedAt: context.lastCancellationCompletedAt,
  hostContinuity: context.hostContinuityState,
  getProviderCapabilities: () => context.getProviderCapabilities(),
  getCurrentToolManifest: () => context.getCurrentToolManifest(),
});

export const syncRuntimeStateHelper = (context: RuntimePersistenceHelperContext): RuntimeSessionContract | null => {
  context.reconcileWorkflowPermissionBlocking();
  return syncStationRuntimeState(buildRuntimePersistenceContextHelper(context));
};

export const persistRuntimeSessionContractHelper = (
  context: RuntimePersistenceHelperContext,
  hostManifestHash: string,
  projectionHash: string,
  overrides: Partial<RuntimeSessionContract> = {},
): RuntimeSessionContract | null =>
  persistStationRuntimeSessionContract({
    context: buildRuntimePersistenceContextHelper(context),
    hostManifestHash,
    projectionHash,
    overrides,
  });

export const appendRuntimeLedgerEventIfSessionHelper = (
  context: RuntimePersistenceHelperContext,
  event: Omit<RuntimeLedgerEvent, "sessionId"> | null,
  syncRuntimeState: () => void,
  options: { syncState?: boolean } = {},
): void => {
  appendStationRuntimeLedgerEventIfSession(
    context.runtimeStore,
    getRuntimeSessionIdHelper(context),
    event,
    syncRuntimeState,
    options,
  );
};

export const recordRuntimeUserMessageHelper = (
  context: RuntimePersistenceHelperContext,
  syncRuntimeState: () => void,
  messageId: string,
  content: string,
): void => {
  recordStationRuntimeUserMessage(
    context.runtimeStore,
    getRuntimeSessionIdHelper(context),
    syncRuntimeState,
    messageId,
    content,
  );
};

export const createRuntimeCheckpointHelper = (
  context: RuntimePersistenceHelperContext,
  kind: RuntimeCheckpointPayload["kind"],
  summary: string,
  syncRuntimeState: () => RuntimeSessionContract | null,
): RuntimeCheckpointPayload | null =>
  createStationRuntimeCheckpoint({
    context: buildRuntimePersistenceContextHelper(context),
    kind,
    summary,
    syncRuntimeState,
  });

export const buildRuntimeRecoverySectionHelper = (
  context: Pick<RuntimePersistenceHelperContext, "runtimeStore" | "stationId" | "setActiveRecoverySource">,
) => {
  const { recoverySection, recoverySource } = buildStationRuntimeRecoverySection({
    runtimeStore: context.runtimeStore,
    stationId: context.stationId,
  });
  context.setActiveRecoverySource(recoverySource);
  return recoverySection;
};

export const getHostContinuitySeedHelper = (
  context: Pick<
    RuntimePersistenceHelperContext,
    | "resumableHostContinuityState"
    | "resumableHostContinuityHostManifestHash"
    | "resumableHostContinuityProjectionHash"
    | "runtimeStore"
    | "getCurrentSystemMessageHash"
    | "stationId"
  > &
    Pick<RuntimePersistenceHelperContext, "getCurrentToolManifest">,
  providerId: ProviderId,
  hostManifestHash: string,
  projectionHash: string,
): ProviderHostContinuityState | null => {
  const resumableHostContinuity = context.resumableHostContinuityState;
  const currentSystemMessageHash = context.getCurrentSystemMessageHash();
  const resumableMatchesCurrentProjection =
    context.resumableHostContinuityHostManifestHash === hostManifestHash &&
    context.resumableHostContinuityProjectionHash === projectionHash;
  const runtimeSessionId = getRuntimeSessionIdHelper(context);
  if (!runtimeSessionId) {
    return resumableHostContinuity?.providerId === providerId &&
      resumableMatchesCurrentProjection &&
      resumableHostContinuity.systemMessageHash === currentSystemMessageHash
      ? resumableHostContinuity
      : null;
  }
  const runtimeSession = context.runtimeStore.getRuntimeSession(runtimeSessionId);
  if (!runtimeSession) {
    return resumableHostContinuity?.providerId === providerId &&
      resumableMatchesCurrentProjection &&
      resumableHostContinuity.systemMessageHash === currentSystemMessageHash
      ? resumableHostContinuity
      : null;
  }
  if (
    runtimeSession.providerBinding.providerId !== providerId ||
    runtimeSession.providerBinding.hostManifestHash !== hostManifestHash ||
    runtimeSession.providerBinding.projectionHash !== projectionHash
  ) {
    return null;
  }
  if (
    runtimeSession.turnState.state !== "idle" &&
    runtimeSession.turnState.state !== "completed" &&
    runtimeSession.turnState.state !== "error"
  ) {
    if (
      !resumableHostContinuity ||
      resumableHostContinuity.providerId !== providerId ||
      !resumableMatchesCurrentProjection ||
      resumableHostContinuity.systemMessageHash !== currentSystemMessageHash
    ) {
      return null;
    }
    return resumableHostContinuity;
  }
  const hostContinuity = runtimeSession.hostContinuity ?? context.resumableHostContinuityState ?? null;
  if (
    !hostContinuity ||
    hostContinuity.providerId !== providerId ||
    hostContinuity.systemMessageHash !== currentSystemMessageHash
  ) {
    return null;
  }
  return hostContinuity;
};
