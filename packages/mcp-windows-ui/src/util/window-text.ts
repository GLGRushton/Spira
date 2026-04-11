import type { OcrLine, OcrRectangle } from "@spira/shared";
import {
  type WindowClickResult,
  type WindowInfo,
  type WindowTarget,
  captureWindow,
  clickWindowPoint,
  findUiNodes,
  listWindows,
} from "./automation.js";
import { removeCaptureFile } from "./capture-store.js";
import { recognizeWindowImage } from "./ocr.js";
import { type TextMatchMode, findOcrTextMatches } from "./text-match.js";

export interface WindowTextReadResult {
  window: WindowInfo;
  capturedAt: string;
  width: number;
  height: number;
  captureMethod: "print-window" | "copy-from-screen";
  imagePath?: string;
  text: string;
  lineCount: number;
  wordCount: number;
  lines: OcrLine[];
}

export interface WindowTextClickResult extends WindowClickResult {
  matchedText: string;
  matchMode: TextMatchMode;
  occurrence: number;
  availableMatches: number;
  matchBounds: OcrRectangle;
}

export interface WindowWaitForResult {
  window: WindowInfo;
  condition: "window-title-contains" | "text-visible" | "node-exists";
  elapsedMs: number;
  attempts: number;
  stablePolls: number;
  observation: Record<string, unknown>;
}

export interface WindowTextVisibleCondition {
  type: "text-visible";
  text: string;
  match: TextMatchMode;
  preferPrintWindow: boolean;
  region?: OcrRectangle;
}

export interface WindowTitleContainsCondition {
  type: "window-title-contains";
  text: string;
}

export interface WindowNodeExistsCondition {
  type: "node-exists";
  path?: number[];
  name?: string;
  automationId?: string;
  className?: string;
  controlType?: string;
  maxDepth: number;
}

export type WindowWaitCondition = WindowTextVisibleCondition | WindowTitleContainsCondition | WindowNodeExistsCondition;

const sleep = async (delayMs: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
};

const normalize = (value: string): string => value.trim().toLocaleLowerCase();

export function resolveWindowFromList(windows: WindowInfo[], target: WindowTarget): WindowInfo | null {
  if (typeof target.handle === "number") {
    return windows.find((window) => window.handle === target.handle) ?? null;
  }

  let candidates = windows;
  if (typeof target.title === "string" && target.title.trim()) {
    const titleTerm = normalize(target.title);
    candidates = candidates.filter((window) => normalize(window.title).includes(titleTerm));
  }

  if (typeof target.processName === "string" && target.processName.trim()) {
    const processName = normalize(target.processName);
    candidates = candidates.filter((window) => normalize(window.processName) === processName);
  }

  return candidates[0] ?? null;
}

async function resolveWindow(target: WindowTarget): Promise<WindowInfo> {
  const windows = await listWindows();
  const match = resolveWindowFromList(windows, target);
  if (!match) {
    throw new Error("No matching window found.");
  }

  return match;
}

export async function readWindowText(args: {
  target: WindowTarget;
  preferPrintWindow: boolean;
  keepImage: boolean;
}): Promise<WindowTextReadResult> {
  const capture = await captureWindow(args.target, args.preferPrintWindow);

  try {
    const ocr = await recognizeWindowImage(capture.imagePath);
    return {
      window: {
        handle: capture.handle,
        title: capture.title,
        processName: capture.processName,
        pid: capture.pid,
        className: capture.className,
        bounds: capture.bounds,
      },
      capturedAt: capture.capturedAt,
      width: capture.width,
      height: capture.height,
      captureMethod: capture.captureMethod,
      imagePath: args.keepImage ? capture.imagePath : undefined,
      text: ocr.text,
      lineCount: ocr.lineCount,
      wordCount: ocr.wordCount,
      lines: ocr.lines,
    };
  } finally {
    if (!args.keepImage) {
      await removeCaptureFile(capture.imagePath);
    }
  }
}

