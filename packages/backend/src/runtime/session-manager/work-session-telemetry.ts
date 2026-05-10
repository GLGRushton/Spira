import type { SpiraMemoryDatabase } from "@spira/memory-db";
import type { WorkSessionPhase, WorkSessionSnapshot, WorkSessionEventType } from "@spira/shared";

/**
 * Diff two consecutive WorkSession snapshots and emit typed events for the
 * transitions. Pure function on inputs; returns the events the caller should write.
 *
 * Detection rules:
 *  - `previous == null && next != null` → `worksession-started`
 *  - phase entry transitions to `active` → `worksession-phase-entered`
 *  - phase entry transitions to `complete` or `skipped` from `active` → `worksession-phase-completed`
 *  - `validationResults` grew → `worksession-validation-recorded` for each fresh entry
 *  - `stalledReason` newly populated → `worksession-stalled`
 */

export interface WorkSessionTelemetryEvent {
  eventType: WorkSessionEventType;
  phase: WorkSessionPhase;
  metadata: Record<string, unknown>;
  occurredAt: number;
}

const truncate = (value: string, max = 200): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

export const diffWorkSessionForTelemetry = (
  previous: WorkSessionSnapshot | null,
  next: WorkSessionSnapshot,
): WorkSessionTelemetryEvent[] => {
  const events: WorkSessionTelemetryEvent[] = [];

  if (!previous) {
    events.push({
      eventType: "worksession-started",
      phase: next.currentPhase,
      occurredAt: next.createdAt,
      metadata: {
        taskText: truncate(next.taskText, 200),
        intent: next.classification.intent,
      },
    });
  }

  // O(N) lookup for previous-status-by-phase. With ≤6 phases the find-loop was fine,
  // but the Map keeps the diff bounded if phase history ever grows.
  const previousByPhase = new Map<WorkSessionPhase, (typeof next.phaseHistory)[number]>();
  if (previous) {
    for (const entry of previous.phaseHistory) previousByPhase.set(entry.phase, entry);
  }

  for (const entry of next.phaseHistory) {
    const previousEntry = previousByPhase.get(entry.phase) ?? null;
    const previousStatus = previousEntry?.status ?? null;
    if (entry.status === "active" && previousStatus !== "active") {
      events.push({
        eventType: "worksession-phase-entered",
        phase: entry.phase,
        occurredAt: entry.startedAt,
        metadata: {
          phase: entry.phase,
          summary: entry.summary ?? null,
        },
      });
    }
    if ((entry.status === "complete" || entry.status === "skipped") && previousStatus === "active") {
      const enteredAt = previousEntry?.startedAt ?? entry.startedAt;
      const completedAt = entry.completedAt ?? entry.updatedAt;
      events.push({
        eventType: "worksession-phase-completed",
        phase: entry.phase,
        occurredAt: completedAt,
        metadata: {
          phase: entry.phase,
          summary: entry.summary ?? null,
          durationMs: typeof completedAt === "number" ? Math.max(0, completedAt - enteredAt) : null,
        },
      });
    }
  }

  const previousValidationCount = previous?.validationResults?.length ?? 0;
  const nextValidationResults = next.validationResults ?? [];
  for (let index = previousValidationCount; index < nextValidationResults.length; index += 1) {
    const entry = nextValidationResults[index]!;
    events.push({
      eventType: "worksession-validation-recorded",
      phase: "validate",
      occurredAt: entry.occurredAt,
      metadata: {
        command: entry.command,
        success: entry.success,
        summary: truncate(entry.summary, 200),
        errorMessage: entry.errorMessage ?? null,
      },
    });
  }

  // Stall detected when stalledAt transitions to a numeric value. Compare on the timestamp
  // (not the reason text) so a re-stall with the same reason still emits a fresh event.
  const previousStalledAt = previous?.stalledAt ?? null;
  const nextStalledAt = next.stalledAt ?? null;
  if (nextStalledAt !== null && nextStalledAt !== previousStalledAt && next.stalledReason) {
    events.push({
      eventType: "worksession-stalled",
      phase: next.currentPhase,
      occurredAt: nextStalledAt,
      metadata: {
        reason: truncate(next.stalledReason, 200),
        phase: next.currentPhase,
      },
    });
  }

  return events;
};

/**
 * Persist the diffed events to the DB in a single transaction. Best-effort: failures
 * are logged via the supplied callback but never thrown. Skipped silently when memoryDb
 * is null (unit-test stations) or when the diff produces no events.
 */
export const writeWorkSessionTelemetry = (
  memoryDb: SpiraMemoryDatabase | null,
  previous: WorkSessionSnapshot | null,
  next: WorkSessionSnapshot,
  onError?: (error: unknown) => void,
): void => {
  if (!memoryDb) return;
  const events = diffWorkSessionForTelemetry(previous, next);
  if (events.length === 0) return;
  try {
    memoryDb.appendWorkSessionEvents(
      events.map((event) => ({
        sessionId: next.sessionId,
        stationId: next.stationId,
        phase: event.phase,
        eventType: event.eventType,
        metadata: event.metadata,
        occurredAt: event.occurredAt,
      })),
    );
  } catch (error) {
    onError?.(error);
  }
};

/** One-shot writer for the close event; takes the closing snapshot + outcome. */
export const writeWorkSessionClosed = (
  memoryDb: SpiraMemoryDatabase | null,
  snapshot: WorkSessionSnapshot,
  outcome: { completed: boolean; outcome: string; reason: string | null; postmortemPath: string | null },
  onError?: (error: unknown) => void,
): void => {
  if (!memoryDb) return;
  try {
    memoryDb.appendWorkSessionEvent({
      sessionId: snapshot.sessionId,
      stationId: snapshot.stationId,
      phase: snapshot.currentPhase,
      eventType: "worksession-closed",
      metadata: {
        completed: outcome.completed,
        outcome: outcome.outcome,
        reason: outcome.reason,
        postmortemPath: outcome.postmortemPath,
      },
      occurredAt: snapshot.completedAt ?? Date.now(),
    });
  } catch (error) {
    onError?.(error);
  }
};
