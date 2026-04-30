import { describe, expect, it } from "vitest";
import { inferProviderIdAtTimestamp, resolveSubagentProviderBinding } from "./provider-binding.js";

describe("provider-binding", () => {
  it("processes equal-timestamp provider switches newest-first", () => {
    const providerId = inferProviderIdAtTimestamp(
      {
        providerBinding: {
          providerId: "copilot",
          providerSessionId: "current-session",
          model: null,
          manifestMode: "projected",
          hostManifestHash: "host-hash",
          projectionHash: "projection-hash",
          bindingRevision: 2,
          boundAt: 1000,
        },
        providerSwitches: [
          {
            switchId: "switch-1",
            fromProviderId: "copilot",
            toProviderId: "azure-openai",
            switchedAt: 1000,
            reason: "user-requested",
            hostManifestHash: "host-hash",
            projectionHash: "projection-hash",
          },
          {
            switchId: "switch-2",
            fromProviderId: "azure-openai",
            toProviderId: "copilot",
            switchedAt: 1000,
            reason: "user-requested",
            hostManifestHash: "host-hash",
            projectionHash: "projection-hash",
          },
        ],
      },
      999,
    );

    expect(providerId).toBe("copilot");
  });

  it("prefers subagent-local switch history over station switch history for legacy snapshots", () => {
    const binding = resolveSubagentProviderBinding(
      {
        providerSessionId: "legacy-subagent-session",
        hostManifestHash: "host-hash",
        providerProjectionHash: "projection-hash",
        startedAt: 1000,
        updatedAt: 1500,
        completedAt: 1500,
      },
      {
        providerBinding: {
          providerId: "azure-openai",
          providerSessionId: null,
          model: null,
          manifestMode: "projected",
          hostManifestHash: "host-hash",
          projectionHash: "projection-hash",
          bindingRevision: 1,
          boundAt: 1000,
        },
        providerSwitches: [
          {
            switchId: "subagent-switch-1",
            fromProviderId: "copilot",
            toProviderId: "azure-openai",
            switchedAt: 2000,
            reason: "user-requested",
            hostManifestHash: "host-hash",
            projectionHash: "projection-hash",
          },
        ],
      },
      {
        providerBinding: {
          providerId: "copilot",
          providerSessionId: "station-session",
          model: null,
          manifestMode: "projected",
          hostManifestHash: "host-hash",
          projectionHash: "projection-hash",
          bindingRevision: 1,
          boundAt: 1000,
        },
        providerSwitches: [],
      },
    );

    expect(binding).toMatchObject({
      providerId: "copilot",
      providerSessionId: "legacy-subagent-session",
    });
  });

  it("falls back to station switch history when local legacy inference has no subagent switch history", () => {
    const binding = resolveSubagentProviderBinding(
      {
        providerSessionId: "legacy-copilot-session",
        hostManifestHash: "host-hash",
        providerProjectionHash: "projection-hash",
        startedAt: 1000,
        updatedAt: 1500,
        completedAt: 1500,
      },
      {
        providerBinding: {
          providerId: "azure-openai",
          providerSessionId: null,
          model: null,
          manifestMode: "projected",
          hostManifestHash: "host-hash",
          projectionHash: "projection-hash",
          bindingRevision: 1,
          boundAt: 1000,
        },
        providerSwitches: [],
      },
      {
        providerBinding: {
          providerId: "azure-openai",
          providerSessionId: "station-session",
          model: null,
          manifestMode: "projected",
          hostManifestHash: "host-hash",
          projectionHash: "projection-hash",
          bindingRevision: 1,
          boundAt: 1000,
        },
        providerSwitches: [
          {
            switchId: "station-switch-1",
            fromProviderId: "copilot",
            toProviderId: "azure-openai",
            switchedAt: 2000,
            reason: "user-requested",
            hostManifestHash: "host-hash",
            projectionHash: "projection-hash",
          },
        ],
      },
    );

    expect(binding).toMatchObject({
      providerId: "copilot",
      providerSessionId: "legacy-copilot-session",
    });
  });

  it("preserves an explicit contract provider even when the provider session id is null", () => {
    const binding = resolveSubagentProviderBinding(
      {
        providerId: "copilot",
        providerSessionId: "stale-copilot-session",
        hostManifestHash: "snapshot-host-hash",
        providerProjectionHash: "snapshot-projection-hash",
        startedAt: 1000,
        updatedAt: 1500,
        completedAt: 1500,
      },
      {
        providerBinding: {
          providerId: "azure-openai",
          providerSessionId: null,
          model: null,
          manifestMode: "projected",
          hostManifestHash: "contract-host-hash",
          projectionHash: "contract-projection-hash",
          bindingRevision: 1,
          boundAt: 1000,
        },
        providerSwitches: [],
      },
    );

    expect(binding).toMatchObject({
      providerId: "azure-openai",
      providerSessionId: null,
      hostManifestHash: "snapshot-host-hash",
      providerProjectionHash: "snapshot-projection-hash",
    });
  });
});
