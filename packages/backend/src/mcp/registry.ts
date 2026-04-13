import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SpiraMemoryDatabase } from "@spira/memory-db";
import {
  type McpServerConfig,
  McpServerConfigSchema,
  type McpServerDiagnostics,
  type McpServerStatus,
  type McpServerUpdateConfig,
  type McpServersFile,
  McpServersFileSchema,
  normalizeMcpToolAccessPolicy,
} from "@spira/shared";
import type { Logger } from "pino";
import { z } from "zod";
import { resolveAppPath } from "../util/app-paths.js";
import { ConfigError } from "../util/errors.js";
import type { SpiraEventBus } from "../util/event-bus.js";
import { setUnrefTimeout } from "../util/timers.js";
import type { McpClientPool } from "./client-pool.js";

interface McpServerEntry {
  fileConfig: McpServerConfig;
  runtimeConfig: McpServerConfig;
  status: McpServerStatus;
  connectedAt?: number;
}

type ParsedMcpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const mergeBuiltinServerConfigs = (
  fileServers: readonly McpServerConfig[],
  dynamicBuiltinServers: readonly McpServerConfig[],
): ParsedMcpServerConfig[] => {
  const dynamicIds = new Set(dynamicBuiltinServers.map((config) => config.id));
  return [...fileServers.filter((config) => !dynamicIds.has(config.id)), ...dynamicBuiltinServers].map((config) =>
    McpServerConfigSchema.parse(config),
  );
};

export const filterManagedBuiltinServerConfigs = (
  configs: readonly McpServerConfig[],
  activeBuiltinServerIds: readonly string[],
  managedBuiltinServerIds: readonly string[],
): ParsedMcpServerConfig[] => {
  const activeIds = new Set(activeBuiltinServerIds);
  const managedIds = new Set(managedBuiltinServerIds);
  return configs
    .filter((config) => !managedIds.has(config.id) || activeIds.has(config.id))
    .map((config) => McpServerConfigSchema.parse(config));
};

const sanitizeBuiltinServerConfigForPersistence = (config: McpServerConfig): McpServerConfig =>
  config.transport === "streamable-http"
    ? {
        ...config,
        headers: undefined,
      }
    : config;

export const toRuntimeConfig = (config: McpServerConfig): McpServerConfig => {
  if (process.env.NODE_ENV !== "development" || config.transport !== "stdio" || config.command !== "node") {
    return config;
  }

  return {
    ...config,
    command: process.execPath,
    args: [
      "--import",
      "tsx",
      ...config.args.map((arg) => arg.replace(/([\\/])dist([\\/])/g, "$1src$2").replace(/\.js$/u, ".ts")),
    ],
  };
};

const createDiagnostics = (): McpServerDiagnostics => ({
  failureCount: 0,
  recentStderr: [],
});

const buildStatusIdentity = (config: McpServerConfig) => ({
  id: config.id,
  name: config.name,
  description: config.description,
  source: config.source ?? "builtin",
  toolAccess: normalizeMcpToolAccessPolicy(config.toolAccess),
  enabled: config.enabled,
});

export const createDisconnectedStatus = (
  config: McpServerConfig,
  previous?: Pick<McpServerStatus, "diagnostics" | "lastConnectedAt">,
): McpServerStatus => ({
  ...buildStatusIdentity(config),
  state: config.enabled ? "starting" : "disconnected",
  toolCount: 0,
  tools: [],
  diagnostics: previous?.diagnostics ?? createDiagnostics(),
  lastConnectedAt: previous?.lastConnectedAt,
});

const MAX_RECENT_STDERR_LINES = 8;

const pushRecentStderr = (diagnostics: McpServerDiagnostics, line: string): McpServerDiagnostics => ({
  ...diagnostics,
  recentStderr: [...diagnostics.recentStderr, line].slice(-MAX_RECENT_STDERR_LINES),
});

