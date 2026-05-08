import { normalizeYouTrackStateMapping } from "@spira/shared";
import type { PermissionRequestPayload, YouTrackStateMapping } from "@spira/shared";
import { type DatabasePersistenceContext, assertDatabaseWritable } from "./context.js";
import {
  getPersistedProviderSessionStateKey,
  normalizeModelProviderId,
  normalizeText,
  normalizeTitle,
  parseStringArray,
  serializeJson,
  tryParseJson,
} from "./helpers.js";
import {
  mapProviderUsageRecordRow,
  mapRuntimeHostResourceRow,
  mapRuntimeLedgerEventRow,
  mapRuntimePermissionRequestRow,
  mapRuntimeSessionRow,
  mapRuntimeSubagentRunRow,
} from "./mappers.js";
import type {
  ProjectRepoMappingRow,
  ProjectWorkspaceConfigRow,
  ProviderUsageRecordRow,
  RuntimeCheckpointRow,
  RuntimeHostResourceRow,
  RuntimeLedgerEventRow,
  RuntimePermissionRequestRow,
  RuntimeSessionRow,
  RuntimeSubagentRunRow,
  SessionStateKeyRow,
  SessionStateRecordRow,
  YouTrackStateMappingRow,
} from "./rows.js";
import type {
  AppendProviderUsageRecordInput,
  AppendRuntimeLedgerEventInput,
  PersistedProviderUsageRecord,
  PersistedRuntimeCheckpointRecord,
  PersistedRuntimeHostResourceRecord,
  PersistedRuntimeLedgerEventRecord,
  PersistedRuntimeSessionRecord,
  PersistedStationRecord,
  ProjectRepoMappingRecord,
  RuntimePermissionRequestRecord,
  RuntimePermissionRequestStatus,
  RuntimeRecoverySummary,
  RuntimeStationStateRecord,
  RuntimeSubagentRunRecord,
  UpsertPersistedStationInput,
  UpsertRuntimeCheckpointInput,
  UpsertRuntimeHostResourceInput,
  UpsertRuntimePermissionRequestInput,
  UpsertRuntimeSessionInput,
  UpsertRuntimeStationStateInput,
  UpsertRuntimeSubagentRunInput,
} from "./types.js";

