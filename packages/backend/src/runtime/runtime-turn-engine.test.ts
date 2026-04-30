import { describe, expect, it, vi } from "vitest";
import { StreamAssembler } from "./stream-handler.js";
import {
  createRuntimeCheckpointFromContract,
  handleSharedTurnEvent,
  settleTurnCompletionIfReady,
  updateRuntimeUsageSummary,
  type SharedTurnEventState,
} from "./runtime-turn-engine.js";
import { createRuntimeSessionContract } from "./runtime-contract.js";
import { getDefaultProviderCapabilities } from "../provider/capability-fallback.js";

describe("runtime-turn-engine", () => {
  it("handles shared assistant, tool, and idle events through one turn path", () => {
    const state: SharedTurnEventState<{ toolName: string; startedAt: number }> = {
      streamAssembler: new StreamAssembler(),
      activeToolCalls: new Map(),
      latestUsage: undefined,
      latestAssistantText: undefined,
      lastAssistantMessageId: null,
      idleObserved: false,
    };
    const ready = vi.fn();
    const toolRecords: Array<{ toolName: string; startedAt: number; completedAt: number }> = [];

    handleSharedTurnEvent({
      state,
      event: { type: "assistant.message_delta", data: { messageId: "m1", deltaContent: "Hello" } },
      now: () => 10,
      normalizeUsage: (snapshot) => ({ source: "provider", ...snapshot }),
      createActiveToolCall: () => ({ toolName: "read_powershell", startedAt: 10 }),
      buildToolRecord: (activeToolCall, _event, occurredAt) => ({
        toolName: activeToolCall?.toolName ?? "unknown",
        startedAt: activeToolCall?.startedAt ?? occurredAt,
        completedAt: occurredAt,
      }),
      onTurnReady: ready,
    });
    handleSharedTurnEvent({
      state,
      event: {
        type: "tool.execution_start",
        data: { toolCallId: "tc1", toolName: "read_powershell", arguments: { shellId: "abc" } },
      },
      now: () => 20,
      normalizeUsage: (snapshot) => ({ source: "provider", ...snapshot }),
      createActiveToolCall: (event, occurredAt) => ({ toolName: event.data.toolName, startedAt: occurredAt }),
      buildToolRecord: (activeToolCall, _event, occurredAt) => ({
        toolName: activeToolCall?.toolName ?? "unknown",
        startedAt: activeToolCall?.startedAt ?? occurredAt,
        completedAt: occurredAt,
      }),
      onTurnReady: ready,
    });
    handleSharedTurnEvent({
      state,
      event: { type: "assistant.message", data: { messageId: "m1", content: "" } },
      now: () => 30,
      normalizeUsage: (snapshot) => ({ source: "provider", ...snapshot }),
      createActiveToolCall: () => ({ toolName: "unused", startedAt: 0 }),
      buildToolRecord: (activeToolCall, _event, occurredAt) => ({
        toolName: activeToolCall?.toolName ?? "unknown",
        startedAt: activeToolCall?.startedAt ?? occurredAt,
        completedAt: occurredAt,
      }),
      onTurnReady: ready,
    });
    handleSharedTurnEvent({
      state,
      event: {
        type: "tool.execution_complete",
        data: { toolCallId: "tc1", success: true, result: { ok: true } },
      },
      now: () => 40,
      normalizeUsage: (snapshot) => ({ source: "provider", ...snapshot }),
      createActiveToolCall: () => ({ toolName: "unused", startedAt: 0 }),
      buildToolRecord: (activeToolCall, _event, occurredAt) => ({
        toolName: activeToolCall?.toolName ?? "unknown",
        startedAt: activeToolCall?.startedAt ?? occurredAt,
        completedAt: occurredAt,
      }),
      onToolExecutionComplete: (_event, toolRecord) => {
        toolRecords.push(toolRecord);
      },
      onTurnReady: ready,
    });
    handleSharedTurnEvent({
      state,
      event: {
        type: "session.idle",
        data: { usage: { model: "gpt-4.1", totalTokens: 12, source: "provider" } },
      },
      now: () => 50,
      normalizeUsage: (snapshot) => ({ source: "provider", ...snapshot }),
      createActiveToolCall: () => ({ toolName: "unused", startedAt: 0 }),
      buildToolRecord: (activeToolCall, _event, occurredAt) => ({
        toolName: activeToolCall?.toolName ?? "unknown",
        startedAt: activeToolCall?.startedAt ?? occurredAt,
        completedAt: occurredAt,
      }),
      onTurnReady: ready,
    });

    expect(state.lastAssistantMessageId).toBe("m1");
    expect(state.latestAssistantText).toBe("Hello");
    expect(state.idleObserved).toBe(true);
    expect(state.activeToolCalls.size).toBe(0);
    expect(state.latestUsage?.totalTokens).toBe(12);
    expect(toolRecords).toEqual([{ toolName: "read_powershell", startedAt: 20, completedAt: 40 }]);
    expect(ready).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenCalledWith("Hello");
  });

  it("updates runtime usage summaries and settles completion only once", () => {
    const summary = updateRuntimeUsageSummary(
      { model: null, totalTokens: null, lastObservedAt: null, source: "unknown" },
      { model: "gpt-4.1", totalTokens: 99, source: "provider" },
      123,
    );
    const settle = vi.fn();

    const firstSettled = settleTurnCompletionIfReady({
      completionSettled: false,
      latestAssistantText: "Done",
      idleObserved: true,
      activeToolCallCount: 0,
      settle,
    });
    const secondSettled = settleTurnCompletionIfReady({
      completionSettled: true,
      latestAssistantText: "Done",
      idleObserved: true,
      activeToolCallCount: 0,
      settle,
    });

    expect(summary).toEqual({
      model: "gpt-4.1",
      totalTokens: 99,
      lastObservedAt: 123,
      source: "provider",
    });
    expect(firstSettled).toBe(true);
    expect(secondSettled).toBe(false);
    expect(settle).toHaveBeenCalledOnce();
  });

  it("builds runtime checkpoints from the shared contract view", () => {
    const contract = createRuntimeSessionContract({
      runtimeSessionId: "runtime-1",
      kind: "station",
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-hash",
      providerProjectionHash: "projection-hash",
      providerId: "azure-openai",
      providerCapabilities: getDefaultProviderCapabilities("azure-openai"),
      checkpointRef: { checkpointId: "old", kind: "turn-snapshot", createdAt: 1 },
      usageSummary: { model: "gpt-4.1", totalTokens: 42, lastObservedAt: 2, source: "provider" },
    });

    const checkpoint = createRuntimeCheckpointFromContract({
      checkpointId: "cp-1",
      kind: "turn-snapshot",
      createdAt: 99,
      summary: "  Fresh summary  ",
      defaultSummary: "Fallback summary",
      contract,
    });

    expect(checkpoint.checkpointId).toBe("cp-1");
    expect(checkpoint.summary).toBe("Fresh summary");
    expect(checkpoint.providerBinding.providerId).toBe("azure-openai");
    expect(checkpoint.usageSummary.totalTokens).toBe(42);
  });
});
