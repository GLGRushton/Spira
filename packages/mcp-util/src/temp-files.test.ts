import type { Dirent, Stats } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCaptureFileStore } from "./temp-files.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: vi.fn(actual.mkdir),
    readdir: vi.fn(actual.readdir),
    rm: vi.fn(actual.rm),
    stat: vi.fn(actual.stat),
    unlink: vi.fn(actual.unlink),
  };
});

const createTestCaptureStore = () => createCaptureFileStore(`spira-mcp-util-test-${Date.now()}-${Math.random()}`);

describe("createCaptureFileStore", () => {
  it("accepts files inside the managed capture directory", () => {
    const captureStore = createTestCaptureStore();
    expect(captureStore.isManagedCapturePath(join(captureStore.getCaptureDirectory(), "capture.png"))).toBe(true);
  });

  it("rejects sibling directories that only share the prefix", () => {
    const captureStore = createTestCaptureStore();
    expect(captureStore.isManagedCapturePath(join(`${captureStore.getCaptureDirectory()}-evil`, "capture.png"))).toBe(
      false,
    );
  });

  it("rejects traversal paths that resolve outside the capture directory", () => {
    const captureStore = createTestCaptureStore();
    expect(captureStore.isManagedCapturePath(join(captureStore.getCaptureDirectory(), "..", "outside.txt"))).toBe(
      false,
    );
  });

  it("removes existing capture files and ignores missing paths", async () => {
    const captureStore = createTestCaptureStore();
    const capturePath = await captureStore.createCapturePath("capture");
    await fsPromises.writeFile(capturePath, "pixels");

    await captureStore.removeCaptureFile(capturePath);
    await expect(fsPromises.stat(capturePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(captureStore.removeCaptureFile(capturePath)).resolves.toBeUndefined();
    await captureStore.cleanupCaptureDirectory();
  });

  it("continues pruning after a cleanup failure and surfaces aggregate errors", async () => {
    const captureStore = createTestCaptureStore();
    const captureDirectory = captureStore.getCaptureDirectory();
    const staleFile = join(captureDirectory, "stale.png");
    const blockedFile = join(captureDirectory, "blocked.png");
    const nestedDirectory = join(captureDirectory, "nested");
    const readdirMock = vi.mocked(fsPromises.readdir);
    const statMock = vi.mocked(fsPromises.stat);
    const unlinkMock = vi.mocked(fsPromises.unlink);
    const rmMock = vi.mocked(fsPromises.rm);

    readdirMock.mockResolvedValueOnce([
      { name: "blocked.png", isDirectory: () => false },
      { name: "stale.png", isDirectory: () => false },
      { name: "nested", isDirectory: () => true },
    ] as Dirent[]);
    statMock.mockResolvedValue({ mtimeMs: 0 } as Stats);
    unlinkMock
      .mockRejectedValueOnce(Object.assign(new Error("blocked"), { code: "EACCES" }))
      .mockResolvedValueOnce(undefined);
    rmMock.mockResolvedValueOnce(undefined);

    await expect(captureStore.pruneStaleCaptureFiles(1)).rejects.toThrow(
      "Failed to prune one or more stale capture files.",
    );

    expect(unlinkMock).toHaveBeenCalledWith(blockedFile);
    expect(unlinkMock).toHaveBeenCalledWith(staleFile);
    expect(rmMock).toHaveBeenCalledWith(nestedDirectory, { recursive: true, force: true });
  });
});
