import type { RuntimeStationStateRecord } from "@spira/memory-db";
import type { ProviderSystemMessageSection } from "../provider/types.js";
import type { RuntimeCheckpointPayload, RuntimeLedgerEvent, RuntimeSessionContract } from "./runtime-contract.js";

export type RuntimeRecoveryReplayEvent = {
  kind: "user" | "assistant" | "tool" | "permission" | "cancellation";
  summary: string;
  occurredAt: number;
};

export type RuntimeRecoveryContext = {
  source: "host-checkpoint" | "continuity-preamble";
  checkpointSummary: string | null;
  recoveryNote: string | null;
  interruptedTurn: boolean;
  replayMode: "post-checkpoint" | "recent-history";
  replay: RuntimeRecoveryReplayEvent[];
};

const INTERRUPTED_TURN_STATES = new Set(["thinking", "streaming", "waiting_for_permission", "executing_tool"]);

const toReplayEvent = (event: RuntimeLedgerEvent): RuntimeRecoveryReplayEvent | null => {
  switch (event.type) {
    case "user.message":
      return {
        kind: "user",
        summary: event.payload.content,
        occurredAt: event.occurredAt,
      };
    case "assistant.message":
      return {
        kind: "assistant",
        summary: event.payload.content,
        occurredAt: event.occurredAt,
      };
    case "tool.execution_started":
      return {
        kind: "tool",
        summary: `Started tool ${event.payload.toolName}.`,
        occurredAt: event.occurredAt,
      };
    case "tool.execution_completed":
      return {
        kind: "tool",
        summary: event.payload.success
          ? `Completed tool ${event.payload.toolName ?? event.payload.toolCallId}.`
          : `Tool ${event.payload.toolName ?? event.payload.toolCallId} failed${event.payload.errorMessage ? `: ${event.payload.errorMessage}` : "."}`,
        occurredAt: event.occurredAt,
      };
    case "permission.requested":
      return {
        kind: "permission",
        summary: `Requested permission for ${event.payload.toolName}.`,
        occurredAt: event.occurredAt,
      };
    case "permission.resolved":
      return {
        kind: "permission",
        summary: `Permission ${event.payload.requestId} resolved as ${event.payload.status}.`,
        occurredAt: event.occurredAt,
      };
    case "cancellation.requested":
      return {
        kind: "cancellation",
        summary: `Cancellation requested using ${event.payload.mode}.`,
        occurredAt: event.occurredAt,
      };
    case "cancellation.completed":
      return {
        kind: "cancellation",
        summary: `Cancellation completed using ${event.payload.mode}.`,
        occurredAt: event.occurredAt,
      };
    default:
      return null;
  }
};

export const buildRuntimeRecoveryContext = (input: {
  runtimeSession: RuntimeSessionContract | null;
  checkpoint: RuntimeCheckpointPayload | null;
  ledgerEvents: RuntimeLedgerEvent[];
  runtimeState?: Pick<RuntimeStationStateRecord, "recoveryMessage"> | null;
  replayLimit?: number;
}): RuntimeRecoveryContext | null => {
  const replaySource = input.checkpoint
    ? input.ledgerEvents.filter((event) => event.occurredAt > input.checkpoint!.createdAt)
    : input.ledgerEvents.slice(-(input.replayLimit ?? 6));
  const replay = replaySource
    .map((event) => toReplayEvent(event))
    .filter((event): event is RuntimeRecoveryReplayEvent => event !== null);
  const interruptedTurn =
    input.runtimeSession?.recoveryPolicy.failClosedOnInterruptedTurn === true &&
    Boolean(input.runtimeSession?.turnState.state && INTERRUPTED_TURN_STATES.has(input.runtimeSession.turnState.state));
  const recoveryNote =
    input.runtimeState?.recoveryMessage ??
    (interruptedTurn ? "The previous turn was interrupted and was not replayed as completed." : null);
  if (!input.checkpoint && replay.length === 0 && !recoveryNote) {
    return null;
  }
  return {
    source: input.checkpoint ? "host-checkpoint" : "continuity-preamble",
    checkpointSummary: input.checkpoint?.summary ?? null,
    recoveryNote,
    interruptedTurn,
    replayMode: input.checkpoint ? "post-checkpoint" : "recent-history",
    replay,
  };
};

export const buildRuntimeRecoverySystemSection = (
  context: RuntimeRecoveryContext,
): ProviderSystemMessageSection => ({
  action: "append",
  content: [
    "[Host runtime recovery bundle]",
    "Treat this host-owned recovery bundle as authoritative continuity state for the current session.",
    JSON.stringify(
      {
        source: context.source,
        checkpointSummary: context.checkpointSummary,
        recoveryNote: context.recoveryNote,
        interruptedTurn: context.interruptedTurn,
        replayMode: context.replayMode,
        replay: context.replay,
      },
      null,
      2,
    ),
    "Use the replay entries to rebuild host continuity from the checkpoint forward. Do not assume an interrupted turn completed unless it appears in the replay.",
    "[End host runtime recovery bundle]",
  ].join("\n\n"),
});

export const buildRuntimeRecoveryPreambleFallback = (context: RuntimeRecoveryContext): string =>
  [
    "[Recovered host continuity]",
    context.checkpointSummary ? `Latest checkpoint: ${context.checkpointSummary}` : null,
    context.recoveryNote ? `Recovery note: ${context.recoveryNote}` : null,
    context.replay.length > 0
      ? `${context.replayMode === "post-checkpoint" ? "Post-checkpoint replay" : "Recent continuity replay"}:\n${context.replay
          .map((entry) => `${entry.kind}: ${entry.summary}`)
          .join("\n")}`
      : null,
    "Continue from this host-owned context rather than assuming provider-native session persistence.",
    "[End recovered host continuity]",
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join("\n\n");