export const deriveRemediationHint = (message: string, recentStderr: string[]): string => {
  const haystack = `${message}\n${recentStderr.join("\n")}`.toLowerCase();
  if (haystack.includes("need to install the following packages") || haystack.includes("ok to proceed?")) {
    return "If this server is launched with npx, add -y before the package name so it can install non-interactively.";
  }

  if (haystack.includes("invalid url")) {
    return "Use a full remote MCP URL, including the protocol prefix such as https://.";
  }

  if (haystack.includes("enoent") || haystack.includes("spawn")) {
    return "Check the server command, arguments, and required runtime on this machine.";
  }

  if (haystack.includes("eacces") || haystack.includes("permission denied")) {
    return "Check execution permissions for the MCP command and any referenced files.";
  }

  if (
    haystack.includes("401") ||
    haystack.includes("403") ||
    haystack.includes("unauthorized") ||
    haystack.includes("api key") ||
    haystack.includes("token")
  ) {
    return "Check this server's API key or other authentication environment variables.";
  }

  if (haystack.includes("schema") || haystack.includes("invalid") || haystack.includes("config")) {
    return "Review the MCP server configuration and environment values for invalid settings.";
  }

  return "Inspect the recent stderr lines below, then review the server command and environment.";
};

export class McpRegistry {
  private readonly servers = new Map<string, McpServerEntry>();
  private configSchema: string | undefined;
  private configMutation = Promise.resolve();
  private suppressStatusPublishes = false;
  private publishPending = false;
  private stderrPublishTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly bus: SpiraEventBus,
    private readonly logger: Logger,
    private readonly pool: McpClientPool,
    private readonly memoryDb: SpiraMemoryDatabase | null = null,
    private readonly dynamicBuiltinServers: readonly McpServerConfig[] = [],
    private readonly managedBuiltinServerIds: readonly string[] = [],
  ) {
    this.bus.on("mcp:server-crashed", (serverId) => {
      this.handleServerCrash(serverId);
    });
    this.bus.on("mcp:server-stderr", (serverId, line) => {
      this.handleServerStderr(serverId, line);
    });
  }

  async initialize(): Promise<void> {
    try {
      const configFile = await this.loadRuntimeConfig();
      await this.applyConfigFile(configFile);
    } catch (error) {
      this.logger.error({ error }, "Failed to initialize MCP registry");
      throw error;
    }
  }

  async reloadFromDisk(): Promise<void> {
    await this.runConfigMutation(async () => {
      const configFile = await this.loadRuntimeConfig();
      const resumePublishing = this.pauseStatusPublishes();
      try {
        await this.pool.disconnectAll();
        await this.applyConfigFile(configFile, { throwOnEnabledServerFailure: true });
      } finally {
        resumePublishing();
      }
    });
  }

  async shutdown(): Promise<void> {
    try {
      await this.pool.disconnectAll();
    } catch (error) {
      this.logger.warn({ error }, "Failed to disconnect MCP clients cleanly");
    } finally {
      for (const entry of this.servers.values()) {
        entry.connectedAt = undefined;
        entry.status = {
          ...entry.status,
          state: "disconnected",
          toolCount: 0,
          tools: [],
          error: undefined,
          uptimeMs: undefined,
        };
      }

      this.publishStatuses();
    }
  }

  async addServer(config: McpServerConfig): Promise<void> {
    await this.runConfigMutation(async () => {
      const fileConfig = McpServerConfigSchema.parse({ ...config, source: "user" });
      if (this.managedBuiltinServerIds.includes(fileConfig.id)) {
        throw new ConfigError(`MCP server ${fileConfig.id} is reserved for a built-in integration`);
      }
      if (this.servers.has(fileConfig.id)) {
        throw new ConfigError(`MCP server ${fileConfig.id} already exists`);
      }

      const entry: McpServerEntry = {
        fileConfig,
        runtimeConfig: toRuntimeConfig(fileConfig),
        status: createDisconnectedStatus(fileConfig),
      };

      this.servers.set(fileConfig.id, entry);
      this.publishStatuses();

      try {
        if (fileConfig.enabled) {
          await this.connectEntry(entry, { throwOnFailure: true, publishFailureStatus: false });
        }
        if (this.memoryDb) {
          this.memoryDb.upsertMcpServerConfig({
            ...fileConfig,
            description: fileConfig.description,
            source: "user",
          });
        } else {
          await this.writeConfig(this.serializeConfig());
        }
      } catch (error) {
        this.servers.delete(fileConfig.id);
        this.publishStatuses();
        await this.pool.disconnect(fileConfig.id).catch((disconnectError) => {
          this.logger.warn({ error: disconnectError, serverId: fileConfig.id }, "Failed to rollback MCP server add");
        });
        throw error;
      }
    });
  }

  async updateServer(serverId: string, patch: McpServerUpdateConfig): Promise<void> {
    await this.runConfigMutation(async () => {
      const entry = this.requireEntry(serverId);
      if ((entry.fileConfig.source ?? "builtin") === "builtin") {
        throw new ConfigError(`Built-in MCP server ${serverId} cannot be edited`);
      }

      const previousFileConfig = structuredClone(entry.fileConfig);
      const previousRuntimeConfig = structuredClone(entry.runtimeConfig);
      const previousStatus = structuredClone(entry.status);
      const previousConnectedAt = entry.connectedAt;
      const normalizedPatch =
        entry.fileConfig.transport === "stdio"
          ? {
              ...patch,
              url: undefined,
              headers: undefined,
            }
          : {
              ...patch,
              command: undefined,
              args: undefined,
              env: undefined,
            };
      const nextFileConfig = McpServerConfigSchema.parse({
        ...entry.fileConfig,
        ...normalizedPatch,
        source: entry.fileConfig.source ?? "user",
        transport: entry.fileConfig.transport,
        id: entry.fileConfig.id,
      });

      entry.fileConfig = nextFileConfig;
      entry.runtimeConfig = toRuntimeConfig(nextFileConfig);

      await this.pool.disconnect(serverId);
      entry.connectedAt = undefined;
      entry.status = createDisconnectedStatus(nextFileConfig, previousStatus);
      this.publishStatuses();

      try {
        if (nextFileConfig.enabled) {
          await this.connectEntry(entry, { throwOnFailure: true, publishFailureStatus: false });
        }
        if (this.memoryDb) {
          this.memoryDb.upsertMcpServerConfig({
            ...nextFileConfig,
            description: nextFileConfig.description,
            source: "user",
          });
        } else {
          await this.writeConfig(this.serializeConfig());
        }
      } catch (error) {
        await this.pool.disconnect(serverId).catch((disconnectError) => {
          this.logger.warn({ error: disconnectError, serverId }, "Failed to rollback updated MCP server");
        });
        entry.fileConfig = previousFileConfig;
        entry.runtimeConfig = previousRuntimeConfig;
        entry.status = previousStatus;
        entry.connectedAt = previousConnectedAt;
        this.publishStatuses();
        if (previousFileConfig.enabled) {
          await this.connectEntry(entry).catch((reconnectError) => {
            this.logger.error(
              { error: reconnectError, serverId },
              "Failed to reconnect MCP server while rolling back update",
            );
          });
        }
        throw error;
      }
    });
  }

  async removeServer(serverId: string): Promise<void> {
    await this.runConfigMutation(async () => {
      const entry = this.requireEntry(serverId);
      if ((entry.fileConfig.source ?? "builtin") === "builtin") {
        throw new ConfigError(`Built-in MCP server ${serverId} cannot be removed`);
      }

      await this.pool.disconnect(serverId);
      this.servers.delete(serverId);
      this.publishStatuses();

      try {
        if (this.memoryDb) {
          this.memoryDb.removeMcpServerConfig(serverId);
        } else {
          await this.writeConfig(this.serializeConfig());
        }
      } catch (error) {
        entry.connectedAt = undefined;
        entry.status = createDisconnectedStatus(entry.fileConfig, entry.status);
        this.servers.set(serverId, entry);
        this.publishStatuses();
        if (entry.fileConfig.enabled) {
          await this.connectEntry(entry).catch((reconnectError) => {
            this.logger.error(
              { error: reconnectError, serverId },
              "Failed to reconnect MCP server while rolling back removal",
            );
          });
        }
        throw error;
      }
    });
  }

  async setServerEnabled(serverId: string, enabled: boolean): Promise<void> {
    await this.runConfigMutation(async () => {
      const entry = this.requireEntry(serverId);
      const previousEnabled = entry.fileConfig.enabled;
      if (previousEnabled === enabled) {
        return;
      }

      entry.fileConfig.enabled = enabled;
      entry.runtimeConfig = toRuntimeConfig(entry.fileConfig);

      if (!enabled) {
        await this.pool.disconnect(serverId);
        entry.connectedAt = undefined;
        entry.status = createDisconnectedStatus(entry.fileConfig, entry.status);
        this.publishStatuses();

        try {
          if (this.memoryDb) {
            this.memoryDb.setMcpServerEnabled(serverId, enabled);
          } else {
            await this.writeConfig(this.serializeConfig());
          }
        } catch (error) {
          entry.fileConfig.enabled = previousEnabled;
          entry.runtimeConfig = toRuntimeConfig(entry.fileConfig);
          if (previousEnabled) {
            await this.connectEntry(entry).catch((reconnectError) => {
              this.logger.error(
                { error: reconnectError, serverId },
                "Failed to reconnect MCP server while rolling back disable",
              );
            });
          } else {
            entry.status = createDisconnectedStatus(entry.fileConfig, entry.status);
            this.publishStatuses();
          }
          throw error;
        }
        return;
      }

      entry.status = createDisconnectedStatus(entry.fileConfig, entry.status);
      this.publishStatuses();

      try {
        await this.connectEntry(entry, { throwOnFailure: true, publishFailureStatus: false });
        if (this.memoryDb) {
          this.memoryDb.setMcpServerEnabled(serverId, enabled);
        } else {
          await this.writeConfig(this.serializeConfig());
        }
      } catch (error) {
        await this.pool.disconnect(serverId).catch((disconnectError) => {
          this.logger.warn({ error: disconnectError, serverId }, "Failed to rollback enabled MCP server");
        });
        entry.connectedAt = undefined;
        entry.fileConfig.enabled = previousEnabled;
        entry.runtimeConfig = toRuntimeConfig(entry.fileConfig);
        entry.status = createDisconnectedStatus(entry.fileConfig, entry.status);
        if (previousEnabled) {
          await this.connectEntry(entry).catch((reconnectError) => {
            this.logger.error(
              { error: reconnectError, serverId },
              "Failed to reconnect MCP server while rolling back enable",
            );
          });
        } else {
          this.publishStatuses();
        }
        throw error;
      }
    });
  }

  getStatus(): McpServerStatus[] {
    return [...this.servers.values()].map((entry) => ({
      ...entry.status,
      state: this.pool.isCrashed(entry.fileConfig.id) ? "error" : entry.status.state,
      lastConnectedAt: entry.connectedAt ?? entry.status.lastConnectedAt,
      uptimeMs:
        entry.status.state === "connected" && entry.connectedAt !== undefined
          ? Date.now() - entry.connectedAt
          : undefined,
    }));
  }

  private async loadRuntimeConfig(): Promise<z.infer<typeof McpServersFileSchema>> {
    const fileConfig = await this.loadConfig();
    if (!this.memoryDb) {
      return fileConfig;
    }

    this.configSchema = fileConfig.$schema;
    this.memoryDb.seedBuiltinMcpServerConfigs(
      fileConfig.servers.map((config) => sanitizeBuiltinServerConfigForPersistence({ ...config, source: "builtin" })),
    );
    const persistedServers = filterManagedBuiltinServerConfigs(
      this.memoryDb.listMcpServerConfigs().map((config) =>
        McpServerConfigSchema.parse({
          id: config.id,
          name: config.name,
          description: config.description,
          source: config.source,
          transport: config.transport,
          ...(config.transport === "stdio"
            ? {
                command: config.command,
                args: config.args,
                env: config.env,
              }
            : {
                url: config.url,
                headers: config.headers,
              }),
          toolAccess: config.toolAccess,
          enabled: config.enabled,
          autoRestart: config.autoRestart,
          maxRestarts: config.maxRestarts,
        }),
      ),
      this.dynamicBuiltinServers.map((config) => config.id),
      this.managedBuiltinServerIds,
    );
    return {
      ...(fileConfig.$schema ? { $schema: fileConfig.$schema } : {}),
      servers: mergeBuiltinServerConfigs(persistedServers, this.dynamicBuiltinServers),
    };
  }

  private async loadConfig(): Promise<z.infer<typeof McpServersFileSchema>> {
    const configPath = this.getConfigPath();

    try {
      const raw = await readFile(configPath, "utf8");
      const parsed = McpServersFileSchema.parse(JSON.parse(raw));
      return {
        ...(parsed.$schema ? { $schema: parsed.$schema } : {}),
        servers: mergeBuiltinServerConfigs(parsed.servers, this.dynamicBuiltinServers),
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ConfigError(`Invalid MCP server configuration in ${configPath}`, error);
      }

      throw new ConfigError(`Failed to read MCP server configuration from ${configPath}`, error);
    }
  }

  private async applyConfigFile(
    configFile: z.infer<typeof McpServersFileSchema>,
    options: { throwOnEnabledServerFailure?: boolean } = {},
  ): Promise<void> {
    this.configSchema = configFile.$schema;
    const previousServers = new Map(this.servers);
    this.servers.clear();

    for (const rawConfig of configFile.servers) {
      const config = { ...rawConfig, source: rawConfig.source ?? "builtin" } satisfies McpServerConfig;
      const previousStatus = previousServers.get(config.id)?.status;
      this.servers.set(config.id, {
        fileConfig: config,
        runtimeConfig: toRuntimeConfig(config),
        status: createDisconnectedStatus(config, previousStatus),
      });
    }

    this.publishStatuses();

    const enabledServers = [...this.servers.values()].filter((entry) => entry.fileConfig.enabled);
    const results = await Promise.allSettled(
      enabledServers.map((entry) =>
        this.connectEntry(entry, { throwOnFailure: options.throwOnEnabledServerFailure === true }),
      ),
    );

    if (!options.throwOnEnabledServerFailure) {
      return;
    }

    const failures = results.flatMap((result, index) => {
      if (result.status === "fulfilled") {
        return [];
      }

      const serverName = enabledServers[index]?.fileConfig.name ?? enabledServers[index]?.fileConfig.id ?? "unknown";
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      return [`${serverName}: ${message}`];
    });

    if (failures.length > 0) {
      throw new ConfigError(`Failed to reload MCP servers: ${failures.join("; ")}`);
    }
  }

  private async connectEntry(
    entry: McpServerEntry,
    options: { throwOnFailure?: boolean; publishFailureStatus?: boolean } = {},
  ): Promise<void> {
    this.updateStatus(entry.fileConfig.id, {
      enabled: entry.fileConfig.enabled,
      state: "starting",
      toolCount: 0,
      tools: [],
      error: undefined,
    });

    try {
      await this.pool.connect(entry.runtimeConfig);
      const tools = this.pool.listTools(entry.fileConfig.id);
      const connectedAt = this.pool.getConnectedAt(entry.fileConfig.id) ?? Date.now();
      entry.connectedAt = connectedAt;
      entry.status = {
        ...buildStatusIdentity(entry.fileConfig),
        state: "connected",
        toolCount: tools.length,
        tools: tools.map((tool) => tool.name),
        diagnostics: entry.status.diagnostics,
        lastConnectedAt: connectedAt,
        uptimeMs: 0,
      };
      this.publishStatuses();
    } catch (error) {
      this.logger.error({ error, serverId: entry.fileConfig.id }, "Failed to connect MCP server");
      if (options.publishFailureStatus !== false) {
        entry.connectedAt = undefined;
        const message = error instanceof Error ? error.message : String(error);
        entry.status = {
          ...buildStatusIdentity(entry.fileConfig),
          state: "error",
          toolCount: 0,
          tools: [],
          error: message,
          diagnostics: {
            ...entry.status.diagnostics,
            failureCount: entry.status.diagnostics.failureCount + 1,
            lastFailureAt: Date.now(),
            lastError: message,
            remediationHint: deriveRemediationHint(message, entry.status.diagnostics.recentStderr),
          },
          lastConnectedAt: entry.status.lastConnectedAt,
        };
        this.publishStatuses();
      }
      if (options.throwOnFailure) {
        throw error;
      }
    }
  }

  private updateStatus(serverId: string, status: Partial<McpServerStatus>): void {
    const entry = this.requireEntry(serverId);
    entry.status = {
      ...entry.status,
      ...status,
    };
    this.publishStatuses();
  }

  private requireEntry(serverId: string): McpServerEntry {
    const entry = this.servers.get(serverId);
    if (!entry) {
      throw new ConfigError(`Unknown MCP server ${serverId}`);
    }

    return entry;
  }

  private handleServerCrash(serverId: string): void {
    const entry = this.servers.get(serverId);
    if (!entry) {
      return;
    }

    entry.connectedAt = undefined;
    const error = "MCP server connection closed unexpectedly";
    entry.status = {
      ...buildStatusIdentity(entry.fileConfig),
      state: "error",
      toolCount: 0,
      tools: [],
      error,
      diagnostics: {
        ...entry.status.diagnostics,
        failureCount: entry.status.diagnostics.failureCount + 1,
        lastFailureAt: Date.now(),
        lastError: error,
        remediationHint: deriveRemediationHint(error, entry.status.diagnostics.recentStderr),
      },
      lastConnectedAt: entry.status.lastConnectedAt,
      uptimeMs: undefined,
    };
    this.publishStatuses();
  }

  private handleServerStderr(serverId: string, line: string): void {
    const entry = this.servers.get(serverId);
    if (!entry) {
      return;
    }

    entry.status = {
      ...entry.status,
      diagnostics: pushRecentStderr(entry.status.diagnostics, line),
    };
    if (this.stderrPublishTimer) {
      return;
    }

    this.stderrPublishTimer = setUnrefTimeout(() => {
      this.stderrPublishTimer = undefined;
      this.publishStatuses();
    }, 75);
  }

  private serializeConfig(): McpServersFile {
    return {
      ...(this.configSchema ? { $schema: this.configSchema } : {}),
      servers: [...this.servers.values()].map((entry) => McpServerConfigSchema.parse(entry.fileConfig)),
    };
  }

  private getConfigPath(): string {
    return resolveAppPath(process.env.SPIRA_MCP_CONFIG_PATH ?? "mcp-servers.json");
  }

  private async writeConfig(config: McpServersFile): Promise<void> {
    const configPath = this.getConfigPath();
    const tempPath = `${configPath}.tmp`;
    const validated = McpServersFileSchema.parse(config);
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    await rename(tempPath, configPath);
  }

  private async runConfigMutation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.configMutation.then(operation, operation);
    this.configMutation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private publishStatuses(): void {
    if (this.stderrPublishTimer) {
      clearTimeout(this.stderrPublishTimer);
      this.stderrPublishTimer = undefined;
    }
    if (this.suppressStatusPublishes) {
      this.publishPending = true;
      return;
    }

    this.bus.emit("mcp:servers-changed", this.getStatus());
  }

  private pauseStatusPublishes(): () => void {
    this.suppressStatusPublishes = true;
    this.publishPending = false;

    return () => {
      this.suppressStatusPublishes = false;
      if (!this.publishPending) {
        return;
      }

      this.publishPending = false;
      this.publishStatuses();
    };
  }
}
