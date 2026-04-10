import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { summarizeConversationTitle } from "@spira/shared";
import BetterSqlite3 from "better-sqlite3";

const SQLITE_BUSY_TIMEOUT_MS = 5_000;

const MEMORY_ENTRY_CATEGORIES = ["user-preference", "fact", "task-context", "correction"] as const;

export type ConversationRole = "user" | "assistant" | "system";
export type MemoryEntryCategory = (typeof MEMORY_ENTRY_CATEGORIES)[number];

export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessageAt: number | null;
  lastViewedAt: number | null;
}

export interface ConversationToolCallRecord {
  callId: string | null;
  name: string;
  args: unknown;
  result: unknown;
  status: "pending" | "running" | "success" | "error" | null;
  details: string | null;
}

export interface ConversationMessageRecord {
  id: string;
  conversationId: string;
  role: ConversationRole;
  content: string;
  timestamp: number;
  wasAborted: boolean;
  autoSpeak: boolean;
  toolCalls: ConversationToolCallRecord[];
}

export interface ConversationRecord extends ConversationSummary {
  messages: ConversationMessageRecord[];
}

export interface ConversationSearchResult {
  conversationId: string;
  conversationTitle: string | null;
  messageId: string;
  role: ConversationRole;
  timestamp: number;
  snippet: string;
  score: number;
}

export interface MemoryEntryRecord {
  id: string;
  category: MemoryEntryCategory;
  content: string;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateConversationInput {
  id?: string;
  title?: string | null;
  createdAt?: number;
}

export interface AppendConversationMessageInput {
  id: string;
  conversationId: string;
  role: ConversationRole;
  content: string;
  timestamp: number;
  wasAborted?: boolean;
  autoSpeak?: boolean;
}

export interface UpsertToolCallInput {
  messageId: string;
  callId?: string | null;
  name: string;
  args?: unknown;
  result?: unknown;
  status?: "pending" | "running" | "success" | "error";
  details?: string | null;
}

export interface RememberMemoryInput {
  id?: string;
  category?: MemoryEntryCategory;
  content: string;
  sourceConversationId?: string | null;
  sourceMessageId?: string | null;
  createdAt?: number;
}

export interface UpdateMemoryInput {
  memoryId: string;
  category?: MemoryEntryCategory;
  content?: string;
}

export interface OpenSpiraMemoryDatabaseOptions {
  readonly?: boolean;
}

interface MigrationDefinition {
  version: number;
  statements: string[];
}

interface ConversationSummaryRow {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessageAt: number | null;
  lastViewedAt: number | null;
}

interface ConversationMessageRow {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  timestamp: number;
  wasAborted: number;
  autoSpeak: number;
}

interface ToolCallRow {
  messageId: string;
  callId: string | null;
  name: string;
  args: string | null;
  result: string | null;
  status: string | null;
  details: string | null;
}

interface ConversationSearchRow {
  conversationId: string;
  conversationTitle: string | null;
  messageId: string;
  role: string;
  timestamp: number;
  snippet: string;
  score: number;
}

interface MemoryEntryRow {
  id: string;
  category: string;
  content: string;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface SessionStateRow {
  value: string | null;
}

const MIGRATIONS: MigrationDefinition[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL DEFAULT '',
        was_aborted INTEGER NOT NULL DEFAULT 0,
        auto_speak INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL
      )`,
      "CREATE INDEX idx_messages_conversation_timestamp ON messages(conversation_id, timestamp)",
      `CREATE TABLE tool_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        call_id TEXT,
        name TEXT NOT NULL,
        args TEXT,
        result TEXT,
        status TEXT CHECK(status IN ('pending', 'running', 'success', 'error')),
        details TEXT
      )`,
      "CREATE INDEX idx_tool_calls_message_id ON tool_calls(message_id)",
      `CREATE TABLE memory_entries (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL CHECK(category IN ('user-preference', 'fact', 'task-context', 'correction')),
        content TEXT NOT NULL,
        source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      )`,
      "CREATE INDEX idx_memory_entries_created_at ON memory_entries(created_at DESC)",
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages', content_rowid='rowid')`,
      "INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages",
      `CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END`,
      `CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END`,
      `CREATE TRIGGER messages_fts_update AFTER UPDATE OF content ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END`,
      `CREATE VIRTUAL TABLE memory_entries_fts USING fts5(content, content='memory_entries', content_rowid='rowid')`,
      "INSERT INTO memory_entries_fts(rowid, content) SELECT rowid, content FROM memory_entries",
      `CREATE TRIGGER memory_entries_fts_insert AFTER INSERT ON memory_entries BEGIN
        INSERT INTO memory_entries_fts(rowid, content) VALUES (new.rowid, new.content);
      END`,
      `CREATE TRIGGER memory_entries_fts_delete AFTER DELETE ON memory_entries BEGIN
        INSERT INTO memory_entries_fts(memory_entries_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END`,
      `CREATE TRIGGER memory_entries_fts_update AFTER UPDATE OF content ON memory_entries BEGIN
        INSERT INTO memory_entries_fts(memory_entries_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO memory_entries_fts(rowid, content) VALUES (new.rowid, new.content);
      END`,
    ],
  },
  {
    version: 3,
    statements: [
      "ALTER TABLE conversations ADD COLUMN last_viewed_at INTEGER",
      "CREATE INDEX idx_conversations_last_viewed_at ON conversations(last_viewed_at DESC)",
    ],
  },
  {
    version: 4,
    statements: [
      `CREATE TABLE session_state (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER NOT NULL
      )`,
      "CREATE INDEX idx_session_state_updated_at ON session_state(updated_at DESC)",
    ],
  },
];

