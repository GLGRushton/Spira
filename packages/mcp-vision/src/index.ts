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
