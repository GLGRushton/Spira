export const MODEL_PROVIDERS = [
  "copilot",
  "claude-agent",
  "azure-openai",
  "azure-openai-escalation",
  "openai",
  "openai-escalation",
] as const;

export type ModelProviderId = (typeof MODEL_PROVIDERS)[number];
