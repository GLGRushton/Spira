import { describe, expect, it } from "vitest";
import {
  coerceStoredRuntimeConfigValue,
  getAllowedRuntimeConfigValues,
  normalizeRuntimeConfigValue,
} from "./runtime-config-utils.js";

describe("runtime-config-utils", () => {
  it("maps cleared model provider updates back to copilot", () => {
    expect(normalizeRuntimeConfigValue("modelProvider", null)).toBe("copilot");
    expect(normalizeRuntimeConfigValue("modelProvider", "")).toBe("copilot");
    expect(normalizeRuntimeConfigValue("modelProvider", "   ")).toBe("copilot");
  });

  it("normalizes model provider aliases to canonical values", () => {
    expect(normalizeRuntimeConfigValue("modelProvider", "azure")).toBe("azure-openai");
    expect(normalizeRuntimeConfigValue("modelProvider", "azure-ai")).toBe("azure-openai");
    expect(normalizeRuntimeConfigValue("modelProvider", "github-copilot")).toBe("copilot");
  });

  it("rejects invalid model providers", () => {
    expect(() => normalizeRuntimeConfigValue("modelProvider", "gpt-5.4")).toThrow(
      'Invalid model provider. Use "copilot" or "azure-openai".',
    );
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

  it("returns allowed values for model provider", () => {
    expect(getAllowedRuntimeConfigValues("modelProvider")).toEqual(["copilot", "azure-openai"]);
    expect(getAllowedRuntimeConfigValues("githubToken")).toBeUndefined();
  });
});
