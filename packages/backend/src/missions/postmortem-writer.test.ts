import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWritePostmortem } from "./postmortem-writer.js";

describe("atomicWritePostmortem", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), "postmortem-writer-test-"));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("returns no-workspace when workspaceRoot is null", async () => {
    const result = await atomicWritePostmortem({
      workspaceRoot: null,
      filename: "anything.md",
      markdown: "# hi",
    });
    expect(result).toEqual({ status: "no-workspace" });
  });

  it("creates the reports directory and writes the file the first time", async () => {
    const result = await atomicWritePostmortem({
      workspaceRoot,
      filename: "first.md",
      markdown: "# first",
    });
    expect(result.status).toBe("written");
    if (result.status === "written") {
      const written = await readFile(result.path, "utf8");
      expect(written).toBe("# first");
    }
  });

  it("returns exists on EEXIST and does NOT clobber the existing file", async () => {
    const filename = "race.md";
    await atomicWritePostmortem({ workspaceRoot, filename, markdown: "# original" });
    const second = await atomicWritePostmortem({
      workspaceRoot,
      filename,
      markdown: "# overwrite-attempt",
    });
    expect(second.status).toBe("exists");
    if (second.status === "exists") {
      const written = await readFile(second.path, "utf8");
      expect(written).toBe("# original");
    }
  });

  it("creates reports/ subdirectory under workspaceRoot", async () => {
    await atomicWritePostmortem({ workspaceRoot, filename: "a.md", markdown: "# a" });
    const stats = await stat(path.join(workspaceRoot, "reports"));
    expect(stats.isDirectory()).toBe(true);
  });
});
