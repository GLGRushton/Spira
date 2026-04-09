export type UpgradeScope = "hot-capability" | "backend-reload" | "ui-refresh" | "full-restart";

export interface UpgradeProposal {
  proposalId: string;
  scope: UpgradeScope;
  summary: string;
  changedFiles: string[];
  requestedAt: number;
}

export type UpgradeStatus =
  | { proposalId: string; scope: UpgradeScope; status: "applying"; message: string }
  | { proposalId: string; scope: UpgradeScope; status: "completed"; message: string }
  | { proposalId: string; scope: UpgradeScope; status: "manual-restart"; message: string }
  | { proposalId: string; scope: UpgradeScope; status: "denied"; message: string }
  | { proposalId: string; scope: UpgradeScope; status: "failed"; message: string };

const MANUAL_RESTART_FILES = new Set(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]);
const IGNORED_UPGRADE_FILES = new Set(["biome.json", "tsconfig.base.json", "tsconfig.json", "vitest.workspace.ts"]);
const MAIN_PROCESS_PREFIX = "packages/main/";
const RENDERER_PREFIXES = ["packages/renderer/", "assets/"] as const;
const BACKEND_PREFIXES = ["packages/backend/", "packages/shared/"] as const;
const HOT_CAPABILITY_PREFIXES = ["packages/mcp-"] as const;
const IGNORED_UPGRADE_FILE_PATTERNS = [/\.md$/u, /(^|\/)scripts\//u, /\.(test|spec)\.[cm]?[jt]sx?$/u];

export const normalizeChangedFilePath = (file: string): string =>
  file
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/u, "")
    .replace(/^\/+/u, "");

const matchesAnyPrefix = (file: string, prefixes: readonly string[]): boolean =>
  prefixes.some((prefix) => file.startsWith(prefix));
const isEnvFile = (file: string): boolean => file === ".env" || file.startsWith(".env.");
const isRendererFile = (file: string): boolean => matchesAnyPrefix(file, RENDERER_PREFIXES);
const isBackendFile = (file: string): boolean => isEnvFile(file) || matchesAnyPrefix(file, BACKEND_PREFIXES);
const isHotCapabilityFile = (file: string): boolean =>
  file === "mcp-servers.json" || matchesAnyPrefix(file, HOT_CAPABILITY_PREFIXES);
const isIgnoredUpgradeFile = (file: string): boolean =>
  IGNORED_UPGRADE_FILES.has(file) || IGNORED_UPGRADE_FILE_PATTERNS.some((pattern) => pattern.test(file));
const isKnownRuntimeFile = (file: string): boolean =>
  MANUAL_RESTART_FILES.has(file) ||
  file.startsWith(MAIN_PROCESS_PREFIX) ||
  isRendererFile(file) ||
  isBackendFile(file) ||
  isHotCapabilityFile(file);

export const getRelevantUpgradeFiles = (changedFiles: string[]): string[] =>
  [...new Set(changedFiles.map(normalizeChangedFilePath).filter((file) => file.length > 0))].filter(
    (file) => !isIgnoredUpgradeFile(file),
  );

export const upgradeNeedsUiRefresh = (changedFiles: string[]): boolean =>
  getRelevantUpgradeFiles(changedFiles).some((file) => isRendererFile(file));

export const upgradeCanAutoRelaunch = (changedFiles: string[]): boolean => {
  const files = getRelevantUpgradeFiles(changedFiles);
  return files.length > 0 && files.every((file) => !MANUAL_RESTART_FILES.has(file) && isKnownRuntimeFile(file));
};

export const classifyUpgradeScope = (changedFiles: string[]): UpgradeScope => {
  const files = getRelevantUpgradeFiles(changedFiles);
  if (files.length === 0) {
    throw new Error("Upgrade classification requires at least one changed file.");
  }

  let hasBackendChange = false;
  let hasRendererChange = false;
  let hasHotCapabilityChange = false;

  for (const file of files) {
    if (MANUAL_RESTART_FILES.has(file) || file.startsWith(MAIN_PROCESS_PREFIX) || !isKnownRuntimeFile(file)) {
      return "full-restart";
    }

    if (isRendererFile(file)) {
      hasRendererChange = true;
      continue;
    }

    if (isBackendFile(file)) {
      hasBackendChange = true;
      continue;
    }

    if (isHotCapabilityFile(file)) {
      hasHotCapabilityChange = true;
    }
  }

  if (hasHotCapabilityChange && !hasBackendChange && !hasRendererChange) {
    return "hot-capability";
  }

  if (hasBackendChange || hasHotCapabilityChange) {
    return "backend-reload";
  }

  return "ui-refresh";
};
