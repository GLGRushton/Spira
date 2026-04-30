import { readdirSync, readFileSync, statSync } from "node:fs";
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

describe("copilot sdk import boundary", () => {
  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const selfPath = path.resolve(srcRoot, "provider", "copilot-import-boundary.test.ts");

  it("keeps GitHub Copilot SDK imports confined to provider\\copilot", () => {
    const offenders = collectTypeScriptFiles(srcRoot).filter((filePath) => {
      if (path.resolve(filePath) === selfPath) {
        return false;
      }
      const source = readFileSync(filePath, "utf8");
      if (!source.includes("@github/copilot")) {
        return false;
      }
      const normalized = filePath.replace(/\\/g, "/");
      return !normalized.includes("/provider/copilot/");
    });

    expect(offenders).toEqual([]);
  });

  it("keeps Copilot-branded helper imports out of runtime-owned modules", () => {
    const offenders = collectTypeScriptFiles(srcRoot).filter((filePath) => {
      if (path.resolve(filePath) === selfPath) {
        return false;
      }
      const normalized = filePath.replace(/\\/g, "/");
      if (!normalized.includes("/runtime/") && !normalized.includes("/subagent/")) {
        return false;
      }
      const source = readFileSync(filePath, "utf8");
      return /(?:from\s+|import\s*\(|(?:^|[;\n\r])\s*import\s+)["'][^"']*\/copilot\/[^"']+["']/m.test(source);
    });

    expect(offenders).toEqual([]);
  });
});
