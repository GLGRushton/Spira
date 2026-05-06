import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  AssistantState,
  McpServerConfig,
  McpServerSource,
  ModelProviderId,
  PermissionRequestPayload,
  SubagentDomain,
  SubagentRunSnapshot,
  SubagentSource,
  TicketRunAttemptStatus,
  TicketRunAttemptSummary,
  TicketRunCleanupState,
  TicketRunMissionClassification,
  TicketRunMissionClassificationKind,
  TicketRunMissionPhase,
  TicketRunMissionPlan,
  TicketRunMissionProofArtifactMode,
  TicketRunMissionProofLevel,
  TicketRunMissionProofPreflightStatus,
  TicketRunMissionProofStrategy,
  TicketRunMissionSummary,
  TicketRunMissionValidationKind,
  TicketRunMissionValidationRecord,
  TicketRunMissionValidationStatus,
  TicketRunPreviousPassContext,
  TicketRunProofArtifact,
  TicketRunProofArtifactKind,
  TicketRunProofRunStatus,
  TicketRunProofRunSummary,
  TicketRunProofStatus,
  TicketRunProofSummary,
  TicketRunSnapshot,
  TicketRunStatus,
  TicketRunSubmoduleParentRef,
  TicketRunSubmoduleSummary,
  TicketRunSummary,
  TicketRunWorktreeSummary,
  YouTrackStateMapping,
} from "@spira/shared";
import { normalizeMcpToolAccessPolicy, normalizeYouTrackStateMapping, summarizeConversationTitle } from "@spira/shared";
import BetterSqlite3 from "better-sqlite3";

export * from "./database/types.js";

import type {
  ConversationRole,
  ConversationSummary,
  ConversationRecord,
  ConversationMessageRecord,
  ConversationToolCallRecord,
  ConversationSearchResult,
  MemoryEntryRecord,
  MemoryEntryCategory,
  CreateConversationInput,
  AppendConversationMessageInput,
  UpsertToolCallInput,
  RememberMemoryInput,
  UpdateMemoryInput,
  OpenSpiraMemoryDatabaseOptions,
  RuntimePermissionRequestRecord,
  RuntimePermissionRequestStatus,
  UpsertRuntimePermissionRequestInput,
  RuntimeSubagentRunRecord,
  UpsertRuntimeSubagentRunInput,
  PersistedProviderUsageRecord,
  PersistedStationRecord,
  UpsertPersistedStationInput,
  RuntimeStationToolCallRecord,
  RuntimeStationStateRecord,
  UpsertRuntimeStationStateInput,
  AppendProviderUsageRecordInput,
  PersistedRuntimeSessionRecord,
  UpsertRuntimeSessionInput,
  PersistedRuntimeCheckpointRecord,
  UpsertRuntimeCheckpointInput,
  PersistedRuntimeLedgerEventRecord,
  AppendRuntimeLedgerEventInput,
  RuntimeRecoverySummary,
  PersistedRuntimeHostResourceRecord,
  UpsertRuntimeHostResourceInput,
  McpServerConfigRecord,
  UpsertMcpServerConfigInput,
  SubagentConfigRecord,
  UpsertSubagentConfigInput,
  ProjectRepoMappingRecord,
  RepoIntelligenceRecord,
  UpsertRepoIntelligenceInput,
  ValidationProfileRecord,
  UpsertValidationProfileInput,
  ProofRuleRecord,
  UpsertProofRuleInput,
  ProofDecisionRecord,
  UpsertProofDecisionInput,
  MissionEventRecord,
  AppendMissionEventInput,
  UpsertTicketRunWorktreeInput,
  UpsertTicketRunSubmoduleInput,
  UpsertTicketRunInput,
  UpsertTicketRunAttemptInput,
  UpsertTicketRunProofInput,
  UpsertTicketRunValidationInput,
  UpsertTicketRunProofStrategyInput,
  UpsertTicketRunMissionSummaryInput,
  UpsertTicketRunProofArtifactInput,
  UpsertTicketRunProofRunInput,
} from "./database/types.js";
import type {
  ConversationSummaryRow,
  ConversationMessageRow,
  ToolCallRow,
  ConversationSearchRow,
  MemoryEntryRow,
  SessionStateRow,
  SessionStateKeyRow,
  SessionStateRecordRow,
  RuntimePermissionRequestRow,
  RuntimeSubagentRunRow,
  RuntimeSessionRow,
  RuntimeCheckpointRow,
  RuntimeLedgerEventRow,
  RuntimeHostResourceRow,
  ProviderUsageRecordRow,
  ProjectWorkspaceConfigRow,
  ProjectRepoMappingRow,
  RepoIntelligenceRow,
  ValidationProfileRow,
  ProofRuleRow,
  ProofDecisionRow,
  MissionEventRow,
  YouTrackStateMappingRow,
  TicketRunRow,
  TicketRunValidationRow,
  TicketRunProofStrategyRow,
  TicketRunWorktreeRow,
  TicketRunAttemptRow,
  TicketRunSubmoduleRow,
  TicketRunSubmoduleParentRow,
  TicketRunProofRunRow,
  McpServerConfigRow,
  SubagentConfigRow,
} from "./database/rows.js";
import type { SqliteDatabase } from "./database/helpers.js";
import {
  getPersistedProviderSessionStateKey,
  toBoolean,
  tryParseJson,
  serializeJson,
  normalizeTitle,
  normalizeText,
  normalizeModelProviderId,
  parseStringArray,
  normalizeTicketRunSubmoduleParentRefs,
  normalizeStringArray,
  toFtsQuery,
  assertMemoryEntryCategory,
  assertRepoIntelligenceEntryType,
  assertRepoIntelligenceEntrySource,
  assertValidationProfileKind,
  assertTicketRunStatus,
  assertTicketRunAttemptStatus,
  assertTicketRunCleanupState,
  assertTicketRunProofStatus,
  assertTicketRunMissionPhase,
  assertTicketRunMissionClassificationKind,
  assertTicketRunMissionProofArtifactMode,
  assertTicketRunMissionProofLevel,
  assertTicketRunMissionProofPreflightStatus,
  assertTicketRunMissionValidationKind,
  assertTicketRunMissionValidationStatus,
  assertTicketRunProofRunStatus,
  assertTicketRunProofArtifactKind,
  configureDatabase,
  applyMigrations,
} from "./database/helpers.js";
import {
  mapRuntimePermissionRequestRow,
  mapRuntimeSubagentRunRow,
  mapRuntimeSessionRow,
  mapRuntimeCheckpointRow,
  mapRuntimeLedgerEventRow,
  mapRuntimeHostResourceRow,
  mapProviderUsageRecordRow,
  mapMcpServerConfigRow,
  mapSubagentConfigRow,
  mapRepoIntelligenceRow,
  mapValidationProfileRow,
  mapProofRuleRow,
  mapProofDecisionRow,
  mapMissionEventRow,
  mapTicketRunWorktreeRow,
  mapTicketRunAttemptRow,
  mapTicketRunProofSummary,
  mapTicketRunMissionClassification,
  mapTicketRunMissionPlan,
  mapTicketRunMissionSummary,
  mapTicketRunPreviousPassContext,
  mapTicketRunProofRunRow,
  mapTicketRunValidationRow,
  mapTicketRunProofStrategyRow,
  mapTicketRunSubmoduleParentRow,
  mapTicketRunSubmoduleRow,
  mapTicketRunRow,
} from "./database/mappers.js";

export class SpiraMemoryDatabase {
  static open(databasePath: string, options: OpenSpiraMemoryDatabaseOptions = {}): SpiraMemoryDatabase {
    const readonly = options.readonly === true;
    if (!readonly) {
      mkdirSync(path.dirname(databasePath), { recursive: true });
    }

    const db = new BetterSqlite3(databasePath, readonly ? { readonly: true, fileMustExist: true } : undefined);
    configureDatabase(db, readonly);
    if (!readonly) {
      applyMigrations(db);
    }

    return new SpiraMemoryDatabase(db, databasePath, readonly);
  }

  private constructor(
    private readonly db: SqliteDatabase,
    readonly databasePath: string,
    readonly isReadonly: boolean,
  ) {}

  close(): void {
    this.db.close();
  }

  createConversation(input: CreateConversationInput = {}): string {
    this.assertWritable();
    const conversationId = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? Date.now();
    const title = normalizeTitle(input.title);
    this.db
      .prepare(
        `INSERT INTO conversations (id, title, created_at, updated_at, last_viewed_at, archived)
         VALUES (@id, @title, @createdAt, @updatedAt, @lastViewedAt, 0)
         ON CONFLICT(id) DO UPDATE SET
            title = COALESCE(conversations.title, excluded.title),
            updated_at = MAX(conversations.updated_at, excluded.updated_at),
            last_viewed_at = COALESCE(excluded.last_viewed_at, conversations.last_viewed_at),
            archived = 0`,
      )
      .run({
        id: conversationId,
        title,
        createdAt,
        updatedAt: createdAt,
        lastViewedAt: createdAt,
      });
    return conversationId;
  }

