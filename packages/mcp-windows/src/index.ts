import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAppTools } from "./tools/apps.js";
import { registerBrightnessTools } from "./tools/brightness.js";
import { registerCpuTools } from "./tools/cpu.js";
import { registerDiskUsageTools } from "./tools/disk-usage.js";
import { registerMemoryTools } from "./tools/memory.js";
import { registerNotificationTools } from "./tools/notifications.js";
import { registerPowerTools } from "./tools/power.js";
import { registerSystemInfoTools } from "./tools/system-info.js";
import { registerVolumeTools } from "./tools/volume.js";

const server = new McpServer({
  name: "spira-windows-system",
  version: "0.1.0",
});

registerVolumeTools(server);
registerBrightnessTools(server);
registerAppTools(server);
registerCpuTools(server);
registerDiskUsageTools(server);
registerMemoryTools(server);
registerPowerTools(server);
registerNotificationTools(server);
registerSystemInfoTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
