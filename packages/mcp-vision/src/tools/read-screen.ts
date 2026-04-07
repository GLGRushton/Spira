import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { captureActiveWindow, captureFullscreen } from "../capture/screen-capture.js";
import { WindowsOcrProvider } from "../ocr/ocr-provider.js";
import { errorResult, successResult } from "../util/results.js";
import { removeCaptureFile } from "../util/temp-files.js";
import { ReadScreenSchema } from "../util/validation.js";

const ocrProvider = new WindowsOcrProvider();

export const registerReadScreenTool = (server: McpServer): void => {
  server.registerTool(
    "vision_read_screen",
    {
      description:
        "Capture the active window or screen and read its visible text in one step. Only call this when the user explicitly asks Shinra to inspect what is on screen.",
      inputSchema: ReadScreenSchema,
      annotations: {
        title: "Inspect Screen",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ target, monitorIndex }) => {
      let imagePath: string | null = null;

      try {
        const capture = target === "screen" ? await captureFullscreen(monitorIndex) : await captureActiveWindow();
        imagePath = capture.imagePath;

        const ocr = await ocrProvider.recognize(capture.imagePath);
        return successResult(
          {
            target,
            capturedAt: capture.capturedAt,
            text: ocr.text,
            lineCount: ocr.lineCount,
            wordCount: ocr.wordCount,
            ...(target === "screen"
              ? {
                  monitorIndex: "monitorIndex" in capture ? capture.monitorIndex : monitorIndex,
                  bounds: capture.bounds,
                }
              : {
                  windowTitle: "windowTitle" in capture ? capture.windowTitle : "",
                  processName: "processName" in capture ? capture.processName : "",
                  bounds: capture.bounds,
                }),
          },
          ocr.text || "No readable text was detected on screen.",
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to inspect the screen.");
      } finally {
        if (imagePath) {
          await removeCaptureFile(imagePath);
        }
      }
    },
  );
};
