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
    expect(parseEnv({ SPIRA_MODEL_PROVIDER: "azure-openai-escalation" }).SPIRA_MODEL_PROVIDER).toBe(
      "azure-openai-escalation",
    );
    expect(parseEnv({ SPIRA_MODEL_PROVIDER: "openai" }).SPIRA_MODEL_PROVIDER).toBe("openai");
    expect(parseEnv({ SPIRA_MODEL_PROVIDER: "openai-escalation" }).SPIRA_MODEL_PROVIDER).toBe("openai-escalation");
  });

  it("treats cleared OpenAI optional values as unset and restores the default model", () => {
    const env = parseEnv({
      OPENAI_BASE_URL: "",
      OPENAI_MODEL: "   ",
      OPENAI_ESCALATION_MODEL: "",
    });

    expect(env.OPENAI_BASE_URL).toBeUndefined();
    expect(env.OPENAI_MODEL).toBe("gpt-5.4");
    expect(env.OPENAI_ESCALATION_MODEL).toBeUndefined();
  });
});