export async function clickWindowText(args: {
  target: WindowTarget;
  text: string;
  match: TextMatchMode;
  occurrence: number;
  region?: OcrRectangle;
  button: "left" | "right";
  doubleClick: boolean;
  restore: boolean;
  preferPrintWindow: boolean;
}): Promise<WindowTextClickResult> {
  const readResult = await readWindowText({
    target: args.target,
    preferPrintWindow: args.preferPrintWindow,
    keepImage: false,
  });

  const matches = findOcrTextMatches(readResult.lines, {
    query: args.text,
    match: args.match,
    region: args.region,
  });

  const selectedMatch = matches[args.occurrence - 1];
  if (!selectedMatch) {
    throw new Error(`No visible text match found for "${args.text}" (occurrence ${args.occurrence}).`);
  }

  const x = Math.max(0, Math.round(selectedMatch.bounds.x + selectedMatch.bounds.width / 2));
  const y = Math.max(0, Math.round(selectedMatch.bounds.y + selectedMatch.bounds.height / 2));
  const clickResult = await clickWindowPoint({
    target: args.target,
    x,
    y,
    button: args.button,
    doubleClick: args.doubleClick,
    restore: args.restore,
  });

  return {
    ...clickResult,
    matchedText: selectedMatch.text,
    matchMode: args.match,
    occurrence: args.occurrence,
    availableMatches: matches.length,
    matchBounds: selectedMatch.bounds,
  };
}

export async function waitForWindowCondition(args: {
  target: WindowTarget;
  condition: WindowWaitCondition;
  timeoutMs: number;
  pollIntervalMs: number;
  stablePolls: number;
}): Promise<WindowWaitForResult> {
  const startedAt = Date.now();
  let attempts = 0;
  let stableMatches = 0;
  let lastObservation: Record<string, unknown> = {};
  let lastWindow: WindowInfo | null = null;
  let lastError: Error | null = null;

  while (Date.now() - startedAt <= args.timeoutMs) {
    attempts += 1;

    try {
      switch (args.condition.type) {
        case "window-title-contains": {
          const window = await resolveWindow(args.target);
          lastWindow = window;
          const satisfied = normalize(window.title).includes(normalize(args.condition.text));
          lastObservation = {
            windowTitle: window.title,
            matched: satisfied,
          };
          stableMatches = satisfied ? stableMatches + 1 : 0;
          break;
        }
        case "text-visible": {
          const readResult = await readWindowText({
            target: args.target,
            preferPrintWindow: args.condition.preferPrintWindow,
            keepImage: false,
          });
          lastWindow = readResult.window;
          const matches = findOcrTextMatches(readResult.lines, {
            query: args.condition.text,
            match: args.condition.match,
            region: args.condition.region,
          });
          lastObservation = {
            matchedText: args.condition.text,
            matchCount: matches.length,
            firstMatch: matches[0] ?? null,
          };
          stableMatches = matches.length > 0 ? stableMatches + 1 : 0;
          break;
        }
        case "node-exists": {
          const result = await findUiNodes({
            ...args.target,
            path: args.condition.path,
            name: args.condition.name,
            automationId: args.condition.automationId,
            className: args.condition.className,
            controlType: args.condition.controlType,
            maxDepth: args.condition.maxDepth,
            limit: 1,
          });
          lastWindow = result.window;
          lastObservation = {
            matchCount: result.matches.length,
            firstMatch: result.matches[0] ?? null,
          };
          stableMatches = result.matches.length > 0 ? stableMatches + 1 : 0;
          break;
        }
      }

      if (stableMatches >= args.stablePolls && lastWindow) {
        return {
          window: lastWindow,
          condition: args.condition.type,
          elapsedMs: Date.now() - startedAt,
          attempts,
          stablePolls: stableMatches,
          observation: lastObservation,
        };
      }

      lastError = null;
    } catch (error) {
      stableMatches = 0;
      lastError = error instanceof Error ? error : new Error("Failed to observe window state.");
      lastObservation = { error: lastError.message };
    }

    await sleep(args.pollIntervalMs);
  }

  const timeoutReason =
    lastError?.message ??
    (args.condition.type === "window-title-contains"
      ? `Window title did not contain "${args.condition.text}".`
      : args.condition.type === "text-visible"
        ? `Visible text "${args.condition.text}" did not appear.`
        : "Matching UI node did not appear.");
  throw new Error(`Timed out after ${args.timeoutMs}ms. ${timeoutReason}`);
}
