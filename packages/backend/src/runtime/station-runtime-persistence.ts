import { randomUUID } from "node:crypto";
import type { RuntimeStationToolCallRecord } from "@spira/memory-db";
import type { AssistantState, StationId } from "@spira/shared";
import type {
  ProviderCapabilities,
  ProviderHostContinuityState,
  ProviderId,
  ProviderSystemMessageSection,
} from "../provider/types.js";
import { appRootDir } from "../util/app-paths.js";
import type {
  RuntimeCheckpointPayload,
  RuntimeLedgerEvent,
  RuntimeSessionContract,
  RuntimeUsageSummary,
} from "./runtime-contract.js";
import {
  appendRuntimeLifecycleEvent,
  persistRuntimeCheckpointLifecycle,
  recordRuntimeUserMessage,
} from "./runtime-lifecycle.js";
import { buildRuntimeRecoveryContext, buildRuntimeRecoverySystemSection } from "./runtime-recovery.js";
import { getStationRuntimeSessionId } from "./runtime-session-ids.js";
import { persistSharedRuntimeSessionState } from "./runtime-session-state.js";
import {
  buildRuntimeCancellationState,
  buildRuntimePermissionState,
  buildRuntimeTurnContract,
} from "./runtime-state-machine.js";
import type { RuntimeStore } from "./runtime-store.js";
import { createRuntimeCheckpointFromContract } from "./runtime-turn-engine.js";

export type StationRecoverySource = "host-checkpoint" | "continuity-preamble";

type ToolManifestHashes = {
  hostManifestHash: string;
  projectionHash: string;
};

export type StationRuntimePersistenceContext = {
  runtimeStore: RuntimeStore;
  stationId: StationId | null | undefined;
  workingDirectory: string | null | undefined;
  configuredProviderId: ProviderId;
  activeSessionId: string | null;
  boundHostManifestHash: string | null;
  boundProviderProjectionHash: string | null;
  currentState: AssistantState;
  promptInFlight: boolean;
  activeToolCalls: Map<string, RuntimeStationToolCallRecord>;
  abortRequestedAt: number | null;
  requestedModel: string | null | undefined;
  runtimeUsageSummary: RuntimeUsageSummary;
  workflowState: RuntimeSessionContract["workflowState"];
  sessionOrigin: "created" | "resumed" | null;
  lastRuntimeUserMessageId: string | null;
  lastRuntimeAssistantMessageId: string | null;
  pendingPermissionRequests: Map<string, unknown>;
  lastPermissionResolvedAt: number | null;
  lastCancellationCompletedAt: number | null;
  hostContinuity: ProviderHostContinuityState | null;
  getProviderCapabilities(): ProviderCapabilities;
  getCurrentToolManifest(): ToolManifestHashes;
};

type PersistStationRuntimeSessionContractOptions = {
  context: StationRuntimePersistenceContext;
  hostManifestHash: string;
  projectionHash: string;
  overrides?: Partial<RuntimeSessionContract>;
};

type CreateStationRuntimeCheckpointOptions = {
  context: StationRuntimePersistenceContext;
  kind: RuntimeCheckpointPayload["kind"];
  summary: string;
  syncRuntimeState(): RuntimeSessionContract | null;
};

type BuildStationRuntimeRecoverySectionOptions = {
  runtimeStore: RuntimeStore;
  stationId: StationId | null | undefined;
};

export const getStationManagerRuntimeSessionId = (stationId: StationId | null | undefined): string | null =>
  stationId ? getStationRuntimeSessionId(stationId) : null;

export const persistStationRuntimeSessionContract = ({
  context,
  hostManifestHash,
  projectionHash,
  overrides = {},
}: PersistStationRuntimeSessionContractOptions): RuntimeSessionContract | null => {
  const runtimeSessionId = getStationManagerRuntimeSessionId(context.stationId);
  if (!runtimeSessionId || !context.stationId) {
    return null;
  }
  const existing = context.runtimeStore.getRuntimeSession(runtimeSessionId);
  const providerCapabilities = context.getProviderCapabilities();
  return persistSharedRuntimeSessionState(context.runtimeStore, {
    runtimeSessionId,
    stationId: context.stationId,
    kind: "station",
    scope: {
      stationId: context.stationId,
    },
    workingDirectory: context.workingDirectory ?? appRootDir,
    hostManifestHash,
    providerProjectionHash: projectionHash,
    providerId: context.configuredProviderId,
    providerCapabilities,
    providerSessionId: context.activeSessionId,
    model: context.runtimeUsageSummary.model ?? context.requestedModel ?? null,
    resumedAt:
      context.sessionOrigin === "resumed"
        ? Date.now()
        : (overrides.providerBinding?.resumedAt ?? existing?.providerBinding.resumedAt ?? null),
    terminatedAt: overrides.providerBinding?.terminatedAt ?? existing?.providerBinding.terminatedAt ?? null,
    artifactRefs: overrides.artifactRefs ?? existing?.artifactRefs,
    checkpointRef: overrides.checkpointRef ?? existing?.checkpointRef ?? null,
    turnState:
      overrides.turnState ??
      buildRuntimeTurnContract({
        isThinking: context.currentState === "thinking",
        activeToolCallIds: [...context.activeToolCalls.keys()],
        lastUserMessageId: context.lastRuntimeUserMessageId,
        lastAssistantMessageId: context.lastRuntimeAssistantMessageId,
        waitingForPermission: context.pendingPermissionRequests.size > 0,
        isError: context.currentState === "error",
        isCancelled: Boolean(context.abortRequestedAt),
      }),
    workflowState: overrides.workflowState ?? context.workflowState,
    permissionState:
      overrides.permissionState ??
      buildRuntimePermissionState({
        pendingRequestIds: [...context.pendingPermissionRequests.keys()],
        lastResolvedAt: context.lastPermissionResolvedAt,
      }),
    cancellationState:
      overrides.cancellationState ??
      buildRuntimeCancellationState({
        requestedAt: context.abortRequestedAt,
        completedAt: context.lastCancellationCompletedAt,
        completed: context.abortRequestedAt === null && context.lastCancellationCompletedAt !== null,
      }),
    usageSummary: overrides.usageSummary ?? context.runtimeUsageSummary,
    hostContinuity: overrides.hostContinuity ?? context.hostContinuity,
    providerSwitches: overrides.providerSwitches ?? existing?.providerSwitches ?? [],
    now: Date.now(),
  });
};

