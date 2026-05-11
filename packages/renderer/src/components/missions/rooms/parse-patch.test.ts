import { describe, expect, it } from "vitest";
import { countHunks, parsePatch } from "./parse-patch.js";

const SAMPLE_PATCH = [
  "diff --git a/foo.ts b/foo.ts",
  "index 0123456..abcdef0 100644",
  "--- a/foo.ts",
  "+++ b/foo.ts",
  "@@ -1,3 +1,4 @@",
  " const x = 1;",
  "-const y = 2;",
  "+const y = 3;",
  "+const z = 4;",
  "@@ -10,2 +11,3 @@",
  " return x + y;",
  "+// trailing comment",
  "",
].join("\n");

describe("parsePatch", () => {
  it("returns an empty payload for empty input", () => {
    expect(parsePatch("")).toEqual({ lines: [], hunkCount: 0 });
  });

  it("classifies meta, hunk, add, del, and ctx lines", () => {
    const result = parsePatch(SAMPLE_PATCH);
    const kinds = result.lines.map((line) => line.kind);
    expect(kinds).toEqual([
      "meta", // diff --git
      "meta", // index
      "meta", // ---
      "meta", // +++
      "hunk", // @@ first
      "ctx", //  const x
      "del", // -const y = 2;
      "add", // +const y = 3;
      "add", // +const z = 4;
      "hunk", // @@ second
      "ctx", //  return x + y;
      "add", // +// trailing comment
    ]);
  });

  it("counts hunks via the @@ markers", () => {
    expect(parsePatch(SAMPLE_PATCH).hunkCount).toBe(2);
  });

  it("strips the trailing empty line produced by patches that end with a newline", () => {
    const result = parsePatch("@@ -1 +1 @@\n test\n");
    expect(result.lines).toHaveLength(2);
    expect(result.lines.at(-1)?.text).toBe(" test");
  });

  it("recognises rename and binary metadata lines", () => {
    const renamePatch = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 92%",
      "rename from old.ts",
      "rename to new.ts",
      "Binary files a/foo.png and b/foo.png differ",
    ].join("\n");
    const result = parsePatch(renamePatch);
    expect(result.lines.map((line) => line.kind)).toEqual(["meta", "meta", "meta", "meta", "meta"]);
    expect(result.hunkCount).toBe(0);
  });
});

describe("countHunks", () => {
  it("returns 0 for empty input", () => {
    expect(countHunks("")).toBe(0);
  });

  it("counts hunks without parsing the whole patch", () => {
    expect(countHunks(SAMPLE_PATCH)).toBe(2);
  });

  it("counts a single hunk at the start of input", () => {
    expect(countHunks("@@ -1 +1 @@\n test")).toBe(1);
  });
});
