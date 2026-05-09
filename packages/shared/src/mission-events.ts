import type { TicketRunMissionPhase } from "./ticket-run-types.js";

/**
 * Stage label written to mission_events.stage. The "system" stage is for
 * cross-phase events (workspace prep, run closure, restart recovery, etc.).
 */
export type MissionEventStage = TicketRunMissionPhase | "system";

/**
 * Closed enumeration of every mission event type. New event types must be added
 * here AND given a metadata entry in MissionEventMetadataMap below; otherwise
 * recordMissionEvent() will fail to compile at the call site.
 *
 * Ordering follows the lifecycle (lifecycle events first, then attempt events,
 * then proof events, then system / cross-phase events, then live attempt-action
 * events introduced in Phase 1.1).
 */
export const MISSION_EVENT_TYPES = [
  // Lifecycle (mission-lifecycle.ts)
  "context-loaded",
  "classification-saved",
  "plan-saved",
  "validation-recorded",
  "proof-strategy-saved",
  "proof-result-recorded",
  "summary-saved",
  // Attempt orchestration (ticket-runs.ts)
  "attempt-started",
  "attempt-finished",
  "attempt-cancelled",
  "attempt-repair-requested",
  "attempt-recovered-after-restart",
  // Proof execution (ticket-runs.ts + proof runner)
  "proof-started",
  "proof-finished",
  // System / cross-phase (ticket-runs.ts)
  "workspace-prepared",
  "repo-intelligence-candidates-observed",
  "repo-intelligence-candidate-approved",
  "run-closed",
  // Live attempt telemetry (Phase 1.1)
  "attempt-action",
  "attempt-shell-command",
  "attempt-awaiting-permission",
  "attempt-permission-resolved",
  // Proof gate (Phase 2.1)
  "proof-set-manual-review-only",
  "proof-manual-review-cleared",
  // Proof preflight (Phase 2.2 / 2.3)
  "proof-preflight-started",
  "proof-preflight-finished",
] as const;

export type MissionEventType = (typeof MISSION_EVENT_TYPES)[number];

const MISSION_EVENT_TYPE_SET = new Set<string>(MISSION_EVENT_TYPES);

export const isMissionEventType = (value: string): value is MissionEventType => MISSION_EVENT_TYPE_SET.has(value);

export interface MissionEventMetadataMap {
  // Lifecycle
  "context-loaded": {
    proofProfileCount: number;
    repoGuidanceCount: number;
    validationProfileCount: number;
    recommendedProofLevel: string | null;
    preflightStatus: string | null;
  };
  "classification-saved": {
    proofRequired: boolean;
    impactedRepoRelativePaths: readonly string[];
  };
  "plan-saved": {
    touchedRepoRelativePaths: readonly string[];
    validationStepCount: number;
  };
  "validation-recorded": {
    validationId: string;
    status: string;
    kind: string;
    command: string;
  };
  "proof-strategy-saved": {
    adapterId: string;
    repoRelativePath: string;
  };
  "proof-result-recorded": {
    status: string;
    lastProofRunId: string | null;
    lastProofProfileId: string | null;
  };
  "summary-saved": {
    changedRepoRelativePaths: readonly string[];
  };
  // Attempt orchestration
  "attempt-started": {
    attemptId: string;
    sequence: number;
    reusedLiveAttempt: boolean;
    promptProvided: boolean;
  };
  "attempt-finished": {
    attemptId: string;
    status: string;
    repairCount: number;
    waitReason: string | null;
    nextAction: string | null;
  };
  "attempt-cancelled": {
    attemptId: string;
  };
  "attempt-repair-requested": {
    attemptId: string;
    waitReason: string | null;
    nextAction: string | null;
  };
  "attempt-recovered-after-restart": {
    attemptId: string;
  };
  // Proof execution
  "proof-started": {
    proofRunId: string;
    profileId: string;
    profileLabel: string;
  };
  "proof-finished": {
    proofRunId: string;
    profileId: string;
    status: string;
    exitCode: number | null;
  };
  // System / cross-phase
  "workspace-prepared": {
    status: string;
    worktreeCount: number;
  };
  "repo-intelligence-candidates-observed": {
    count: number;
    entryIds: readonly string[];
    repoRelativePaths: readonly (string | null)[];
  };
  "repo-intelligence-candidate-approved": {
    entryId: string;
    repoRelativePath: string | null;
  };
  "run-closed": {
    stationCleared: boolean;
  };
  // Live attempt telemetry — Phase 1.1
  "attempt-action": {
    attemptId: string;
    /** Short human-readable label, e.g. "Read", "Write", "Edit", "Bash". */
    action: string;
    /** Optional target hint truncated by the caller (e.g. file path, tool name). */
    target?: string | null;
    /** Optional duration if the action has settled. */
    durationMs?: number | null;
    /** Optional outcome status (e.g. "success", "error", "denied"). */
    status?: string | null;
  };
  "attempt-shell-command": {
    attemptId: string;
    command: string;
    cwd?: string | null;
    durationMs?: number | null;
    exitCode?: number | null;
    status?: "running" | "passed" | "failed" | "cancelled" | null;
  };
  "attempt-awaiting-permission": {
    attemptId: string;
    requestId: string;
    /** Short label of the tool / surface that needs approval. */
    label?: string | null;
  };
  "attempt-permission-resolved": {
    attemptId: string;
    requestId: string;
    result: "approved" | "denied" | "expired";
  };
  // Proof gate — Phase 2.1
  "proof-set-manual-review-only": {
    /** Operator's free-text justification — e.g. "5-line copy edit, eyeballed in MissionChangesRoom". */
    justification: string;
    /** Whether this manual-review choice replaced a previously failed/blocked proof status. */
    replacedPriorStatus: string | null;
  };
  "proof-manual-review-cleared": {
    /** What the proof status reverted to (typically "not-run"). */
    revertedTo: string;
  };
  // Proof preflight — Phase 2.2 / 2.3
  "proof-preflight-started": {
    profileId: string;
    profileLabel: string;
  };
  "proof-preflight-finished": {
    profileId: string;
    profileLabel: string;
    ok: boolean;
    blockerCount: number;
    warningCount: number;
    elapsedMs: number;
    /** Brief reason summary when ok = false; e.g. "dotnet not on PATH; node_modules missing". */
    summary: string | null;
  };
}

/**
 * Convenience union of every typed event. Useful for renderer-side reducers
 * that want to switch on event.type and get fully-typed metadata.
 */
export type MissionEvent = {
  [K in MissionEventType]: { type: K; stage: MissionEventStage; metadata: MissionEventMetadataMap[K] };
}[MissionEventType];

/**
 * Build an AppendMissionEventInput-shaped payload from a typed event.
 * Throws if the event type is unknown (defensive — TS catches this at compile
 * time, but at runtime the validator gives an actionable message).
 */
export const validateMissionEventType = (eventType: string): MissionEventType => {
  if (!isMissionEventType(eventType)) {
    throw new Error(
      `Unknown mission event type "${eventType}". Add it to MISSION_EVENT_TYPES in @spira/shared/src/mission-events.ts.`,
    );
  }
  return eventType;
};
