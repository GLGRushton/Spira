import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, successResult } from "@spira/mcp-util/results";
import { WindowsOcrProvider } from "../ocr/ocr-provider.js";
import { isManagedCapturePath, removeCaptureFile } from "../util/capture-store.js";
import { OcrSchema } from "../util/validation.js";

const ocrProvider = new WindowsOcrProvider();

export const registerOcrTools = (server: McpServer): void => {
  server.registerTool(
    "vision_ocr",
    {
      description:
        "Read text from a previously captured screen image. Only call this when the user has asked Shinra to inspect on-screen text.",
      inputSchema: OcrSchema,
      annotations: {
        title: "Read Screen Text",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ imagePath }) => {
      if (!isManagedCapturePath(imagePath)) {
        return errorResult("imagePath must be a managed capture file.");
      }

      try {
        const result = await ocrProvider.recognize(imagePath);
        return successResult(result, result.text || "No readable text was detected.");
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to run OCR.");
      } finally {
        if (isManagedCapturePath(imagePath)) {
          await removeCaptureFile(imagePath);
        }
      }
    },
  );
};
