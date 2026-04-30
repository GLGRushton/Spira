import type { ProviderCapabilities, ProviderId, ProviderUsageSnapshot } from "./types.js";

export const getDefaultProviderCapabilities = (providerId: ProviderId): ProviderCapabilities =>
  providerId === "azure-openai"
    ? {
        persistentSessions: false,
        abortableTurns: false,
        sessionResumption: "host-managed",
        turnCancellation: "disconnect-and-reset",
        responseStreaming: "host-buffered",
        usageReporting: "none",
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
      }
    : {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
      };

export type ProviderRuntimeFallbackPolicy = {
  continuity: "provider-session" | "host-continuity";
  cancellation: "provider-abort" | "disconnect-and-reset";
  streaming: "native" | "host-buffered";
  usage: "full" | "partial" | "unknown";
  toolManifest: "literal" | "projected";
};

export const getProviderRuntimeFallbackPolicy = (
  capabilities: ProviderCapabilities,
): ProviderRuntimeFallbackPolicy => ({
  continuity: capabilities.sessionResumption === "provider-managed" ? "provider-session" : "host-continuity",
  cancellation: capabilities.turnCancellation,
  streaming: capabilities.responseStreaming,
  usage:
    capabilities.usageReporting === "full" ? "full" : capabilities.usageReporting === "partial" ? "partial" : "unknown",
  toolManifest: capabilities.toolManifestMode,
});

export const shouldPersistProviderSession = (capabilities: ProviderCapabilities): boolean =>
  getProviderRuntimeFallbackPolicy(capabilities).continuity === "provider-session";

export const shouldRequestNativeStreaming = (capabilities: ProviderCapabilities): boolean =>
  getProviderRuntimeFallbackPolicy(capabilities).streaming === "native";

export const shouldUseProviderAbort = (capabilities: ProviderCapabilities): boolean =>
  getProviderRuntimeFallbackPolicy(capabilities).cancellation === "provider-abort";

export const requiresProviderManifestProjection = (capabilities: ProviderCapabilities): boolean =>
  getProviderRuntimeFallbackPolicy(capabilities).toolManifest === "projected";

export const normalizeProviderUsageSnapshot = (
  capabilities: ProviderCapabilities,
  snapshot: Partial<ProviderUsageSnapshot> | null | undefined,
): ProviderUsageSnapshot => ({
  model: snapshot?.model ?? null,
  inputTokens: snapshot?.inputTokens ?? null,
  outputTokens: snapshot?.outputTokens ?? null,
  totalTokens: snapshot?.totalTokens ?? null,
  estimatedCostUsd: snapshot?.estimatedCostUsd ?? null,
  latencyMs: snapshot?.latencyMs ?? null,
  source:
    snapshot?.source ??
    (capabilities.usageReporting === "full"
      ? "provider"
      : capabilities.usageReporting === "partial"
        ? "unknown"
        : "unknown"),
});
