import { parseEnv } from "@spira/shared";
import { describe, expect, it, vi } from "vitest";
import { createProviderClientForProvider } from "./client-factory.js";

describe("createProviderClientForProvider", () => {
  it("creates the OpenAI escalation provider without falling back to Copilot", async () => {
    const { client } = await createProviderClientForProvider(
      parseEnv({
        SPIRA_MODEL_PROVIDER: "openai-escalation",
        OPENAI_API_KEY: "secret",
        OPENAI_MODEL: "gpt-5.4",
        OPENAI_ESCALATION_MODEL: "gpt-5.5",
      }),
      "openai-escalation",
      { info: vi.fn(), warn: vi.fn() },
    );

    expect(client.providerId).toBe("openai-escalation");
    expect(client.capabilities).toMatchObject({
      sessionResumption: "host-managed",
      modelSelection: "session-scoped",
    });
  });

  it("creates the Azure OpenAI escalation provider without falling back to Copilot", async () => {
    const { client } = await createProviderClientForProvider(
      parseEnv({
        SPIRA_MODEL_PROVIDER: "azure-openai-escalation",
        AZURE_OPENAI_API_KEY: "secret",
        AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
        AZURE_OPENAI_DEPLOYMENT: "shinra-mini",
        AZURE_OPENAI_ESCALATION_DEPLOYMENT: "shinra-full",
      }),
      "azure-openai-escalation",
      { info: vi.fn(), warn: vi.fn() },
    );

    expect(client.providerId).toBe("azure-openai-escalation");
    expect(client.capabilities).toMatchObject({
      sessionResumption: "host-managed",
      modelSelection: "provider-default",
    });
  });
});
