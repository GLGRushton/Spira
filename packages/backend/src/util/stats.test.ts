import { describe, expect, it } from "vitest";
import { median, percentile } from "./stats.js";

describe("percentile", () => {
  it("returns 0 for empty input", () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it("returns the single value for a one-element list", () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.99)).toBe(42);
  });

  it("matches Excel-style PERCENTILE.INC interpolation", () => {
    expect(percentile([10, 20, 30, 40, 50], 0)).toBe(10);
    expect(percentile([10, 20, 30, 40, 50], 0.25)).toBe(20);
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(percentile([10, 20, 30, 40, 50], 0.75)).toBe(40);
    expect(percentile([10, 20, 30, 40, 50], 1)).toBe(50);
  });

  it("rounds to the nearest integer between adjacent samples", () => {
    expect(percentile([10, 20], 0.5)).toBe(15);
    expect(percentile([10, 30], 0.25)).toBe(15);
  });
});

describe("median", () => {
  it("returns null for empty input", () => {
    expect(median([])).toBeNull();
  });

  it("matches percentile(sorted, 0.5)", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3); // (2+3)/2 rounded
  });
});
