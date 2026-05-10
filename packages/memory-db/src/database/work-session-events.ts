import { validateWorkSessionEventType } from "@spira/shared";
import { type DatabasePersistenceContext, assertDatabaseWritable } from "./context.js";
import { serializeJson } from "./helpers.js";

/**
 * Phase 7.1 — work_session_events table read/write helpers.
 *
 * Mirrors mission_events shape (id auto-PK, JSON metadata blob, integer occurredAt) but
 * is keyed on (sessionId, stationId) instead of runId since WorkSessions live outside
 * the ticket-runs lifecycle.
 */

export interface WorkSessionEventRecord {
  id: number;
  sessionId: string;
  stationId: string;
  phase: string;
  eventType: string;
  metadata: unknown;
  occurredAt: number;
}

export interface AppendWorkSessionEventInput {
  sessionId: string;
  stationId: string;
  phase: string;
  eventType: string;
  metadata?: unknown;
  occurredAt?: number;
}

interface WorkSessionEventRow {
  id: number;
  sessionId: string;
  stationId: string;
  phase: string;
  eventType: string;
  metadataJson: string | null;
  occurredAt: number;
}

const mapRow = (row: WorkSessionEventRow): WorkSessionEventRecord => ({
  id: row.id,
  sessionId: row.sessionId,
  stationId: row.stationId,
  phase: row.phase,
  eventType: row.eventType,
  metadata: row.metadataJson === null ? null : (JSON.parse(row.metadataJson) as unknown),
  occurredAt: row.occurredAt,
});

export const createWorkSessionEventsRepository = (context: DatabasePersistenceContext) => {
  /**
   * Validate an event input and return the canonicalised payload + occurredAt. Pure;
   * does not touch the DB — callers compose with INSERT in a transaction.
   */
  const buildInsertPayload = (input: AppendWorkSessionEventInput) => {
    const sessionId = input.sessionId.trim();
    const stationId = input.stationId.trim();
    const phase = input.phase.trim();
    if (!sessionId || !stationId || !phase || !input.eventType) {
      throw new Error("Work-session events require non-empty sessionId, stationId, phase, and eventType.");
    }
    const eventType = validateWorkSessionEventType(input.eventType);
    return {
      sessionId,
      stationId,
      phase,
      eventType,
      metadata: input.metadata ?? null,
      occurredAt: input.occurredAt ?? Date.now(),
    };
  };

  const insertStatement = context.db.prepare(
    `INSERT INTO work_session_events (session_id, station_id, phase, event_type, metadata_json, occurred_at)
     VALUES (@sessionId, @stationId, @phase, @eventType, @metadataJson, @occurredAt)`,
  );

  /**
   * Insert a single event. Returns the persisted record built from the inputs +
   * `lastInsertRowid` — no follow-up SELECT.
   */
  const appendWorkSessionEvent = (input: AppendWorkSessionEventInput): WorkSessionEventRecord => {
    assertDatabaseWritable(context);
    const payload = buildInsertPayload(input);
    const result = insertStatement.run({
      sessionId: payload.sessionId,
      stationId: payload.stationId,
      phase: payload.phase,
      eventType: payload.eventType,
      metadataJson: serializeJson(payload.metadata),
      occurredAt: payload.occurredAt,
    });
    return {
      id: Number(result.lastInsertRowid),
      sessionId: payload.sessionId,
      stationId: payload.stationId,
      phase: payload.phase,
      eventType: payload.eventType,
      metadata: payload.metadata,
      occurredAt: payload.occurredAt,
    };
  };

  /**
   * Insert N events in a single transaction. Used by the telemetry diff pipeline
   * (multi-event diffs at phase boundaries are common) to coalesce fsyncs.
   */
  const appendWorkSessionEvents = (inputs: readonly AppendWorkSessionEventInput[]): WorkSessionEventRecord[] => {
    if (inputs.length === 0) return [];
    assertDatabaseWritable(context);
    const payloads = inputs.map(buildInsertPayload);
    const insertAll = context.db.transaction((rows: readonly ReturnType<typeof buildInsertPayload>[]) => {
      const records: WorkSessionEventRecord[] = [];
      for (const payload of rows) {
        const result = insertStatement.run({
          sessionId: payload.sessionId,
          stationId: payload.stationId,
          phase: payload.phase,
          eventType: payload.eventType,
          metadataJson: serializeJson(payload.metadata),
          occurredAt: payload.occurredAt,
        });
        records.push({
          id: Number(result.lastInsertRowid),
          sessionId: payload.sessionId,
          stationId: payload.stationId,
          phase: payload.phase,
          eventType: payload.eventType,
          metadata: payload.metadata,
          occurredAt: payload.occurredAt,
        });
      }
      return records;
    });
    return insertAll(payloads);
  };

  const listWorkSessionEvents = (
    sessionId: string,
    options: { beforeId?: number | null; limit?: number } = {},
  ): WorkSessionEventRecord[] => {
    const limit = Math.max(1, Math.min(500, options.limit ?? 50));
    const cursor = options.beforeId ?? null;
    const sql = cursor === null
      ? `SELECT
           id,
           session_id AS sessionId,
           station_id AS stationId,
           phase,
           event_type AS eventType,
           metadata_json AS metadataJson,
           occurred_at AS occurredAt
         FROM work_session_events
         WHERE session_id = @sessionId
         ORDER BY occurred_at DESC, id DESC
         LIMIT @limit`
      : `SELECT
           id,
           session_id AS sessionId,
           station_id AS stationId,
           phase,
           event_type AS eventType,
           metadata_json AS metadataJson,
           occurred_at AS occurredAt
         FROM work_session_events
         WHERE session_id = @sessionId AND id < @cursor
         ORDER BY occurred_at DESC, id DESC
         LIMIT @limit`;
    const params = cursor === null ? { sessionId, limit } : { sessionId, limit, cursor };
    const rows = context.db.prepare(sql).all(params) as unknown as WorkSessionEventRow[];
    return rows.map((row) => mapRow(row));
  };

  /**
   * List most recent events for a station regardless of session id. Used by the renderer's
   * "now playing" surface for the primary station so a fresh session inherits no history
   * but the latest events from the active session show up immediately.
   */
  const listWorkSessionEventsByStation = (
    stationId: string,
    options: { limit?: number } = {},
  ): WorkSessionEventRecord[] => {
    const limit = Math.max(1, Math.min(500, options.limit ?? 50));
    const rows = context.db
      .prepare(
        `SELECT
           id,
           session_id AS sessionId,
           station_id AS stationId,
           phase,
           event_type AS eventType,
           metadata_json AS metadataJson,
           occurred_at AS occurredAt
         FROM work_session_events
         WHERE station_id = @stationId
         ORDER BY occurred_at DESC, id DESC
         LIMIT @limit`,
      )
      .all({ stationId, limit }) as unknown as WorkSessionEventRow[];
    return rows.map((row) => mapRow(row));
  };

  return {
    appendWorkSessionEvent,
    appendWorkSessionEvents,
    listWorkSessionEvents,
    listWorkSessionEventsByStation,
  };
};
