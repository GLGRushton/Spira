import type { Env } from "@spira/shared";
import type { ProviderId } from "./types.js";

export const getConfiguredProviderId = (env: Env): ProviderId => env.SPIRA_MODEL_PROVIDER;

export const getProviderLabel = (providerId: ProviderId): string => {
  switch (providerId) {
    case "azure-openai":
      return "Azure OpenAI";
    case "copilot":
    default:
      return "GitHub Copilot";
  }
};
