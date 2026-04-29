import { describe, expect, it } from "vitest";
import {
  getProviderRuntimeFallbackPolicy,
  normalizeProviderUsageSnapshot,
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
    } as const;

    expect(getProviderRuntimeFallbackPolicy(capabilities)).toEqual({
      continuity: "provider-session",
      cancellation: "provider-abort",
      streaming: "native",
      usage: "full",
    });
    expect(shouldPersistProviderSession(capabilities)).toBe(true);
    expect(shouldRequestNativeStreaming(capabilities)).toBe(true);
    expect(shouldUseProviderAbort(capabilities)).toBe(true);
  });

  it("maps host-managed capabilities to fallback runtime policies", () => {
    const capabilities = {
      persistentSessions: false,
      abortableTurns: false,
      sessionResumption: "host-managed",
      turnCancellation: "disconnect-and-reset",
      responseStreaming: "host-buffered",
      usageReporting: "partial",
    } as const;

    expect(getProviderRuntimeFallbackPolicy(capabilities)).toEqual({
      continuity: "host-continuity",
      cancellation: "disconnect-and-reset",
      streaming: "host-buffered",
      usage: "partial",
    });
    expect(shouldPersistProviderSession(capabilities)).toBe(false);
    expect(shouldRequestNativeStreaming(capabilities)).toBe(false);
    expect(shouldUseProviderAbort(capabilities)).toBe(false);
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
        },
        null,
      ),
    ).toMatchObject({
      totalTokens: null,
      source: "unknown",
    });
  });
});
