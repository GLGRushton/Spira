import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { activateWindow, captureWindow, clickWindowPoint, listWindows, sendKeysToWindow } from "../util/automation.js";
import { errorResult, successResult } from "../util/results.js";
import {
  ActivateWindowSchema,
  CaptureWindowSchema,
  EmptySchema,
  UiClickTextSchema,
  UiClickWindowPointSchema,
  UiReadWindowSchema,
  UiSendKeysSchema,
  UiWaitForSchema,
} from "../util/validation.js";
import { clickWindowText, readWindowText, waitForWindowCondition } from "../util/window-text.js";

export const registerWindowTools = (server: McpServer): void => {
  server.registerTool(
    "ui_list_windows",
    {
      description: "List visible top-level windows with handles, titles, processes, and bounds.",
      inputSchema: EmptySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => {
      try {
        const windows = await listWindows();
        return successResult({ windows }, `Found ${windows.length} visible windows.`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to list windows.");
      }
    },
  );

  server.registerTool(
    "ui_activate_window",
    {
      description: "Restore and foreground a specific window by handle, title, or process name.",
      inputSchema: ActivateWindowSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ handle, title, processName, restore }) => {
      try {
        const result = await activateWindow({ handle, title, processName }, restore);
        return successResult(result, `Activated "${result.window.title}" (${result.window.processName}).`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to activate the requested window.");
      }
    },
  );

  server.registerTool(
    "ui_read_window",
    {
      description:
        "Capture a specific window and run OCR on it, returning visible text and line bounds. Prefer this over ui_capture_window when the goal is to read on-screen text rather than inspect pixels.",
      inputSchema: UiReadWindowSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ handle, title, processName, preferPrintWindow, keepImage }) => {
      try {
        const result = await readWindowText({
          target: { handle, title, processName },
          preferPrintWindow,
          keepImage,
        });
        return successResult(
          result,
          result.text ||
            `Read ${result.lineCount} text line${result.lineCount === 1 ? "" : "s"} from "${result.window.title}".`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to read text from the requested window.");
      }
    },
  );

  server.registerTool(
    "ui_capture_window",
    {
      description:
        "Capture a specific window by handle, title, or process name. Works best for inactive desktop apps when Windows allows PrintWindow.",
      inputSchema: CaptureWindowSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ handle, title, processName, preferPrintWindow }) => {
      try {
        const capture = await captureWindow({ handle, title, processName }, preferPrintWindow);
        return successResult(
          capture,
          `Captured "${capture.title}" (${capture.processName}) at ${capture.width}x${capture.height} via ${capture.captureMethod}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to capture the requested window.");
      }
    },
  );

  server.registerTool(
    "ui_click_text",
    {
      description:
        "Click visible text inside a specific window using OCR matching. Prefer this when UI Automation is unavailable but the target text is clearly visible.",
      inputSchema: UiClickTextSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({
      handle,
      title,
      processName,
      text,
      match,
      occurrence,
      region,
      button,
      doubleClick,
      restore,
      preferPrintWindow,
    }) => {
      try {
        const result = await clickWindowText({
          target: { handle, title, processName },
          text,
          match,
          occurrence,
          region,
          button,
          doubleClick,
          restore,
          preferPrintWindow,
        });
        return successResult(
          result,
          `Clicked visible text "${result.matchedText}" in "${result.window.title}" at (${result.relativePoint.x}, ${result.relativePoint.y}).`,
        );
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : "Failed to click visible text in the requested window.",
        );
      }
    },
  );

  server.registerTool(
    "ui_click_window_point",
    {
      description:
        "Click a point inside a specific window using coordinates relative to that window. Use this only when ui_act and ui_click_text are not viable.",
      inputSchema: UiClickWindowPointSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ handle, title, processName, x, y, button, doubleClick, restore }) => {
      try {
        const result = await clickWindowPoint({
          target: { handle, title, processName },
          x,
          y,
          button,
          doubleClick,
          restore,
        });
        return successResult(result, `Clicked ${button} button at (${x}, ${y}) inside "${result.window.title}".`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to click inside the requested window.");
      }
    },
  );

  server.registerTool(
    "ui_wait_for",
    {
      description:
        "Wait for a specific window state such as a title change, visible OCR text, or a UI Automation node becoming available. Use this after clicks, typing, or navigation that changes the UI asynchronously.",
      inputSchema: UiWaitForSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ handle, title, processName, timeoutMs, pollIntervalMs, stablePolls, condition }) => {
      try {
        const result = await waitForWindowCondition({
          target: { handle, title, processName },
          condition,
          timeoutMs,
          pollIntervalMs,
          stablePolls,
        });
        return successResult(
          result,
          `Condition "${result.condition}" satisfied for "${result.window.title}" after ${result.elapsedMs}ms.`,
        );
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : "Timed out waiting for the requested window state.",
        );
      }
    },
  );

  server.registerTool(
    "ui_send_keys",
    {
      description:
        "Send text or raw SendKeys input to a specific window after activating it. Provide either text for clipboard paste or keys for raw key chords.",
      inputSchema: UiSendKeysSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ handle, title, processName, text, keys, restore }) => {
      try {
        const result = await sendKeysToWindow({
          target: { handle, title, processName },
          text,
          keys,
          restore,
        });
        return successResult(
          result,
          result.mode === "text"
            ? `Pasted ${result.textLength ?? 0} characters into "${result.window.title}".`
            : `Sent keys to "${result.window.title}".`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to send input to the requested window.");
      }
    },
  );
};
