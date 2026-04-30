import { createRuntimeSessionContract, type RuntimeSessionContract } from "./runtime-contract.js";
import { recordRuntimeSessionCreated, recordRuntimeTurnStateChanged } from "./runtime-lifecycle.js";
import type { RuntimeStore } from "./runtime-store.js";

const resolveBindingTiming = (
  existing: RuntimeSessionContract | null,
  providerSessionId: string | null | undefined,
  now: number,
): { boundAt: number; bindingRevision: number } => ({
  boundAt:
    existing?.providerBinding.providerSessionId === providerSessionId && providerSessionId
      ? existing!.providerBinding.boundAt
      : now,
  bindingRevision:
    !providerSessionId
      ? (existing?.providerBinding.bindingRevision ?? 0)
      : existing?.providerBinding.providerSessionId === providerSessionId
        ? existing.providerBinding.bindingRevision
        : (existing?.providerBinding.bindingRevision ?? -1) + 1,
});

const didTurnStateChange = (
  previousTurnState: RuntimeSessionContract["turnState"] | null | undefined,
  nextTurnState: RuntimeSessionContract["turnState"],
): boolean =>
  !previousTurnState ||
  previousTurnState.state !== nextTurnState.state ||
  previousTurnState.lastUserMessageId !== nextTurnState.lastUserMessageId ||
  previousTurnState.lastAssistantMessageId !== nextTurnState.lastAssistantMessageId ||
  previousTurnState.activeToolCallIds.length !== nextTurnState.activeToolCallIds.length ||
  previousTurnState.activeToolCallIds.some((callId, index) => callId !== nextTurnState.activeToolCallIds[index]);

export const persistSharedRuntimeSessionState = (
  runtimeStore: RuntimeStore | null | undefined,
  input: {
    runtimeSessionId: string;
    stationId?: string | null;
    runId?: string | null;
    kind: RuntimeSessionContract["kind"];
    scope: RuntimeSessionContract["scope"];
    workingDirectory: string;
    hostManifestHash: string;
    providerProjectionHash: string;
    providerId: RuntimeSessionContract["providerBinding"]["providerId"];
    providerCapabilities: Parameters<typeof createRuntimeSessionContract>[0]["providerCapabilities"];
    providerSessionId?: string | null;
    model?: string | null;
    resumedAt?: number | null;
    terminatedAt?: number | null;
    artifactRefs?: RuntimeSessionContract["artifactRefs"];
    checkpointRef?: RuntimeSessionContract["checkpointRef"];
    turnState: RuntimeSessionContract["turnState"];
    permissionState: RuntimeSessionContract["permissionState"];
    cancellationState: Omit<RuntimeSessionContract["cancellationState"], "mode">;
    usageSummary: RuntimeSessionContract["usageSummary"];
    providerSwitches?: RuntimeSessionContract["providerSwitches"];
    now: number;
  },
): RuntimeSessionContract | null => {
  if (!runtimeStore) {
    return null;
  }

  const existing = runtimeStore.getRuntimeSession(input.runtimeSessionId);
  const { boundAt, bindingRevision } = resolveBindingTiming(existing, input.providerSessionId, input.now);
  const contract = createRuntimeSessionContract({
    runtimeSessionId: input.runtimeSessionId,
    kind: input.kind,
    scope: input.scope,
    workingDirectory: input.workingDirectory,
    hostManifestHash: input.hostManifestHash,
    providerProjectionHash: input.providerProjectionHash,
    providerId: input.providerId,
    providerCapabilities: input.providerCapabilities,
    providerSessionId: input.providerSessionId,
    model: input.model ?? existing?.providerBinding.model ?? null,
    boundAt,
    resumedAt: input.resumedAt ?? existing?.providerBinding.resumedAt ?? null,
    terminatedAt: input.terminatedAt ?? existing?.providerBinding.terminatedAt ?? null,
    artifactRefs: input.artifactRefs ?? existing?.artifactRefs,
    checkpointRef: input.checkpointRef ?? existing?.checkpointRef ?? null,
    turnState: input.turnState,
    permissionState: input.permissionState,
    cancellationState: input.cancellationState,
    usageSummary: input.usageSummary,
    providerSwitches: input.providerSwitches ?? existing?.providerSwitches ?? [],
    bindingRevision,
  });
  const persisted = runtimeStore.persistRuntimeSession({
    runtimeSessionId: input.runtimeSessionId,
    ...(input.stationId !== undefined ? { stationId: input.stationId } : {}),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    kind: input.kind,
    contract,
  });
  if (!existing && persisted) {
    recordRuntimeSessionCreated(runtimeStore, {
      runtimeSessionId: input.runtimeSessionId,
      kind: input.kind,
      scope: input.scope,
      hostManifestHash: input.hostManifestHash,
      providerProjectionHash: input.providerProjectionHash,
      providerId: input.providerId,
      occurredAt: input.now,
    });
  }
  if (persisted && didTurnStateChange(existing?.turnState, persisted.turnState)) {
    recordRuntimeTurnStateChanged(runtimeStore, input.runtimeSessionId, {
      turnState: persisted.turnState,
      occurredAt: input.now,
    });
  }
  return persisted;
};
