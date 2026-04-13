import { describe, expect, it } from "vitest";
import { describeSource, normalizeIdentifier } from "./entries.js";

describe("normalizeIdentifier", () => {
  it("normalizes labels into lowercase hyphenated identifiers", () => {
    expect(normalizeIdentifier("YouTrack Personal MCP")).toBe("youtrack-personal-mcp");
  });

  it("strips leading and trailing separators", () => {
    expect(normalizeIdentifier("  --Custom Agent--  ")).toBe("custom-agent");
  });
});

describe("describeSource", () => {
  it("maps user sources to custom wording", () => {
    expect(describeSource("user")).toBe("custom");
  });

  it("maps undefined sources to built-in wording", () => {
    expect(describeSource(undefined)).toBe("built-in");
  });
});
