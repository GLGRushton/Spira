export const RUNTIME_CONFIG_KEYS = [
  "modelProvider",
  "githubToken",
  "azureOpenAiApiKey",
  "azureOpenAiEndpoint",
  "azureOpenAiDeployment",
  "azureOpenAiApiVersion",
  "azureOpenAiModel",
  "missionGitHubToken",
  "elevenLabsApiKey",
  "picovoiceAccessKey",
  "nexusModsApiKey",
  "youTrackBaseUrl",
  "youTrackToken",
  "sqlServerServer",
  "sqlServerPort",
  "sqlServerUsername",
  "sqlServerPassword",
  "sqlServerEncrypt",
  "sqlServerTrustServerCertificate",
  "sqlServerAllowedDatabases",
  "sqlServerRowLimit",
  "sqlServerTimeoutMs",
] as const;

export type RuntimeConfigKey = (typeof RUNTIME_CONFIG_KEYS)[number];
export type RuntimeConfigSource = "stored" | "environment" | "cleared" | "unset";
export type RuntimeConfigUpdate = Partial<Record<RuntimeConfigKey, string | null>>;

export interface RuntimeConfigEntrySummary {
  key: RuntimeConfigKey;
  label: string;
  description: string;
  configured: boolean;
  source: RuntimeConfigSource;
  secret: boolean;
  currentValue: string | null;
  allowedValues?: string[];
}

export type RuntimeConfigSummary = Record<RuntimeConfigKey, RuntimeConfigEntrySummary>;

export interface RuntimeConfigApplyResult {
  summary: RuntimeConfigSummary;
  appliedToBackend: boolean;
}
