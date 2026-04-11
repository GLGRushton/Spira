import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerChromiumTools } from "./tools/chromium.js";
import { registerUiAutomationTools } from "./tools/uia.js";
import { registerWindowTools } from "./tools/windows.js";
import { cleanupCaptureDirectory, pruneStaleCaptureFiles } from "./util/capture-store.js";

const server = new McpServer({
  name: "spira-windows-ui",
  version: "0.1.0",
});

registerWindowTools(server);
registerUiAutomationTools(server);
registerChromiumTools(server);

await pruneStaleCaptureFiles();
process.once("beforeExit", () => {
  void cleanupCaptureDirectory();
});
process.once("SIGINT", () => {
  void cleanupCaptureDirectory();
});
process.once("SIGTERM", () => {
  void cleanupCaptureDirectory();
});

const transport = new StdioServerTransport();
await server.connect(transport);
