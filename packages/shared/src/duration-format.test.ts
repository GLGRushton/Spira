import { describe, expect, it } from "vitest";
import { formatDuration } from "./duration-format.js";

describe("formatDuration", () => {
  it("long: matches the post-mortem output", () => {
    expect(formatDuration(0, "long")).toBe("0 ms");
    expect(formatDuration(999, "long")).toBe("999 ms");
    expect(formatDuration(1500, "long")).toBe("1.5 s");
    expect(formatDuration(60_000, "long")).toBe("1 min");
    expect(formatDuration(90_000, "long")).toBe("1 min 30 s");
    expect(formatDuration(3_600_000, "long")).toBe("1 h");
    expect(formatDuration(3_900_000, "long")).toBe("1 h 5 min");
  });

  it("minutes-only: rounds seconds inside the minute bucket", () => {
    expect(formatDuration(60_500, "minutes-only")).toBe("1 min 1 s");
    expect(formatDuration(60_000, "minutes-only")).toBe("1 min");
    expect(formatDuration(null, "minutes-only")).toBe("—");
  });

  it("elapsed: returns starting for sub-second deltas", () => {
    expect(formatDuration(0, "elapsed")).toBe("starting");
    expect(formatDuration(15_000, "elapsed")).toBe("15s elapsed");
    expect(formatDuration(75_500, "elapsed")).toBe("1m 15s elapsed");
    expect(formatDuration(3_720_000, "elapsed")).toBe("1h 02m elapsed");
  });

  it("compact: no spaces in seconds form", () => {
    expect(formatDuration(450, "compact")).toBe("450ms");
    expect(formatDuration(1_500, "compact")).toBe("1.5s");
    expect(formatDuration(75_000, "compact")).toBe("1m 15s");
  });

  it("aux-deck: integer seconds", () => {
    expect(formatDuration(35_999, "aux-deck")).toBe("35s");
    expect(formatDuration(125_000, "aux-deck")).toBe("2m 5s");
  });

  it("non-finite input returns the per-style sentinel", () => {
    expect(formatDuration(null, "long")).toBe("—");
    expect(formatDuration(undefined, "long")).toBe("—");
    expect(formatDuration(Number.NaN, "elapsed")).toBe("starting");
    expect(formatDuration(Number.NaN, "aux-deck")).toBe("0s");
  });
});
