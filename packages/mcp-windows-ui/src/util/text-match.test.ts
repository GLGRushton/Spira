import type { OcrLine } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { findOcrTextMatches } from "./text-match.js";

const lines: OcrLine[] = [
  {
    text: "Search or paste link",
    bounds: { x: 10, y: 10, width: 180, height: 24 },
    words: [],
  },
  {
    text: "Sherlock",
    bounds: { x: 20, y: 80, width: 90, height: 28 },
    words: [],
  },
  {
    text: "A Study in Pink",
    bounds: { x: 200, y: 80, width: 150, height: 28 },
    words: [],
  },
];

describe("findOcrTextMatches", () => {
  it("matches text exactly without case sensitivity", () => {
    expect(findOcrTextMatches(lines, { query: "sherlock", match: "exact" })).toEqual([
      {
        lineIndex: 1,
        text: "Sherlock",
        bounds: { x: 20, y: 80, width: 90, height: 28 },
      },
    ]);
  });

  it("matches text by substring", () => {
    expect(findOcrTextMatches(lines, { query: "study", match: "contains" })).toEqual([
      {
        lineIndex: 2,
        text: "A Study in Pink",
        bounds: { x: 200, y: 80, width: 150, height: 28 },
      },
    ]);
  });

  it("matches text by regex", () => {
    expect(findOcrTextMatches(lines, { query: "^Search.+link$", match: "regex" })).toEqual([
      {
        lineIndex: 0,
        text: "Search or paste link",
        bounds: { x: 10, y: 10, width: 180, height: 24 },
      },
    ]);
  });

  it("filters matches to a region", () => {
    expect(
      findOcrTextMatches(lines, {
        query: "sherlock",
        match: "contains",
        region: { x: 0, y: 0, width: 50, height: 50 },
      }),
    ).toEqual([]);
  });
});
