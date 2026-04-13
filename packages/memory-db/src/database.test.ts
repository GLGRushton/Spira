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

  it("summarizes the first user-message title when the conversation already exists", () => {
    const database = createTestDatabase();
    const conversationId = database.createConversation({ createdAt: 1_000 });
    const firstMessage = "Can you help me untangle chat retention for Spira?";

    database.appendMessage({
      id: "user-1",
      conversationId,
      role: "user",
      content: firstMessage,
      timestamp: 1_000,
    });

    const conversation = database.getConversation(conversationId);
    expect(conversation?.title).toBe("Help Me Untangle");
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

  it("persists and clears session state values", () => {
    const database = createTestDatabase();

    expect(database.getSessionState("copilot-session-id")).toBeNull();

    database.setSessionState("copilot-session-id", "session-123");
    expect(database.getSessionState("copilot-session-id")).toBe("session-123");

    database.setSessionState("copilot-session-id", "session-456");
    expect(database.getSessionState("copilot-session-id")).toBe("session-456");

    database.setSessionState("copilot-session-id", null);
    expect(database.getSessionState("copilot-session-id")).toBeNull();
  });

  it("stores seeded MCP server configs and preserves built-in enabled overrides", () => {
    const database = createTestDatabase();

    database.seedBuiltinMcpServerConfigs([
      {
        id: "windows-system",
        name: "Windows System",
        description: "Host control",
        transport: "stdio",
        command: "node",
        args: ["packages/mcp-windows/dist/index.js"],
        env: {},
        enabled: true,
        autoRestart: true,
        maxRestarts: 3,
      },
    ]);
    database.setMcpServerEnabled("windows-system", false);
    database.seedBuiltinMcpServerConfigs([
      {
        id: "windows-system",
        name: "Windows System",
        description: "Updated description",
        transport: "stdio",
        command: "node",
        args: ["packages/mcp-windows/dist/index.js"],
        env: {},
        enabled: true,
        autoRestart: true,
        maxRestarts: 3,
      },
    ]);
    database.upsertMcpServerConfig({
      id: "youtrack",
      name: "YouTrack",
      description: "Custom tracker",
      source: "user",
      transport: "streamable-http",
      url: "https://example.youtrack.cloud/mcp",
      headers: { Authorization: "Bearer secret" },
      toolAccess: { readOnlyToolNames: ["find_projects"], writeToolNames: ["create_issue"] },
      enabled: true,
      autoRestart: true,
      maxRestarts: 5,
    });

    expect(database.listMcpServerConfigs()).toMatchObject([
      {
        id: "windows-system",
        source: "builtin",
        enabled: false,
        description: "Updated description",
      },
      {
        id: "youtrack",
        source: "user",
        name: "YouTrack",
        transport: "streamable-http",
        url: "https://example.youtrack.cloud/mcp",
        headers: { Authorization: "Bearer secret" },
        toolAccess: { readOnlyToolNames: ["find_projects"], writeToolNames: ["create_issue"] },
      },
    ]);
  });

  it("round-trips remote MCP server configs without requiring stdio fields", () => {
    const database = createTestDatabase();

    database.upsertMcpServerConfig({
      id: "youtrack",
      name: "YouTrack",
      description: "Remote tracker",
      source: "user",
      transport: "streamable-http",
      url: "https://example.youtrack.cloud/mcp",
      headers: { Authorization: "Bearer secret" },
      enabled: true,
      autoRestart: false,
      maxRestarts: 3,
    });

    expect(database.getMcpServerConfig("youtrack")).toMatchObject({
      id: "youtrack",
      transport: "streamable-http",
      url: "https://example.youtrack.cloud/mcp",
      headers: { Authorization: "Bearer secret" },
      enabled: true,
      autoRestart: false,
    });
  });

  it("stores custom subagent configs and preserves built-in ready overrides", () => {
    const database = createTestDatabase();

    database.seedBuiltinSubagentConfigs([
      {
        id: "windows",
        label: "Windows Agent",
        description: "Windows control",
        source: "builtin",
        serverIds: ["windows-system"],
        allowedToolNames: null,
        delegationToolName: "delegate_to_windows",
        allowWrites: true,
        systemPrompt: "",
        ready: true,
      },
    ]);
    database.setSubagentReady("windows", false);
    database.seedBuiltinSubagentConfigs([
      {
        id: "windows",
        label: "Windows Agent",
        description: "Updated description",
        source: "builtin",
        serverIds: ["windows-system", "vision"],
        allowedToolNames: null,
        delegationToolName: "delegate_to_windows",
        allowWrites: true,
        systemPrompt: "",
        ready: true,
      },
    ]);
    database.upsertSubagentConfig({
      id: "youtrack-ops",
      label: "YouTrack Ops",
      description: "Ticket triage",
      source: "user",
      serverIds: ["youtrack"],
      allowedToolNames: ["youtrack_list_issues"],
      delegationToolName: "delegate_to_youtrack_ops",
      allowWrites: false,
      systemPrompt: "Focus on ticket summarisation.",
      ready: true,
    });

    expect(database.listSubagentConfigs()).toMatchObject([
      {
        id: "windows",
        source: "builtin",
        ready: false,
        description: "Updated description",
        serverIds: ["windows-system", "vision"],
      },
      {
        id: "youtrack-ops",
        source: "user",
        allowedToolNames: ["youtrack_list_issues"],
      },
    ]);
  });

  it("stores the workspace root and replaces project repo mappings", () => {
    const database = createTestDatabase();

    expect(database.getProjectWorkspaceRoot()).toBeNull();

    database.setProjectWorkspaceRoot("C:\\Repos");
    expect(database.getProjectWorkspaceRoot()).toBe("C:\\Repos");

    database.setProjectRepoMapping("SPI", ["client-app", "shared\\sdk"]);
    database.setProjectRepoMapping("OPS", ["ops-tools"]);
    database.setProjectRepoMapping("SPI", ["shared\\sdk", "service-api"]);

    expect(database.listProjectRepoMappings()).toMatchObject([
      {
        projectKey: "OPS",
        repoRelativePaths: ["ops-tools"],
      },
      {
        projectKey: "SPI",
        repoRelativePaths: ["service-api", "shared\\sdk"],
      },
    ]);

    database.setProjectRepoMapping("SPI", []);

    expect(database.listProjectRepoMappings()).toMatchObject([
      {
        projectKey: "OPS",
        repoRelativePaths: ["ops-tools"],
      },
    ]);
  });
});
