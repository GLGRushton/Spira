import { beforeEach, describe, expect, it, vi } from "vitest";

const memoryDb = vi.hoisted(() => ({
  listConversations: vi.fn(),
  searchConversationMessages: vi.fn(),
  getConversation: vi.fn(),
  listMemoryEntries: vi.fn(),
  searchMemoryEntries: vi.fn(),
  remember: vi.fn(),
  updateMemory: vi.fn(),
  archiveMemory: vi.fn(),
}));

vi.mock("../util/database.js", () => ({
  getMemoryDatabase: () => memoryDb,
}));

import { registerConversationMemoryTools } from "./conversations.js";
import { registerStoredMemoryTools } from "./memories.js";

class FakeMcpServer {
  readonly tools = new Map<
    string,
    {
      description: string;
      handler: (args: Record<string, unknown>) => Promise<unknown>;
    }
  >();

  registerTool(
    name: string,
    config: { description: string },
    handler: (args: Record<string, unknown>) => Promise<unknown>,
  ): void {
    this.tools.set(name, {
      description: config.description,
      handler,
    });
  }
}

describe("mcp-memories tools", () => {
  beforeEach(() => {
    for (const mock of Object.values(memoryDb)) {
      mock.mockReset();
    }
  });

  it("lists conversations through the memory database", async () => {
    memoryDb.listConversations.mockReturnValue([{ id: "conversation-1" }]);
    const server = new FakeMcpServer();

    registerConversationMemoryTools(server as never);
    const result = await server.tools.get("spira_memory_list_conversations")?.handler({ limit: 5, offset: 0 });

    expect(memoryDb.listConversations).toHaveBeenCalledWith(5, 0);
    expect(result).toMatchObject({
      structuredContent: {
        conversations: [{ id: "conversation-1" }],
      },
    });
  });

  it("returns a structured error when a conversation is missing", async () => {
    memoryDb.getConversation.mockReturnValue(null);
    const server = new FakeMcpServer();

    registerConversationMemoryTools(server as never);
    const result = await server.tools.get("spira_memory_get_conversation")?.handler({ conversationId: "ghost" });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: "Conversation ghost was not found.",
      },
    });
  });

  it("stores memories with null source identifiers when omitted", async () => {
    memoryDb.remember.mockReturnValue({ id: "memory-1" });
    const server = new FakeMcpServer();

    registerStoredMemoryTools(server as never);
    const result = await server.tools.get("spira_memory_remember")?.handler({
      content: "Remember this",
      category: "fact",
    });

    expect(memoryDb.remember).toHaveBeenCalledWith({
      content: "Remember this",
      category: "fact",
      sourceConversationId: null,
      sourceMessageId: null,
    });
    expect(result).toMatchObject({
      structuredContent: {
        entry: { id: "memory-1" },
      },
    });
  });

  it("returns a structured error when forgetting a missing memory entry", async () => {
    memoryDb.archiveMemory.mockReturnValue(false);
    const server = new FakeMcpServer();

    registerStoredMemoryTools(server as never);
    const result = await server.tools.get("spira_memory_forget")?.handler({ memoryId: "missing-memory" });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: "Memory entry missing-memory was not found.",
      },
    });
  });
});
