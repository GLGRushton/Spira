import { describe, expect, it } from "vitest";
import { parseEnv } from "./config-schema.js";

describe("parseEnv", () => {
  it("defaults an empty model provider to copilot", () => {
    expect(parseEnv({ SPIRA_MODEL_PROVIDER: "" }).SPIRA_MODEL_PROVIDER).toBe("copilot");
    expect(parseEnv({ SPIRA_MODEL_PROVIDER: "   " }).SPIRA_MODEL_PROVIDER).toBe("copilot");
  });

  it("accepts explicit model providers", () => {
    expect(parseEnv({ SPIRA_MODEL_PROVIDER: "copilot" }).SPIRA_MODEL_PROVIDER).toBe("copilot");
    expect(parseEnv({ SPIRA_MODEL_PROVIDER: "azure-openai" }).SPIRA_MODEL_PROVIDER).toBe("azure-openai");
  });
});