export const syncStationRuntimeState = (context: StationRuntimePersistenceContext): RuntimeSessionContract | null => {
  const { hostManifestHash, projectionHash } =
    context.activeSessionId && context.boundHostManifestHash && context.boundProviderProjectionHash
      ? {
          hostManifestHash: context.boundHostManifestHash,
          projectionHash: context.boundProviderProjectionHash,
        }
      : context.getCurrentToolManifest();
  context.runtimeStore.persistStationRuntimeState({
    state: context.currentState,
    promptInFlight: context.promptInFlight,
    providerId: context.configuredProviderId,
    activeSessionId: context.activeSessionId,
    hostManifestHash,
    providerProjectionHash: projectionHash,
    activeToolCalls: [...context.activeToolCalls.values()],
    abortRequestedAt: context.abortRequestedAt,
    recoveryMessage: null,
  });
  return persistStationRuntimeSessionContract({
    context,
    hostManifestHash,
    projectionHash,
  });
};

export const appendStationRuntimeLedgerEventIfSession = (
  runtimeStore: RuntimeStore,
  runtimeSessionId: string | null,
  event: Omit<RuntimeLedgerEvent, "sessionId"> | null,
  syncRuntimeState: (() => void) | null,
  options: { syncState?: boolean } = {},
): void => {
  if (!runtimeSessionId || !event) {
    return;
  }
  if (options.syncState !== false) {
    syncRuntimeState?.();
  }
  appendRuntimeLifecycleEvent(runtimeStore, runtimeSessionId, event);
};

export const recordStationRuntimeUserMessage = (
  runtimeStore: RuntimeStore,
  runtimeSessionId: string | null,
  syncRuntimeState: (() => void) | null,
  messageId: string,
  content: string,
): void => {
  syncRuntimeState?.();
  recordRuntimeUserMessage(runtimeStore, runtimeSessionId, {
    messageId,
    content,
    occurredAt: Date.now(),
  });
};

export const createStationRuntimeCheckpoint = ({
  context,
  kind,
  summary,
  syncRuntimeState,
}: CreateStationRuntimeCheckpointOptions): RuntimeCheckpointPayload | null => {
  const runtimeSessionId = getStationManagerRuntimeSessionId(context.stationId);
  if (!runtimeSessionId || !context.stationId) {
    return null;
  }
  const contract = syncRuntimeState();
  if (!contract) {
    return null;
  }
  const checkpoint = createRuntimeCheckpointFromContract({
    checkpointId: randomUUID(),
    kind,
    createdAt: Date.now(),
    summary,
    defaultSummary: "Station runtime checkpoint.",
    contract,
  });
  persistRuntimeCheckpointLifecycle(context.runtimeStore, {
    runtimeSessionId,
    checkpoint,
    scope: {
      stationId: context.stationId,
    },
    persistCheckpointRef: (checkpointRef) =>
      persistStationRuntimeSessionContract({
        context,
        hostManifestHash: contract.hostManifestHash,
        projectionHash: contract.providerProjectionHash,
        overrides: {
          checkpointRef,
        },
      }),
  });
  return checkpoint;
};

export const buildStationRuntimeRecoverySection = ({
  runtimeStore,
  stationId,
}: BuildStationRuntimeRecoverySectionOptions): {
  recoverySection: ProviderSystemMessageSection | null;
  recoverySource: StationRecoverySource | null;
} => {
  const runtimeSessionId = getStationManagerRuntimeSessionId(stationId);
  if (!runtimeSessionId) {
    return {
      recoverySection: null,
      recoverySource: null,
    };
  }
  const runtimeSession = runtimeStore.getRuntimeSession(runtimeSessionId);
  if (!runtimeSession) {
    return {
      recoverySection: null,
      recoverySource: null,
    };
  }
  const recoveryContext = buildRuntimeRecoveryContext({
    runtimeSession,
    checkpoint: runtimeStore.getLatestRuntimeCheckpoint(runtimeSessionId),
    ledgerEvents: runtimeStore.listRuntimeLedgerEvents(runtimeSessionId),
    runtimeState: stationId ? runtimeStore.getStationRuntimeState() : null,
  });
  if (!recoveryContext) {
    return {
      recoverySection: null,
      recoverySource: null,
    };
  }
  return {
    recoverySection: buildRuntimeRecoverySystemSection(recoveryContext),
    recoverySource: recoveryContext.source,
  };
};
