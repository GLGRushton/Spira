import type { SubagentRunSnapshot } from "@spira/shared";
import type { ProviderId } from "../provider/types.js";
import type { RuntimeSessionContract } from "./runtime-contract.js";

export type ResolvedSubagentProviderBinding = {
  providerId: ProviderId | null;
  providerSessionId: string | null;
  hostManifestHash: string | null;
  providerProjectionHash: string | null;
};

const getSnapshotBindingTimestamp = (
  snapshot: Pick<SubagentRunSnapshot, "completedAt" | "updatedAt" | "startedAt">,
): number | null => snapshot.completedAt ?? snapshot.updatedAt ?? snapshot.startedAt ?? null;

export function inferProviderIdAtTimestamp(
  runtimeSession:
    | Pick<RuntimeSessionContract, "providerBinding" | "providerSwitches">
    | null
    | undefined,
  occurredAt: number | null,
): ProviderId | null {
  const currentProviderId = runtimeSession?.providerBinding.providerId ?? null;
  if (!currentProviderId) {
    return null;
  }
  if (occurredAt === null) {
    return currentProviderId;
  }

  let providerId = currentProviderId;
  const switchHistory = runtimeSession?.providerSwitches ?? [];
  for (let index = switchHistory.length - 1; index >= 0; index -= 1) {
    const record = switchHistory[index]!;
    if (occurredAt < record.switchedAt) {
      providerId = record.fromProviderId;
      continue;
    }
    break;
  }
  return providerId;
}

export function resolveSubagentProviderBinding(
  snapshot: Pick<
    SubagentRunSnapshot,
    "providerId" | "providerSessionId" | "hostManifestHash" | "providerProjectionHash" | "completedAt" | "updatedAt" | "startedAt"
  >,
  runtimeSession: Pick<RuntimeSessionContract, "providerBinding" | "providerSwitches"> | null | undefined,
  stationRuntimeSession?: Pick<RuntimeSessionContract, "providerBinding" | "providerSwitches"> | null | undefined,
): ResolvedSubagentProviderBinding {
  const contractBinding = runtimeSession?.providerBinding;
  if (contractBinding?.providerId && contractBinding.providerSessionId) {
    return {
      providerId: contractBinding.providerId,
      providerSessionId: contractBinding.providerSessionId,
      hostManifestHash: snapshot.hostManifestHash ?? contractBinding.hostManifestHash,
      providerProjectionHash: snapshot.providerProjectionHash ?? contractBinding.projectionHash,
    };
  }

  if (contractBinding?.providerId && snapshot.providerId && snapshot.providerId !== contractBinding.providerId) {
    return {
      providerId: contractBinding.providerId,
      providerSessionId: null,
      hostManifestHash: snapshot.hostManifestHash ?? contractBinding.hostManifestHash,
      providerProjectionHash: snapshot.providerProjectionHash ?? contractBinding.projectionHash,
    };
  }

  const snapshotProviderId = snapshot.providerId ?? null;
  const snapshotProviderSessionId = snapshot.providerSessionId ?? null;
  if (snapshotProviderId) {
    return {
      providerId: snapshotProviderId,
      providerSessionId: snapshotProviderSessionId,
      hostManifestHash: snapshot.hostManifestHash ?? contractBinding?.hostManifestHash ?? null,
      providerProjectionHash: snapshot.providerProjectionHash ?? contractBinding?.projectionHash ?? null,
    };
  }

  const snapshotBindingTimestamp = getSnapshotBindingTimestamp(snapshot);
  const localLegacyProviderId =
    snapshot.providerSessionId && !snapshot.providerId && (runtimeSession?.providerSwitches.length ?? 0) > 0
      ? inferProviderIdAtTimestamp(runtimeSession, snapshotBindingTimestamp)
      : null;
  const legacyProviderId =
    snapshot.providerSessionId && !snapshot.providerId
      ? localLegacyProviderId ?? inferProviderIdAtTimestamp(stationRuntimeSession, snapshotBindingTimestamp)
      : null;
  if (legacyProviderId && snapshot.providerSessionId) {
    return {
      providerId: legacyProviderId,
      providerSessionId: snapshot.providerSessionId,
      hostManifestHash: snapshot.hostManifestHash ?? contractBinding?.hostManifestHash ?? null,
      providerProjectionHash: snapshot.providerProjectionHash ?? contractBinding?.projectionHash ?? null,
    };
  }

  if (contractBinding?.providerId) {
    return {
      providerId: contractBinding.providerId,
      providerSessionId: null,
      hostManifestHash: snapshot.hostManifestHash ?? contractBinding.hostManifestHash,
      providerProjectionHash: snapshot.providerProjectionHash ?? contractBinding.projectionHash,
    };
  }

  return {
    providerId: null,
    providerSessionId: null,
    hostManifestHash: contractBinding?.hostManifestHash ?? snapshot.hostManifestHash ?? null,
    providerProjectionHash: contractBinding?.projectionHash ?? snapshot.providerProjectionHash ?? null,
  };
}
