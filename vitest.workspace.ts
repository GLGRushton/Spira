import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/shared",
  "packages/memory-db",
  "packages/backend",
  "packages/main",
  "packages/mcp-sql-server",
  "packages/mcp-memories",
  "packages/mcp-util",
  "packages/mcp-nexus-mods",
  "packages/mcp-spira-data-entry",
  "packages/mcp-spira-ui",
  "packages/mcp-vision",
  "packages/mcp-windows",
  "packages/mcp-windows-ui",
  "packages/renderer",
]);
