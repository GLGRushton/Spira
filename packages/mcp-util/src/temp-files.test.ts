import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCaptureFileStore } from "./temp-files.js";

const captureStore = createCaptureFileStore("spira-mcp-util-test");

describe("createCaptureFileStore", () => {
  it("accepts files inside the managed capture directory", () => {
    expect(captureStore.isManagedCapturePath(join(captureStore.getCaptureDirectory(), "capture.png"))).toBe(true);
  });

  it("rejects sibling directories that only share the prefix", () => {
    expect(captureStore.isManagedCapturePath(join(`${captureStore.getCaptureDirectory()}-evil`, "capture.png"))).toBe(
      false,
    );
  });

  it("rejects traversal paths that resolve outside the capture directory", () => {
    expect(captureStore.isManagedCapturePath(join(captureStore.getCaptureDirectory(), "..", "outside.txt"))).toBe(
      false,
    );
  });
});
