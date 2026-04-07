import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getCaptureDirectory, isManagedCapturePath } from "./temp-files.js";

describe("isManagedCapturePath", () => {
  it("accepts files inside the managed capture directory", () => {
    expect(isManagedCapturePath(join(getCaptureDirectory(), "capture.png"))).toBe(true);
  });

  it("rejects sibling directories that only share the prefix", () => {
    expect(isManagedCapturePath(join(`${getCaptureDirectory()}-evil`, "capture.png"))).toBe(false);
  });

  it("rejects traversal paths that resolve outside the capture directory", () => {
    expect(isManagedCapturePath(join(getCaptureDirectory(), "..", "outside.txt"))).toBe(false);
  });
});
