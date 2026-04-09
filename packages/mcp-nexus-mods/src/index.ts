import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerNexusTools } from "./tools/nexus.js";

const server = new McpServer({
  name: "spira-nexus-mods",
  version: "0.1.0",
});

registerNexusTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
