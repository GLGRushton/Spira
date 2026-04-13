import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerSpiraDataEntryTools } from "./tools/data-entry.js";

const server = new McpServer({
  name: "spira-data-entry",
  version: "0.1.0",
});

registerSpiraDataEntryTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
