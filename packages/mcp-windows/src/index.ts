import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAppTools } from "./tools/apps.js";
import { registerBrightnessTools } from "./tools/brightness.js";
import { registerNotificationTools } from "./tools/notifications.js";
import { registerPowerTools } from "./tools/power.js";
import { registerVolumeTools } from "./tools/volume.js";

const server = new McpServer({
  name: "spira-windows-system",
  version: "0.1.0",
});

registerVolumeTools(server);
registerBrightnessTools(server);
registerAppTools(server);
registerPowerTools(server);
registerNotificationTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
