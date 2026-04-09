import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callSpiraUiBridge } from "../util/bridge-client.js";
import { errorResult, successResult } from "../util/results.js";
import { AgentRoomQuerySchema, EmptySchema, McpServerQuerySchema } from "../util/validation.js";

export const registerRoomTools = (server: McpServer): void => {
  server.registerTool(
    "spira_ui_list_mcp_servers",
    {
      description: "List MCP servers currently visible in Spira's semantic state snapshot.",
      inputSchema: EmptySchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      try {
        const result = await callSpiraUiBridge({ kind: "get-snapshot" });
        if (result.type !== "snapshot") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(
          { servers: result.snapshot.mcpServers },
          `Spira currently reports ${result.snapshot.mcpServers.length} MCP server${result.snapshot.mcpServers.length === 1 ? "" : "s"}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to list Spira MCP servers.");
      }
    },
  );

  server.registerTool(
    "spira_ui_get_mcp_server",
    {
      description: "Read a single MCP server summary from Spira's semantic state snapshot.",
      inputSchema: McpServerQuerySchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ serverId }) => {
      try {
        const result = await callSpiraUiBridge({ kind: "get-snapshot" });
        if (result.type !== "snapshot") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        const serverEntry = result.snapshot.mcpServers.find((entry) => entry.id === serverId);
        if (!serverEntry) {
          return errorResult(`No MCP server with id "${serverId}" is visible in Spira.`);
        }
        return successResult({ server: serverEntry }, `Read MCP server "${serverId}".`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to read the requested Spira MCP server.");
      }
    },
  );

  server.registerTool(
    "spira_ui_list_agent_rooms",
    {
      description: "List agent rooms currently visible in Spira's semantic state snapshot.",
      inputSchema: EmptySchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      try {
        const result = await callSpiraUiBridge({ kind: "get-snapshot" });
        if (result.type !== "snapshot") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(
          { rooms: result.snapshot.agentRooms },
          `Spira currently reports ${result.snapshot.agentRooms.length} agent room${result.snapshot.agentRooms.length === 1 ? "" : "s"}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to list Spira agent rooms.");
      }
    },
  );

  server.registerTool(
    "spira_ui_get_agent_room",
    {
      description: "Read a single agent room summary from Spira's semantic state snapshot.",
      inputSchema: AgentRoomQuerySchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ roomId }) => {
      try {
        const result = await callSpiraUiBridge({ kind: "get-snapshot" });
        if (result.type !== "snapshot") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        const roomEntry = result.snapshot.agentRooms.find((entry) => entry.roomId === roomId);
        if (!roomEntry) {
          return errorResult(`No agent room with id "${roomId}" is visible in Spira.`);
        }
        return successResult({ room: roomEntry }, `Read agent room "${roomId}".`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to read the requested Spira agent room.");
      }
    },
  );
};
