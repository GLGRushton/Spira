import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SpiraMemoryDatabase, getSpiraMemoryDbPath } from "@spira/memory-db";
import { afterEach, describe, expect, it } from "vitest";
import { buildContinuityPreamble, buildConversationMemoryContent } from "./continuity.js";

const tempDirs: string[] = [];
const openDatabases: SpiraMemoryDatabase[] = [];

const createTestDatabase = (): SpiraMemoryDatabase => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "spira-continuity-"));
  tempDirs.push(tempDir);
  const database = SpiraMemoryDatabase.open(getSpiraMemoryDbPath(tempDir));
  openDatabases.push(database);
  return database;
};

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close();
  }

  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("continuity helpers", () => {
  it("returns null when there is no durable context", () => {
    const database = createTestDatabase();

    expect(buildContinuityPreamble({ database, query: "hello", conversationId: null })).toBeNull();
  });

  it("builds a continuity preamble from memories and conversations", () => {
    const database = createTestDatabase();
    const conversationId = database.createConversation({ title: "Renderer follow-up", createdAt: 1_000 });

    database.appendMessage({
      id: "user-1",
      conversationId,
      role: "user",
      content: "Please fix the renderer hot reload path.",
      timestamp: 1_000,
    });
    database.appendMessage({
      id: "assistant-1",
      conversationId,
      role: "assistant",
      content: "The IPC handshake is the fragile seam here.",
      timestamp: 2_000,
    });
    database.remember({
      id: "memory-1",
      category: "task-context",
      content: "User is working on renderer continuity behavior.",
      sourceConversationId: conversationId,
    });

    const preamble = buildContinuityPreamble({
      database,
      query: "renderer continuity",
      conversationId,
    });

    expect(preamble).toContain("[Recovered context]");
    expect(preamble).toContain("User is working on renderer continuity behavior.");
    expect(preamble).toContain("Recovered conversation thread: Renderer follow-up");
    expect(preamble).toContain("Shinra: The IPC handshake is the fragile seam here.");
  });

  it("creates a reusable conversation memory summary", () => {
    const database = createTestDatabase();
    const conversationId = database.createConversation({ title: "Memory summary", createdAt: 1_000 });

    database.appendMessage({
      id: "user-1",
      conversationId,
      role: "user",
      content: "Summarize the current conversation before we start over.",
      timestamp: 1_000,
    });
    database.appendMessage({
      id: "assistant-1",
      conversationId,
      role: "assistant",
      content: "I can preserve the important context in durable memory.",
      timestamp: 2_000,
    });

    const conversation = database.getConversation(conversationId);
    expect(conversation).not.toBeNull();

    if (!conversation) {
      throw new Error("Expected saved conversation to exist.");
    }

    const summary = buildConversationMemoryContent(conversation);
    expect(summary).toContain('Saved context from conversation "Memory summary".');
    expect(summary).toContain("User: Summarize the current conversation before we start over.");
    expect(summary).toContain("Shinra: I can preserve the important context in durable memory.");
  });
});
