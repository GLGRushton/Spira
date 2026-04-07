import { type Tool, type ToolResultObject, defineTool } from "@github/copilot-sdk";
import type { McpTool } from "@spira/shared";
import type { McpToolAggregator } from "../mcp/tool-aggregator.js";
import { createLogger } from "../util/logger.js";

const logger = createLogger("tool-bridge");
const isPermissionlessTool = (tool: McpTool): boolean =>
  !tool.name.startsWith("vision_") &&
  tool.annotations?.readOnlyHint === true &&
  tool.annotations?.destructiveHint !== true;

const toSuccessResult = (result: unknown): ToolResultObject => ({
  textResultForLlm: typeof result === "string" ? result : JSON.stringify(result ?? null),
  resultType: "success",
});

const toFailureResult = (toolName: string, error: unknown): ToolResultObject => {
  const message = error instanceof Error ? error.message : `Tool ${toolName} failed`;
  return {
    textResultForLlm: message,
    error: message,
    resultType: "failure",
  };
};

const buildTool = (tool: McpTool, aggregator: McpToolAggregator) =>
  defineTool(tool.name, {
    description: tool.description ?? `Execute the ${tool.name} tool from ${tool.serverName}.`,
    parameters: tool.inputSchema,
    skipPermission: isPermissionlessTool(tool),
    handler: async (args) => {
      try {
        return toSuccessResult(await aggregator.executeTool(tool.name, args));
      } catch (error) {
        logger.error({ error, toolName: tool.name, serverId: tool.serverId }, "MCP tool execution failed");
        return toFailureResult(tool.name, error);
      }
    },
  });

export function getCopilotTools(aggregator: McpToolAggregator): Tool[] {
  const tools = aggregator.getTools().map((tool) => buildTool(tool, aggregator));
  logger.info({ toolCount: tools.length }, "Registered MCP tools with Copilot session");
  return tools;
}
