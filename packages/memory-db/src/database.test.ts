import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SpiraMemoryDatabase } from "./database.js";
import { getSpiraMemoryDbPath } from "./path.js";

const tempDirs: string[] = [];
const openDatabases: SpiraMemoryDatabase[] = [];

const createTestDatabase = (): SpiraMemoryDatabase => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "spira-memory-db-"));
  tempDirs.push(tempDir);
  const database = SpiraMemoryDatabase.open(getSpiraMemoryDbPath(tempDir));
  openDatabases.push(database);
  return database;
};

afterEach(() => {
  while (openDatabases.length > 0) {
    const database = openDatabases.pop();
    database?.close();
  }

  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (!directory) {
      continue;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SpiraMemoryDatabase", () => {
  it("persists conversations and searches message content", () => {
    const database = createTestDatabase();
    const conversationId = database.createConversation({ title: "Database plan" });
    database.appendMessage({
      id: "user-1",
      conversationId,
      role: "user",
      content: "Please design searchable conversation memory for Spira.",
      timestamp: 1_000,
    });
    database.appendMessage({
      id: "assistant-1",
      conversationId,
      role: "assistant",
      content: "SQLite with FTS5 is a strong fit for searchable conversations.",
      timestamp: 2_000,
      autoSpeak: true,
    });
    database.upsertToolCall({
      messageId: "assistant-1",
      callId: "call-1",
      name: "spira_memory_search_conversations",
      args: { query: "searchable" },
      result: { hits: 2 },
      status: "success",
      details: "Found two matches.",
    });

    const searchResults = database.searchConversationMessages("searchable", 5);
    const conversation = database.getConversation(conversationId);
    const recentConversation = database.getMostRecentConversation();

    expect(searchResults).toHaveLength(2);
    expect(searchResults[0]?.conversationId).toBe(conversationId);
    expect(conversation?.messages).toHaveLength(2);
    expect(conversation?.messages[1]?.autoSpeak).toBe(true);
    expect(conversation?.messages[1]?.toolCalls).toMatchObject([
      {
        callId: "call-1",
        name: "spira_memory_search_conversations",
        args: { query: "searchable" },
        result: { hits: 2 },
        status: "success",
      },
    ]);
    expect(recentConversation?.id).toBe(conversationId);
    expect(recentConversation?.lastViewedAt).toBe(2_000);
  });

  it("infers and truncates the first user-message title when the conversation already exists", () => {
    const database = createTestDatabase();
    const conversationId = database.createConversation({ createdAt: 1_000 });
    const longMessage =
      "This first user message is deliberately far too long to fit as a conversation title without being neatly truncated.";

    database.appendMessage({
      id: "user-1",
      conversationId,
      role: "user",
      content: longMessage,
      timestamp: 1_000,
    });

    const conversation = database.getConversation(conversationId);
    expect(conversation?.title).toBe(
      "This first user message is deliberately far too long to fit as a conversation...",
    );
  });

  it("stores and searches explicit memory entries", () => {
    const database = createTestDatabase();
    const saved = database.remember({
      category: "fact",
      content: "Shinra should not get raw SQL access to the Spira database.",
    });
    const updated = database.updateMemory({
      memoryId: saved.id,
      content: "Shinra should use guarded memory tools rather than raw SQL access.",
    });

    const entries = database.searchMemoryEntries("guarded memory tools", 5);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(saved.id);
    expect(entries[0]?.category).toBe("fact");
    expect(updated.content).toContain("guarded memory tools");

    expect(database.archiveMemory(saved.id)).toBe(true);
    expect(database.getMemoryEntry(saved.id)).toBeNull();
  });

  it("tracks the most recently viewed conversation and archives old ones", () => {
    const database = createTestDatabase();
    const firstConversationId = database.createConversation({ title: "First", createdAt: 1_000 });
    const secondConversationId = database.createConversation({ title: "Second", createdAt: 2_000 });

    database.markConversationViewed(firstConversationId, 3_000);
    database.markConversationViewed(secondConversationId, 4_000);

    expect(database.getMostRecentConversation()?.id).toBe(secondConversationId);

    expect(database.archiveConversation(secondConversationId, 5_000)).toBe(true);
    expect(database.getMostRecentConversation()?.id).toBe(firstConversationId);
  });

  it("uses the same recency ordering for startup hydration and archive listings", () => {
    const database = createTestDatabase();
    const olderViewedConversationId = database.createConversation({ title: "Viewed", createdAt: 1_000 });
    const newerMessageConversationId = database.createConversation({ title: "Recent message", createdAt: 2_000 });

    database.markConversationViewed(olderViewedConversationId, 3_000);
    database.appendMessage({
      id: "message-1",
      conversationId: newerMessageConversationId,
      role: "user",
      content: "Latest activity",
      timestamp: 4_000,
    });

    expect(database.listConversations()[0]?.id).toBe(newerMessageConversationId);
    expect(database.getMostRecentConversation()?.id).toBe(newerMessageConversationId);
  });
});
