import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerConfigurationTools } from "./tools/configuration.js";
import { registerCoreSpiraUiTools } from "./tools/core.js";
import { registerNavigationChatTools } from "./tools/navigation-chat.js";
import { registerRoomTools } from "./tools/rooms.js";

const server = new McpServer({
  name: "spira-ui",
  version: "0.1.0",
});

registerCoreSpiraUiTools(server);
registerNavigationChatTools(server);
registerConfigurationTools(server);
registerRoomTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
