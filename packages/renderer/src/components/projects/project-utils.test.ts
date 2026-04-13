import { describe, expect, it } from "vitest";
import { findExactProjectMatch, normalizeProjectKey } from "./project-utils.js";

describe("normalizeProjectKey", () => {
  it("trims and uppercases project keys", () => {
    expect(normalizeProjectKey(" spi ")).toBe("SPI");
  });
});

describe("findExactProjectMatch", () => {
  it("matches project keys case-insensitively", () => {
    expect(
      findExactProjectMatch(
        [
          { id: "1", shortName: "SPI", name: "Spira" },
          { id: "2", shortName: "OPS", name: "Operations" },
        ],
        "spi",
      ),
    ).toEqual({ id: "1", shortName: "SPI", name: "Spira" });
  });

  it("returns null when no project key matches exactly", () => {
    expect(findExactProjectMatch([{ id: "1", shortName: "SPI", name: "Spira" }], "sp")).toBeNull();
  });
});
