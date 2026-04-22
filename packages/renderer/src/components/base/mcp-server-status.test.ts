import type { McpServerStatus } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { getMcpServerStateLabel, getMcpServerStateTone } from "./mcp-server-status.js";

const createServer = (overrides: Partial<McpServerStatus>): McpServerStatus => ({
  id: "windows-system",
  name: "Windows System",
  enabled: true,
  state: "connected",
  toolCount: 0,
  tools: [],
  diagnostics: {
    failureCount: 0,
    recentStderr: [],
  },
  ...overrides,
});

describe("mcp-server-status", () => {
  it("reports disabled state explicitly for intentionally disabled servers", () => {
    const server = createServer({ enabled: false, state: "disconnected" });

    expect(getMcpServerStateLabel(server)).toBe("disabled");
    expect(getMcpServerStateTone(server)).toBe("disconnected");
  });

  it("preserves live runtime state for enabled servers", () => {
    const server = createServer({ enabled: true, state: "starting" });

    expect(getMcpServerStateLabel(server)).toBe("starting");
    expect(getMcpServerStateTone(server)).toBe("starting");
  });
});
