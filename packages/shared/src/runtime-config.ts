export const RUNTIME_CONFIG_KEYS = [
  "githubToken",
  "missionGitHubToken",
  "elevenLabsApiKey",
  "picovoiceAccessKey",
  "nexusModsApiKey",
  "youTrackBaseUrl",
  "youTrackToken",
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
  secret: true;
}

export type RuntimeConfigSummary = Record<RuntimeConfigKey, RuntimeConfigEntrySummary>;

export interface RuntimeConfigApplyResult {
  summary: RuntimeConfigSummary;
  appliedToBackend: boolean;
}
