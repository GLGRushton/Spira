import type { McpTool } from "@spira/shared";
import { McpError } from "../util/errors.js";
import type { McpClientPool } from "./client-pool.js";

export class McpToolAggregator {
  constructor(private readonly pool: McpClientPool) {}

  getTools(): McpTool[] {
    return this.pool.allTools();
  }

  getToolsForServerIds(serverIds: readonly string[]): McpTool[] {
    const serverIdSet = new Set(serverIds);
    return this.getTools().filter((tool) => serverIdSet.has(tool.serverId));
  }

  getToolsExcludingServerIds(serverIds: readonly string[]): McpTool[] {
    const serverIdSet = new Set(serverIds);
    return this.getTools().filter((tool) => !serverIdSet.has(tool.serverId));
  }

  /**
   * Executes the uniquely named MCP tool.
   *
   * Throws `McpError` when no tool is registered under `toolName` or when
   * multiple servers expose the same tool name and dispatch would be ambiguous.
   */
  async executeTool(toolName: string, args: unknown): Promise<unknown> {
    const matchingTools = this.getTools().filter((tool) => tool.name === toolName);

    if (matchingTools.length === 0) {
      throw new McpError(`No MCP tool named ${toolName} is registered`);
    }

    if (matchingTools.length > 1) {
      throw new McpError(`Multiple MCP servers expose the tool ${toolName}; tool names must be unique`);
    }

    const [tool] = matchingTools;
    return await this.pool.callTool(tool.serverId, tool.name, args);
  }
}