  appendMessage(input: AppendConversationMessageInput): void {
    this.assertWritable();
    const title = input.role === "user" ? summarizeConversationTitle(input.content) : null;
    this.createConversation({
      id: input.conversationId,
      title,
      createdAt: input.timestamp,
    });

    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, content, model, was_aborted, auto_speak, timestamp)
         VALUES (@id, @conversationId, @role, @content, @model, @wasAborted, @autoSpeak, @timestamp)
         ON CONFLICT(id) DO UPDATE SET
            conversation_id = excluded.conversation_id,
            role = excluded.role,
            content = excluded.content,
            model = excluded.model,
            was_aborted = excluded.was_aborted,
            auto_speak = excluded.auto_speak,
            timestamp = excluded.timestamp`,
      )
      .run({
        id: input.id,
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        model: input.model ?? null,
        wasAborted: input.wasAborted === true ? 1 : 0,
        autoSpeak: input.autoSpeak === true ? 1 : 0,
        timestamp: input.timestamp,
      });

    this.db
      .prepare("UPDATE conversations SET updated_at = MAX(updated_at, @updatedAt) WHERE id = @id")
      .run({ id: input.conversationId, updatedAt: input.timestamp });
    this.markConversationViewed(input.conversationId, input.timestamp);
  }

  upsertToolCall(input: UpsertToolCallInput): void {
    this.assertWritable();
    const existing = input.callId
      ? (this.db
          .prepare(
            `SELECT id
             FROM tool_calls
             WHERE message_id = @messageId AND call_id = @callId
             ORDER BY id DESC
             LIMIT 1`,
          )
          .get({
            messageId: input.messageId,
            callId: input.callId,
          }) as { id: number } | undefined)
      : (this.db
          .prepare(
            `SELECT id
             FROM tool_calls
             WHERE message_id = @messageId AND name = @name AND call_id IS NULL
             ORDER BY id DESC
             LIMIT 1`,
          )
          .get({
            messageId: input.messageId,
            name: input.name,
          }) as { id: number } | undefined);

    const payload = {
      id: existing?.id,
      messageId: input.messageId,
      callId: input.callId ?? null,
      name: input.name,
      args: serializeJson(input.args),
      result: serializeJson(input.result),
      status: input.status ?? null,
      details: input.details ?? null,
    };

    if (existing) {
      this.db
        .prepare(
          `UPDATE tool_calls
           SET call_id = @callId,
               name = @name,
               args = @args,
               result = @result,
               status = @status,
               details = @details
           WHERE id = @id`,
        )
        .run(payload);
      return;
    }

    this.db
      .prepare(
        `INSERT INTO tool_calls (message_id, call_id, name, args, result, status, details)
         VALUES (@messageId, @callId, @name, @args, @result, @status, @details)`,
      )
      .run(payload);
  }

  listConversations(limit = 20, offset = 0): ConversationSummary[] {
    const rows = this.db
      .prepare(
        `SELECT
           c.id,
           c.title,
           c.created_at AS createdAt,
           c.updated_at AS updatedAt,
           c.last_viewed_at AS lastViewedAt,
           COUNT(m.id) AS messageCount,
           MAX(m.timestamp) AS lastMessageAt
          FROM conversations c
          LEFT JOIN messages m ON m.conversation_id = c.id
          WHERE c.archived = 0
          GROUP BY c.id, c.title, c.created_at, c.updated_at, c.last_viewed_at
          ORDER BY COALESCE(c.last_viewed_at, MAX(m.timestamp), c.updated_at) DESC
          LIMIT @limit OFFSET @offset`,
      )
      .all({ limit, offset }) as unknown as ConversationSummaryRow[];

    return rows.map((row) => ({
      id: String(row.id),
      title: row.title === null ? null : String(row.title),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
      messageCount: Number(row.messageCount),
      lastMessageAt: row.lastMessageAt === null ? null : Number(row.lastMessageAt),
      lastViewedAt: row.lastViewedAt === null ? null : Number(row.lastViewedAt),
    }));
  }

  getConversation(conversationId: string): ConversationRecord | null {
    const summary = this.db
      .prepare(
        `SELECT
           c.id,
           c.title,
           c.created_at AS createdAt,
           c.updated_at AS updatedAt,
           c.last_viewed_at AS lastViewedAt,
           COUNT(m.id) AS messageCount,
           MAX(m.timestamp) AS lastMessageAt
          FROM conversations c
          LEFT JOIN messages m ON m.conversation_id = c.id
          WHERE c.id = @conversationId AND c.archived = 0
          GROUP BY c.id, c.title, c.created_at, c.updated_at, c.last_viewed_at`,
      )
      .get({ conversationId }) as ConversationSummaryRow | undefined;

    if (!summary) {
      return null;
    }

    const toolCallsByMessageId = new Map<string, ConversationToolCallRecord[]>();
    const toolCallRows = this.db
      .prepare(
        `SELECT
           message_id AS messageId,
           call_id AS callId,
           name,
           args,
           result,
           status,
           details
         FROM tool_calls
         WHERE message_id IN (
           SELECT id
           FROM messages
           WHERE conversation_id = @conversationId
         )
         ORDER BY id ASC`,
      )
      .all({ conversationId }) as unknown as ToolCallRow[];

    for (const row of toolCallRows) {
      const messageId = String(row.messageId);
      const toolCalls = toolCallsByMessageId.get(messageId) ?? [];
      toolCalls.push({
        callId: row.callId === null ? null : String(row.callId),
        name: String(row.name),
        args: tryParseJson(row.args),
        result: tryParseJson(row.result),
        status: row.status === null ? null : (String(row.status) as "pending" | "running" | "success" | "error"),
        details: row.details === null ? null : String(row.details),
      });
      toolCallsByMessageId.set(messageId, toolCalls);
    }

    const messages = (
      this.db
        .prepare(
          `SELECT
           id,
           conversation_id AS conversationId,
           role,
           content,
           model,
           timestamp,
           was_aborted AS wasAborted,
           auto_speak AS autoSpeak
         FROM messages
         WHERE conversation_id = @conversationId
         ORDER BY timestamp ASC, rowid ASC`,
        )
        .all({ conversationId }) as unknown as ConversationMessageRow[]
    ).map((row) => ({
      id: String(row.id),
      conversationId: String(row.conversationId),
      role: String(row.role) as ConversationRole,
      content: String(row.content),
      model: row.model === null ? null : String(row.model),
      timestamp: Number(row.timestamp),
      wasAborted: toBoolean(Number(row.wasAborted)),
      autoSpeak: toBoolean(Number(row.autoSpeak)),
      toolCalls: toolCallsByMessageId.get(String(row.id)) ?? [],
    }));

    return {
      id: String(summary.id),
      title: summary.title === null ? null : String(summary.title),
      createdAt: Number(summary.createdAt),
      updatedAt: Number(summary.updatedAt),
      messageCount: Number(summary.messageCount),
      lastMessageAt: summary.lastMessageAt === null ? null : Number(summary.lastMessageAt),
      lastViewedAt: summary.lastViewedAt === null ? null : Number(summary.lastViewedAt),
      messages,
    };
  }

  getMostRecentConversation(): ConversationRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           c.id
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.archived = 0
         GROUP BY c.id, c.last_viewed_at, c.updated_at
         ORDER BY COALESCE(c.last_viewed_at, MAX(m.timestamp), c.updated_at) DESC
         LIMIT 1`,
      )
      .get() as { id: string } | undefined;

    if (!row) {
      return null;
    }

    return this.getConversation(String(row.id));
  }

  searchConversationMessages(query: string, limit = 10): ConversationSearchResult[] {
    const ftsQuery = toFtsQuery(query);
    if (!ftsQuery) {
      return [];
    }

    const rows = this.db
      .prepare(
        `SELECT
           m.conversation_id AS conversationId,
           c.title AS conversationTitle,
           m.id AS messageId,
           m.role AS role,
           m.timestamp AS timestamp,
           snippet(messages_fts, 0, '[', ']', ' ... ', 18) AS snippet,
           bm25(messages_fts) AS score
         FROM messages_fts
         JOIN messages m ON m.rowid = messages_fts.rowid
         JOIN conversations c ON c.id = m.conversation_id
         WHERE messages_fts MATCH @query AND c.archived = 0
         ORDER BY score ASC, m.timestamp DESC
         LIMIT @limit`,
      )
      .all({ query: ftsQuery, limit }) as unknown as ConversationSearchRow[];

    return rows.map((row) => ({
      conversationId: String(row.conversationId),
      conversationTitle: row.conversationTitle === null ? null : String(row.conversationTitle),
      messageId: String(row.messageId),
      role: String(row.role) as ConversationRole,
      timestamp: Number(row.timestamp),
      snippet: String(row.snippet),
      score: Number(row.score),
    }));
  }

  markConversationViewed(conversationId: string, timestamp = Date.now()): boolean {
    this.assertWritable();
    const result = this.db
      .prepare(
        `UPDATE conversations
         SET last_viewed_at = @timestamp,
             updated_at = MAX(updated_at, @timestamp)
         WHERE id = @conversationId AND archived = 0`,
      )
      .run({ conversationId, timestamp });

    return result.changes > 0;
  }

  archiveConversation(conversationId: string, timestamp = Date.now()): boolean {
    this.assertWritable();
    const result = this.db
      .prepare(
        `UPDATE conversations
         SET archived = 1,
             updated_at = MAX(updated_at, @timestamp)
         WHERE id = @conversationId AND archived = 0`,
      )
      .run({ conversationId, timestamp });

    return result.changes > 0;
  }

  getSessionState(key: string): string | null {
    const row = this.db
      .prepare(
        `SELECT
           value
         FROM session_state
         WHERE key = @key`,
      )
      .get({ key }) as SessionStateRow | undefined;

    if (!row) {
      return null;
    }

    return row.value === null ? null : String(row.value);
  }

  setSessionState(key: string, value: string | null): void {
    this.assertWritable();
    if (value === null) {
      this.db
        .prepare(
          `DELETE FROM session_state
           WHERE key = @key`,
        )
        .run({ key });
      return;
    }

    const normalizedValue = value.trim();
    if (!normalizedValue) {
      throw new Error("Session state values cannot be empty.");
    }

    const updatedAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO session_state (key, value, updated_at)
         VALUES (@key, @value, @updatedAt)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run({
        key,
        value: normalizedValue,
        updatedAt,
      });
  }

  upsertPersistedStation(input: UpsertPersistedStationInput): PersistedStationRecord {
    this.assertWritable();
    const stationId = normalizeText(input.stationId);
    const label = normalizeText(input.label);
    if (!stationId) {
      throw new Error("Persisted station id is required.");
    }
    if (!label) {
      throw new Error("Persisted station label is required.");
    }

    const key = `station-record:${stationId}`;
    const existingRow = this.db
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

    this.db
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
  }

  listPersistedStations(): PersistedStationRecord[] {
    const explicitRows = this.db
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

    const legacySessionKeys = this.db
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
  }

  deletePersistedStation(stationId: string): boolean {
    this.assertWritable();
    const normalizedStationId = normalizeText(stationId);
    if (!normalizedStationId) {
      return false;
    }
    const result = this.db
      .prepare("DELETE FROM session_state WHERE key = @key")
      .run({ key: `station-record:${normalizedStationId}` });
    return result.changes > 0;
  }

  upsertRuntimeStationState(input: UpsertRuntimeStationStateInput): RuntimeStationStateRecord {
    this.assertWritable();
    const stationId = normalizeText(input.stationId);
    if (!stationId) {
      throw new Error("Runtime station state requires a station id.");
    }

    const key = `station-runtime:${stationId}`;
    const existingRow = this.db
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

    this.db
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
  }

  getRuntimeStationState(stationId: string): RuntimeStationStateRecord | null {
    const normalizedStationId = normalizeText(stationId);
    if (!normalizedStationId) {
      return null;
    }

    const row = this.db
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
  }

  listRuntimeStationStates(): RuntimeStationStateRecord[] {
    const rows = this.db
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
      const record = this.getRuntimeStationState(stationId);
      return record ? [record] : [];
    });
  }

  deleteRuntimeStationState(stationId: string): boolean {
    this.assertWritable();
    const normalizedStationId = normalizeText(stationId);
    if (!normalizedStationId) {
      return false;
    }
    const result = this.db
      .prepare("DELETE FROM session_state WHERE key = @key")
      .run({ key: `station-runtime:${normalizedStationId}` });
    return result.changes > 0;
  }

  upsertRuntimeSession(input: UpsertRuntimeSessionInput): PersistedRuntimeSessionRecord {
    this.assertWritable();
    const runtimeSessionId = normalizeText(input.runtimeSessionId);
    if (!runtimeSessionId) {
      throw new Error("Runtime session persistence requires a runtime session id.");
    }
    const updatedAt = input.updatedAt ?? Date.now();
    const existing = this.db
      .prepare(
        `SELECT
           created_at AS createdAt
         FROM runtime_sessions
         WHERE runtime_session_id = @runtimeSessionId`,
      )
      .get({ runtimeSessionId }) as Pick<RuntimeSessionRow, "createdAt"> | undefined;
    this.db
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

    const record = this.getRuntimeSession(runtimeSessionId);
    if (!record) {
      throw new Error(`Failed to persist runtime session ${runtimeSessionId}`);
    }
    return record;
  }

  getRuntimeSession(runtimeSessionId: string): PersistedRuntimeSessionRecord | null {
    const normalizedRuntimeSessionId = normalizeText(runtimeSessionId);
    if (!normalizedRuntimeSessionId) {
      return null;
    }
    const row = this.db
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
  }

  listRuntimeSessions(stationId?: string | null): PersistedRuntimeSessionRecord[] {
    const rows = (
      stationId
        ? this.db
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
        : this.db
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
  }

  appendRuntimeLedgerEvent(input: AppendRuntimeLedgerEventInput): PersistedRuntimeLedgerEventRecord {
    this.assertWritable();
    const eventId = normalizeText(input.eventId);
    const runtimeSessionId = normalizeText(input.runtimeSessionId);
    if (!eventId || !runtimeSessionId) {
      throw new Error("Runtime ledger events require non-empty event and session ids.");
    }
    const occurredAt = input.occurredAt ?? Date.now();
    this.db
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

    const row = this.db
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
  }

  listRuntimeLedgerEvents(runtimeSessionId: string): PersistedRuntimeLedgerEventRecord[] {
    const normalizedRuntimeSessionId = normalizeText(runtimeSessionId);
    if (!normalizedRuntimeSessionId) {
      return [];
    }
    const rows = this.db
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
  }

  upsertRuntimeCheckpoint(input: UpsertRuntimeCheckpointInput): PersistedRuntimeCheckpointRecord {
    this.assertWritable();
    const checkpointId = normalizeText(input.checkpointId);
    const runtimeSessionId = normalizeText(input.runtimeSessionId);
    if (!checkpointId || !runtimeSessionId) {
      throw new Error("Runtime checkpoints require non-empty checkpoint and session ids.");
    }
    const createdAt = input.createdAt ?? Date.now();
    this.db
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

    const record = this.getRuntimeCheckpoint(checkpointId);
    if (!record) {
      throw new Error(`Failed to persist runtime checkpoint ${checkpointId}`);
    }
    return record;
  }

  getRuntimeCheckpoint(checkpointId: string): PersistedRuntimeCheckpointRecord | null {
    const normalizedCheckpointId = normalizeText(checkpointId);
    if (!normalizedCheckpointId) {
      return null;
    }
    const row = this.db
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
    return row ? mapRuntimeCheckpointRow(row) : null;
  }

  getLatestRuntimeCheckpoint(runtimeSessionId: string): PersistedRuntimeCheckpointRecord | null {
    const normalizedRuntimeSessionId = normalizeText(runtimeSessionId);
    if (!normalizedRuntimeSessionId) {
      return null;
    }
    const row = this.db
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
    return row ? mapRuntimeCheckpointRow(row) : null;
  }

  upsertRuntimeHostResource(input: UpsertRuntimeHostResourceInput): PersistedRuntimeHostResourceRecord {
    this.assertWritable();
    const resourceId = normalizeText(input.resourceId);
    const runtimeSessionId = normalizeText(input.runtimeSessionId);
    if (!resourceId || !runtimeSessionId) {
      throw new Error("Runtime host resources require non-empty resource and session ids.");
    }
    const updatedAt = input.updatedAt ?? Date.now();
    const existing = this.db
      .prepare(
        `SELECT
           created_at AS createdAt
         FROM runtime_host_resources
         WHERE resource_id = @resourceId`,
      )
      .get({ resourceId }) as Pick<RuntimeHostResourceRow, "createdAt"> | undefined;
    this.db
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

    const record = this.getRuntimeHostResource(resourceId);
    if (!record) {
      throw new Error(`Failed to persist runtime host resource ${resourceId}`);
    }
    return record;
  }

  getRuntimeHostResource(resourceId: string): PersistedRuntimeHostResourceRecord | null {
    const normalizedResourceId = normalizeText(resourceId);
    if (!normalizedResourceId) {
      return null;
    }
    const row = this.db
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
  }

  deleteRuntimeHostResource(resourceId: string): boolean {
    const normalizedResourceId = normalizeText(resourceId);
    if (!normalizedResourceId) {
      return false;
    }
    const result = this.db
      .prepare(
        `DELETE FROM runtime_host_resources
         WHERE resource_id = @resourceId`,
      )
      .run({ resourceId: normalizedResourceId });
    return result.changes > 0;
  }

  listRuntimeHostResources(runtimeSessionId: string): PersistedRuntimeHostResourceRecord[] {
    const normalizedRuntimeSessionId = normalizeText(runtimeSessionId);
    if (!normalizedRuntimeSessionId) {
      return [];
    }
    const rows = this.db
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
  }

  upsertRuntimePermissionRequest(input: UpsertRuntimePermissionRequestInput): RuntimePermissionRequestRecord {
    this.assertWritable();
    const createdAt = input.createdAt ?? Date.now();
    const stationId = input.stationId ?? input.payload.stationId ?? null;
    const payload: PermissionRequestPayload = {
      ...input.payload,
      ...(stationId ? { stationId } : {}),
    };
    this.db
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

    const record = this.getRuntimePermissionRequest(input.requestId);
    if (!record) {
      throw new Error(`Failed to persist runtime permission request ${input.requestId}`);
    }
    return record;
  }

  getRuntimePermissionRequest(requestId: string): RuntimePermissionRequestRecord | null {
    const row = this.db
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
  }

  listPendingRuntimePermissionRequests(stationId?: string | null): RuntimePermissionRequestRecord[] {
    const rows = (
      stationId
        ? this.db
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
        : this.db
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
  }

  resolveRuntimePermissionRequest(
    requestId: string,
    status: Exclude<RuntimePermissionRequestStatus, "pending">,
    resolvedAt = Date.now(),
  ): boolean {
    this.assertWritable();
    const result = this.db
      .prepare(
        `UPDATE runtime_permission_requests
         SET status = @status,
             updated_at = @resolvedAt,
             resolved_at = @resolvedAt
         WHERE request_id = @requestId AND status = 'pending'`,
      )
      .run({ requestId, status, resolvedAt });
    return result.changes > 0;
  }

  upsertRuntimeSubagentRun(input: UpsertRuntimeSubagentRunInput): RuntimeSubagentRunRecord {
    this.assertWritable();
    const createdAt = input.createdAt ?? input.snapshot.startedAt ?? Date.now();
    const updatedAt = input.snapshot.updatedAt;
    const expiresAt = input.snapshot.expiresAt ?? null;
    this.db
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

    const record = this.getRuntimeSubagentRun(input.runId);
    if (!record) {
      throw new Error(`Failed to persist runtime subagent run ${input.runId}`);
    }
    return record;
  }

  getRuntimeSubagentRun(runId: string): RuntimeSubagentRunRecord | null {
    const row = this.db
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
  }

  listRuntimeSubagentRuns(stationId?: string | null): RuntimeSubagentRunRecord[] {
    const rows = (
      stationId
        ? this.db
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
        : this.db
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
  }

  deleteRuntimeSubagentRun(runId: string): boolean {
    this.assertWritable();
    const result = this.db
      .prepare(
        `DELETE FROM runtime_subagent_runs
         WHERE run_id = @runId`,
      )
      .run({ runId });
    return result.changes > 0;
  }

  appendProviderUsageRecord(input: AppendProviderUsageRecordInput): PersistedProviderUsageRecord {
    this.assertWritable();
    const observedAt = input.observedAt ?? Date.now();
    const result = this.db
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

    const row = this.db
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
  }

  listProviderUsageRecords(limit = 100): PersistedProviderUsageRecord[] {
    const rows = this.db
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
  }

  recoverInterruptedRuntimeState(now = Date.now()): RuntimeRecoverySummary {
    this.assertWritable();

    const expiredPermissionRequestIds = this.listPendingRuntimePermissionRequests().map((record) => record.requestId);
    if (expiredPermissionRequestIds.length > 0) {
      this.db
        .prepare(
          `UPDATE runtime_permission_requests
           SET status = 'expired',
               updated_at = @now,
               resolved_at = @now
           WHERE status = 'pending'`,
        )
        .run({ now });
    }

    const recoveredRuns = this.listRuntimeSubagentRuns().filter((record) => record.snapshot.status === "running");
    for (const record of recoveredRuns) {
      this.upsertRuntimeSubagentRun({
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

    const recoveredStations = this.listRuntimeStationStates().filter(
      (record) =>
        record.promptInFlight ||
        record.state === "thinking" ||
        record.activeToolCalls.length > 0 ||
        record.abortRequestedAt,
    );
    for (const record of recoveredStations) {
      this.setSessionState(getPersistedProviderSessionStateKey(record.stationId), null);
      this.upsertRuntimeStationState({
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

    const unrecoverableHostResources = this.db
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
      this.upsertRuntimeHostResource({
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
  }

  getYouTrackStateMapping(): YouTrackStateMapping | null {
    const row = this.db
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
  }

  setYouTrackStateMapping(mapping: YouTrackStateMapping): YouTrackStateMapping {
    this.assertWritable();
    const normalizedMapping = normalizeYouTrackStateMapping(mapping);
    const updatedAt = Date.now();

    this.db
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
  }

  getProjectWorkspaceRoot(): string | null {
    const row = this.db
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
  }

  setProjectWorkspaceRoot(workspaceRoot: string | null): void {
    this.assertWritable();
    const updatedAt = Date.now();
    this.db
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
  }

  listProjectRepoMappings(): ProjectRepoMappingRecord[] {
    const rows = this.db
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
  }

  setProjectRepoMapping(projectKey: string, repoRelativePaths: readonly string[]): ProjectRepoMappingRecord {
    this.assertWritable();
    const normalizedProjectKey = projectKey.trim();
    if (!normalizedProjectKey) {
      throw new Error("Project key cannot be empty.");
    }

    const normalizedPaths = [...new Set(repoRelativePaths.map((pathEntry) => pathEntry.trim()).filter(Boolean))].sort(
      (left, right) => left.localeCompare(right),
    );
    const now = Date.now();

    const replace = this.db.transaction((paths: readonly string[]) => {
      this.db
        .prepare(
          `DELETE FROM project_repo_mappings
           WHERE project_key = @projectKey`,
        )
        .run({ projectKey: normalizedProjectKey });

      const insert = this.db.prepare(
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
  }

  listRepoIntelligence(
    options: {
      projectKey?: string | null;
      repoRelativePaths?: readonly string[];
      tags?: readonly string[];
      includeUnapproved?: boolean;
      limit?: number;
    } = {},
  ): RepoIntelligenceRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
           id,
           project_key AS projectKey,
           repo_relative_path AS repoRelativePath,
           type,
           title,
           content,
           tags_json AS tagsJson,
           source,
           approved,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM repo_intelligence_entries
         ORDER BY approved DESC, updated_at DESC, created_at DESC`,
      )
      .all() as unknown as RepoIntelligenceRow[];

    const normalizedProjectKey = normalizeTitle(options.projectKey) ?? null;
    const repoPathSet = new Set(normalizeStringArray(options.repoRelativePaths));
    const tagSet = new Set(normalizeStringArray(options.tags));
    const includeUnapproved = options.includeUnapproved === true;
    const limit = options.limit ?? 20;

    return rows
      .map((row) => mapRepoIntelligenceRow(row))
      .filter(
        (entry) =>
          (includeUnapproved || entry.approved) &&
          this.matchesScopedRecord(entry, normalizedProjectKey, repoPathSet) &&
          (tagSet.size === 0 || [...tagSet].every((tag) => entry.tags.includes(tag))),
      )
      .slice(0, limit);
  }

  getRepoIntelligenceEntry(entryId: string): RepoIntelligenceRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           project_key AS projectKey,
           repo_relative_path AS repoRelativePath,
           type,
           title,
           content,
           tags_json AS tagsJson,
           source,
           approved,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM repo_intelligence_entries
         WHERE id = @entryId`,
      )
      .get({ entryId }) as RepoIntelligenceRow | undefined;

    return row ? mapRepoIntelligenceRow(row) : null;
  }

  upsertRepoIntelligence(input: UpsertRepoIntelligenceInput): RepoIntelligenceRecord {
    this.assertWritable();
    const now = input.createdAt ?? Date.now();
    const existing = this.getRepoIntelligenceEntry(input.id);
    const payload = {
      id: input.id.trim(),
      projectKey: normalizeTitle(input.projectKey),
      repoRelativePath: normalizeTitle(input.repoRelativePath),
      type: input.type,
      title: input.title.trim(),
      content: input.content.trim(),
      tagsJson: serializeJson(normalizeStringArray(input.tags)) ?? "[]",
      source: input.source,
      approved: input.approved === false ? 0 : 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    assertRepoIntelligenceEntryType(payload.type);
    assertRepoIntelligenceEntrySource(payload.source);
    if (!payload.id || !payload.title || !payload.content) {
      throw new Error("Repo intelligence entries require non-empty id, title, and content.");
    }

    this.db
      .prepare(
        `INSERT INTO repo_intelligence_entries (
           id,
           project_key,
           repo_relative_path,
           type,
           title,
           content,
           tags_json,
           source,
           approved,
           created_at,
           updated_at
         ) VALUES (
           @id,
           @projectKey,
           @repoRelativePath,
           @type,
           @title,
           @content,
           @tagsJson,
           @source,
           @approved,
           @createdAt,
           @updatedAt
         )
         ON CONFLICT(id) DO UPDATE SET
           project_key = excluded.project_key,
           repo_relative_path = excluded.repo_relative_path,
           type = excluded.type,
           title = excluded.title,
           content = excluded.content,
           tags_json = excluded.tags_json,
           source = excluded.source,
           approved = excluded.approved,
           updated_at = excluded.updated_at`,
      )
      .run(payload);

    const saved = this.getRepoIntelligenceEntry(payload.id);
    if (!saved) {
      throw new Error(`Failed to load repo intelligence entry ${payload.id}.`);
    }

    return saved;
  }

  seedBuiltinRepoIntelligence(
    entries: readonly Omit<UpsertRepoIntelligenceInput, "source">[],
  ): RepoIntelligenceRecord[] {
    this.assertWritable();
    const seed = this.db.transaction((items: readonly Omit<UpsertRepoIntelligenceInput, "source">[]) =>
      items.map((entry) =>
        this.upsertRepoIntelligence({
          ...entry,
          source: "builtin",
          approved: this.getRepoIntelligenceEntry(entry.id)?.approved ?? true,
        }),
      ),
    );

    return seed(entries);
  }

  setRepoIntelligenceApproval(entryId: string, approved: boolean): RepoIntelligenceRecord {
    this.assertWritable();
    const existing = this.getRepoIntelligenceEntry(entryId);
    if (!existing) {
      throw new Error(`Repo intelligence entry ${entryId} does not exist.`);
    }

    return this.upsertRepoIntelligence({
      id: existing.id,
      projectKey: existing.projectKey,
      repoRelativePath: existing.repoRelativePath,
      type: existing.type,
      title: existing.title,
      content: existing.content,
      tags: existing.tags,
      source: existing.source,
      approved,
      createdAt: existing.createdAt,
    });
  }

  listValidationProfiles(
    options: {
      projectKey?: string | null;
      repoRelativePaths?: readonly string[];
      limit?: number;
    } = {},
  ): ValidationProfileRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
           id,
           project_key AS projectKey,
           repo_relative_path AS repoRelativePath,
           label,
           kind,
           command,
           working_directory AS workingDirectory,
           notes,
           confidence,
           expected_runtime_ms AS expectedRuntimeMs,
           prerequisites_json AS prerequisitesJson,
           source,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM validation_profiles
         ORDER BY updated_at DESC, created_at DESC`,
      )
      .all() as unknown as ValidationProfileRow[];

    const normalizedProjectKey = normalizeTitle(options.projectKey) ?? null;
    const repoPathSet = new Set(normalizeStringArray(options.repoRelativePaths));
    const limit = options.limit ?? 20;

    return rows
      .map((row) => mapValidationProfileRow(row))
      .filter((entry) => this.matchesScopedRecord(entry, normalizedProjectKey, repoPathSet))
      .slice(0, limit);
  }

  getValidationProfile(profileId: string): ValidationProfileRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           project_key AS projectKey,
           repo_relative_path AS repoRelativePath,
           label,
           kind,
           command,
           working_directory AS workingDirectory,
           notes,
           confidence,
           expected_runtime_ms AS expectedRuntimeMs,
           prerequisites_json AS prerequisitesJson,
           source,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM validation_profiles
         WHERE id = @profileId`,
      )
      .get({ profileId }) as ValidationProfileRow | undefined;

    return row ? mapValidationProfileRow(row) : null;
  }

  upsertValidationProfile(input: UpsertValidationProfileInput): ValidationProfileRecord {
    this.assertWritable();
    const now = input.createdAt ?? Date.now();
    const existing = this.getValidationProfile(input.id);
    const payload = {
      id: input.id.trim(),
      projectKey: normalizeTitle(input.projectKey),
      repoRelativePath: normalizeTitle(input.repoRelativePath),
      label: input.label.trim(),
      kind: input.kind,
      command: input.command.trim(),
      workingDirectory: input.workingDirectory.trim(),
      notes: normalizeTitle(input.notes),
      confidence: Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, input.confidence ?? 0.5)) : 0.5,
      expectedRuntimeMs:
        typeof input.expectedRuntimeMs === "number" && Number.isFinite(input.expectedRuntimeMs)
          ? Math.max(0, input.expectedRuntimeMs)
          : null,
      prerequisitesJson: serializeJson(normalizeStringArray(input.prerequisites)) ?? "[]",
      source: input.source,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    assertValidationProfileKind(payload.kind);
    if (payload.source !== "builtin" && payload.source !== "user") {
      throw new Error(`Unsupported validation profile source: ${payload.source}`);
    }
    if (!payload.id || !payload.label || !payload.command || !payload.workingDirectory) {
      throw new Error("Validation profiles require non-empty id, label, command, and workingDirectory.");
    }

    this.db
      .prepare(
        `INSERT INTO validation_profiles (
           id,
           project_key,
           repo_relative_path,
           label,
           kind,
           command,
           working_directory,
           notes,
           confidence,
           expected_runtime_ms,
           prerequisites_json,
           source,
           created_at,
           updated_at
         ) VALUES (
           @id,
           @projectKey,
           @repoRelativePath,
           @label,
           @kind,
           @command,
           @workingDirectory,
           @notes,
           @confidence,
           @expectedRuntimeMs,
           @prerequisitesJson,
           @source,
           @createdAt,
           @updatedAt
         )
         ON CONFLICT(id) DO UPDATE SET
           project_key = excluded.project_key,
           repo_relative_path = excluded.repo_relative_path,
           label = excluded.label,
           kind = excluded.kind,
           command = excluded.command,
           working_directory = excluded.working_directory,
           notes = excluded.notes,
           confidence = excluded.confidence,
           expected_runtime_ms = excluded.expected_runtime_ms,
           prerequisites_json = excluded.prerequisites_json,
           source = excluded.source,
           updated_at = excluded.updated_at`,
      )
      .run(payload);

    const saved = this.getValidationProfile(payload.id);
    if (!saved) {
      throw new Error(`Failed to load validation profile ${payload.id}.`);
    }

    return saved;
  }

  seedBuiltinValidationProfiles(
    entries: readonly Omit<UpsertValidationProfileInput, "source">[],
  ): ValidationProfileRecord[] {
    this.assertWritable();
    const seed = this.db.transaction((items: readonly Omit<UpsertValidationProfileInput, "source">[]) =>
      items.map((entry) =>
        this.upsertValidationProfile({
          ...entry,
          source: "builtin",
        }),
      ),
    );

    return seed(entries);
  }

  listProofRules(
    options: {
      projectKey?: string | null;
      repoRelativePaths?: readonly string[];
      limit?: number;
    } = {},
  ): ProofRuleRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
           id,
           project_key AS projectKey,
           repo_relative_path AS repoRelativePath,
           classification_kind AS classificationKind,
           ui_change AS uiChange,
           proof_required AS proofRequired,
           summary_keywords_json AS summaryKeywordsJson,
           recommended_level AS recommendedLevel,
           rationale,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM proof_rules
         ORDER BY updated_at DESC, created_at DESC`,
      )
      .all() as unknown as ProofRuleRow[];

    const normalizedProjectKey = normalizeTitle(options.projectKey) ?? null;
    const repoPathSet = new Set(normalizeStringArray(options.repoRelativePaths));
    const limit = options.limit ?? 20;

    return rows
      .map((row) => mapProofRuleRow(row))
      .filter((entry) => this.matchesScopedRecord(entry, normalizedProjectKey, repoPathSet))
      .slice(0, limit);
  }

  getProofRule(ruleId: string): ProofRuleRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           project_key AS projectKey,
           repo_relative_path AS repoRelativePath,
           classification_kind AS classificationKind,
           ui_change AS uiChange,
           proof_required AS proofRequired,
           summary_keywords_json AS summaryKeywordsJson,
           recommended_level AS recommendedLevel,
           rationale,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM proof_rules
         WHERE id = @ruleId`,
      )
      .get({ ruleId }) as ProofRuleRow | undefined;

    return row ? mapProofRuleRow(row) : null;
  }

  upsertProofRule(input: UpsertProofRuleInput): ProofRuleRecord {
    this.assertWritable();
    const now = input.createdAt ?? Date.now();
    const existing = this.getProofRule(input.id);
    const payload = {
      id: input.id.trim(),
      projectKey: normalizeTitle(input.projectKey),
      repoRelativePath: normalizeTitle(input.repoRelativePath),
      classificationKind: input.classificationKind ?? null,
      uiChange: typeof input.uiChange === "boolean" ? (input.uiChange ? 1 : 0) : null,
      proofRequired: typeof input.proofRequired === "boolean" ? (input.proofRequired ? 1 : 0) : null,
      summaryKeywordsJson: serializeJson(normalizeStringArray(input.summaryKeywords)) ?? "[]",
      recommendedLevel: input.recommendedLevel,
      rationale: input.rationale.trim(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (payload.classificationKind !== null) {
      assertTicketRunMissionClassificationKind(payload.classificationKind);
    }
    assertTicketRunMissionProofLevel(payload.recommendedLevel);
    if (!payload.id || !payload.rationale) {
      throw new Error("Proof rules require non-empty id and rationale.");
    }

    this.db
      .prepare(
        `INSERT INTO proof_rules (
           id,
           project_key,
           repo_relative_path,
           classification_kind,
           ui_change,
           proof_required,
           summary_keywords_json,
           recommended_level,
           rationale,
           created_at,
           updated_at
         ) VALUES (
           @id,
           @projectKey,
           @repoRelativePath,
           @classificationKind,
           @uiChange,
           @proofRequired,
           @summaryKeywordsJson,
           @recommendedLevel,
           @rationale,
           @createdAt,
           @updatedAt
         )
         ON CONFLICT(id) DO UPDATE SET
           project_key = excluded.project_key,
           repo_relative_path = excluded.repo_relative_path,
           classification_kind = excluded.classification_kind,
           ui_change = excluded.ui_change,
           proof_required = excluded.proof_required,
           summary_keywords_json = excluded.summary_keywords_json,
           recommended_level = excluded.recommended_level,
           rationale = excluded.rationale,
           updated_at = excluded.updated_at`,
      )
      .run(payload);

    const saved = this.getProofRule(payload.id);
    if (!saved) {
      throw new Error(`Failed to load proof rule ${payload.id}.`);
    }

    return saved;
  }

  seedBuiltinProofRules(entries: readonly Omit<UpsertProofRuleInput, "createdAt">[]): ProofRuleRecord[] {
    this.assertWritable();
    const seed = this.db.transaction((items: readonly Omit<UpsertProofRuleInput, "createdAt">[]) =>
      items.map((entry) => this.upsertProofRule(entry)),
    );

    return seed(entries);
  }

  getProofDecision(runId: string): ProofDecisionRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           attempt_id AS attemptId,
           recommended_level AS recommendedLevel,
           preflight_status AS preflightStatus,
           rationale,
           evidence_json AS evidenceJson,
           repo_relative_paths_json AS repoRelativePathsJson,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM proof_decisions
         WHERE run_id = @runId`,
      )
      .get({ runId }) as ProofDecisionRow | undefined;

    return row ? mapProofDecisionRow(row) : null;
  }

  upsertProofDecision(input: UpsertProofDecisionInput): ProofDecisionRecord {
    this.assertWritable();
    const normalizedRunId = input.runId.trim();
    if (!normalizedRunId) {
      throw new Error("Proof decisions require a non-empty run id.");
    }
    const existing = this.getProofDecision(normalizedRunId);
    const now = input.createdAt ?? Date.now();
    if (input.recommendedLevel !== null && input.recommendedLevel !== undefined) {
      assertTicketRunMissionProofLevel(input.recommendedLevel);
    }
    if (input.preflightStatus !== null && input.preflightStatus !== undefined) {
      assertTicketRunMissionProofPreflightStatus(input.preflightStatus);
    }

    this.db
      .prepare(
        `INSERT INTO proof_decisions (
           run_id,
           attempt_id,
           recommended_level,
           preflight_status,
           rationale,
           evidence_json,
           repo_relative_paths_json,
           created_at,
           updated_at
         ) VALUES (
           @runId,
           @attemptId,
           @recommendedLevel,
           @preflightStatus,
           @rationale,
           @evidenceJson,
           @repoRelativePathsJson,
           @createdAt,
           @updatedAt
         )
         ON CONFLICT(run_id) DO UPDATE SET
           attempt_id = excluded.attempt_id,
           recommended_level = excluded.recommended_level,
           preflight_status = excluded.preflight_status,
           rationale = excluded.rationale,
           evidence_json = excluded.evidence_json,
           repo_relative_paths_json = excluded.repo_relative_paths_json,
           updated_at = excluded.updated_at`,
      )
      .run({
        runId: normalizedRunId,
        attemptId: normalizeTitle(input.attemptId),
        recommendedLevel: input.recommendedLevel ?? null,
        preflightStatus: input.preflightStatus ?? null,
        rationale: normalizeTitle(input.rationale),
        evidenceJson: serializeJson(normalizeStringArray(input.evidence)),
        repoRelativePathsJson: serializeJson(normalizeStringArray(input.repoRelativePaths)),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });

    const saved = this.getProofDecision(normalizedRunId);
    if (!saved) {
      throw new Error(`Failed to load proof decision for ${normalizedRunId}.`);
    }

    return saved;
  }

  appendMissionEvent(input: AppendMissionEventInput): MissionEventRecord {
    this.assertWritable();
    const runId = input.runId.trim();
    const stage = input.stage.trim();
    const eventType = input.eventType.trim();
    if (!runId || !stage || !eventType) {
      throw new Error("Mission events require non-empty runId, stage, and eventType values.");
    }

    const result = this.db
      .prepare(
        `INSERT INTO mission_events (
           run_id,
           attempt_id,
           stage,
           event_type,
           metadata_json,
           occurred_at
         ) VALUES (
           @runId,
           @attemptId,
           @stage,
           @eventType,
           @metadataJson,
           @occurredAt
         )`,
      )
      .run({
        runId,
        attemptId: normalizeTitle(input.attemptId),
        stage,
        eventType,
        metadataJson: serializeJson(input.metadata ?? null),
        occurredAt: input.occurredAt ?? Date.now(),
      });

    const row = this.db
      .prepare(
        `SELECT
           id,
           run_id AS runId,
           attempt_id AS attemptId,
           stage,
           event_type AS eventType,
           metadata_json AS metadataJson,
           occurred_at AS occurredAt
         FROM mission_events
         WHERE id = @id`,
      )
      .get({ id: result.lastInsertRowid }) as MissionEventRow | undefined;

    if (!row) {
      throw new Error(`Failed to load mission event for ${runId}.`);
    }

    return mapMissionEventRow(row);
  }

  listMissionEvents(runId: string, limit = 50): MissionEventRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
           id,
           run_id AS runId,
           attempt_id AS attemptId,
           stage,
           event_type AS eventType,
           metadata_json AS metadataJson,
           occurred_at AS occurredAt
         FROM mission_events
         WHERE run_id = @runId
         ORDER BY occurred_at DESC, id DESC
         LIMIT @limit`,
      )
      .all({ runId, limit }) as unknown as MissionEventRow[];

    return rows.map((row) => mapMissionEventRow(row));
  }

  listTicketRuns(): TicketRunSummary[] {
    const runRows = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           station_id AS stationId,
           ticket_id AS ticketId,
           ticket_summary AS ticketSummary,
           ticket_url AS ticketUrl,
            project_key AS projectKey,
            status,
            status_message AS statusMessage,
            commit_message_draft AS commitMessageDraft,
            mission_phase AS missionPhase,
            mission_phase_updated_at AS missionPhaseUpdatedAt,
           classification_json AS classificationJson,
           plan_json AS planJson,
           summary_json AS summaryJson,
           previous_pass_context_json AS previousPassContextJson,
           proof_status AS proofStatus,
            last_proof_run_id AS lastProofRunId,
            last_proof_profile_id AS lastProofProfileId,
           last_proof_at AS lastProofAt,
           last_proof_summary AS lastProofSummary,
           proof_stale_reason AS proofStaleReason,
           started_at AS startedAt,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM ticket_runs
         ORDER BY updated_at DESC, created_at DESC`,
      )
      .all() as unknown as TicketRunRow[];

    const worktreeRows = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           repo_relative_path AS repoRelativePath,
           repo_absolute_path AS repoAbsolutePath,
           worktree_path AS worktreePath,
           branch_name AS branchName,
           commit_message_draft AS commitMessageDraft,
           cleanup_state AS cleanupState,
           created_at AS createdAt,
           updated_at AS updatedAt
          FROM ticket_run_worktrees
          ORDER BY run_id ASC, repo_relative_path COLLATE NOCASE ASC`,
      )
      .all() as unknown as TicketRunWorktreeRow[];

    const worktreesByRun = new Map<string, TicketRunWorktreeSummary[]>();
    for (const row of worktreeRows) {
      const worktrees = worktreesByRun.get(row.runId) ?? [];
      worktrees.push(mapTicketRunWorktreeRow(row));
      worktreesByRun.set(row.runId, worktrees);
    }

    const attemptRows = this.db
      .prepare(
        `SELECT
           attempt_id AS attemptId,
           run_id AS runId,
           subagent_run_id AS subagentRunId,
           sequence,
           status,
           prompt,
           summary,
           followup_needed AS followupNeeded,
           started_at AS startedAt,
           created_at AS createdAt,
           updated_at AS updatedAt,
           completed_at AS completedAt
         FROM ticket_run_attempts
         ORDER BY run_id ASC, sequence ASC`,
      )
      .all() as unknown as TicketRunAttemptRow[];

    const attemptsByRun = new Map<string, TicketRunAttemptSummary[]>();
    for (const row of attemptRows) {
      const attempts = attemptsByRun.get(row.runId) ?? [];
      attempts.push(mapTicketRunAttemptRow(row));
      attemptsByRun.set(row.runId, attempts);
    }

    const validationRows = this.db
      .prepare(
        `SELECT
           validation_id AS validationId,
           run_id AS runId,
           kind,
           command,
           cwd,
           supersedes_validation_ids_json AS supersedesValidationIdsJson,
           status,
           summary,
           artifacts_json AS artifactsJson,
           started_at AS startedAt,
           completed_at AS completedAt,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM ticket_run_validations
         ORDER BY run_id ASC, started_at DESC, created_at DESC`,
      )
      .all() as unknown as TicketRunValidationRow[];

    const validationsByRun = new Map<string, TicketRunMissionValidationRecord[]>();
    for (const row of validationRows) {
      const validations = validationsByRun.get(row.runId) ?? [];
      validations.push(mapTicketRunValidationRow(row));
      validationsByRun.set(row.runId, validations);
    }

    const proofStrategyRows = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           adapter_id AS adapterId,
           repo_relative_path AS repoRelativePath,
           scenario_path AS scenarioPath,
           scenario_name AS scenarioName,
           command,
           artifact_mode AS artifactMode,
           rationale,
           metadata_json AS metadataJson,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM ticket_run_proof_strategy`,
      )
      .all() as unknown as TicketRunProofStrategyRow[];

    const proofStrategyByRun = new Map<string, TicketRunMissionProofStrategy>();
    for (const row of proofStrategyRows) {
      proofStrategyByRun.set(row.runId, mapTicketRunProofStrategyRow(row));
    }

    const proofRunRows = this.db
      .prepare(
        `SELECT
           proof_run_id AS proofRunId,
           run_id AS runId,
           profile_id AS profileId,
           profile_label AS profileLabel,
           status,
           summary,
           started_at AS startedAt,
           completed_at AS completedAt,
           exit_code AS exitCode,
           command,
           artifacts_json AS artifactsJson
         FROM ticket_run_proof_runs
         ORDER BY run_id ASC, started_at DESC`,
      )
      .all() as unknown as TicketRunProofRunRow[];

    const proofRunsByRun = new Map<string, TicketRunProofRunSummary[]>();
    for (const row of proofRunRows) {
      const proofRuns = proofRunsByRun.get(row.runId) ?? [];
      proofRuns.push(mapTicketRunProofRunRow(row));
      proofRunsByRun.set(row.runId, proofRuns);
    }

    const submoduleRows = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           canonical_url AS canonicalUrl,
           name,
           branch_name AS branchName,
           commit_message_draft AS commitMessageDraft,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM ticket_run_submodules
         ORDER BY run_id ASC, canonical_url COLLATE NOCASE ASC`,
      )
      .all() as unknown as TicketRunSubmoduleRow[];

    const submoduleParentRows = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           canonical_url AS canonicalUrl,
           parent_repo_relative_path AS parentRepoRelativePath,
           submodule_path AS submodulePath,
           submodule_worktree_path AS submoduleWorktreePath
         FROM ticket_run_submodule_parents
         ORDER BY run_id ASC, canonical_url COLLATE NOCASE ASC, parent_repo_relative_path COLLATE NOCASE ASC, submodule_path COLLATE NOCASE ASC`,
      )
      .all() as unknown as TicketRunSubmoduleParentRow[];

    const submoduleParentRefsByKey = new Map<string, TicketRunSubmoduleParentRef[]>();
    for (const row of submoduleParentRows) {
      const key = `${row.runId}\u0000${row.canonicalUrl}`;
      const parentRefs = submoduleParentRefsByKey.get(key) ?? [];
      parentRefs.push(mapTicketRunSubmoduleParentRow(row));
      submoduleParentRefsByKey.set(key, parentRefs);
    }

    const submodulesByRun = new Map<string, TicketRunSubmoduleSummary[]>();
    for (const row of submoduleRows) {
      const key = `${row.runId}\u0000${row.canonicalUrl}`;
      const submodules = submodulesByRun.get(row.runId) ?? [];
      submodules.push(mapTicketRunSubmoduleRow(row, submoduleParentRefsByKey.get(key) ?? []));
      submodulesByRun.set(row.runId, submodules);
    }

    return runRows.map((row) =>
      mapTicketRunRow(
        row,
        worktreesByRun.get(row.runId) ?? [],
        attemptsByRun.get(row.runId) ?? [],
        submodulesByRun.get(row.runId) ?? [],
        validationsByRun.get(row.runId) ?? [],
        proofStrategyByRun.get(row.runId) ?? null,
        proofRunsByRun.get(row.runId) ?? [],
      ),
    );
  }

  getTicketRun(runId: string): TicketRunSummary | null {
    const row = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           station_id AS stationId,
           ticket_id AS ticketId,
           ticket_summary AS ticketSummary,
           ticket_url AS ticketUrl,
            project_key AS projectKey,
            status,
            status_message AS statusMessage,
            commit_message_draft AS commitMessageDraft,
            mission_phase AS missionPhase,
            mission_phase_updated_at AS missionPhaseUpdatedAt,
            classification_json AS classificationJson,
            plan_json AS planJson,
            summary_json AS summaryJson,
            proof_status AS proofStatus,
            last_proof_run_id AS lastProofRunId,
            last_proof_profile_id AS lastProofProfileId,
           last_proof_at AS lastProofAt,
           last_proof_summary AS lastProofSummary,
           proof_stale_reason AS proofStaleReason,
           started_at AS startedAt,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM ticket_runs
         WHERE run_id = @runId`,
      )
      .get({ runId }) as TicketRunRow | undefined;

    if (!row) {
      return null;
    }

    const worktrees = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           repo_relative_path AS repoRelativePath,
           repo_absolute_path AS repoAbsolutePath,
           worktree_path AS worktreePath,
           branch_name AS branchName,
           commit_message_draft AS commitMessageDraft,
           cleanup_state AS cleanupState,
           created_at AS createdAt,
           updated_at AS updatedAt
          FROM ticket_run_worktrees
          WHERE run_id = @runId
         ORDER BY repo_relative_path COLLATE NOCASE ASC`,
      )
      .all({ runId }) as unknown as TicketRunWorktreeRow[];

    const attempts = this.db
      .prepare(
        `SELECT
           attempt_id AS attemptId,
           run_id AS runId,
           subagent_run_id AS subagentRunId,
           sequence,
           status,
           prompt,
           summary,
           followup_needed AS followupNeeded,
           started_at AS startedAt,
           created_at AS createdAt,
           updated_at AS updatedAt,
           completed_at AS completedAt
         FROM ticket_run_attempts
         WHERE run_id = @runId
         ORDER BY sequence ASC`,
      )
      .all({ runId }) as unknown as TicketRunAttemptRow[];

    const validations = this.db
      .prepare(
        `SELECT
           validation_id AS validationId,
           run_id AS runId,
           kind,
           command,
           cwd,
           supersedes_validation_ids_json AS supersedesValidationIdsJson,
           status,
           summary,
           artifacts_json AS artifactsJson,
           started_at AS startedAt,
           completed_at AS completedAt,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM ticket_run_validations
         WHERE run_id = @runId
         ORDER BY started_at DESC, created_at DESC`,
      )
      .all({ runId }) as unknown as TicketRunValidationRow[];

    const proofStrategy = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           adapter_id AS adapterId,
           repo_relative_path AS repoRelativePath,
           scenario_path AS scenarioPath,
           scenario_name AS scenarioName,
           command,
           artifact_mode AS artifactMode,
           rationale,
           metadata_json AS metadataJson,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM ticket_run_proof_strategy
         WHERE run_id = @runId`,
      )
      .get({ runId }) as TicketRunProofStrategyRow | undefined;

    const proofRuns = this.db
      .prepare(
        `SELECT
           proof_run_id AS proofRunId,
           run_id AS runId,
           profile_id AS profileId,
           profile_label AS profileLabel,
           status,
           summary,
           started_at AS startedAt,
           completed_at AS completedAt,
           exit_code AS exitCode,
           command,
           artifacts_json AS artifactsJson
         FROM ticket_run_proof_runs
         WHERE run_id = @runId
         ORDER BY started_at DESC`,
      )
      .all({ runId }) as unknown as TicketRunProofRunRow[];

    const submodules = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           canonical_url AS canonicalUrl,
           name,
           branch_name AS branchName,
           commit_message_draft AS commitMessageDraft,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM ticket_run_submodules
         WHERE run_id = @runId
         ORDER BY canonical_url COLLATE NOCASE ASC`,
      )
      .all({ runId }) as unknown as TicketRunSubmoduleRow[];

    const submoduleParents = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           canonical_url AS canonicalUrl,
           parent_repo_relative_path AS parentRepoRelativePath,
           submodule_path AS submodulePath,
           submodule_worktree_path AS submoduleWorktreePath
         FROM ticket_run_submodule_parents
         WHERE run_id = @runId
         ORDER BY canonical_url COLLATE NOCASE ASC, parent_repo_relative_path COLLATE NOCASE ASC, submodule_path COLLATE NOCASE ASC`,
      )
      .all({ runId }) as unknown as TicketRunSubmoduleParentRow[];

    const submoduleParentRefsByCanonicalUrl = new Map<string, TicketRunSubmoduleParentRef[]>();
    for (const parentRow of submoduleParents) {
      const parentRefs = submoduleParentRefsByCanonicalUrl.get(parentRow.canonicalUrl) ?? [];
      parentRefs.push(mapTicketRunSubmoduleParentRow(parentRow));
      submoduleParentRefsByCanonicalUrl.set(parentRow.canonicalUrl, parentRefs);
    }

    return mapTicketRunRow(
      row,
      worktrees.map((worktree) => mapTicketRunWorktreeRow(worktree)),
      attempts.map((attempt) => mapTicketRunAttemptRow(attempt)),
      submodules.map((submodule) =>
        mapTicketRunSubmoduleRow(submodule, submoduleParentRefsByCanonicalUrl.get(submodule.canonicalUrl) ?? []),
      ),
      validations.map((validation) => mapTicketRunValidationRow(validation)),
      proofStrategy ? mapTicketRunProofStrategyRow(proofStrategy) : null,
      proofRuns.map((proofRun) => mapTicketRunProofRunRow(proofRun)),
    );
  }

  getTicketRunByTicketId(ticketId: string): TicketRunSummary | null {
    const row = this.db
      .prepare(
        `SELECT
            run_id AS runId
          FROM ticket_runs
         WHERE ticket_id = @ticketId`,
      )
      .get({ ticketId }) as { runId: string } | undefined;

    return row ? this.getTicketRun(String(row.runId)) : null;
  }

  deleteTicketRun(runId: string): boolean {
    this.assertWritable();
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      throw new Error("Ticket runs require a non-empty run id to delete.");
    }

    return (
      this.db
        .prepare(
          `DELETE FROM ticket_runs
           WHERE run_id = @runId`,
        )
        .run({ runId: normalizedRunId }).changes > 0
    );
  }

  upsertTicketRun(input: UpsertTicketRunInput): TicketRunSummary {
    this.assertWritable();
    const runId = input.runId.trim();
    const stationId = normalizeTitle(input.stationId);
    const ticketId = input.ticketId.trim();
    const ticketSummary = input.ticketSummary.trim();
    const ticketUrl = input.ticketUrl.trim();
    const projectKey = input.projectKey.trim();
    if (!runId || !ticketId || !ticketSummary || !ticketUrl || !projectKey) {
      throw new Error("Ticket runs require non-empty run, ticket, summary, URL, and project key values.");
    }

    const now = Date.now();
    const createdAt = input.createdAt ?? now;
    const startedAt = input.startedAt ?? createdAt;
    const statusMessage = normalizeTitle(input.statusMessage);
    const status = input.status;
    assertTicketRunStatus(status);
    const normalizedWorktrees = input.worktrees.map((worktree) => {
      const repoRelativePath = worktree.repoRelativePath.trim();
      const repoAbsolutePath = worktree.repoAbsolutePath.trim();
      const worktreePath = worktree.worktreePath.trim();
      const branchName = worktree.branchName.trim();
      if (!repoRelativePath || !repoAbsolutePath || !worktreePath || !branchName) {
        throw new Error("Ticket run worktrees require repo path, absolute path, worktree path, and branch name.");
      }

      const cleanupState = worktree.cleanupState ?? "retained";
      const commitMessageDraft = normalizeTitle(worktree.commitMessageDraft);
      assertTicketRunCleanupState(cleanupState);
      return {
        repoRelativePath,
        repoAbsolutePath,
        worktreePath,
        branchName,
        commitMessageDraft,
        cleanupState,
        createdAt: worktree.createdAt ?? createdAt,
        updatedAt: worktree.updatedAt ?? now,
      };
    });
    const commitMessageDraft = normalizeTitle(
      input.commitMessageDraft ?? normalizedWorktrees[0]?.commitMessageDraft ?? null,
    );
    const normalizedSubmodules = (input.submodules ?? []).map((submodule) => {
      const canonicalUrl = submodule.canonicalUrl.trim();
      const name = submodule.name.trim();
      const branchName = submodule.branchName.trim();
      const commitMessageDraft = normalizeTitle(submodule.commitMessageDraft);
      const parentRefs = normalizeTicketRunSubmoduleParentRefs(submodule.parentRefs);
      if (!canonicalUrl || !name || !branchName || parentRefs.length === 0) {
        throw new Error("Ticket run submodules require a canonical URL, name, branch name, and parent refs.");
      }

      return {
        canonicalUrl,
        name,
        branchName,
        commitMessageDraft,
        parentRefs,
        createdAt: submodule.createdAt ?? createdAt,
        updatedAt: submodule.updatedAt ?? now,
      };
    });
    const normalizedAttempts = (input.attempts ?? []).map((attempt) => {
      const attemptId = attempt.attemptId.trim();
      const prompt = normalizeTitle(attempt.prompt);
      const summary = normalizeTitle(attempt.summary);
      if (!attemptId) {
        throw new Error("Ticket run attempts require a non-empty attempt id.");
      }
      assertTicketRunAttemptStatus(attempt.status);
      return {
        attemptId,
        subagentRunId: normalizeTitle(attempt.subagentRunId),
        sequence: attempt.sequence,
        status: attempt.status,
        prompt,
        summary,
        followupNeeded: attempt.followupNeeded ? 1 : 0,
        startedAt: attempt.startedAt ?? now,
        createdAt: attempt.createdAt ?? now,
        updatedAt: attempt.updatedAt ?? now,
        completedAt: attempt.completedAt ?? null,
      };
    });
    const missionPhase = input.missionPhase ?? "classification";
    assertTicketRunMissionPhase(missionPhase);
    const missionPhaseUpdatedAt = input.missionPhaseUpdatedAt ?? now;
    const normalizedClassification = input.classification
      ? {
          kind: input.classification.kind,
          scopeSummary: input.classification.scopeSummary.trim(),
          acceptanceCriteria: normalizeStringArray(input.classification.acceptanceCriteria),
          impactedRepoRelativePaths: normalizeStringArray(input.classification.impactedRepoRelativePaths),
          risks: normalizeStringArray(input.classification.risks),
          uiChange: input.classification.uiChange,
          proofRequired: input.classification.proofRequired,
          proofArtifactMode: input.classification.proofArtifactMode,
          advisoryProofLevel:
            typeof input.classification.advisoryProofLevel === "string"
              ? input.classification.advisoryProofLevel
              : null,
          advisoryProofRationale: normalizeTitle(input.classification.advisoryProofRationale),
          rationale: normalizeTitle(input.classification.rationale),
          createdAt: input.classification.createdAt ?? now,
          updatedAt: input.classification.updatedAt ?? now,
        }
      : null;
    if (normalizedClassification) {
      assertTicketRunMissionClassificationKind(normalizedClassification.kind);
      assertTicketRunMissionProofArtifactMode(normalizedClassification.proofArtifactMode);
      if (normalizedClassification.advisoryProofLevel !== null) {
        assertTicketRunMissionProofLevel(normalizedClassification.advisoryProofLevel);
      }
      if (!normalizedClassification.scopeSummary) {
        throw new Error("Ticket run classification requires a non-empty scope summary.");
      }
    }
    const normalizedPlan = input.plan
      ? {
          steps: normalizeStringArray(input.plan.steps),
          touchedRepoRelativePaths: normalizeStringArray(input.plan.touchedRepoRelativePaths),
          validationPlan: normalizeStringArray(input.plan.validationPlan),
          proofIntent: normalizeTitle(input.plan.proofIntent),
          blockers: normalizeStringArray(input.plan.blockers),
          assumptions: normalizeStringArray(input.plan.assumptions),
          createdAt: input.plan.createdAt ?? now,
          updatedAt: input.plan.updatedAt ?? now,
        }
      : null;
    const normalizedValidations = (input.validations ?? []).map((validation) => {
      const validationId = validation.validationId.trim();
      const command = validation.command.trim();
      const cwd = validation.cwd.trim();
      if (!validationId || !command || !cwd) {
        throw new Error("Ticket run validations require non-empty id, command, and cwd values.");
      }
      assertTicketRunMissionValidationKind(validation.kind);
      assertTicketRunMissionValidationStatus(validation.status);
      const artifacts = (validation.artifacts ?? []).map((artifact) => {
        const artifactId = artifact.artifactId.trim();
        const label = artifact.label.trim();
        const artifactPath = artifact.path.trim();
        const fileUrl = artifact.fileUrl.trim();
        if (!artifactId || !label || !artifactPath || !fileUrl) {
          throw new Error("Ticket run validation artifacts require non-empty id, label, path, and file URL values.");
        }
        assertTicketRunProofArtifactKind(artifact.kind);
        return {
          artifactId,
          kind: artifact.kind,
          label,
          path: artifactPath,
          fileUrl,
        };
      });
      return {
        validationId,
        kind: validation.kind,
        command,
        cwd,
        supersedesValidationIds: [
          ...new Set(
            (validation.supersedesValidationIds ?? [])
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0 && entry !== validationId),
          ),
        ],
        status: validation.status,
        summary: normalizeTitle(validation.summary),
        artifacts,
        startedAt: validation.startedAt ?? now,
        completedAt: validation.completedAt ?? null,
        createdAt: validation.createdAt ?? now,
        updatedAt: validation.updatedAt ?? now,
      };
    });
    const normalizedProofStrategy = input.proofStrategy
      ? {
          adapterId: input.proofStrategy.adapterId.trim(),
          repoRelativePath: input.proofStrategy.repoRelativePath.trim(),
          scenarioPath: normalizeTitle(input.proofStrategy.scenarioPath),
          scenarioName: normalizeTitle(input.proofStrategy.scenarioName),
          command: input.proofStrategy.command.trim(),
          artifactMode: input.proofStrategy.artifactMode,
          rationale: input.proofStrategy.rationale.trim(),
          metadata: input.proofStrategy.metadata ?? null,
          createdAt: input.proofStrategy.createdAt ?? now,
          updatedAt: input.proofStrategy.updatedAt ?? now,
        }
      : null;
    if (normalizedProofStrategy) {
      assertTicketRunMissionProofArtifactMode(normalizedProofStrategy.artifactMode);
      if (
        !normalizedProofStrategy.adapterId ||
        !normalizedProofStrategy.repoRelativePath ||
        !normalizedProofStrategy.command ||
        !normalizedProofStrategy.rationale
      ) {
        throw new Error(
          "Ticket run proof strategy requires non-empty adapter, repo path, command, and rationale values.",
        );
      }
    }
    const normalizedMissionSummary = input.missionSummary
      ? {
          completedWork: input.missionSummary.completedWork.trim(),
          changedRepoRelativePaths: normalizeStringArray(input.missionSummary.changedRepoRelativePaths),
          validationSummary: normalizeTitle(input.missionSummary.validationSummary),
          proofSummary: normalizeTitle(input.missionSummary.proofSummary),
          openQuestions: normalizeStringArray(input.missionSummary.openQuestions),
          followUps: normalizeStringArray(input.missionSummary.followUps),
          createdAt: input.missionSummary.createdAt ?? now,
          updatedAt: input.missionSummary.updatedAt ?? now,
        }
      : null;
    if (normalizedMissionSummary && !normalizedMissionSummary.completedWork) {
      throw new Error("Ticket run mission summary requires non-empty completed work text.");
    }
    const normalizedPreviousPassContext = input.previousPassContext
      ? {
          attemptId: input.previousPassContext.attemptId.trim(),
          sequence: input.previousPassContext.sequence,
          completedAt: input.previousPassContext.completedAt,
          summary: normalizeTitle(input.previousPassContext.summary),
          classification: input.previousPassContext.classification,
          plan: input.previousPassContext.plan,
          validations: input.previousPassContext.validations ?? [],
          proofStrategy: input.previousPassContext.proofStrategy,
          missionSummary: input.previousPassContext.missionSummary,
          proof: input.previousPassContext.proof,
        }
      : null;
    if (
      normalizedPreviousPassContext &&
      (!normalizedPreviousPassContext.attemptId ||
        !Number.isFinite(normalizedPreviousPassContext.sequence) ||
        !Number.isFinite(normalizedPreviousPassContext.completedAt))
    ) {
      throw new Error("Ticket run previous pass context requires attemptId, sequence, and completedAt.");
    }
    const proofInput = input.proof ?? {};
    const proofStatus = proofInput.status ?? "not-run";
    assertTicketRunProofStatus(proofStatus);
    const normalizedProof = {
      status: proofStatus,
      lastProofRunId: normalizeTitle(proofInput.lastProofRunId),
      lastProofProfileId: normalizeTitle(proofInput.lastProofProfileId),
      lastProofAt: proofInput.lastProofAt ?? null,
      lastProofSummary: normalizeTitle(proofInput.lastProofSummary),
      staleReason: normalizeTitle(proofInput.staleReason),
    };
    const normalizedProofRuns = (input.proofRuns ?? []).map((proofRun) => {
      const proofRunId = proofRun.proofRunId.trim();
      const profileId = proofRun.profileId.trim();
      const profileLabel = proofRun.profileLabel.trim();
      if (!proofRunId || !profileId || !profileLabel) {
        throw new Error("Ticket run proof runs require non-empty proof run, profile id, and profile label values.");
      }
      assertTicketRunProofRunStatus(proofRun.status);
      const artifacts = (proofRun.artifacts ?? []).map((artifact) => {
        const artifactId = artifact.artifactId.trim();
        const kind = artifact.kind;
        const label = artifact.label.trim();
        const artifactPath = artifact.path.trim();
        const fileUrl = artifact.fileUrl.trim();
        if (!artifactId || !label || !artifactPath || !fileUrl) {
          throw new Error("Ticket run proof artifacts require non-empty id, label, path, and file URL values.");
        }
        assertTicketRunProofArtifactKind(kind);
        return {
          artifactId,
          kind,
          label,
          path: artifactPath,
          fileUrl,
        };
      });
      return {
        proofRunId,
        profileId,
        profileLabel,
        status: proofRun.status,
        summary: normalizeTitle(proofRun.summary),
        startedAt: proofRun.startedAt ?? now,
        completedAt: proofRun.completedAt ?? null,
        exitCode: proofRun.exitCode ?? null,
        command: normalizeTitle(proofRun.command),
        artifacts,
      };
    });

    const replace = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO ticket_runs (
             run_id,
             station_id,
             ticket_id,
             ticket_summary,
             ticket_url,
              project_key,
              status,
              status_message,
              commit_message_draft,
              mission_phase,
              mission_phase_updated_at,
              classification_json,
              plan_json,
              summary_json,
              previous_pass_context_json,
              proof_status,
              last_proof_run_id,
              last_proof_profile_id,
             last_proof_at,
             last_proof_summary,
             proof_stale_reason,
             started_at,
             created_at,
             updated_at
           ) VALUES (
             @runId,
             @stationId,
             @ticketId,
             @ticketSummary,
             @ticketUrl,
              @projectKey,
              @status,
              @statusMessage,
              @commitMessageDraft,
              @missionPhase,
              @missionPhaseUpdatedAt,
              @classificationJson,
              @planJson,
              @summaryJson,
              @previousPassContextJson,
              @proofStatus,
              @lastProofRunId,
              @lastProofProfileId,
             @lastProofAt,
             @lastProofSummary,
             @proofStaleReason,
             @startedAt,
             @createdAt,
             @updatedAt
           )
           ON CONFLICT(run_id) DO UPDATE SET
              ticket_id = excluded.ticket_id,
              station_id = excluded.station_id,
              ticket_summary = excluded.ticket_summary,
             ticket_url = excluded.ticket_url,
                project_key = excluded.project_key,
                status = excluded.status,
                status_message = excluded.status_message,
                commit_message_draft = excluded.commit_message_draft,
                mission_phase = excluded.mission_phase,
                mission_phase_updated_at = excluded.mission_phase_updated_at,
                classification_json = excluded.classification_json,
                plan_json = excluded.plan_json,
                summary_json = excluded.summary_json,
                previous_pass_context_json = excluded.previous_pass_context_json,
                proof_status = excluded.proof_status,
                last_proof_run_id = excluded.last_proof_run_id,
                last_proof_profile_id = excluded.last_proof_profile_id,
               last_proof_at = excluded.last_proof_at,
               last_proof_summary = excluded.last_proof_summary,
               proof_stale_reason = excluded.proof_stale_reason,
               started_at = excluded.started_at,
               updated_at = excluded.updated_at`,
        )
        .run({
          runId,
          stationId,
          ticketId,
          ticketSummary,
          ticketUrl,
          projectKey,
          status,
          statusMessage,
          commitMessageDraft,
          missionPhase,
          missionPhaseUpdatedAt,
          classificationJson: serializeJson(normalizedClassification),
          planJson: serializeJson(normalizedPlan),
          summaryJson: serializeJson(normalizedMissionSummary),
          previousPassContextJson: serializeJson(normalizedPreviousPassContext),
          proofStatus: normalizedProof.status,
          lastProofRunId: normalizedProof.lastProofRunId,
          lastProofProfileId: normalizedProof.lastProofProfileId,
          lastProofAt: normalizedProof.lastProofAt,
          lastProofSummary: normalizedProof.lastProofSummary,
          proofStaleReason: normalizedProof.staleReason,
          startedAt,
          createdAt,
          updatedAt: now,
        });

      this.db
        .prepare(
          `DELETE FROM ticket_run_worktrees
           WHERE run_id = @runId`,
        )
        .run({ runId });

      const insert = this.db.prepare(
        `INSERT INTO ticket_run_worktrees (
           run_id,
           repo_relative_path,
           repo_absolute_path,
           worktree_path,
           branch_name,
           commit_message_draft,
           cleanup_state,
           created_at,
           updated_at
         ) VALUES (
           @runId,
           @repoRelativePath,
           @repoAbsolutePath,
           @worktreePath,
           @branchName,
           @commitMessageDraft,
           @cleanupState,
           @createdAt,
           @updatedAt
         )`,
      );

      for (const worktree of normalizedWorktrees) {
        insert.run({
          runId,
          ...worktree,
        });
      }

      this.db
        .prepare(
          `DELETE FROM ticket_run_submodules
           WHERE run_id = @runId`,
        )
        .run({ runId });

      const insertSubmodule = this.db.prepare(
        `INSERT INTO ticket_run_submodules (
           run_id,
           canonical_url,
           name,
           branch_name,
           commit_message_draft,
           created_at,
           updated_at
         ) VALUES (
           @runId,
           @canonicalUrl,
           @name,
           @branchName,
           @commitMessageDraft,
           @createdAt,
           @updatedAt
         )`,
      );

      const insertSubmoduleParent = this.db.prepare(
        `INSERT INTO ticket_run_submodule_parents (
           run_id,
           canonical_url,
           parent_repo_relative_path,
           submodule_path,
           submodule_worktree_path
         ) VALUES (
           @runId,
           @canonicalUrl,
           @parentRepoRelativePath,
           @submodulePath,
           @submoduleWorktreePath
         )`,
      );

      for (const submodule of normalizedSubmodules) {
        insertSubmodule.run({
          runId,
          canonicalUrl: submodule.canonicalUrl,
          name: submodule.name,
          branchName: submodule.branchName,
          commitMessageDraft: submodule.commitMessageDraft,
          createdAt: submodule.createdAt,
          updatedAt: submodule.updatedAt,
        });

        for (const parentRef of submodule.parentRefs) {
          insertSubmoduleParent.run({
            runId,
            canonicalUrl: submodule.canonicalUrl,
            ...parentRef,
          });
        }
      }

      this.db
        .prepare(
          `DELETE FROM ticket_run_attempts
           WHERE run_id = @runId`,
        )
        .run({ runId });

      this.db
        .prepare(
          `DELETE FROM ticket_run_validations
           WHERE run_id = @runId`,
        )
        .run({ runId });

      this.db
        .prepare(
          `DELETE FROM ticket_run_proof_strategy
           WHERE run_id = @runId`,
        )
        .run({ runId });

      const insertAttempt = this.db.prepare(
        `INSERT INTO ticket_run_attempts (
           attempt_id,
           run_id,
           subagent_run_id,
           sequence,
           status,
           prompt,
           summary,
           followup_needed,
           started_at,
           created_at,
           updated_at,
           completed_at
         ) VALUES (
           @attemptId,
           @runId,
           @subagentRunId,
           @sequence,
           @status,
           @prompt,
           @summary,
           @followupNeeded,
           @startedAt,
           @createdAt,
           @updatedAt,
           @completedAt
         )`,
      );

      for (const attempt of normalizedAttempts) {
        insertAttempt.run({
          runId,
          ...attempt,
        });
      }

      const insertValidation = this.db.prepare(
        `INSERT INTO ticket_run_validations (
           validation_id,
           run_id,
           kind,
           command,
           cwd,
           supersedes_validation_ids_json,
           status,
           summary,
           artifacts_json,
           started_at,
           completed_at,
           created_at,
           updated_at
         ) VALUES (
           @validationId,
           @runId,
           @kind,
           @command,
           @cwd,
           @supersedesValidationIdsJson,
           @status,
           @summary,
           @artifactsJson,
           @startedAt,
           @completedAt,
           @createdAt,
           @updatedAt
         )`,
      );

      for (const validation of normalizedValidations) {
        insertValidation.run({
          validationId: validation.validationId,
          runId,
          kind: validation.kind,
          command: validation.command,
          cwd: validation.cwd,
          supersedesValidationIdsJson: serializeJson(validation.supersedesValidationIds),
          status: validation.status,
          summary: validation.summary,
          artifactsJson: serializeJson(validation.artifacts),
          startedAt: validation.startedAt,
          completedAt: validation.completedAt,
          createdAt: validation.createdAt,
          updatedAt: validation.updatedAt,
        });
      }

      if (normalizedProofStrategy) {
        this.db
          .prepare(
            `INSERT INTO ticket_run_proof_strategy (
               run_id,
               adapter_id,
               repo_relative_path,
               scenario_path,
               scenario_name,
               command,
               artifact_mode,
               rationale,
               metadata_json,
               created_at,
               updated_at
             ) VALUES (
               @runId,
               @adapterId,
               @repoRelativePath,
               @scenarioPath,
               @scenarioName,
               @command,
               @artifactMode,
               @rationale,
               @metadataJson,
               @createdAt,
               @updatedAt
             )`,
          )
          .run({
            runId,
            adapterId: normalizedProofStrategy.adapterId,
            repoRelativePath: normalizedProofStrategy.repoRelativePath,
            scenarioPath: normalizedProofStrategy.scenarioPath,
            scenarioName: normalizedProofStrategy.scenarioName,
            command: normalizedProofStrategy.command,
            artifactMode: normalizedProofStrategy.artifactMode,
            rationale: normalizedProofStrategy.rationale,
            metadataJson: serializeJson(normalizedProofStrategy.metadata),
            createdAt: normalizedProofStrategy.createdAt,
            updatedAt: normalizedProofStrategy.updatedAt,
          });
      }

      this.db
        .prepare(
          `DELETE FROM ticket_run_proof_runs
           WHERE run_id = @runId`,
        )
        .run({ runId });

      const insertProofRun = this.db.prepare(
        `INSERT INTO ticket_run_proof_runs (
           proof_run_id,
           run_id,
           profile_id,
           profile_label,
           status,
           summary,
           started_at,
           completed_at,
           exit_code,
           command,
           artifacts_json
         ) VALUES (
           @proofRunId,
           @runId,
           @profileId,
           @profileLabel,
           @status,
           @summary,
           @startedAt,
           @completedAt,
           @exitCode,
           @command,
           @artifactsJson
         )`,
      );

      for (const proofRun of normalizedProofRuns) {
        insertProofRun.run({
          runId,
          proofRunId: proofRun.proofRunId,
          profileId: proofRun.profileId,
          profileLabel: proofRun.profileLabel,
          status: proofRun.status,
          summary: proofRun.summary,
          startedAt: proofRun.startedAt,
          completedAt: proofRun.completedAt,
          exitCode: proofRun.exitCode,
          command: proofRun.command,
          artifactsJson: serializeJson(proofRun.artifacts),
        });
      }
    });

    replace();
    const record = this.getTicketRun(runId);
    if (!record) {
      throw new Error(`Failed to persist ticket run ${runId}.`);
    }
    return record;
  }

  getTicketRunSnapshot(): TicketRunSnapshot {
    return {
      runs: this.listTicketRuns(),
    };
  }

  listMcpServerConfigs(): McpServerConfigRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
           id,
           name,
           description,
           source,
           transport,
           command,
           args_json AS argsJson,
           env_json AS envJson,
           url,
           headers_json AS headersJson,
           tool_access_json AS toolAccessJson,
           enabled,
           auto_restart AS autoRestart,
           max_restarts AS maxRestarts,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM mcp_server_configs
         ORDER BY source ASC, name COLLATE NOCASE ASC`,
      )
      .all() as unknown as McpServerConfigRow[];

    return rows.map(mapMcpServerConfigRow);
  }

  getMcpServerConfig(serverId: string): McpServerConfigRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           name,
           description,
           source,
           transport,
           command,
           args_json AS argsJson,
           env_json AS envJson,
           url,
           headers_json AS headersJson,
           tool_access_json AS toolAccessJson,
           enabled,
           auto_restart AS autoRestart,
           max_restarts AS maxRestarts,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM mcp_server_configs
         WHERE id = @serverId`,
      )
      .get({ serverId }) as McpServerConfigRow | undefined;

    return row ? mapMcpServerConfigRow(row) : null;
  }

  upsertMcpServerConfig(input: UpsertMcpServerConfigInput): McpServerConfigRecord {
    this.assertWritable();
    const now = input.createdAt ?? Date.now();
    const existing = this.getMcpServerConfig(input.id);
    const description = normalizeText(input.description);
    const transportPayload =
      input.transport === "streamable-http"
        ? {
            command: "",
            argsJson: "[]",
            envJson: null,
            url: input.url.trim(),
            headersJson: serializeJson(input.headers ?? {}),
          }
        : {
            command: input.command.trim(),
            argsJson: serializeJson(normalizeStringArray(input.args)) ?? "[]",
            envJson: serializeJson(input.env ?? {}),
            url: null,
            headersJson: null,
          };
    const payload = {
      id: input.id,
      name: input.name.trim(),
      description,
      source: input.source,
      transport: input.transport,
      ...transportPayload,
      toolAccessJson: serializeJson(normalizeMcpToolAccessPolicy(input.toolAccess) ?? null),
      enabled: input.enabled ? 1 : 0,
      autoRestart: input.autoRestart ? 1 : 0,
      maxRestarts: input.maxRestarts ?? 3,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (!payload.name) {
      throw new Error("MCP server name cannot be empty.");
    }
    if (input.transport === "stdio" && !payload.command) {
      throw new Error("MCP server command cannot be empty.");
    }
    if (input.transport === "streamable-http" && !payload.url) {
      throw new Error("MCP server URL cannot be empty.");
    }

    this.db
      .prepare(
        `INSERT INTO mcp_server_configs (
           id,
           name,
           description,
           source,
           transport,
           command,
           args_json,
           env_json,
           url,
           headers_json,
           tool_access_json,
           enabled,
           auto_restart,
           max_restarts,
           created_at,
           updated_at
         ) VALUES (
           @id,
           @name,
           @description,
           @source,
           @transport,
           @command,
           @argsJson,
           @envJson,
           @url,
           @headersJson,
           @toolAccessJson,
           @enabled,
           @autoRestart,
           @maxRestarts,
           @createdAt,
           @updatedAt
         )
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           source = excluded.source,
           transport = excluded.transport,
           command = excluded.command,
           args_json = excluded.args_json,
           env_json = excluded.env_json,
           url = excluded.url,
           headers_json = excluded.headers_json,
           tool_access_json = excluded.tool_access_json,
           enabled = excluded.enabled,
           auto_restart = excluded.auto_restart,
           max_restarts = excluded.max_restarts,
           updated_at = excluded.updated_at`,
      )
      .run(payload);

    const saved = this.getMcpServerConfig(input.id);
    if (!saved) {
      throw new Error(`Failed to load MCP server config ${input.id}.`);
    }

    return saved;
  }

  seedBuiltinMcpServerConfigs(configs: readonly McpServerConfig[]): McpServerConfigRecord[] {
    this.assertWritable();
    const seed = this.db.transaction((items: readonly McpServerConfig[]) =>
      items.map((config) =>
        this.upsertMcpServerConfig({
          ...config,
          description: config.description,
          source: "builtin",
          enabled: this.getMcpServerConfig(config.id)?.enabled ?? config.enabled,
        }),
      ),
    );

    return seed(configs);
  }

  removeMcpServerConfig(serverId: string): boolean {
    this.assertWritable();
    const result = this.db
      .prepare(
        `DELETE FROM mcp_server_configs
         WHERE id = @serverId`,
      )
      .run({ serverId });

    return result.changes > 0;
  }

  setMcpServerEnabled(serverId: string, enabled: boolean): boolean {
    this.assertWritable();
    const result = this.db
      .prepare(
        `UPDATE mcp_server_configs
         SET enabled = @enabled,
             updated_at = @updatedAt
         WHERE id = @serverId`,
      )
      .run({
        serverId,
        enabled: enabled ? 1 : 0,
        updatedAt: Date.now(),
      });

    return result.changes > 0;
  }

  listSubagentConfigs(): SubagentConfigRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
           id,
           label,
           description,
           source,
           system_prompt AS systemPrompt,
           delegation_tool_name AS delegationToolName,
           server_ids_json AS serverIdsJson,
           allowed_tool_names_json AS allowedToolNamesJson,
           allow_writes AS allowWrites,
           ready,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM subagent_configs
         ORDER BY source ASC, label COLLATE NOCASE ASC`,
      )
      .all() as unknown as SubagentConfigRow[];

    return rows.map(mapSubagentConfigRow);
  }

  getSubagentConfig(agentId: string): SubagentConfigRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           label,
           description,
           source,
           system_prompt AS systemPrompt,
           delegation_tool_name AS delegationToolName,
           server_ids_json AS serverIdsJson,
           allowed_tool_names_json AS allowedToolNamesJson,
           allow_writes AS allowWrites,
           ready,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM subagent_configs
         WHERE id = @agentId`,
      )
      .get({ agentId }) as SubagentConfigRow | undefined;

    return row ? mapSubagentConfigRow(row) : null;
  }

  upsertSubagentConfig(input: UpsertSubagentConfigInput): SubagentConfigRecord {
    this.assertWritable();
    const now = input.createdAt ?? Date.now();
    const existing = this.getSubagentConfig(input.id);
    const payload = {
      id: input.id,
      label: input.label.trim(),
      description: normalizeText(input.description),
      source: input.source,
      systemPrompt: normalizeText(input.systemPrompt),
      delegationToolName: input.delegationToolName.trim(),
      serverIdsJson: serializeJson(normalizeStringArray(input.serverIds)) ?? "[]",
      allowedToolNamesJson:
        input.allowedToolNames === null || input.allowedToolNames === undefined
          ? null
          : serializeJson(normalizeStringArray(input.allowedToolNames)),
      allowWrites: input.allowWrites ? 1 : 0,
      ready: input.ready ? 1 : 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (!payload.label) {
      throw new Error("Subagent label cannot be empty.");
    }
    if (!payload.delegationToolName) {
      throw new Error("Subagent delegation tool name cannot be empty.");
    }

    this.db
      .prepare(
        `INSERT INTO subagent_configs (
           id,
           label,
           description,
           source,
           system_prompt,
           delegation_tool_name,
           server_ids_json,
           allowed_tool_names_json,
           allow_writes,
           ready,
           created_at,
           updated_at
         ) VALUES (
           @id,
           @label,
           @description,
           @source,
           @systemPrompt,
           @delegationToolName,
           @serverIdsJson,
           @allowedToolNamesJson,
           @allowWrites,
           @ready,
           @createdAt,
           @updatedAt
         )
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           description = excluded.description,
           source = excluded.source,
           system_prompt = excluded.system_prompt,
           delegation_tool_name = excluded.delegation_tool_name,
           server_ids_json = excluded.server_ids_json,
           allowed_tool_names_json = excluded.allowed_tool_names_json,
           allow_writes = excluded.allow_writes,
           ready = excluded.ready,
           updated_at = excluded.updated_at`,
      )
      .run(payload);

    const saved = this.getSubagentConfig(input.id);
    if (!saved) {
      throw new Error(`Failed to load subagent config ${input.id}.`);
    }

    return saved;
  }

  seedBuiltinSubagentConfigs(configs: readonly SubagentDomain[]): SubagentConfigRecord[] {
    this.assertWritable();
    const seed = this.db.transaction((items: readonly SubagentDomain[]) =>
      items.map((config) =>
        this.upsertSubagentConfig({
          ...config,
          source: "builtin",
          ready: this.getSubagentConfig(config.id)?.ready ?? config.ready,
        }),
      ),
    );

    return seed(configs);
  }

  removeSubagentConfig(agentId: string): boolean {
    this.assertWritable();
    const result = this.db
      .prepare(
        `DELETE FROM subagent_configs
         WHERE id = @agentId`,
      )
      .run({ agentId });

    return result.changes > 0;
  }

  setSubagentReady(agentId: string, ready: boolean): boolean {
    this.assertWritable();
    const result = this.db
      .prepare(
        `UPDATE subagent_configs
         SET ready = @ready,
             updated_at = @updatedAt
         WHERE id = @agentId`,
      )
      .run({
        agentId,
        ready: ready ? 1 : 0,
        updatedAt: Date.now(),
      });

    return result.changes > 0;
  }

  remember(input: RememberMemoryInput): MemoryEntryRecord {
    this.assertWritable();
    const content = input.content.trim();
    if (!content) {
      throw new Error("Memory content cannot be empty.");
    }

    const category = input.category ?? "task-context";
    assertMemoryEntryCategory(category);
    const now = input.createdAt ?? Date.now();
    const memoryId = input.id ?? randomUUID();

    this.db
      .prepare(
        `INSERT INTO memory_entries (
           id,
           category,
           content,
           source_conversation_id,
           source_message_id,
           created_at,
           updated_at,
           archived
         ) VALUES (
           @id,
           @category,
           @content,
           @sourceConversationId,
           @sourceMessageId,
           @createdAt,
           @updatedAt,
           0
         )
         ON CONFLICT(id) DO UPDATE SET
           category = excluded.category,
           content = excluded.content,
           source_conversation_id = excluded.source_conversation_id,
           source_message_id = excluded.source_message_id,
           updated_at = excluded.updated_at,
           archived = 0`,
      )
      .run({
        id: memoryId,
        category,
        content,
        sourceConversationId: input.sourceConversationId ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
        createdAt: now,
        updatedAt: now,
      });

    const record = this.db
      .prepare(
        `SELECT
           id,
           category,
           content,
           source_conversation_id AS sourceConversationId,
           source_message_id AS sourceMessageId,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM memory_entries
         WHERE id = @id`,
      )
      .get({ id: memoryId }) as MemoryEntryRow | undefined;

    if (!record) {
      throw new Error(`Failed to load saved memory entry ${memoryId}.`);
    }

    return {
      id: String(record.id),
      category: String(record.category) as MemoryEntryCategory,
      content: String(record.content),
      sourceConversationId: record.sourceConversationId === null ? null : String(record.sourceConversationId),
      sourceMessageId: record.sourceMessageId === null ? null : String(record.sourceMessageId),
      createdAt: Number(record.createdAt),
      updatedAt: Number(record.updatedAt),
    };
  }

  getMemoryEntry(memoryId: string): MemoryEntryRecord | null {
    const record = this.db
      .prepare(
        `SELECT
           id,
           category,
           content,
           source_conversation_id AS sourceConversationId,
           source_message_id AS sourceMessageId,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM memory_entries
         WHERE id = @id AND archived = 0`,
      )
      .get({ id: memoryId }) as MemoryEntryRow | undefined;

    if (!record) {
      return null;
    }

    return {
      id: String(record.id),
      category: String(record.category) as MemoryEntryCategory,
      content: String(record.content),
      sourceConversationId: record.sourceConversationId === null ? null : String(record.sourceConversationId),
      sourceMessageId: record.sourceMessageId === null ? null : String(record.sourceMessageId),
      createdAt: Number(record.createdAt),
      updatedAt: Number(record.updatedAt),
    };
  }

  updateMemory(input: UpdateMemoryInput): MemoryEntryRecord {
    this.assertWritable();
    const existing = this.getMemoryEntry(input.memoryId);
    if (!existing) {
      throw new Error(`Memory entry ${input.memoryId} was not found.`);
    }

    const nextContent = typeof input.content === "string" ? input.content.trim() : existing.content;
    if (!nextContent) {
      throw new Error("Memory content cannot be empty.");
    }

    const nextCategory = input.category ?? existing.category;
    assertMemoryEntryCategory(nextCategory);
    const updatedAt = Date.now();

    this.db
      .prepare(
        `UPDATE memory_entries
         SET category = @category,
             content = @content,
             updated_at = @updatedAt
         WHERE id = @id AND archived = 0`,
      )
      .run({
        id: input.memoryId,
        category: nextCategory,
        content: nextContent,
        updatedAt,
      });

    const updated = this.getMemoryEntry(input.memoryId);
    if (!updated) {
      throw new Error(`Failed to reload updated memory entry ${input.memoryId}.`);
    }

    return updated;
  }

  archiveMemory(memoryId: string): boolean {
    this.assertWritable();
    const result = this.db
      .prepare(
        `UPDATE memory_entries
         SET archived = 1,
             updated_at = @updatedAt
         WHERE id = @id AND archived = 0`,
      )
      .run({
        id: memoryId,
        updatedAt: Date.now(),
      });

    return result.changes > 0;
  }

  listMemoryEntries(limit = 20, category?: MemoryEntryCategory): MemoryEntryRecord[] {
    const statement = category
      ? this.db.prepare(
          `SELECT
             id,
             category,
             content,
             source_conversation_id AS sourceConversationId,
             source_message_id AS sourceMessageId,
             created_at AS createdAt,
             updated_at AS updatedAt
           FROM memory_entries
           WHERE archived = 0 AND category = @category
           ORDER BY updated_at DESC
           LIMIT @limit`,
        )
      : this.db.prepare(
          `SELECT
             id,
             category,
             content,
             source_conversation_id AS sourceConversationId,
             source_message_id AS sourceMessageId,
             created_at AS createdAt,
             updated_at AS updatedAt
           FROM memory_entries
           WHERE archived = 0
           ORDER BY updated_at DESC
           LIMIT @limit`,
        );

    const rows = statement.all(category ? { category, limit } : { limit }) as unknown as MemoryEntryRow[];
    return rows.map((row) => ({
      id: String(row.id),
      category: String(row.category) as MemoryEntryCategory,
      content: String(row.content),
      sourceConversationId: row.sourceConversationId === null ? null : String(row.sourceConversationId),
      sourceMessageId: row.sourceMessageId === null ? null : String(row.sourceMessageId),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    }));
  }

  searchMemoryEntries(query: string, limit = 10, category?: MemoryEntryCategory): MemoryEntryRecord[] {
    const ftsQuery = toFtsQuery(query);
    if (!ftsQuery) {
      return [];
    }

    const statement = category
      ? this.db.prepare(
          `SELECT
             e.id,
             e.category,
             e.content,
             e.source_conversation_id AS sourceConversationId,
             e.source_message_id AS sourceMessageId,
             e.created_at AS createdAt,
             e.updated_at AS updatedAt
           FROM memory_entries_fts
           JOIN memory_entries e ON e.rowid = memory_entries_fts.rowid
           WHERE memory_entries_fts MATCH @query AND e.archived = 0 AND e.category = @category
           ORDER BY bm25(memory_entries_fts), e.updated_at DESC
           LIMIT @limit`,
        )
      : this.db.prepare(
          `SELECT
             e.id,
             e.category,
             e.content,
             e.source_conversation_id AS sourceConversationId,
             e.source_message_id AS sourceMessageId,
             e.created_at AS createdAt,
             e.updated_at AS updatedAt
           FROM memory_entries_fts
           JOIN memory_entries e ON e.rowid = memory_entries_fts.rowid
           WHERE memory_entries_fts MATCH @query AND e.archived = 0
           ORDER BY bm25(memory_entries_fts), e.updated_at DESC
           LIMIT @limit`,
        );

    const rows = statement.all(
      category ? { query: ftsQuery, category, limit } : { query: ftsQuery, limit },
    ) as unknown as MemoryEntryRow[];
    return rows.map((row) => ({
      id: String(row.id),
      category: String(row.category) as MemoryEntryCategory,
      content: String(row.content),
      sourceConversationId: row.sourceConversationId === null ? null : String(row.sourceConversationId),
      sourceMessageId: row.sourceMessageId === null ? null : String(row.sourceMessageId),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    }));
  }

  private matchesScopedRecord(
    entry: { projectKey: string | null; repoRelativePath: string | null },
    projectKey: string | null,
    repoPathSet: ReadonlySet<string>,
  ): boolean {
    const projectMatches = entry.projectKey === null || (projectKey !== null && entry.projectKey === projectKey);
    const repoMatches =
      entry.repoRelativePath === null || repoPathSet.size === 0 || repoPathSet.has(entry.repoRelativePath);
    return projectMatches && repoMatches;
  }

  private assertWritable(): void {
    if (this.isReadonly) {
      throw new Error("The memory database is open in read-only mode.");
    }
  }
}
