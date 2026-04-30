import { describe, expect, it } from "vitest";
import { getDefaultProviderCapabilities } from "../provider/capability-fallback.js";
import { createRuntimeCheckpointPayload, createRuntimeSessionContract } from "./runtime-contract.js";
import {
  buildRuntimeRecoveryContext,
  buildRuntimeRecoveryPreambleFallback,
  buildRuntimeRecoverySystemSection,
} from "./runtime-recovery.js";

describe("runtime-recovery", () => {
  it("builds structured host recovery from checkpoint and replayed ledger events", () => {
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "runtime-1",
      kind: "background",
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-hash",
      providerProjectionHash: "projection-hash",
      providerId: "azure-openai",
      providerCapabilities: getDefaultProviderCapabilities("azure-openai"),
      turnState: {
        state: "executing_tool",
        activeToolCallIds: ["tc1"],
        lastUserMessageId: "u1",
        lastAssistantMessageId: "a1",
      },
    });
    const checkpoint = createRuntimeCheckpointPayload({
      checkpointId: "cp-1",
      kind: "turn-snapshot",
      createdAt: 5,
      summary: "Initial inspection complete.",
      artifactRefs: runtimeSession.artifactRefs,
      turnState: runtimeSession.turnState,
      permissionState: runtimeSession.permissionState,
      cancellationState: runtimeSession.cancellationState,
      usageSummary: runtimeSession.usageSummary,
      providerBinding: runtimeSession.providerBinding,
    });

    const context = buildRuntimeRecoveryContext({
      runtimeSession,
      checkpoint,
      runtimeState: { recoveryMessage: null },
      ledgerEvents: [
        {
          eventId: "e1",
          sessionId: "runtime-1",
          occurredAt: 6,
          type: "user.message",
          payload: { messageId: "u1", content: "Inspect the repo." },
        },
        {
          eventId: "e2",
          sessionId: "runtime-1",
          occurredAt: 7,
          type: "assistant.message",
          payload: { messageId: "a1", content: "Inspection started." },
        },
      ],
    });

    expect(context).toEqual({
      source: "host-checkpoint",
      checkpointSummary: "Initial inspection complete.",
      recoveryNote: "The previous turn was interrupted and was not replayed as completed.",
      interruptedTurn: true,
      replayMode: "post-checkpoint",
      replay: [
        { kind: "user", summary: "Inspect the repo.", occurredAt: 6 },
        { kind: "assistant", summary: "Inspection started.", occurredAt: 7 },
      ],
    });
  });

  it("renders authoritative recovery sections and fallback preambles", () => {
    const context = {
      source: "host-checkpoint" as const,
      checkpointSummary: "Checkpoint summary",
      recoveryNote: "Pending tool execution was not assumed complete.",
      interruptedTurn: true,
      replayMode: "post-checkpoint" as const,
      replay: [
        { kind: "user" as const, summary: "Continue the repair.", occurredAt: 1 },
        { kind: "assistant" as const, summary: "Repair underway.", occurredAt: 2 },
      ],
    };

    const systemSection = buildRuntimeRecoverySystemSection(context);
    const fallback = buildRuntimeRecoveryPreambleFallback(context);

    expect(systemSection.content).toContain("[Host runtime recovery bundle]");
    expect(systemSection.content).toContain("\"checkpointSummary\": \"Checkpoint summary\"");
    expect(systemSection.content).toContain("\"replayMode\": \"post-checkpoint\"");
    expect(systemSection.content).toContain("authoritative continuity state");
    expect(fallback).toContain("[Recovered host continuity]");
    expect(fallback).toContain("Checkpoint summary");
    expect(fallback).toContain("Post-checkpoint replay");
    expect(fallback).toContain("Continue from this host-owned context");
  });
});
