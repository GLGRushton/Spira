import { describe, expect, it } from "vitest";
import { classifyUpgradeScope, normalizeChangedFilePath } from "./upgrade.js";

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

  it("escalates mixed renderer and backend changes to full restart", () => {
    expect(classifyUpgradeScope(["packages/renderer/src/hooks/useIpc.ts", "packages/backend/src/index.ts"])).toBe(
      "full-restart",
    );
  });
});
