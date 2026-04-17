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

const cleanupCaptureDirectoryOnExit = () => {
  void cleanupCaptureDirectory().catch((error) => {
    console.warn("[spira-windows-ui] Failed to clean up capture directory during shutdown", error);
  });
};

const pruneStaleCaptureFilesOnStartup = async () => {
  try {
    await pruneStaleCaptureFiles();
  } catch (error) {
    console.warn("[spira-windows-ui] Failed to prune stale capture files during startup", error);
  }
};

await pruneStaleCaptureFilesOnStartup();
process.once("beforeExit", () => {
  cleanupCaptureDirectoryOnExit();
});
process.once("SIGINT", () => {
  cleanupCaptureDirectoryOnExit();
});
process.once("SIGTERM", () => {
  cleanupCaptureDirectoryOnExit();
});

const transport = new StdioServerTransport();
await server.connect(transport);
