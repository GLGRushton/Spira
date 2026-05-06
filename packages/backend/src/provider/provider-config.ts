import type { Env } from "@spira/shared";
import type { ProviderId } from "./types.js";

export const getConfiguredProviderId = (env: Env): ProviderId => env.SPIRA_MODEL_PROVIDER;

export const ESCALATION_PROVIDER_IDS = ["azure-openai-escalation", "openai-escalation"] as const satisfies ProviderId[];

export const isEscalationProvider = (
  providerId: ProviderId | null | undefined,
): providerId is (typeof ESCALATION_PROVIDER_IDS)[number] =>
  providerId === "azure-openai-escalation" || providerId === "openai-escalation";

export const getProviderLabel = (providerId: ProviderId): string => {
  switch (providerId) {
    case "azure-openai-escalation":
      return "Azure OpenAI Escalation";
    case "azure-openai":
      return "Azure OpenAI";
    case "openai-escalation":
      return "OpenAI Escalation";
    case "openai":
      return "OpenAI";
    default:
      return "GitHub Copilot";
  }
};
