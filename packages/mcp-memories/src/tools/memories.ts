import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMemoryDatabase } from "../util/database.js";
import { errorResult, successResult } from "../util/results.js";
import {
  ForgetMemorySchema,
  MemoryListSchema,
  MemorySearchSchema,
  RememberMemorySchema,
  UpdateMemorySchema,
} from "../util/validation.js";

export const registerStoredMemoryTools = (server: McpServer): void => {
  server.registerTool(
    "spira_memory_list_entries",
    {
      description: "List explicit memory entries that Shinra has stored in Spira.",
      inputSchema: MemoryListSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ limit, category }) => {
      try {
        const entries = getMemoryDatabase().listMemoryEntries(limit, category);
        return successResult({ entries }, `Found ${entries.length} stored memor${entries.length === 1 ? "y" : "ies"}.`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to list stored memory entries.");
      }
    },
  );

  server.registerTool(
    "spira_memory_search_entries",
    {
      description: "Search explicit memory entries that Shinra has stored in Spira.",
      inputSchema: MemorySearchSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ query, limit, category }) => {
      try {
        const entries = getMemoryDatabase().searchMemoryEntries(query, limit, category);
        return successResult({ entries }, `Found ${entries.length} memory match${entries.length === 1 ? "" : "es"}.`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to search stored memory entries.");
      }
    },
  );

  server.registerTool(
    "spira_memory_remember",
    {
      description: "Store a new explicit memory entry in Spira without using raw SQL.",
      inputSchema: RememberMemorySchema,
    },
    async ({ content, category, sourceConversationId, sourceMessageId }) => {
      try {
        const entry = getMemoryDatabase().remember({
          content,
          category,
          sourceConversationId: sourceConversationId ?? null,
          sourceMessageId: sourceMessageId ?? null,
        });
        return successResult({ entry }, `Stored memory entry ${entry.id}.`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to store the requested memory entry.");
      }
    },
  );

  server.registerTool(
    "spira_memory_update",
    {
      description: "Update a stored Spira memory entry by ID.",
      inputSchema: UpdateMemorySchema,
    },
    async ({ memoryId, content, category }) => {
      try {
        const entry = getMemoryDatabase().updateMemory({
          memoryId,
          ...(content !== undefined ? { content } : {}),
          ...(category !== undefined ? { category } : {}),
        });
        return successResult({ entry }, `Updated memory entry ${entry.id}.`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to update the requested memory entry.");
      }
    },
  );

  server.registerTool(
    "spira_memory_forget",
    {
      description: "Archive a stored Spira memory entry by ID.",
      inputSchema: ForgetMemorySchema,
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ memoryId }) => {
      try {
        const archived = getMemoryDatabase().archiveMemory(memoryId);
        if (!archived) {
          return errorResult(`Memory entry ${memoryId} was not found.`);
        }

        return successResult({ memoryId, archived: true }, `Archived memory entry ${memoryId}.`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to archive the requested memory entry.");
      }
    },
  );
};
