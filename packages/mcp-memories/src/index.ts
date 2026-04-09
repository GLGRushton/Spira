import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerConversationMemoryTools } from "./tools/conversations.js";
import { registerStoredMemoryTools } from "./tools/memories.js";

const server = new McpServer({
  name: "spira-memories",
  version: "0.1.0",
});

registerConversationMemoryTools(server);
registerStoredMemoryTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
