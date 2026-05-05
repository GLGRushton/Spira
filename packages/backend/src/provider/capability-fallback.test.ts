import { describe, expect, it } from "vitest";
import {
  getDefaultProviderCapabilities,
  getProviderRuntimeFallbackPolicy,
  normalizeProviderUsageSnapshot,
  requiresProviderManifestProjection,
  shouldPersistProviderSession,
  shouldRequestNativeStreaming,
  shouldUseProviderAbort,
} from "./capability-fallback.js";

describe("provider capability fallback policy", () => {
  it("maps provider-managed capabilities to native runtime policies", () => {
    const capabilities = {
      persistentSessions: true,
      abortableTurns: true,
      sessionResumption: "provider-managed",
      turnCancellation: "provider-abort",
      responseStreaming: "native",
      usageReporting: "full",
      toolManifestMode: "projected",
      modelSelection: "session-scoped",
      toolCalling: "native",
    } as const;

    expect(getProviderRuntimeFallbackPolicy(capabilities)).toEqual({
      continuity: "provider-session",
      cancellation: "provider-abort",
      streaming: "native",
      usage: "full",
      toolManifest: "projected",
    });
    expect(shouldPersistProviderSession(capabilities)).toBe(true);
    expect(shouldRequestNativeStreaming(capabilities)).toBe(true);
    expect(shouldUseProviderAbort(capabilities)).toBe(true);
    expect(requiresProviderManifestProjection(capabilities)).toBe(true);
  });

  it("maps host-managed capabilities to fallback runtime policies", () => {
    const capabilities = {
      persistentSessions: false,
      abortableTurns: false,
      sessionResumption: "host-managed",
      turnCancellation: "disconnect-and-reset",
      responseStreaming: "host-buffered",
      usageReporting: "partial",
      toolManifestMode: "literal",
      modelSelection: "provider-default",
      toolCalling: "native",
    } as const;

    expect(getProviderRuntimeFallbackPolicy(capabilities)).toEqual({
      continuity: "host-continuity",
      cancellation: "disconnect-and-reset",
      streaming: "host-buffered",
      usage: "partial",
      toolManifest: "literal",
    });
    expect(shouldPersistProviderSession(capabilities)).toBe(false);
    expect(shouldRequestNativeStreaming(capabilities)).toBe(false);
    expect(shouldUseProviderAbort(capabilities)).toBe(false);
    expect(requiresProviderManifestProjection(capabilities)).toBe(false);
  });

  it("normalizes usage snapshots with policy-aware source defaults", () => {
    expect(
      normalizeProviderUsageSnapshot(
        {
          persistentSessions: true,
          abortableTurns: true,
          sessionResumption: "provider-managed",
          turnCancellation: "provider-abort",
          responseStreaming: "native",
          usageReporting: "full",
          toolManifestMode: "projected",
          modelSelection: "session-scoped",
          toolCalling: "native",
        },
        { totalTokens: 42 },
      ),
    ).toMatchObject({
      totalTokens: 42,
      source: "provider",
    });

    expect(
      normalizeProviderUsageSnapshot(
        {
          persistentSessions: false,
          abortableTurns: false,
          sessionResumption: "host-managed",
          turnCancellation: "disconnect-and-reset",
          responseStreaming: "host-buffered",
          usageReporting: "partial",
          toolManifestMode: "literal",
          modelSelection: "provider-default",
          toolCalling: "native",
        },
        null,
      ),
    ).toMatchObject({
      totalTokens: null,
      source: "unknown",
    });
  });

  it("treats openai as host-managed with session-scoped model selection", () => {
    const capabilities = getProviderRuntimeFallbackPolicy({
      persistentSessions: false,
      abortableTurns: true,
      sessionResumption: "host-managed",
      turnCancellation: "provider-abort",
      responseStreaming: "native",
      usageReporting: "partial",
      toolManifestMode: "literal",
      modelSelection: "session-scoped",
      toolCalling: "native",
    });

    expect(capabilities).toEqual({
      continuity: "host-continuity",
      cancellation: "provider-abort",
      streaming: "native",
      usage: "partial",
      toolManifest: "literal",
    });
  });

  it("maps escalation providers to the same baseline capability families", () => {
    expect(getDefaultProviderCapabilities("openai-escalation")).toMatchObject({
      sessionResumption: "host-managed",
      modelSelection: "session-scoped",
      usageReporting: "partial",
    });
    expect(getDefaultProviderCapabilities("azure-openai-escalation")).toMatchObject({
      sessionResumption: "host-managed",
      modelSelection: "provider-default",
      usageReporting: "partial",
    });
  });
});
