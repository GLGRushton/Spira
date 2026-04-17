import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerOcrTools } from "./tools/ocr.js";
import { registerReadScreenTool } from "./tools/read-screen.js";
import { registerScreenshotTools } from "./tools/screenshot.js";
import { cleanupCaptureDirectory, pruneStaleCaptureFiles } from "./util/capture-store.js";

const server = new McpServer({
  name: "spira-vision",
  version: "0.1.0",
});

registerScreenshotTools(server);
registerOcrTools(server);
registerReadScreenTool(server);

const cleanupCaptureDirectoryOnExit = () => {
  void cleanupCaptureDirectory().catch((error) => {
    console.warn("[spira-vision] Failed to clean up capture directory during shutdown", error);
  });
};

const pruneStaleCaptureFilesOnStartup = async () => {
  try {
    await pruneStaleCaptureFiles();
  } catch (error) {
    console.warn("[spira-vision] Failed to prune stale capture files during startup", error);
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
