import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const collectTypeScriptFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      return collectTypeScriptFiles(fullPath);
    }
    return fullPath.endsWith(".ts") ? [fullPath] : [];
  });

describe("claude-agent sdk import boundary", () => {
  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const selfPath = path.resolve(srcRoot, "provider", "claude-agent-import-boundary.test.ts");

  it("keeps Claude Agent SDK imports confined to provider/claude-agent", () => {
    const offenders = collectTypeScriptFiles(srcRoot).filter((filePath) => {
      if (path.resolve(filePath) === selfPath) {
        return false;
      }
      const source = readFileSync(filePath, "utf8");
      if (!source.includes("@anthropic-ai/claude-agent-sdk")) {
        return false;
      }
      const normalized = filePath.replace(/\\/g, "/");
      return !normalized.includes("/provider/claude-agent/");
    });

    expect(offenders).toEqual([]);
  });

  it("keeps claude-agent helper imports out of runtime-owned modules", () => {
    const offenders = collectTypeScriptFiles(srcRoot).filter((filePath) => {
      if (path.resolve(filePath) === selfPath) {
        return false;
      }
      const normalized = filePath.replace(/\\/g, "/");
      if (!normalized.includes("/runtime/") && !normalized.includes("/subagent/")) {
        return false;
      }
      const source = readFileSync(filePath, "utf8");
      return /(?:from\s+|import\s*\(|(?:^|[;\n\r])\s*import\s+)["'][^"']*\/claude-agent\/[^"']+["']/m.test(source);
    });

    expect(offenders).toEqual([]);
  });
});
