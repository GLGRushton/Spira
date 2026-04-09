import { describe, expect, it } from "vitest";
import {
  classifyUpgradeScope,
  getRelevantUpgradeFiles,
  normalizeChangedFilePath,
  upgradeCanAutoRelaunch,
  upgradeNeedsUiRefresh,
} from "./upgrade.js";

describe("normalizeChangedFilePath", () => {
  it("normalizes relative Windows-style paths", () => {
    expect(normalizeChangedFilePath(".\\packages\\renderer\\src\\App.tsx")).toBe("packages/renderer/src/App.tsx");
  });
});

describe("classifyUpgradeScope", () => {
  it("classifies pure mcp config changes as hot capability", () => {
    expect(classifyUpgradeScope(["mcp-servers.json"])).toBe("hot-capability");
  });

  it("classifies pure mcp server changes as hot capability", () => {
    expect(classifyUpgradeScope(["packages/mcp-windows/src/tools/disk-usage.ts"])).toBe("hot-capability");
  });

  it("classifies renderer-only changes as ui refresh", () => {
    expect(classifyUpgradeScope(["packages/renderer/src/components/AppShell.tsx"])).toBe("ui-refresh");
  });

  it("classifies backend and shared changes as backend reload", () => {
    expect(classifyUpgradeScope(["packages/backend/src/index.ts", "packages/shared/src/protocol.ts"])).toBe(
      "backend-reload",
    );
  });

  it("classifies main process changes as full restart", () => {
    expect(classifyUpgradeScope(["packages/main/src/index.ts"])).toBe("full-restart");
  });

  it("keeps mixed backend and mcp changes on backend reload", () => {
    expect(classifyUpgradeScope(["packages/mcp-windows/src/index.ts", "packages/backend/src/index.ts"])).toBe(
      "backend-reload",
    );
  });

  it("classifies mixed renderer and backend changes as backend reload", () => {
    expect(classifyUpgradeScope(["packages/renderer/src/hooks/useIpc.ts", "packages/backend/src/index.ts"])).toBe(
      "backend-reload",
    );
  });

  it("classifies mixed renderer and mcp changes as backend reload", () => {
    expect(classifyUpgradeScope(["packages/renderer/src/hooks/useIpc.ts", "packages/mcp-windows/src/index.ts"])).toBe(
      "backend-reload",
    );
  });
});

describe("getRelevantUpgradeFiles", () => {
  it("filters docs, tests, and scripts from upgrade planning", () => {
    expect(
      getRelevantUpgradeFiles([
        "README.md",
        "scripts\\build.ts",
        "packages\\shared\\src\\upgrade.test.ts",
        "tsconfig.json",
        "packages\\backend\\src\\index.ts",
      ]),
    ).toEqual(["packages/backend/src/index.ts"]);
  });
});

describe("upgradeNeedsUiRefresh", () => {
  it("detects renderer changes inside a mixed upgrade", () => {
    expect(upgradeNeedsUiRefresh(["packages/backend/src/index.ts", "packages/renderer/src/hooks/useIpc.ts"])).toBe(
      true,
    );
    expect(upgradeNeedsUiRefresh(["packages/backend/src/index.ts"])).toBe(false);
  });
});

describe("upgradeCanAutoRelaunch", () => {
  it("allows automatic relaunch for runtime code changes", () => {
    expect(upgradeCanAutoRelaunch(["packages/main/src/index.ts", "packages/backend/src/index.ts"])).toBe(true);
  });

  it("rejects automatic relaunch for package manager changes", () => {
    expect(upgradeCanAutoRelaunch(["package.json", "packages/main/src/index.ts"])).toBe(false);
  });
});
