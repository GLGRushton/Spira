import type { WorkSessionPhase } from "./work-session-types.js";

/**
 * Phase 7.1 — typed taxonomy for the WorkSession event log. Mirrors the mission-events
 * pattern (closed enum + per-event metadata map + runtime validator) so the renderer can
 * switch on `event.eventType` and get strongly-typed metadata.
 *
 * The events ride a parallel `work_session_events` table (no FK to ticket_runs since
 * WorkSessions live outside the missions lifecycle). The plan deliberately keeps these
 * separate from MissionEventType so we don't conflate "what is this mission doing" with
 * "what is the primary station's WorkSession doing."
 */
export const WORK_SESSION_EVENT_TYPES = [
  "worksession-started",
  "worksession-phase-entered",
  "worksession-phase-completed",
  "worksession-validation-recorded",
  "worksession-stalled",
  "worksession-preflight-started",
  "worksession-preflight-finished",
  "worksession-closed",
] as const;

export type WorkSessionEventType = (typeof WORK_SESSION_EVENT_TYPES)[number];

const WORK_SESSION_EVENT_TYPE_SET = new Set<string>(WORK_SESSION_EVENT_TYPES);

export const isWorkSessionEventType = (value: string): value is WorkSessionEventType =>
  WORK_SESSION_EVENT_TYPE_SET.has(value);

export interface WorkSessionEventMetadataMap {
  "worksession-started": {
    /** Free-text task the session is acting on; truncated by the caller. */
    taskText: string;
    intent: string;
  };
  "worksession-phase-entered": {
    phase: WorkSessionPhase;
    /** Phase summary captured at entry, if any. */
    summary: string | null;
  };
  "worksession-phase-completed": {
    phase: WorkSessionPhase;
    /** Phase summary at completion. */
    summary: string | null;
    /** Wall-clock duration in ms from `worksession-phase-entered` to this event. */
    durationMs: number | null;
  };
  "worksession-validation-recorded": {
    command: string;
    success: boolean;
    summary: string;
    errorMessage: string | null;
  };
  "worksession-stalled": {
    reason: string;
    phase: WorkSessionPhase;
  };
  "worksession-preflight-started": {
    /** Number of checks queued (e.g. "3"). */
    checkCount: number;
  };
  "worksession-preflight-finished": {
    ok: boolean;
    blockerCount: number;
    warningCount: number;
    elapsedMs: number;
    /** Brief reason summary; e.g. "port 9720 in use; node_modules missing". */
    summary: string | null;
  };
  "worksession-closed": {
    /** True when the operator closed cleanly; false when the close fell out of a stall/cancel. */
    completed: boolean;
    /** "clean-pass" | "pass-with-friction" | "fail-with-recovery" | "fail-final" — see classifier. */
    outcome: string;
    /** Reason text for non-clean closes; null for clean. */
    reason: string | null;
  };
}

export type WorkSessionEvent = {
  [K in WorkSessionEventType]: { type: K; phase: WorkSessionPhase; metadata: WorkSessionEventMetadataMap[K] };
}[WorkSessionEventType];

export const validateWorkSessionEventType = (eventType: string): WorkSessionEventType => {
  if (!isWorkSessionEventType(eventType)) {
    throw new Error(
      `Unknown work-session event type "${eventType}". Add it to WORK_SESSION_EVENT_TYPES in @spira/shared/src/work-session-events.ts.`,
    );
  }
  return eventType;
};
