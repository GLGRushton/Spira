import type { McpTool } from "@spira/shared";
import { McpError } from "../util/errors.js";
import type { McpClientPool } from "./client-pool.js";

export class McpToolAggregator {
  constructor(private readonly pool: McpClientPool) {}

  getTools(): McpTool[] {
    return this.pool.allTools();
  }

  async executeTool(toolName: string, args: unknown): Promise<unknown> {
    const matchingTools = this.pool.allTools().filter((tool) => tool.name === toolName);

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
