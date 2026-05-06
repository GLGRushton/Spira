import { describe, expect, it } from "vitest";
import {
  RUNTIME_ARTIFACT_KINDS,
  buildProviderContractProfile,
  createRuntimeCheckpointPayload,
  createRuntimeLedgerEvent,
  createRuntimeSessionContract,
} from "./runtime-contract.js";

describe("runtime contract", () => {
  it("captures Copilot as a projected-manifest accelerator profile", () => {
    const profile = buildProviderContractProfile("copilot", {
      persistentSessions: true,
      abortableTurns: true,
      sessionResumption: "provider-managed",
      turnCancellation: "provider-abort",
      responseStreaming: "native",
      usageReporting: "full",
      toolManifestMode: "projected",
      modelSelection: "session-scoped",
      toolCalling: "native",
    });

    expect(profile).toEqual({
      facts: {
        providerId: "copilot",
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
      },
      accelerators: {
        nativeSessionReuse: true,
        nativeAbort: true,
        nativeStreaming: true,
        providerUsageTelemetry: true,
        requiresToolManifestProjection: true,
      },
      runtimePolicy: {
        continuity: "provider-session",
        cancellation: "provider-abort",
        streaming: "native",
        usage: "full",
        toolManifest: "projected",
      },
    });
  });

  it("captures Azure as a host-continuity literal-manifest profile", () => {
    const profile = buildProviderContractProfile("azure-openai", {
      persistentSessions: false,
      abortableTurns: false,
      sessionResumption: "host-managed",
      turnCancellation: "disconnect-and-reset",
      responseStreaming: "host-buffered",
      usageReporting: "partial",
      toolManifestMode: "literal",
      modelSelection: "provider-default",
      toolCalling: "native",
    });

    expect(profile).toEqual({
      facts: {
        providerId: "azure-openai",
        sessionResumption: "host-managed",
        turnCancellation: "disconnect-and-reset",
        responseStreaming: "host-buffered",
        usageReporting: "partial",
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
      },
      accelerators: {
        nativeSessionReuse: false,
        nativeAbort: false,
        nativeStreaming: false,
        providerUsageTelemetry: false,
        requiresToolManifestProjection: false,
      },
      runtimePolicy: {
        continuity: "host-continuity",
        cancellation: "disconnect-and-reset",
        streaming: "host-buffered",
        usage: "partial",
        toolManifest: "literal",
      },
    });
  });

  it("builds a host-owned runtime session contract from provider capabilities", () => {
    const contract = createRuntimeSessionContract({
      runtimeSessionId: "runtime-1",
      kind: "station",
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-manifest-123",
      providerProjectionHash: "projection-123",
      providerId: "copilot",
      providerCapabilities: {
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
      providerSessionId: "provider-1",
      model: "gpt-5.4",
      scope: {
        stationId: "primary",
      },
      boundAt: 1_000,
      resumedAt: 1_100,
      checkpointRef: {
        checkpointId: "checkpoint-1",
        kind: "session-summary",
        createdAt: 1_050,
      },
      turnState: {
        state: "thinking",
        activeToolCallIds: ["tool-1"],
        lastUserMessageId: "user-1",
        lastAssistantMessageId: "assistant-1",
      },
      workflowState: {
        phase: "implement",
        status: "active",
        summary: "Applying the reviewed patch.",
        updatedAt: 1_085,
        phaseHistory: [
          {
            phase: "plan",
            status: "complete",
            summary: "Plan approved.",
            providerId: "copilot",
            model: "gpt-5.4-mini",
            startedAt: 1_010,
            updatedAt: 1_040,
            completedAt: 1_040,
            blockedBy: null,
          },
        ],
        handoffs: [
          {
            handoffId: "handoff-1",
            kind: "model-escalation",
            phase: "implement",
            reason: "cross-file complexity",
            continuationMode: "continue-current-phase",
            occurredAt: 1_080,
            fromProviderId: "copilot",
            toProviderId: "copilot",
            fromModel: "gpt-5.4-mini",
            toModel: "gpt-5.4",
          },
        ],
        blockedBy: null,
        review: {
          status: "idle",
          attempt: 0,
          runId: null,
          summary: null,
          failureReason: null,
          lastUpdatedAt: null,
        },
      },
      permissionState: {
        status: "pending",
        pendingRequestIds: ["perm-1"],
        lastResolvedAt: 900,
      },
      cancellationState: {
        status: "requested",
        requestedAt: 1_075,
      },
      usageSummary: {
        model: "gpt-5.4",
        totalTokens: 42,
        lastObservedAt: 1_090,
        source: "provider",
      },
      providerSwitches: [
        {
          switchId: "switch-1",
          fromProviderId: "azure-openai",
          toProviderId: "copilot",
          switchedAt: 950,
          reason: "user-requested",
          hostManifestHash: "host-manifest-123",
          projectionHash: "projection-123",
          checkpointId: null,
        },
      ],
    });

    expect(contract).toEqual({
      runtimeSessionId: "runtime-1",
      kind: "station",
      scope: {
        stationId: "primary",
      },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-manifest-123",
      providerProjectionHash: "projection-123",
      artifactRefs: RUNTIME_ARTIFACT_KINDS.map((kind) => ({
        kind,
        storageKey: `runtime-1:${kind}`,
        updatedAt: null,
      })),
      checkpointRef: {
        checkpointId: "checkpoint-1",
        kind: "session-summary",
        createdAt: 1_050,
      },
      turnState: {
        state: "thinking",
        activeToolCallIds: ["tool-1"],
        lastUserMessageId: "user-1",
        lastAssistantMessageId: "assistant-1",
      },
      workflowState: {
        phase: "implement",
        status: "active",
        summary: "Applying the reviewed patch.",
        updatedAt: 1_085,
        phaseHistory: [
          {
            phase: "plan",
            status: "complete",
            summary: "Plan approved.",
            providerId: "copilot",
            model: "gpt-5.4-mini",
            startedAt: 1_010,
            updatedAt: 1_040,
            completedAt: 1_040,
            blockedBy: null,
          },
        ],
        handoffs: [
          {
            handoffId: "handoff-1",
            kind: "model-escalation",
            phase: "implement",
            reason: "cross-file complexity",
            continuationMode: "continue-current-phase",
            occurredAt: 1_080,
            fromProviderId: "copilot",
            toProviderId: "copilot",
            fromModel: "gpt-5.4-mini",
            toModel: "gpt-5.4",
          },
        ],
        blockedBy: null,
        review: {
          status: "idle",
          attempt: 0,
          runId: null,
          summary: null,
          failureReason: null,
          lastUpdatedAt: null,
        },
      },
      permissionState: {
        status: "pending",
        pendingRequestIds: ["perm-1"],
        lastResolvedAt: 900,
      },
      cancellationState: {
        status: "requested",
        mode: "provider-abort",
        requestedAt: 1_075,
        completedAt: null,
      },
      usageSummary: {
        model: "gpt-5.4",
        totalTokens: 42,
        lastObservedAt: 1_090,
        source: "provider",
      },
      recoveryPolicy: {
        primary: "checkpoint-replay",
        useProviderResumeWhenAvailable: true,
        useContinuityPreambleFallback: true,
        failClosedOnInterruptedTurn: true,
      },
      providerSwitches: [
        {
          switchId: "switch-1",
          fromProviderId: "azure-openai",
          toProviderId: "copilot",
          switchedAt: 950,
          reason: "user-requested",
          hostManifestHash: "host-manifest-123",
          projectionHash: "projection-123",
          checkpointId: null,
        },
      ],
      permissionPolicy: "host-authoritative",
      continuityPolicy: "provider-session",
      cancellationPolicy: "provider-abort",
      streamingPolicy: "native",
      hostContinuity: null,
      providerBinding: {
        providerId: "copilot",
        model: "gpt-5.4",
        providerSessionId: "provider-1",
        manifestMode: "projected",
        hostManifestHash: "host-manifest-123",
        projectionHash: "projection-123",
        bindingRevision: 1,
        boundAt: 1_000,
        resumedAt: 1_100,
        terminatedAt: null,
      },
    });
  });

  it("builds checkpoint payloads and ledger events with projection provenance", () => {
    const contract = createRuntimeSessionContract({
      runtimeSessionId: "runtime-2",
      kind: "subagent",
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-manifest-456",
      providerProjectionHash: "projection-456",
      providerId: "azure-openai",
      providerCapabilities: {
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
      providerSessionId: null,
      model: "gpt-4.1",
      boundAt: 2_000,
    });

    const checkpoint = createRuntimeCheckpointPayload({
      checkpointId: "checkpoint-2",
      kind: "turn-snapshot",
      createdAt: 2_050,
      summary: "Subagent paused after reading context.",
      artifactRefs: contract.artifactRefs,
      turnState: contract.turnState,
      workflowState: contract.workflowState,
      permissionState: contract.permissionState,
      cancellationState: contract.cancellationState,
      usageSummary: contract.usageSummary,
      providerBinding: contract.providerBinding,
    });

    const event = createRuntimeLedgerEvent({
      eventId: "event-1",
      sessionId: contract.runtimeSessionId,
      occurredAt: 2_060,
      type: "provider.switched",
      payload: {
        switchId: "switch-2",
        fromProviderId: "copilot",
        toProviderId: "azure-openai",
        switchedAt: 2_025,
        reason: "recovery",
        hostManifestHash: "host-manifest-456",
        projectionHash: "projection-456",
        checkpointId: "checkpoint-2",
      },
    });

    expect(checkpoint).toEqual({
      checkpointId: "checkpoint-2",
      kind: "turn-snapshot",
      createdAt: 2_050,
      summary: "Subagent paused after reading context.",
      artifactRefs: RUNTIME_ARTIFACT_KINDS.map((kind) => ({
        kind,
        storageKey: `runtime-2:${kind}`,
        updatedAt: null,
      })),
      turnState: {
        state: "idle",
        activeToolCallIds: [],
        lastUserMessageId: null,
        lastAssistantMessageId: null,
      },
      workflowState: {
        phase: "intake",
        status: "idle",
        summary: null,
        updatedAt: null,
        phaseHistory: [],
        handoffs: [],
        blockedBy: null,
        review: {
          status: "idle",
          attempt: 0,
          runId: null,
          summary: null,
          failureReason: null,
          lastUpdatedAt: null,
        },
      },
      permissionState: {
        status: "idle",
        pendingRequestIds: [],
        lastResolvedAt: null,
      },
      cancellationState: {
        status: "idle",
        mode: "disconnect-and-reset",
        requestedAt: null,
        completedAt: null,
      },
      usageSummary: {
        model: "gpt-4.1",
        totalTokens: null,
        lastObservedAt: null,
        source: "unknown",
      },
      providerBinding: {
        providerId: "azure-openai",
        model: "gpt-4.1",
        providerSessionId: null,
        manifestMode: "literal",
        hostManifestHash: "host-manifest-456",
        projectionHash: "projection-456",
        bindingRevision: 0,
        boundAt: 2_000,
        resumedAt: null,
        terminatedAt: null,
      },
    });
    expect(event).toEqual({
      eventId: "event-1",
      sessionId: "runtime-2",
      occurredAt: 2_060,
      type: "provider.switched",
      payload: {
        switchId: "switch-2",
        fromProviderId: "copilot",
        toProviderId: "azure-openai",
        switchedAt: 2_025,
        reason: "recovery",
        hostManifestHash: "host-manifest-456",
        projectionHash: "projection-456",
        checkpointId: "checkpoint-2",
      },
    });
  });

  it("clones workflow update ledger events", () => {
    const event = createRuntimeLedgerEvent({
      eventId: "event-workflow",
      sessionId: "runtime-3",
      occurredAt: 3_000,
      type: "workflow.updated",
      payload: {
        phase: "review",
        status: "blocked",
        summary: "Waiting for approval before running review.",
        updatedAt: 2_995,
        phaseHistory: [
          {
            phase: "implement",
            status: "complete",
            summary: "Implementation landed.",
            providerId: "copilot",
            model: "gpt-5.4",
            startedAt: 2_900,
            updatedAt: 2_980,
            completedAt: 2_980,
            blockedBy: null,
          },
        ],
        handoffs: [],
        blockedBy: {
          kind: "approval",
          reason: "Permission request is still pending.",
          pendingRequestIds: ["perm-7"],
          blockedAt: 2_994,
        },
        review: {
          status: "running",
          attempt: 1,
          runId: "agent:review-1",
          summary: "Review launched.",
          failureReason: null,
          lastUpdatedAt: 2_995,
        },
      },
    });

    expect(event).toEqual({
      eventId: "event-workflow",
      sessionId: "runtime-3",
      occurredAt: 3_000,
      type: "workflow.updated",
      payload: {
        phase: "review",
        status: "blocked",
        summary: "Waiting for approval before running review.",
        updatedAt: 2_995,
        phaseHistory: [
          {
            phase: "implement",
            status: "complete",
            summary: "Implementation landed.",
            providerId: "copilot",
            model: "gpt-5.4",
            startedAt: 2_900,
            updatedAt: 2_980,
            completedAt: 2_980,
            blockedBy: null,
          },
        ],
        handoffs: [],
        blockedBy: {
          kind: "approval",
          reason: "Permission request is still pending.",
          pendingRequestIds: ["perm-7"],
          blockedAt: 2_994,
        },
        review: {
          status: "running",
          attempt: 1,
          runId: "agent:review-1",
          summary: "Review launched.",
          failureReason: null,
          lastUpdatedAt: 2_995,
        },
      },
    });
  });
});
