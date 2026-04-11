import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, successResult } from "@spira/mcp-util/results";
import { callSpiraUiBridge } from "../util/bridge-client.js";
import {
  ChatMessagesSchema,
  EmptySchema,
  NavigateSchema,
  OpenAgentRoomSchema,
  OpenMcpServerSchema,
  SendChatSchema,
  SetDraftSchema,
} from "../util/validation.js";

const getSnapshotText = (activeView: string): string => `Spira UI action completed. Active view: ${activeView}.`;

export const registerNavigationChatTools = (server: McpServer): void => {
  server.registerTool(
    "spira_ui_navigate",
    {
      description: "Navigate Spira to one of its root semantic views.",
      inputSchema: NavigateSchema,
    },
    async ({ view }) => {
      try {
        const result = await callSpiraUiBridge({
          kind: "perform-action",
          action: {
            type: "navigate",
            view,
          },
        });
        if (result.type !== "action-result") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(result, getSnapshotText(result.snapshot.activeView));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to navigate Spira.");
      }
    },
  );

  server.registerTool(
    "spira_ui_open_mcp_server",
    {
      description: "Open a specific MCP server detail room in Spira.",
      inputSchema: OpenMcpServerSchema,
    },
    async ({ serverId }) => {
      try {
        const result = await callSpiraUiBridge({
          kind: "perform-action",
          action: {
            type: "open-mcp-server",
            serverId,
          },
        });
        if (result.type !== "action-result") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(result, getSnapshotText(result.snapshot.activeView));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to open the requested MCP server room.");
      }
    },
  );

  server.registerTool(
    "spira_ui_open_agent_room",
    {
      description: "Open a specific agent room in Spira.",
      inputSchema: OpenAgentRoomSchema,
    },
    async ({ roomId }) => {
      try {
        const result = await callSpiraUiBridge({
          kind: "perform-action",
          action: {
            type: "open-agent-room",
            roomId: roomId as `agent:${string}`,
          },
        });
        if (result.type !== "action-result") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(result, getSnapshotText(result.snapshot.activeView));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to open the requested agent room.");
      }
    },
  );

  server.registerTool(
    "spira_ui_back",
    {
      description: "Return Spira to the ship overview.",
      inputSchema: EmptySchema,
    },
    async () => {
      try {
        const result = await callSpiraUiBridge({
          kind: "perform-action",
          action: { type: "back" },
        });
        if (result.type !== "action-result") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(result, getSnapshotText(result.snapshot.activeView));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to return Spira to the ship view.");
      }
    },
  );

  server.registerTool(
    "spira_ui_get_chat_state",
    {
      description: "Read Spira's current chat draft and streaming/reset state.",
      inputSchema: EmptySchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      try {
        const result = await callSpiraUiBridge({ kind: "get-snapshot" });
        if (result.type !== "snapshot") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult({ chat: result.snapshot.chat }, "Read the current Spira chat state.");
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to read the Spira chat state.");
      }
    },
  );

  server.registerTool(
    "spira_ui_get_messages",
    {
      description: "Read recent user and assistant chat messages from Spira.",
      inputSchema: ChatMessagesSchema,
      annotations: { readOnlyHint: true, idempotentHint: false },
    },
    async ({ limit }) => {
      try {
        const result = await callSpiraUiBridge({
          kind: "get-chat-messages",
          limit,
        });
        if (result.type !== "chat-messages") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(result, `Read ${result.transcript.messages.length} recent Spira messages.`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to read recent Spira messages.");
      }
    },
  );

  server.registerTool(
    "spira_ui_set_draft",
    {
      description: "Set or append to Spira's current chat draft without sending it.",
      inputSchema: SetDraftSchema,
    },
    async ({ draft, append }) => {
      try {
        const result = await callSpiraUiBridge({
          kind: "perform-action",
          action: {
            type: "set-draft",
            draft,
            append,
          },
        });
        if (result.type !== "action-result") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(result, "Updated the Spira chat draft.");
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to update the Spira chat draft.");
      }
    },
  );

  server.registerTool(
    "spira_ui_send_chat",
    {
      description: "Send a chat message in Spira using the provided text or the current draft.",
      inputSchema: SendChatSchema,
    },
    async ({ text }) => {
      try {
        const result = await callSpiraUiBridge({
          kind: "perform-action",
          action: {
            type: "send-chat",
            ...(typeof text === "string" ? { text } : {}),
          },
        });
        if (result.type !== "action-result") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(result, "Sent the Spira chat message.");
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to send the Spira chat message.");
      }
    },
  );

  server.registerTool(
    "spira_ui_abort_chat",
    {
      description: "Abort Spira's current streaming assistant response.",
      inputSchema: EmptySchema,
    },
    async () => {
      try {
        const result = await callSpiraUiBridge({
          kind: "perform-action",
          action: { type: "abort-chat" },
        });
        if (result.type !== "action-result") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(result, "Abort signal sent to Spira chat.");
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to abort the Spira chat response.");
      }
    },
  );

  server.registerTool(
    "spira_ui_reset_chat",
    {
      description: "Reset Spira's current chat session and clear the visible transcript.",
      inputSchema: EmptySchema,
    },
    async () => {
      try {
        const result = await callSpiraUiBridge({
          kind: "perform-action",
          action: { type: "reset-chat" },
        });
        if (result.type !== "action-result") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(result, "Reset the Spira chat session.");
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to reset the Spira chat session.");
      }
    },
  );

  server.registerTool(
    "spira_ui_focus_composer",
    {
      description: "Move focus to Spira's chat composer.",
      inputSchema: EmptySchema,
    },
    async () => {
      try {
        const result = await callSpiraUiBridge({
          kind: "perform-action",
          action: { type: "focus-composer" },
        });
        if (result.type !== "action-result") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(result, "Focused the Spira chat composer.");
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to focus the Spira chat composer.");
      }
    },
  );
};