type SqliteDatabase = InstanceType<typeof BetterSqlite3>;

const toBoolean = (value: number): boolean => value === 1;

const tryParseJson = (value: string | null): unknown => {
  if (value === null) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

const serializeJson = (value: unknown): string | null => {
  if (value === undefined) {
    return null;
  }

  return JSON.stringify(value);
};

const normalizeTitle = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toFtsQuery = (query: string): string => {
  const tokens = query
    .trim()
    .split(/\s+/u)
    .map((token) => token.replace(/"/gu, '""'))
    .filter((token) => token.length > 0);

  return tokens.map((token) => `"${token}"`).join(" AND ");
};

function assertMemoryEntryCategory(category: string): asserts category is MemoryEntryCategory {
  if (!MEMORY_ENTRY_CATEGORIES.includes(category as MemoryEntryCategory)) {
    throw new Error(`Unsupported memory entry category: ${category}`);
  }
}

const configureDatabase = (db: SqliteDatabase, readonly: boolean): void => {
  db.pragma("foreign_keys = ON");
  db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  if (readonly) {
    db.pragma("query_only = ON");
    return;
  }

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
};

const applyMigrations = (db: SqliteDatabase): void => {
  const currentVersion = Number(db.pragma("user_version", { simple: true }) ?? 0);
  const pending = MIGRATIONS.filter((migration) => migration.version > currentVersion);
  if (pending.length === 0) {
    return;
  }

  const migrate = db.transaction(() => {
    for (const migration of pending) {
      for (const statement of migration.statements) {
        db.exec(statement);
      }
      db.pragma(`user_version = ${migration.version}`);
    }
  });

  migrate();
};

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
        `INSERT INTO messages (id, conversation_id, role, content, was_aborted, auto_speak, timestamp)
         VALUES (@id, @conversationId, @role, @content, @wasAborted, @autoSpeak, @timestamp)
         ON CONFLICT(id) DO UPDATE SET
           conversation_id = excluded.conversation_id,
           role = excluded.role,
           content = excluded.content,
           was_aborted = excluded.was_aborted,
           auto_speak = excluded.auto_speak,
           timestamp = excluded.timestamp`,
      )
      .run({
        id: input.id,
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
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

  private assertWritable(): void {
    if (this.isReadonly) {
      throw new Error("The memory database is open in read-only mode.");
    }
  }
}
