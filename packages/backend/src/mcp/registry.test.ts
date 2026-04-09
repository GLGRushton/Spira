import type { McpServerConfig } from "@spira/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createDisconnectedStatus, deriveRemediationHint, toRuntimeConfig } from "./registry.js";

const originalNodeEnv = process.env.NODE_ENV;

const baseConfig: McpServerConfig = {
  id: "windows-system",
  name: "Windows System",
  transport: "stdio",
  command: "node",
  args: ["packages/mcp-windows/dist/index.js"],
  env: {},
  enabled: true,
  autoRestart: true,
  maxRestarts: 3,
};

describe("toRuntimeConfig", () => {
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("uses node with tsx import for development stdio servers", () => {
    process.env.NODE_ENV = "development";

    expect(toRuntimeConfig(baseConfig)).toEqual({
      ...baseConfig,
      command: process.execPath,
      args: ["--import", "tsx", "packages/mcp-windows/src/index.ts"],
    });
  });

  it("leaves non-development configs unchanged", () => {
    process.env.NODE_ENV = "production";

    expect(toRuntimeConfig(baseConfig)).toEqual(baseConfig);
  });

  it("leaves non-node commands unchanged in development", () => {
    process.env.NODE_ENV = "development";

    expect(
      toRuntimeConfig({
        ...baseConfig,
        command: "python",
      }),
    ).toEqual({
      ...baseConfig,
      command: "python",
    });
  });
});

describe("createDisconnectedStatus", () => {
  it("creates fresh diagnostics for new enabled servers", () => {
    expect(createDisconnectedStatus(baseConfig)).toMatchObject({
      enabled: true,
      state: "starting",
      diagnostics: {
        failureCount: 0,
        recentStderr: [],
      },
    });
  });

  it("marks disabled servers as disconnected", () => {
    expect(
      createDisconnectedStatus({
        ...baseConfig,
        enabled: false,
      }),
    ).toMatchObject({
      enabled: false,
      state: "disconnected",
    });
  });

  it("preserves diagnostics and last connected time when rebuilding status", () => {
    expect(
      createDisconnectedStatus(baseConfig, {
        diagnostics: {
          failureCount: 2,
          lastFailureAt: 123,
          lastError: "Token expired",
          remediationHint: "Check the API key.",
          recentStderr: ["401 unauthorized"],
        },
        lastConnectedAt: 456,
      }),
    ).toMatchObject({
      enabled: true,
      state: "starting",
      diagnostics: {
        failureCount: 2,
        lastFailureAt: 123,
        lastError: "Token expired",
        remediationHint: "Check the API key.",
        recentStderr: ["401 unauthorized"],
      },
      lastConnectedAt: 456,
    });
  });
});

describe("deriveRemediationHint", () => {
  it("points auth failures toward secret configuration from stderr output", () => {
    expect(deriveRemediationHint("Request failed", ["401 missing api key"])).toContain("API key");
  });

  it("points spawn failures toward command/runtime setup", () => {
    expect(deriveRemediationHint("spawn ENOENT", [])).toContain("command");
  });

  it("points permission failures toward execution access", () => {
    expect(deriveRemediationHint("permission denied", [])).toContain("permissions");
  });

  it("points invalid config failures toward configuration review", () => {
    expect(deriveRemediationHint("Invalid schema", [])).toContain("configuration");
  });

  it("falls back to inspecting stderr and environment for unknown failures", () => {
    expect(deriveRemediationHint("Unexpected failure", [])).toContain("stderr");
  });
});
