import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, successResult } from "@spira/mcp-util/results";
import { actOnUiNode, findUiNodes, getUiTree, scrapeVirtualList } from "../util/automation.js";
import { UiActionSchema, UiFindNodesSchema, UiScrapeVirtualListSchema, UiTreeSchema } from "../util/validation.js";

export const registerUiAutomationTools = (server: McpServer): void => {
  server.registerTool(
    "ui_get_tree",
    {
      description:
        "Read a window's UI Automation tree. Use the returned node paths with ui_act or ui_scrape_virtual_list.",
      inputSchema: UiTreeSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ handle, title, processName, path, maxDepth }) => {
      try {
        const tree = await getUiTree({ handle, title, processName, path, maxDepth });
        return successResult(
          tree,
          `Read the UI tree for "${tree.window.title}" to depth ${maxDepth}. Root path: ${tree.root.path.join(".") || "root"}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to read the UI tree.");
      }
    },
  );

  server.registerTool(
    "ui_find_nodes",
    {
      description:
        "Find UI Automation nodes inside a window by name, automationId, className, or controlType. Returns node paths for follow-up actions.",
      inputSchema: UiFindNodesSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ handle, title, processName, path, name, automationId, className, controlType, maxDepth, limit }) => {
      try {
        const matches = await findUiNodes({
          handle,
          title,
          processName,
          path,
          name,
          automationId,
          className,
          controlType,
          maxDepth,
          limit,
        });

        return successResult(
          matches,
          `Found ${matches.matches.length} matching node${matches.matches.length === 1 ? "" : "s"} in "${matches.window.title}".`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to query UI nodes.");
      }
    },
  );

  server.registerTool(
    "ui_act",
    {
      description:
        "Execute a UI Automation action against a specific node path. This depends on a node path returned by ui_get_tree or ui_find_nodes.",
      inputSchema: UiActionSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ handle, title, processName, path, action, text }) => {
      try {
        const result = await actOnUiNode({ handle, title, processName, path, action, text });
        return successResult(
          result,
          `${result.message} Node path: ${result.node.path.join(".")}. Window: ${result.window.title}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to execute the requested UI action.");
      }
    },
  );

  server.registerTool(
    "ui_scrape_virtual_list",
    {
      description:
        "Walk a scrollable or virtualized UI Automation list, collecting unique visible items across scroll steps. Use either a node path or a selector to identify the list container.",
      inputSchema: UiScrapeVirtualListSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({
      handle,
      title,
      processName,
      path,
      name,
      automationId,
      className,
      controlType,
      itemControlType,
      itemMaxDepth,
      maxIterations,
      maxItems,
    }) => {
      try {
        const result = await scrapeVirtualList({
          handle,
          title,
          processName,
          path,
          name,
          automationId,
          className,
          controlType,
          itemControlType,
          itemMaxDepth,
          maxIterations,
          maxItems,
        });

        return successResult(
          result,
          `Collected ${result.uniqueCount} unique list items from "${result.window.title}" in ${result.iterations} pass(es).`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to scrape the virtualized list.");
      }
    },
  );
};
