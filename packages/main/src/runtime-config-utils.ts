import type { RuntimeConfigKey } from "@spira/shared";

const MODEL_PROVIDER_ALIASES = new Map<string, "copilot" | "azure-openai">([
  ["copilot", "copilot"],
  ["github-copilot", "copilot"],
  ["azure", "azure-openai"],
  ["azure-ai", "azure-openai"],
  ["azure-openai", "azure-openai"],
  ["azure openai", "azure-openai"],
]);

export const MODEL_PROVIDER_RUNTIME_CONFIG_VALUES = ["copilot", "azure-openai"] as const;

const normalizeStringValue = (value: unknown): string | null | undefined => {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeModelProviderValue = (
  value: string | null | undefined,
): "copilot" | "azure-openai" | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return "copilot";
  }

  const canonical = MODEL_PROVIDER_ALIASES.get(value.toLowerCase());
  if (canonical) {
    return canonical;
  }

  throw new Error('Invalid model provider. Use "copilot" or "azure-openai".');
};

export const normalizeRuntimeConfigValue = (key: RuntimeConfigKey, value: unknown): string | null | undefined => {
  const normalized = normalizeStringValue(value);
  if (key === "modelProvider") {
    return normalizeModelProviderValue(normalized);
  }
  return normalized;
};

export const coerceStoredRuntimeConfigValue = (
  key: RuntimeConfigKey,
  value: string | null | undefined,
): string | null | undefined => {
  if (key !== "modelProvider" || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    const canonical = MODEL_PROVIDER_ALIASES.get(value.trim().toLowerCase());
    if (canonical) {
      return canonical;
    }
  }

  return "copilot";
};

export const getAllowedRuntimeConfigValues = (key: RuntimeConfigKey): string[] | undefined =>
  key === "modelProvider" ? [...MODEL_PROVIDER_RUNTIME_CONFIG_VALUES] : undefined;
