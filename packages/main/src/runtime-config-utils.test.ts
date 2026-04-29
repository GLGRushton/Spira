import { describe, expect, it } from "vitest";
import { coerceStoredRuntimeConfigValue, normalizeRuntimeConfigValue } from "./runtime-config-utils.js";

describe("runtime-config-utils", () => {
  it("maps cleared model provider updates back to copilot", () => {
    expect(normalizeRuntimeConfigValue("modelProvider", null)).toBe("copilot");
    expect(normalizeRuntimeConfigValue("modelProvider", "")).toBe("copilot");
    expect(normalizeRuntimeConfigValue("modelProvider", "   ")).toBe("copilot");
  });

  it("preserves cleared semantics for other runtime config keys", () => {
    expect(normalizeRuntimeConfigValue("githubToken", null)).toBeNull();
    expect(normalizeRuntimeConfigValue("githubToken", "   ")).toBeNull();
  });

  it("coerces stored cleared model providers back to copilot", () => {
    expect(coerceStoredRuntimeConfigValue("modelProvider", null)).toBe("copilot");
    expect(coerceStoredRuntimeConfigValue("modelProvider", "invalid")).toBe("copilot");
  });

  it("leaves unset model providers unset until explicitly configured", () => {
    expect(coerceStoredRuntimeConfigValue("modelProvider", undefined)).toBeUndefined();
  });
});
