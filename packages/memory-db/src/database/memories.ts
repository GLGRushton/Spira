import { randomUUID } from "node:crypto";
import { type DatabasePersistenceContext, assertDatabaseWritable } from "./context.js";
import { assertMemoryEntryCategory, toFtsQuery } from "./helpers.js";
import type { MemoryEntryRow } from "./rows.js";
import type { MemoryEntryCategory, MemoryEntryRecord, RememberMemoryInput, UpdateMemoryInput } from "./types.js";

const mapMemoryEntryRow = (row: MemoryEntryRow): MemoryEntryRecord => ({
  id: String(row.id),
  category: String(row.category) as MemoryEntryCategory,
  content: String(row.content),
  sourceConversationId: row.sourceConversationId === null ? null : String(row.sourceConversationId),
  sourceMessageId: row.sourceMessageId === null ? null : String(row.sourceMessageId),
  createdAt: Number(row.createdAt),
  updatedAt: Number(row.updatedAt),
});

export const createMemoryEntryPersistence = (context: DatabasePersistenceContext) => {
  const getMemoryEntry = (memoryId: string): MemoryEntryRecord | null => {
    const record = context.db
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

    return record ? mapMemoryEntryRow(record) : null;
  };

  const remember = (input: RememberMemoryInput): MemoryEntryRecord => {
    assertDatabaseWritable(context);
    const content = input.content.trim();
    if (!content) {
      throw new Error("Memory content cannot be empty.");
    }

    const category = input.category ?? "task-context";
    assertMemoryEntryCategory(category);
    const now = input.createdAt ?? Date.now();
    const memoryId = input.id ?? randomUUID();

    context.db
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

    const record = context.db
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

    return mapMemoryEntryRow(record);
  };

  const updateMemory = (input: UpdateMemoryInput): MemoryEntryRecord => {
    assertDatabaseWritable(context);
    const existing = getMemoryEntry(input.memoryId);
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

    context.db
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

    const updated = getMemoryEntry(input.memoryId);
    if (!updated) {
      throw new Error(`Failed to reload updated memory entry ${input.memoryId}.`);
    }

    return updated;
  };

  const archiveMemory = (memoryId: string): boolean => {
    assertDatabaseWritable(context);
    const result = context.db
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
  };

  const listMemoryEntries = (limit = 20, category?: MemoryEntryCategory): MemoryEntryRecord[] => {
    const statement = category
      ? context.db.prepare(
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
      : context.db.prepare(
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
    return rows.map(mapMemoryEntryRow);
  };

  const searchMemoryEntries = (query: string, limit = 10, category?: MemoryEntryCategory): MemoryEntryRecord[] => {
    const ftsQuery = toFtsQuery(query);
    if (!ftsQuery) {
      return [];
    }

    const statement = category
      ? context.db.prepare(
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
      : context.db.prepare(
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
    return rows.map(mapMemoryEntryRow);
  };

  return {
    remember,
    getMemoryEntry,
    updateMemory,
    archiveMemory,
    listMemoryEntries,
    searchMemoryEntries,
  };
};
