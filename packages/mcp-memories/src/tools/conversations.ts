import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, successResult } from "@spira/mcp-util/results";
import { getMemoryDatabase } from "../util/database.js";
import { ConversationListSchema, ConversationQuerySchema, ConversationSearchSchema } from "../util/validation.js";

export const registerConversationMemoryTools = (server: McpServer): void => {
  server.registerTool(
    "spira_memory_list_conversations",
    {
      description: "List recent Spira conversations from the local memory database.",
      inputSchema: ConversationListSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ limit, offset }) => {
      try {
        const conversations = getMemoryDatabase().listConversations(limit, offset);
        return successResult(
          { conversations },
          `Found ${conversations.length} conversation${conversations.length === 1 ? "" : "s"}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to list Spira conversations.");
      }
    },
  );

  server.registerTool(
    "spira_memory_search_conversations",
    {
      description: "Search conversation message content in the Spira memory database.",
      inputSchema: ConversationSearchSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ query, limit }) => {
      try {
        const results = getMemoryDatabase().searchConversationMessages(query, limit);
        return successResult(
          { results },
          `Found ${results.length} conversation match${results.length === 1 ? "" : "es"}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to search Spira conversations.");
      }
    },
  );

  server.registerTool(
    "spira_memory_get_conversation",
    {
      description: "Fetch a full stored conversation from the Spira memory database.",
      inputSchema: ConversationQuerySchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ conversationId }) => {
      try {
        const conversation = getMemoryDatabase().getConversation(conversationId);
        if (!conversation) {
          return errorResult(`Conversation ${conversationId} was not found.`);
        }

        return successResult(
          { conversation },
          `Loaded conversation ${conversationId} with ${conversation.messages.length} message${conversation.messages.length === 1 ? "" : "s"}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to load the requested conversation.");
      }
    },
  );
};
