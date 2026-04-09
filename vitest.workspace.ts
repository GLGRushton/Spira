import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/shared",
  "packages/memory-db",
  "packages/backend",
  "packages/mcp-vision",
  "packages/mcp-windows",
  "packages/renderer",
]);
