import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { captureActiveWindow, captureFullscreen } from "../capture/screen-capture.js";
import { errorResult, successResult } from "../util/results.js";
import { CaptureScreenSchema, EmptySchema } from "../util/validation.js";

export const registerScreenshotTools = (server: McpServer): void => {
  server.registerTool(
    "vision_capture_active_window",
    {
      description:
        "Capture the user's active window. Only call this when the user explicitly asks Shinra to inspect what is currently on screen.",
      inputSchema: EmptySchema,
      annotations: {
        title: "Capture Active Window",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async () => {
      try {
        const capture = await captureActiveWindow();
        return successResult(
          capture,
          `Captured the active window "${capture.windowTitle || "Untitled"}" at ${capture.width}x${capture.height}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to capture the active window.");
      }
    },
  );

  server.registerTool(
    "vision_capture_screen",
    {
      description:
        "Capture the user's screen. Only call this when the user explicitly asks Shinra to inspect the screen.",
      inputSchema: CaptureScreenSchema,
      annotations: {
        title: "Capture Screen",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ monitorIndex }) => {
      try {
        const capture = await captureFullscreen(monitorIndex);
        return successResult(
          capture,
          `Captured monitor ${capture.monitorIndex} at ${capture.width}x${capture.height}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to capture the screen.");
      }
    },
  );
};
