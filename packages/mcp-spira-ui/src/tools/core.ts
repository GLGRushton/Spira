import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, successResult } from "@spira/mcp-util/results";
import { callSpiraUiBridge } from "../util/bridge-client.js";
import { EmptySchema, SpiraUiWaitForSchema } from "../util/validation.js";

export const registerCoreSpiraUiTools = (server: McpServer): void => {
  server.registerTool(
    "spira_ui_ping",
    {
      description: "Verify that the Spira UI control bridge is reachable and report its capabilities.",
      inputSchema: EmptySchema,
    },
    async () => {
      try {
        const result = await callSpiraUiBridge({ kind: "ping" });
        return successResult(result, "Spira UI bridge is reachable.");
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to reach the Spira UI control bridge.");
      }
    },
  );

  server.registerTool(
    "spira_ui_get_capabilities",
    {
      description: "Read the semantic actions, wait conditions, and root views exposed by Spira's UI control bridge.",
      inputSchema: EmptySchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      try {
        const result = await callSpiraUiBridge({ kind: "get-capabilities" });
        return successResult(result, "Read Spira UI control capabilities.");
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to read Spira UI capabilities.");
      }
    },
  );

  server.registerTool(
    "spira_ui_get_snapshot",
    {
      description:
        "Read a semantic snapshot of Spira's active UI state, including chat, rooms, settings, prompts, and MCP status.",
      inputSchema: EmptySchema,
      annotations: { readOnlyHint: true, idempotentHint: false },
    },
    async () => {
      try {
        const result = await callSpiraUiBridge({ kind: "get-snapshot" });
        return successResult(result, "Read the current Spira UI snapshot.");
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to read the Spira UI snapshot.");
      }
    },
  );

  server.registerTool(
    "spira_ui_get_active_view",
    {
      description: "Read Spira's active semantic view identifier.",
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
          { activeView: result.snapshot.activeView },
          `Spira is currently showing ${result.snapshot.activeView}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to read the active Spira view.");
      }
    },
  );

  server.registerTool(
    "spira_ui_list_views",
    {
      description: "List Spira's root semantic views.",
      inputSchema: EmptySchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      try {
        const result = await callSpiraUiBridge({ kind: "get-capabilities" });
        if (result.type !== "capabilities") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }

        return successResult(
          { views: result.capabilities.rootViews },
          `Spira exposes ${result.capabilities.rootViews.length} root views.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to list Spira views.");
      }
    },
  );

  server.registerTool(
    "spira_ui_wait_for",
    {
      description:
        "Wait for a semantic Spira UI condition such as a view change, streaming state, prompt, or room/server state.",
      inputSchema: SpiraUiWaitForSchema,
      annotations: { readOnlyHint: true, idempotentHint: false },
    },
    async ({ condition, timeoutMs, pollIntervalMs }) => {
      try {
        const result = await callSpiraUiBridge({
          kind: "wait-for",
          condition,
          timeoutMs,
          pollIntervalMs,
        });
        return successResult(result, `Condition ${condition.type} satisfied.`);
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : "Timed out waiting for the requested Spira UI condition.",
        );
      }
    },
  );
};