export const createRuntimePersistence = (context: DatabasePersistenceContext) => {
  const getRuntimeCheckpoint = (checkpointId: string): PersistedRuntimeCheckpointRecord | null => {
    const normalizedCheckpointId = normalizeText(checkpointId);
    if (!normalizedCheckpointId) {
      return null;
    }
    const row = context.db
      .prepare(
        `SELECT
           checkpoint_id AS checkpointId,
           runtime_session_id AS runtimeSessionId,
           station_id AS stationId,
           run_id AS runId,
           kind,
           summary,
           payload_json AS payloadJson,
           created_at AS createdAt
         FROM runtime_checkpoints
         WHERE checkpoint_id = @checkpointId`,
      )
      .get({ checkpointId: normalizedCheckpointId }) as RuntimeCheckpointRow | undefined;
    return row
      ? {
          checkpointId: String(row.checkpointId),
          runtimeSessionId: String(row.runtimeSessionId),
          stationId: row.stationId === null ? null : String(row.stationId),
          runId: row.runId === null ? null : String(row.runId),
          kind: String(row.kind),
          summary: String(row.summary),
          payload: tryParseJson(row.payloadJson) as Record<string, unknown>,
          createdAt: Number(row.createdAt),
        }
      : null;
  };

  const getRuntimeSession = (runtimeSessionId: string): PersistedRuntimeSessionRecord | null => {
    const normalizedRuntimeSessionId = normalizeText(runtimeSessionId);
    if (!normalizedRuntimeSessionId) {
      return null;
    }
    const row = context.db
      .prepare(
        `SELECT
           runtime_session_id AS runtimeSessionId,
           station_id AS stationId,
           run_id AS runId,
           kind,
           contract_json AS contractJson,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM runtime_sessions
         WHERE runtime_session_id = @runtimeSessionId`,
      )
      .get({ runtimeSessionId: normalizedRuntimeSessionId }) as RuntimeSessionRow | undefined;
    return row ? mapRuntimeSessionRow(row) : null;
  };

  const getRuntimeHostResource = (resourceId: string): PersistedRuntimeHostResourceRecord | null => {
    const normalizedResourceId = normalizeText(resourceId);
    if (!normalizedResourceId) {
      return null;
    }
    const row = context.db
      .prepare(
        `SELECT
           resource_id AS resourceId,
           runtime_session_id AS runtimeSessionId,
           station_id AS stationId,
           kind,
           status,
           state_json AS stateJson,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM runtime_host_resources
         WHERE resource_id = @resourceId`,
      )
      .get({ resourceId: normalizedResourceId }) as RuntimeHostResourceRow | undefined;
    return row ? mapRuntimeHostResourceRow(row) : null;
  };

  const getRuntimePermissionRequest = (requestId: string): RuntimePermissionRequestRecord | null => {
    const row = context.db
      .prepare(
        `SELECT
           request_id AS requestId,
           station_id AS stationId,
           payload_json AS payloadJson,
           status,
           created_at AS createdAt,
           updated_at AS updatedAt,
           resolved_at AS resolvedAt
         FROM runtime_permission_requests
         WHERE request_id = @requestId`,
      )
      .get({ requestId }) as RuntimePermissionRequestRow | undefined;

    return row ? mapRuntimePermissionRequestRow(row) : null;
  };

  const getRuntimeSubagentRun = (runId: string): RuntimeSubagentRunRecord | null => {
    const row = context.db
      .prepare(
        `SELECT
           run_id AS runId,
           station_id AS stationId,
           snapshot_json AS snapshotJson,
           status,
           created_at AS createdAt,
           updated_at AS updatedAt,
           expires_at AS expiresAt
         FROM runtime_subagent_runs
         WHERE run_id = @runId`,
      )
      .get({ runId }) as RuntimeSubagentRunRow | undefined;

    return row ? mapRuntimeSubagentRunRow(row) : null;
  };

  const upsertPersistedStation = (input: UpsertPersistedStationInput): PersistedStationRecord => {
    assertDatabaseWritable(context);
    const stationId = normalizeText(input.stationId);
    const label = normalizeText(input.label);
    if (!stationId) {
      throw new Error("Persisted station id is required.");
    }
    if (!label) {
      throw new Error("Persisted station label is required.");
    }

    const key = `station-record:${stationId}`;
    const existingRow = context.db
      .prepare(
        `SELECT
           value,
           updated_at AS updatedAt
         FROM session_state
         WHERE key = @key`,
      )
      .get({ key }) as Pick<SessionStateRecordRow, "value" | "updatedAt"> | undefined;
    const parsedExisting = tryParseJson(existingRow?.value ?? null) as Partial<PersistedStationRecord> | null;
    const createdAt =
      typeof parsedExisting?.createdAt === "number" && Number.isFinite(parsedExisting.createdAt)
        ? parsedExisting.createdAt
        : (input.createdAt ?? Date.now());
    const updatedAt = Date.now();
    const record: PersistedStationRecord = {
      stationId,
      label,
      workingDirectory: normalizeText(input.workingDirectory) ?? null,
      createdAt,
      updatedAt,
    };

    context.db
      .prepare(
        `INSERT INTO session_state (key, value, updated_at)
         VALUES (@key, @value, @updatedAt)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run({
        key,
        value: serializeJson(record),
        updatedAt,
      });

    return record;
  };

  const listPersistedStations = (): PersistedStationRecord[] => {
    const explicitRows = context.db
      .prepare(
        `SELECT
           key,
           value,
           updated_at AS updatedAt
         FROM session_state
         WHERE key LIKE 'station-record:%'
           AND value IS NOT NULL`,
      )
      .all() as SessionStateRecordRow[];

    const records = new Map<string, PersistedStationRecord>();
    for (const row of explicitRows) {
      const stationId = String(row.key).slice("station-record:".length);
      if (!stationId) {
        continue;
      }
      const parsed = tryParseJson(row.value) as Partial<PersistedStationRecord> | null;
      const label = normalizeText(parsed?.label);
      if (!label) {
        continue;
      }
      records.set(stationId, {
        stationId,
        label,
        workingDirectory: normalizeText(parsed?.workingDirectory) ?? null,
        createdAt:
          typeof parsed?.createdAt === "number" && Number.isFinite(parsed.createdAt) ? parsed.createdAt : row.updatedAt,
        updatedAt: row.updatedAt,
      });
    }

    const legacySessionKeys = context.db
      .prepare(
        `SELECT
           key
         FROM session_state
         WHERE key LIKE 'station:%'
           AND value IS NOT NULL`,
      )
      .all() as SessionStateKeyRow[];
    for (const row of legacySessionKeys) {
      const match = /^station:([^:]+):/u.exec(String(row.key));
      const stationId = match?.[1];
      if (!stationId || records.has(stationId)) {
        continue;
      }
      records.set(stationId, {
        stationId,
        label: `Station ${stationId}`,
        workingDirectory: null,
        createdAt: 0,
        updatedAt: 0,
      });
    }

    return [...records.values()].sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.stationId.localeCompare(right.stationId)
        : left.createdAt - right.createdAt,
    );
  };

  const deletePersistedStation = (stationId: string): boolean => {
    assertDatabaseWritable(context);
    const normalizedStationId = normalizeText(stationId);
    if (!normalizedStationId) {
      return false;
    }
    const result = context.db
      .prepare("DELETE FROM session_state WHERE key = @key")
      .run({ key: `station-record:${normalizedStationId}` });
    return result.changes > 0;
  };

  const upsertRuntimeStationState = (input: UpsertRuntimeStationStateInput): RuntimeStationStateRecord => {
    assertDatabaseWritable(context);
    const stationId = normalizeText(input.stationId);
    if (!stationId) {
      throw new Error("Runtime station state requires a station id.");
    }

    const key = `station-runtime:${stationId}`;
    const existingRow = context.db
      .prepare(
        `SELECT
           value,
           updated_at AS updatedAt
         FROM session_state
         WHERE key = @key`,
      )
      .get({ key }) as Pick<SessionStateRecordRow, "value" | "updatedAt"> | undefined;
    const parsedExisting = tryParseJson(existingRow?.value ?? null) as Partial<RuntimeStationStateRecord> | null;
    const updatedAt = input.updatedAt ?? Date.now();
    const record: RuntimeStationStateRecord = {
      stationId,
      state: input.state,
      promptInFlight: input.promptInFlight,
      providerId: input.providerId ?? normalizeModelProviderId(parsedExisting?.providerId),
      activeSessionId: input.activeSessionId ?? null,
      hostManifestHash:
        normalizeTitle(input.hostManifestHash) ??
        (typeof parsedExisting?.hostManifestHash === "string" ? parsedExisting.hostManifestHash : null),
      providerProjectionHash:
        normalizeTitle(input.providerProjectionHash) ??
        (typeof parsedExisting?.providerProjectionHash === "string" ? parsedExisting.providerProjectionHash : null),
      activeToolCalls: input.activeToolCalls ?? [],
      abortRequestedAt: input.abortRequestedAt ?? null,
      recoveryMessage: normalizeTitle(input.recoveryMessage) ?? null,
      createdAt:
        typeof parsedExisting?.createdAt === "number" && Number.isFinite(parsedExisting.createdAt)
          ? parsedExisting.createdAt
          : (input.createdAt ?? updatedAt),
      updatedAt,
    };

    context.db
      .prepare(
        `INSERT INTO session_state (key, value, updated_at)
         VALUES (@key, @value, @updatedAt)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run({
        key,
        value: serializeJson(record),
        updatedAt,
      });

    return record;
  };

  const getRuntimeStationState = (stationId: string): RuntimeStationStateRecord | null => {
    const normalizedStationId = normalizeText(stationId);
    if (!normalizedStationId) {
      return null;
    }

    const row = context.db
      .prepare(
        `SELECT
           value,
           updated_at AS updatedAt
         FROM session_state
         WHERE key = @key`,
      )
      .get({ key: `station-runtime:${normalizedStationId}` }) as
      | Pick<SessionStateRecordRow, "value" | "updatedAt">
      | undefined;
    if (!row?.value) {
      return null;
    }

    const parsed = tryParseJson(row.value) as Partial<RuntimeStationStateRecord> | null;
    return {
      stationId: normalizedStationId,
      state:
        parsed?.state === "listening" ||
        parsed?.state === "transcribing" ||
        parsed?.state === "speaking" ||
        parsed?.state === "thinking" ||
        parsed?.state === "error"
          ? parsed.state
          : "idle",
      promptInFlight: parsed?.promptInFlight === true,
      providerId: normalizeModelProviderId(parsed?.providerId),
      activeSessionId: typeof parsed?.activeSessionId === "string" ? parsed.activeSessionId : null,
      hostManifestHash: typeof parsed?.hostManifestHash === "string" ? parsed.hostManifestHash : null,
      providerProjectionHash: typeof parsed?.providerProjectionHash === "string" ? parsed.providerProjectionHash : null,
      activeToolCalls: Array.isArray(parsed?.activeToolCalls)
        ? parsed.activeToolCalls.flatMap((entry) => {
            if (
              entry &&
              typeof entry === "object" &&
              typeof entry.callId === "string" &&
              typeof entry.toolName === "string" &&
              typeof entry.startedAt === "number" &&
              Number.isFinite(entry.startedAt)
            ) {
              return [
                {
                  callId: entry.callId,
                  toolName: entry.toolName,
                  args: "args" in entry ? entry.args : {},
                  startedAt: entry.startedAt,
                },
              ];
            }
            return [];
          })
        : [],
      abortRequestedAt:
        typeof parsed?.abortRequestedAt === "number" && Number.isFinite(parsed.abortRequestedAt)
          ? parsed.abortRequestedAt
          : null,
      recoveryMessage: normalizeTitle(parsed?.recoveryMessage) ?? null,
      createdAt:
        typeof parsed?.createdAt === "number" && Number.isFinite(parsed.createdAt) ? parsed.createdAt : row.updatedAt,
      updatedAt: row.updatedAt,
    };
  };

  const listRuntimeStationStates = (): RuntimeStationStateRecord[] => {
    const rows = context.db
      .prepare(
        `SELECT
           key
         FROM session_state
         WHERE key LIKE 'station-runtime:%'
           AND value IS NOT NULL`,
      )
      .all() as SessionStateKeyRow[];
    return rows.flatMap((row) => {
      const stationId = String(row.key).slice("station-runtime:".length);
      const record = getRuntimeStationState(stationId);
      return record ? [record] : [];
    });
  };

  const deleteRuntimeStationState = (stationId: string): boolean => {
    assertDatabaseWritable(context);
    const normalizedStationId = normalizeText(stationId);
    if (!normalizedStationId) {
      return false;
    }
    const result = context.db
      .prepare("DELETE FROM session_state WHERE key = @key")
      .run({ key: `station-runtime:${normalizedStationId}` });
    return result.changes > 0;
  };

  const upsertRuntimeSession = (input: UpsertRuntimeSessionInput): PersistedRuntimeSessionRecord => {
    assertDatabaseWritable(context);
    const runtimeSessionId = normalizeText(input.runtimeSessionId);
    if (!runtimeSessionId) {
      throw new Error("Runtime session persistence requires a runtime session id.");
    }
    const updatedAt = input.updatedAt ?? Date.now();
    const existing = context.db
      .prepare(
        `SELECT
           created_at AS createdAt
         FROM runtime_sessions
         WHERE runtime_session_id = @runtimeSessionId`,
      )
      .get({ runtimeSessionId }) as Pick<RuntimeSessionRow, "createdAt"> | undefined;
    context.db
      .prepare(
        `INSERT INTO runtime_sessions (
           runtime_session_id,
           station_id,
           run_id,
           kind,
           contract_json,
           created_at,
           updated_at
         )
         VALUES (@runtimeSessionId, @stationId, @runId, @kind, @contractJson, @createdAt, @updatedAt)
         ON CONFLICT(runtime_session_id) DO UPDATE SET
           station_id = excluded.station_id,
           run_id = excluded.run_id,
           kind = excluded.kind,
           contract_json = excluded.contract_json,
           updated_at = excluded.updated_at`,
      )
      .run({
        runtimeSessionId,
        stationId: normalizeText(input.stationId ?? null) || null,
        runId: normalizeText(input.runId ?? null) || null,
        kind: input.kind,
        contractJson: serializeJson(input.contract),
        createdAt: existing?.createdAt ?? input.createdAt ?? updatedAt,
        updatedAt,
      });

    const record = getRuntimeSession(runtimeSessionId);
    if (!record) {
      throw new Error(`Failed to persist runtime session ${runtimeSessionId}`);
    }
    return record;
  };

  const listRuntimeSessions = (stationId?: string | null): PersistedRuntimeSessionRecord[] => {
    const rows = (
      stationId
        ? context.db
            .prepare(
              `SELECT
                 runtime_session_id AS runtimeSessionId,
                 station_id AS stationId,
                 run_id AS runId,
                 kind,
                 contract_json AS contractJson,
                 created_at AS createdAt,
                 updated_at AS updatedAt
               FROM runtime_sessions
               WHERE station_id = @stationId
               ORDER BY updated_at DESC`,
            )
            .all({ stationId })
        : context.db
            .prepare(
              `SELECT
                 runtime_session_id AS runtimeSessionId,
                 station_id AS stationId,
                 run_id AS runId,
                 kind,
                 contract_json AS contractJson,
                 created_at AS createdAt,
                 updated_at AS updatedAt
               FROM runtime_sessions
               ORDER BY updated_at DESC`,
            )
            .all()
    ) as RuntimeSessionRow[];
    return rows.map(mapRuntimeSessionRow);
  };

  const appendRuntimeLedgerEvent = (input: AppendRuntimeLedgerEventInput): PersistedRuntimeLedgerEventRecord => {
    assertDatabaseWritable(context);
    const eventId = normalizeText(input.eventId);
    const runtimeSessionId = normalizeText(input.runtimeSessionId);
    if (!eventId || !runtimeSessionId) {
      throw new Error("Runtime ledger events require non-empty event and session ids.");
    }
    const occurredAt = input.occurredAt ?? Date.now();
    context.db
      .prepare(
        `INSERT INTO runtime_ledger_events (
           event_id,
           runtime_session_id,
           station_id,
           run_id,
           event_type,
           payload_json,
           occurred_at
         )
         VALUES (@eventId, @runtimeSessionId, @stationId, @runId, @type, @payloadJson, @occurredAt)
         ON CONFLICT(event_id) DO NOTHING`,
      )
      .run({
        eventId,
        runtimeSessionId,
        stationId: normalizeText(input.stationId ?? null) || null,
        runId: normalizeText(input.runId ?? null) || null,
        type: input.type,
        payloadJson: serializeJson(input.payload),
        occurredAt,
      });

    const row = context.db
      .prepare(
        `SELECT
           id,
           event_id AS eventId,
           runtime_session_id AS runtimeSessionId,
           station_id AS stationId,
           run_id AS runId,
           event_type AS type,
           payload_json AS payloadJson,
           occurred_at AS occurredAt
         FROM runtime_ledger_events
         WHERE event_id = @eventId`,
      )
      .get({ eventId }) as RuntimeLedgerEventRow | undefined;
    if (!row) {
      throw new Error(`Failed to append runtime ledger event ${eventId}`);
    }
    return mapRuntimeLedgerEventRow(row);
  };

  const listRuntimeLedgerEvents = (runtimeSessionId: string): PersistedRuntimeLedgerEventRecord[] => {
    const normalizedRuntimeSessionId = normalizeText(runtimeSessionId);
    if (!normalizedRuntimeSessionId) {
      return [];
    }
    const rows = context.db
      .prepare(
        `SELECT
           id,
           event_id AS eventId,
           runtime_session_id AS runtimeSessionId,
           station_id AS stationId,
           run_id AS runId,
           event_type AS type,
           payload_json AS payloadJson,
           occurred_at AS occurredAt
         FROM runtime_ledger_events
         WHERE runtime_session_id = @runtimeSessionId
         ORDER BY occurred_at ASC, id ASC`,
      )
      .all({ runtimeSessionId: normalizedRuntimeSessionId }) as RuntimeLedgerEventRow[];
    return rows.map(mapRuntimeLedgerEventRow);
  };

  const upsertRuntimeCheckpoint = (input: UpsertRuntimeCheckpointInput): PersistedRuntimeCheckpointRecord => {
    assertDatabaseWritable(context);
    const checkpointId = normalizeText(input.checkpointId);
    const runtimeSessionId = normalizeText(input.runtimeSessionId);
    if (!checkpointId || !runtimeSessionId) {
      throw new Error("Runtime checkpoints require non-empty checkpoint and session ids.");
    }
    const createdAt = input.createdAt ?? Date.now();
    context.db
      .prepare(
        `INSERT INTO runtime_checkpoints (
           checkpoint_id,
           runtime_session_id,
           station_id,
           run_id,
           kind,
           summary,
           payload_json,
           created_at
         )
         VALUES (@checkpointId, @runtimeSessionId, @stationId, @runId, @kind, @summary, @payloadJson, @createdAt)
         ON CONFLICT(checkpoint_id) DO UPDATE SET
           station_id = excluded.station_id,
           run_id = excluded.run_id,
           kind = excluded.kind,
           summary = excluded.summary,
           payload_json = excluded.payload_json,
           created_at = excluded.created_at`,
      )
      .run({
        checkpointId,
        runtimeSessionId,
        stationId: normalizeText(input.stationId ?? null) || null,
        runId: normalizeText(input.runId ?? null) || null,
        kind: input.kind,
        summary: input.summary,
        payloadJson: serializeJson(input.payload),
        createdAt,
      });

    const record = getRuntimeCheckpoint(checkpointId);
    if (!record) {
      throw new Error(`Failed to persist runtime checkpoint ${checkpointId}`);
    }
    return record;
  };

  const getLatestRuntimeCheckpoint = (runtimeSessionId: string): PersistedRuntimeCheckpointRecord | null => {
    const normalizedRuntimeSessionId = normalizeText(runtimeSessionId);
    if (!normalizedRuntimeSessionId) {
      return null;
    }
    const row = context.db
      .prepare(
        `SELECT
           checkpoint_id AS checkpointId,
           runtime_session_id AS runtimeSessionId,
           station_id AS stationId,
           run_id AS runId,
           kind,
           summary,
           payload_json AS payloadJson,
           created_at AS createdAt
         FROM runtime_checkpoints
         WHERE runtime_session_id = @runtimeSessionId
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get({ runtimeSessionId: normalizedRuntimeSessionId }) as RuntimeCheckpointRow | undefined;
    return row
      ? {
          checkpointId: String(row.checkpointId),
          runtimeSessionId: String(row.runtimeSessionId),
          stationId: row.stationId === null ? null : String(row.stationId),
          runId: row.runId === null ? null : String(row.runId),
          kind: String(row.kind),
          summary: String(row.summary),
          payload: tryParseJson(row.payloadJson) as Record<string, unknown>,
          createdAt: Number(row.createdAt),
        }
      : null;
  };

  const upsertRuntimeHostResource = (input: UpsertRuntimeHostResourceInput): PersistedRuntimeHostResourceRecord => {
    assertDatabaseWritable(context);
    const resourceId = normalizeText(input.resourceId);
    const runtimeSessionId = normalizeText(input.runtimeSessionId);
    if (!resourceId || !runtimeSessionId) {
      throw new Error("Runtime host resources require non-empty resource and session ids.");
    }
    const updatedAt = input.updatedAt ?? Date.now();
    const existing = context.db
      .prepare(
        `SELECT
           created_at AS createdAt
         FROM runtime_host_resources
         WHERE resource_id = @resourceId`,
      )
      .get({ resourceId }) as Pick<RuntimeHostResourceRow, "createdAt"> | undefined;
    context.db
      .prepare(
        `INSERT INTO runtime_host_resources (
           resource_id,
           runtime_session_id,
           station_id,
           kind,
           status,
           state_json,
           created_at,
           updated_at
         )
         VALUES (@resourceId, @runtimeSessionId, @stationId, @kind, @status, @stateJson, @createdAt, @updatedAt)
         ON CONFLICT(resource_id) DO UPDATE SET
           runtime_session_id = excluded.runtime_session_id,
           station_id = excluded.station_id,
           kind = excluded.kind,
           status = excluded.status,
           state_json = excluded.state_json,
           updated_at = excluded.updated_at`,
      )
      .run({
        resourceId,
        runtimeSessionId,
        stationId: normalizeText(input.stationId ?? null) || null,
        kind: input.kind,
        status: input.status,
        stateJson: serializeJson(input.state),
        createdAt: existing?.createdAt ?? input.createdAt ?? updatedAt,
        updatedAt,
      });

    const record = getRuntimeHostResource(resourceId);
    if (!record) {
      throw new Error(`Failed to persist runtime host resource ${resourceId}`);
    }
    return record;
  };

  const deleteRuntimeHostResource = (resourceId: string): boolean => {
    const normalizedResourceId = normalizeText(resourceId);
    if (!normalizedResourceId) {
      return false;
    }
    const result = context.db
      .prepare(
        `DELETE FROM runtime_host_resources
         WHERE resource_id = @resourceId`,
      )
      .run({ resourceId: normalizedResourceId });
    return result.changes > 0;
  };

  const listRuntimeHostResources = (runtimeSessionId: string): PersistedRuntimeHostResourceRecord[] => {
    const normalizedRuntimeSessionId = normalizeText(runtimeSessionId);
    if (!normalizedRuntimeSessionId) {
      return [];
    }
    const rows = context.db
      .prepare(
        `SELECT
           resource_id AS resourceId,
           runtime_session_id AS runtimeSessionId,
           station_id AS stationId,
           kind,
           status,
           state_json AS stateJson,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM runtime_host_resources
         WHERE runtime_session_id = @runtimeSessionId
         ORDER BY updated_at DESC`,
      )
      .all({ runtimeSessionId: normalizedRuntimeSessionId }) as RuntimeHostResourceRow[];
    return rows.map(mapRuntimeHostResourceRow);
  };

  const upsertRuntimePermissionRequest = (
    input: UpsertRuntimePermissionRequestInput,
  ): RuntimePermissionRequestRecord => {
    assertDatabaseWritable(context);
    const createdAt = input.createdAt ?? Date.now();
    const stationId = input.stationId ?? input.payload.stationId ?? null;
    const payload: PermissionRequestPayload = {
      ...input.payload,
      ...(stationId ? { stationId } : {}),
    };
    context.db
      .prepare(
        `INSERT INTO runtime_permission_requests (
           request_id,
           station_id,
           payload_json,
           status,
           created_at,
           updated_at,
           resolved_at
         )
         VALUES (@requestId, @stationId, @payloadJson, 'pending', @createdAt, @updatedAt, NULL)
         ON CONFLICT(request_id) DO UPDATE SET
           station_id = excluded.station_id,
           payload_json = excluded.payload_json,
           status = 'pending',
           updated_at = excluded.updated_at,
           resolved_at = NULL`,
      )
      .run({
        requestId: input.requestId,
        stationId,
        payloadJson: serializeJson(payload),
        createdAt,
        updatedAt: createdAt,
      });

    const record = getRuntimePermissionRequest(input.requestId);
    if (!record) {
      throw new Error(`Failed to persist runtime permission request ${input.requestId}`);
    }
    return record;
  };

  const listPendingRuntimePermissionRequests = (stationId?: string | null): RuntimePermissionRequestRecord[] => {
    const rows = (
      stationId
        ? context.db
            .prepare(
              `SELECT
               request_id AS requestId,
               station_id AS stationId,
               payload_json AS payloadJson,
               status,
               created_at AS createdAt,
               updated_at AS updatedAt,
               resolved_at AS resolvedAt
             FROM runtime_permission_requests
             WHERE status = 'pending' AND station_id = @stationId
             ORDER BY updated_at DESC`,
            )
            .all({ stationId })
        : context.db
            .prepare(
              `SELECT
               request_id AS requestId,
               station_id AS stationId,
               payload_json AS payloadJson,
               status,
               created_at AS createdAt,
               updated_at AS updatedAt,
               resolved_at AS resolvedAt
             FROM runtime_permission_requests
             WHERE status = 'pending'
             ORDER BY updated_at DESC`,
            )
            .all()
    ) as RuntimePermissionRequestRow[];

    return rows.map(mapRuntimePermissionRequestRow);
  };

  const resolveRuntimePermissionRequest = (
    requestId: string,
    status: Exclude<RuntimePermissionRequestStatus, "pending">,
    resolvedAt = Date.now(),
  ): boolean => {
    assertDatabaseWritable(context);
    const result = context.db
      .prepare(
        `UPDATE runtime_permission_requests
         SET status = @status,
             updated_at = @resolvedAt,
             resolved_at = @resolvedAt
         WHERE request_id = @requestId AND status = 'pending'`,
      )
      .run({ requestId, status, resolvedAt });
    return result.changes > 0;
  };

  const upsertRuntimeSubagentRun = (input: UpsertRuntimeSubagentRunInput): RuntimeSubagentRunRecord => {
    assertDatabaseWritable(context);
    const createdAt = input.createdAt ?? input.snapshot.startedAt ?? Date.now();
    const updatedAt = input.snapshot.updatedAt;
    const expiresAt = input.snapshot.expiresAt ?? null;
    context.db
      .prepare(
        `INSERT INTO runtime_subagent_runs (
           run_id,
           station_id,
           snapshot_json,
           status,
           created_at,
           updated_at,
           expires_at
         )
         VALUES (@runId, @stationId, @snapshotJson, @status, @createdAt, @updatedAt, @expiresAt)
         ON CONFLICT(run_id) DO UPDATE SET
           station_id = excluded.station_id,
           snapshot_json = excluded.snapshot_json,
           status = excluded.status,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at`,
      )
      .run({
        runId: input.runId,
        stationId: input.stationId ?? null,
        snapshotJson: serializeJson(input.snapshot),
        status: input.snapshot.status,
        createdAt,
        updatedAt,
        expiresAt,
      });

    const record = getRuntimeSubagentRun(input.runId);
    if (!record) {
      throw new Error(`Failed to persist runtime subagent run ${input.runId}`);
    }
    return record;
  };

  const listRuntimeSubagentRuns = (stationId?: string | null): RuntimeSubagentRunRecord[] => {
    const rows = (
      stationId
        ? context.db
            .prepare(
              `SELECT
               run_id AS runId,
               station_id AS stationId,
               snapshot_json AS snapshotJson,
               status,
               created_at AS createdAt,
               updated_at AS updatedAt,
               expires_at AS expiresAt
             FROM runtime_subagent_runs
             WHERE station_id = @stationId
             ORDER BY updated_at DESC`,
            )
            .all({ stationId })
        : context.db
            .prepare(
              `SELECT
               run_id AS runId,
               station_id AS stationId,
               snapshot_json AS snapshotJson,
               status,
               created_at AS createdAt,
               updated_at AS updatedAt,
               expires_at AS expiresAt
             FROM runtime_subagent_runs
             ORDER BY updated_at DESC`,
            )
            .all()
    ) as RuntimeSubagentRunRow[];

    return rows.map(mapRuntimeSubagentRunRow);
  };

  const deleteRuntimeSubagentRun = (runId: string): boolean => {
    assertDatabaseWritable(context);
    const result = context.db
      .prepare(
        `DELETE FROM runtime_subagent_runs
         WHERE run_id = @runId`,
      )
      .run({ runId });
    return result.changes > 0;
  };

  const appendProviderUsageRecord = (input: AppendProviderUsageRecordInput): PersistedProviderUsageRecord => {
    assertDatabaseWritable(context);
    const observedAt = input.observedAt ?? Date.now();
    const result = context.db
      .prepare(
        `INSERT INTO provider_usage_records (
           provider,
           station_id,
           run_id,
           session_id,
           model,
           input_tokens,
           output_tokens,
           total_tokens,
           estimated_cost_usd,
           latency_ms,
           observed_at,
           source
         )
         VALUES (
           @provider,
           @stationId,
           @runId,
           @sessionId,
           @model,
           @inputTokens,
           @outputTokens,
           @totalTokens,
           @estimatedCostUsd,
           @latencyMs,
           @observedAt,
           @source
         )`,
      )
      .run({
        provider: input.provider,
        stationId: input.stationId ?? null,
        runId: input.runId ?? null,
        sessionId: input.sessionId ?? null,
        model: input.model ?? null,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        totalTokens: input.totalTokens ?? null,
        estimatedCostUsd: input.estimatedCostUsd ?? null,
        latencyMs: input.latencyMs ?? null,
        observedAt,
        source: input.source,
      });

    const row = context.db
      .prepare(
        `SELECT
           id,
           provider,
           station_id AS stationId,
           run_id AS runId,
           session_id AS sessionId,
           model,
           input_tokens AS inputTokens,
           output_tokens AS outputTokens,
           total_tokens AS totalTokens,
           estimated_cost_usd AS estimatedCostUsd,
           latency_ms AS latencyMs,
           observed_at AS observedAt,
           source
         FROM provider_usage_records
         WHERE id = @id`,
      )
      .get({ id: result.lastInsertRowid }) as ProviderUsageRecordRow | undefined;

    if (!row) {
      throw new Error("Failed to persist provider usage record");
    }
    return mapProviderUsageRecordRow(row);
  };

  const listProviderUsageRecords = (limit = 100): PersistedProviderUsageRecord[] => {
    const rows = context.db
      .prepare(
        `SELECT
           id,
           provider,
           station_id AS stationId,
           run_id AS runId,
           session_id AS sessionId,
           model,
           input_tokens AS inputTokens,
           output_tokens AS outputTokens,
           total_tokens AS totalTokens,
           estimated_cost_usd AS estimatedCostUsd,
           latency_ms AS latencyMs,
           observed_at AS observedAt,
           source
         FROM provider_usage_records
         ORDER BY observed_at DESC, id DESC
         LIMIT @limit`,
      )
      .all({ limit }) as ProviderUsageRecordRow[];

    return rows.map(mapProviderUsageRecordRow);
  };

  const recoverInterruptedRuntimeState = (now = Date.now()): RuntimeRecoverySummary => {
    assertDatabaseWritable(context);

    const expiredPermissionRequestIds = listPendingRuntimePermissionRequests().map((record) => record.requestId);
    if (expiredPermissionRequestIds.length > 0) {
      context.db
        .prepare(
          `UPDATE runtime_permission_requests
           SET status = 'expired',
               updated_at = @now,
               resolved_at = @now
           WHERE status = 'pending'`,
        )
        .run({ now });
    }

    const recoveredRuns = listRuntimeSubagentRuns().filter((record) => record.snapshot.status === "running");
    for (const record of recoveredRuns) {
      upsertRuntimeSubagentRun({
        runId: record.runId,
        stationId: record.stationId,
        createdAt: record.createdAt,
        snapshot: {
          ...record.snapshot,
          status: "failed",
          summary: "Delegated subagent run ended when the backend restarted.",
          followupNeeded: undefined,
          envelope: undefined,
          updatedAt: now,
          completedAt: now,
          expiresAt: now + 10 * 60_000,
        },
      });
    }

    const recoveredStations = listRuntimeStationStates().filter(
      (record) =>
        record.promptInFlight ||
        record.state === "thinking" ||
        record.activeToolCalls.length > 0 ||
        record.abortRequestedAt,
    );
    for (const record of recoveredStations) {
      context.db.prepare("DELETE FROM session_state WHERE key = @key").run({
        key: getPersistedProviderSessionStateKey(record.stationId),
      });
      upsertRuntimeStationState({
        stationId: record.stationId,
        state: "error",
        promptInFlight: false,
        activeSessionId: null,
        activeToolCalls: [],
        abortRequestedAt: null,
        recoveryMessage: record.abortRequestedAt
          ? "The previous response was interrupted while cancellation was in progress."
          : "The previous response ended when the backend restarted.",
        createdAt: record.createdAt,
        updatedAt: now,
      });
    }

    const unrecoverableHostResources = context.db
      .prepare(
        `SELECT
           resource_id AS resourceId,
           runtime_session_id AS runtimeSessionId,
           station_id AS stationId,
           kind,
           status,
           state_json AS stateJson,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM runtime_host_resources
         WHERE status IN ('running', 'idle')`,
      )
      .all() as RuntimeHostResourceRow[];
    for (const row of unrecoverableHostResources) {
      const record = mapRuntimeHostResourceRow(row);
      upsertRuntimeHostResource({
        resourceId: record.resourceId,
        runtimeSessionId: record.runtimeSessionId,
        stationId: record.stationId,
        kind: record.kind,
        status: "unrecoverable",
        state: {
          ...record.state,
          status: "unrecoverable",
          recoveryNote: "The backend restarted before this host resource could be reattached.",
        },
        createdAt: record.createdAt,
        updatedAt: now,
      });
    }

    return {
      expiredPermissionRequestIds,
      recoveredSubagentRunIds: recoveredRuns.map((record) => record.runId),
      recoveredStationIds: recoveredStations.map((record) => record.stationId),
      unrecoverableHostResourceIds: unrecoverableHostResources.map((record) => record.resourceId),
    };
  };

  const getYouTrackStateMapping = (): YouTrackStateMapping | null => {
    const row = context.db
      .prepare(
        `SELECT
           todo_json AS todoJson,
           in_progress_json AS inProgressJson,
           updated_at AS updatedAt
         FROM youtrack_state_mapping_config
         WHERE id = 1`,
      )
      .get() as YouTrackStateMappingRow | undefined;

    if (!row) {
      return null;
    }

    return normalizeYouTrackStateMapping({
      todo: parseStringArray(row.todoJson),
      inProgress: parseStringArray(row.inProgressJson),
    });
  };

  const setYouTrackStateMapping = (mapping: YouTrackStateMapping): YouTrackStateMapping => {
    assertDatabaseWritable(context);
    const normalizedMapping = normalizeYouTrackStateMapping(mapping);
    const updatedAt = Date.now();

    context.db
      .prepare(
        `INSERT INTO youtrack_state_mapping_config (id, todo_json, in_progress_json, updated_at)
         VALUES (1, @todoJson, @inProgressJson, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           todo_json = excluded.todo_json,
           in_progress_json = excluded.in_progress_json,
           updated_at = excluded.updated_at`,
      )
      .run({
        todoJson: serializeJson(normalizedMapping.todo) ?? "[]",
        inProgressJson: serializeJson(normalizedMapping.inProgress) ?? "[]",
        updatedAt,
      });

    return normalizedMapping;
  };

  const getProjectWorkspaceRoot = (): string | null => {
    const row = context.db
      .prepare(
        `SELECT
           workspace_root AS workspaceRoot
         FROM project_workspace_config
         WHERE id = 1`,
      )
      .get() as ProjectWorkspaceConfigRow | undefined;

    if (!row) {
      return null;
    }

    return row.workspaceRoot === null ? null : String(row.workspaceRoot);
  };

  const setProjectWorkspaceRoot = (workspaceRoot: string | null): void => {
    assertDatabaseWritable(context);
    const updatedAt = Date.now();
    context.db
      .prepare(
        `INSERT INTO project_workspace_config (id, workspace_root, updated_at)
         VALUES (1, @workspaceRoot, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           workspace_root = excluded.workspace_root,
           updated_at = excluded.updated_at`,
      )
      .run({
        workspaceRoot,
        updatedAt,
      });
  };

  const listProjectRepoMappings = (): ProjectRepoMappingRecord[] => {
    const rows = context.db
      .prepare(
        `SELECT
           project_key AS projectKey,
           repo_relative_path AS repoRelativePath,
           updated_at AS updatedAt
         FROM project_repo_mappings
         ORDER BY project_key COLLATE NOCASE ASC, repo_relative_path COLLATE NOCASE ASC`,
      )
      .all() as unknown as ProjectRepoMappingRow[];

    const grouped = new Map<string, ProjectRepoMappingRecord>();
    for (const row of rows) {
      const existing = grouped.get(row.projectKey);
      if (existing) {
        existing.repoRelativePaths.push(String(row.repoRelativePath));
        existing.updatedAt = Math.max(existing.updatedAt, Number(row.updatedAt));
        continue;
      }

      grouped.set(row.projectKey, {
        projectKey: String(row.projectKey),
        repoRelativePaths: [String(row.repoRelativePath)],
        updatedAt: Number(row.updatedAt),
      });
    }

    return [...grouped.values()];
  };

  const setProjectRepoMapping = (
    projectKey: string,
    repoRelativePaths: readonly string[],
  ): ProjectRepoMappingRecord => {
    assertDatabaseWritable(context);
    const normalizedProjectKey = projectKey.trim();
    if (!normalizedProjectKey) {
      throw new Error("Project key cannot be empty.");
    }

    const normalizedPaths = [...new Set(repoRelativePaths.map((pathEntry) => pathEntry.trim()).filter(Boolean))].sort(
      (left, right) => left.localeCompare(right),
    );
    const now = Date.now();

    const replace = context.db.transaction((paths: readonly string[]) => {
      context.db
        .prepare(
          `DELETE FROM project_repo_mappings
           WHERE project_key = @projectKey`,
        )
        .run({ projectKey: normalizedProjectKey });

      const insert = context.db.prepare(
        `INSERT INTO project_repo_mappings (
           project_key,
           repo_relative_path,
           created_at,
           updated_at
         ) VALUES (
           @projectKey,
           @repoRelativePath,
           @createdAt,
           @updatedAt
         )`,
      );

      for (const repoRelativePath of paths) {
        insert.run({
          projectKey: normalizedProjectKey,
          repoRelativePath,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    replace(normalizedPaths);

    return {
      projectKey: normalizedProjectKey,
      repoRelativePaths: normalizedPaths,
      updatedAt: now,
    };
  };

  return {
    upsertPersistedStation,
    listPersistedStations,
    deletePersistedStation,
    upsertRuntimeStationState,
    getRuntimeStationState,
    listRuntimeStationStates,
    deleteRuntimeStationState,
    upsertRuntimeSession,
    getRuntimeSession,
    listRuntimeSessions,
    appendRuntimeLedgerEvent,
    listRuntimeLedgerEvents,
    upsertRuntimeCheckpoint,
    getRuntimeCheckpoint,
    getLatestRuntimeCheckpoint,
    upsertRuntimeHostResource,
    getRuntimeHostResource,
    deleteRuntimeHostResource,
    listRuntimeHostResources,
    upsertRuntimePermissionRequest,
    getRuntimePermissionRequest,
    listPendingRuntimePermissionRequests,
    resolveRuntimePermissionRequest,
    upsertRuntimeSubagentRun,
    getRuntimeSubagentRun,
    listRuntimeSubagentRuns,
    deleteRuntimeSubagentRun,
    appendProviderUsageRecord,
    listProviderUsageRecords,
    recoverInterruptedRuntimeState,
    getYouTrackStateMapping,
    setYouTrackStateMapping,
    getProjectWorkspaceRoot,
    setProjectWorkspaceRoot,
    listProjectRepoMappings,
    setProjectRepoMapping,
  };
};
