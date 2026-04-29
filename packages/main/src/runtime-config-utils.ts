import type { RuntimeConfigKey } from "@spira/shared";

const MODEL_PROVIDER_VALUES = new Set(["copilot", "azure-openai"] as const);

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

export const normalizeRuntimeConfigValue = (key: RuntimeConfigKey, value: unknown): string | null | undefined => {
  const normalized = normalizeStringValue(value);
  if (key === "modelProvider" && normalized === null) {
    return "copilot";
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
    const trimmed = value.trim();
    if (MODEL_PROVIDER_VALUES.has(trimmed as "copilot" | "azure-openai")) {
      return trimmed;
    }
  }

  return "copilot";
};
