import type { McpServerConfig } from "@spira/shared";
import { afterEach, describe, expect, it } from "vitest";
import { SpiraEventBus } from "../util/event-bus.js";
import {
  McpRegistry,
  createDisconnectedStatus,
  deriveRemediationHint,
  filterManagedBuiltinServerConfigs,
  mergeBuiltinServerConfigs,
  toRuntimeConfig,
} from "./registry.js";

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

  it("leaves remote MCP transports unchanged in development", () => {
    process.env.NODE_ENV = "development";

    expect(
      toRuntimeConfig({
        id: "youtrack",
        name: "YouTrack",
        transport: "streamable-http",
        url: "https://example.youtrack.cloud/mcp",
        headers: { Authorization: "Bearer secret" },
        enabled: true,
        autoRestart: true,
        maxRestarts: 3,
      }),
    ).toEqual({
      id: "youtrack",
      name: "YouTrack",
      transport: "streamable-http",
      url: "https://example.youtrack.cloud/mcp",
      headers: { Authorization: "Bearer secret" },
      enabled: true,
      autoRestart: true,
      maxRestarts: 3,
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

  it("includes normalized tool access policy in disconnected status", () => {
    expect(
      createDisconnectedStatus({
        ...baseConfig,
        toolAccess: {
          readOnlyToolNames: ["find_projects", "find_projects"],
          writeToolNames: ["create_issue"],
        },
      }),
    ).toMatchObject({
      toolAccess: {
        readOnlyToolNames: ["find_projects"],
        writeToolNames: ["create_issue"],
      },
    });
  });

  it("preserves tool access policy when a server is connected", async () => {
    const pool = {
      connect: async () => undefined,
      disconnect: async () => undefined,
      listTools: () => [{ name: "find_projects" }, { name: "create_issue" }],
      getConnectedAt: () => 123,
      isCrashed: () => false,
    };
    const memoryDb = {
      upsertMcpServerConfig: (config: McpServerConfig) => config,
    };
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };

    const registry = new McpRegistry(new SpiraEventBus(), logger as never, pool as never, memoryDb as never);
    await registry.addServer({
      ...baseConfig,
      id: "youtrackpersonal",
      name: "YouTrack Personal MCP",
      toolAccess: {
        readOnlyToolNames: ["find_projects"],
        writeToolNames: ["create_issue"],
      },
    });

    expect(registry.getStatus()).toEqual([
      expect.objectContaining({
        id: "youtrackpersonal",
        state: "connected",
        toolAccess: {
          readOnlyToolNames: ["find_projects"],
          writeToolNames: ["create_issue"],
        },
      }),
    ]);
  });

  it("reserves managed dynamic builtin ids for future activation", async () => {
    const pool = {
      connect: async () => undefined,
      disconnect: async () => undefined,
      listTools: () => [],
      getConnectedAt: () => 0,
      isCrashed: () => false,
    };
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };
    const registry = new McpRegistry(new SpiraEventBus(), logger as never, pool as never, null, [], ["youtrack"]);

    await expect(
      registry.addServer({
        ...baseConfig,
        id: "youtrack",
        name: "Shadow YouTrack",
      }),
    ).rejects.toThrow("reserved");
  });
});

describe("dynamic builtins", () => {
  it("merges dynamic builtins over file config ids", () => {
    const dynamicConfig: McpServerConfig = {
      ...baseConfig,
      id: "youtrack",
      name: "YouTrack",
      source: "builtin",
    };

    expect(mergeBuiltinServerConfigs([baseConfig], [dynamicConfig])).toEqual([baseConfig, dynamicConfig]);
    expect(
      mergeBuiltinServerConfigs([{ ...baseConfig, id: "youtrack", name: "Old YouTrack" }], [dynamicConfig]),
    ).toEqual([dynamicConfig]);
  });

  it("filters stale managed builtins from persisted config", () => {
    const dynamicConfig: McpServerConfig = {
      ...baseConfig,
      id: "youtrack",
      name: "YouTrack",
      source: "builtin",
    };

    expect(filterManagedBuiltinServerConfigs([baseConfig, dynamicConfig], [], ["youtrack"])).toEqual([baseConfig]);
    expect(filterManagedBuiltinServerConfigs([baseConfig, dynamicConfig], ["youtrack"], ["youtrack"])).toEqual([
      baseConfig,
      dynamicConfig,
    ]);
  });
});

describe("deriveRemediationHint", () => {
  it("points auth failures toward secret configuration from stderr output", () => {
    expect(deriveRemediationHint("Request failed", ["401 missing api key"])).toContain("API key");
  });

  it("points npx install prompts toward non-interactive launch args", () => {
    expect(
      deriveRemediationHint("Connection closed", ["Need to install the following packages:", "Ok to proceed? (y)"]),
    ).toContain("-y");
  });

  it("points invalid remote URLs toward full https endpoints", () => {
    expect(deriveRemediationHint("TypeError: Invalid URL", [])).toContain("https://");
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
