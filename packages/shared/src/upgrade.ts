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

const FULL_RESTART_FILES = new Set([
  "biome.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
  "vitest.workspace.ts",
]);

export const normalizeChangedFilePath = (file: string): string =>
  file
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/u, "")
    .replace(/^\/+/u, "");

export const classifyUpgradeScope = (changedFiles: string[]): UpgradeScope => {
  const files = [...new Set(changedFiles.map(normalizeChangedFilePath).filter((file) => file.length > 0))];
  if (files.length === 0) {
    throw new Error("Upgrade classification requires at least one changed file.");
  }

  let hasBackendChange = false;
  let hasRendererChange = false;
  let hasHotCapabilityChange = false;

  for (const file of files) {
    if (file === "mcp-servers.json") {
      hasHotCapabilityChange = true;
      continue;
    }

    if (file === ".env" || file.startsWith(".env.")) {
      hasBackendChange = true;
      continue;
    }

    if (file.startsWith("packages/main/") || FULL_RESTART_FILES.has(file)) {
      return "full-restart";
    }

    if (file.startsWith("packages/renderer/") || file.startsWith("assets/")) {
      hasRendererChange = true;
      continue;
    }

    if (file.startsWith("packages/backend/") || file.startsWith("packages/shared/")) {
      hasBackendChange = true;
      continue;
    }

    if (file.startsWith("packages/mcp-")) {
      hasHotCapabilityChange = true;
      continue;
    }

    return "full-restart";
  }

  if (hasHotCapabilityChange && !hasBackendChange && !hasRendererChange) {
    return "hot-capability";
  }

  if (hasBackendChange && hasRendererChange) {
    return "full-restart";
  }

  if (hasBackendChange) {
    return "backend-reload";
  }

  if (hasRendererChange && hasHotCapabilityChange) {
    return "full-restart";
  }

  return "ui-refresh";
};
