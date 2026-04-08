import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type McpServerConfig,
  McpServerConfigSchema,
  type McpServerStatus,
  type McpServersFile,
  McpServersFileSchema,
} from "@spira/shared";
import type { Logger } from "pino";
import { z } from "zod";
import { resolveAppPath } from "../util/app-paths.js";
import { ConfigError } from "../util/errors.js";
import type { SpiraEventBus } from "../util/event-bus.js";
import type { McpClientPool } from "./client-pool.js";

interface McpServerEntry {
  readonly fileConfig: McpServerConfig;
  readonly runtimeConfig: McpServerConfig;
  status: McpServerStatus;
  connectedAt?: number;
}

const toDevelopmentConfig = (config: McpServerConfig): McpServerConfig => {
  if (process.env.NODE_ENV !== "development" || config.transport !== "stdio" || config.command !== "node") {
    return config;
  }

  return {
    ...config,
    command: "tsx",
    args: config.args.map((arg) => arg.replace(/([\\/])dist([\\/])/g, "$1src$2").replace(/\.js$/u, ".ts")),
  };
};

const createDisconnectedStatus = (config: McpServerConfig): McpServerStatus => ({
  id: config.id,
  name: config.name,
  state: config.enabled ? "starting" : "disconnected",
  toolCount: 0,
  tools: [],
});

export class McpRegistry {
  private readonly servers = new Map<string, McpServerEntry>();
  private configSchema: string | undefined;
  private configMutation = Promise.resolve();
  private suppressStatusPublishes = false;
  private publishPending = false;

  constructor(
    private readonly bus: SpiraEventBus,
    private readonly logger: Logger,
    private readonly pool: McpClientPool,
  ) {
    this.bus.on("mcp:server-crashed", (serverId) => {
      this.handleServerCrash(serverId);
    });
  }

  async initialize(): Promise<void> {
    try {
      const configFile = await this.loadConfig();
      await this.applyConfigFile(configFile);
    } catch (error) {
      this.logger.error({ error }, "Failed to initialize MCP registry");
      throw error;
    }
  }

  async reloadFromDisk(): Promise<void> {
    await this.runConfigMutation(async () => {
      const configFile = await this.loadConfig();
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
      const fileConfig = McpServerConfigSchema.parse(config);
      if (this.servers.has(fileConfig.id)) {
        throw new ConfigError(`MCP server ${fileConfig.id} already exists`);
      }

      const entry: McpServerEntry = {
        fileConfig,
        runtimeConfig: toDevelopmentConfig(fileConfig),
        status: createDisconnectedStatus(fileConfig),
      };

      this.servers.set(fileConfig.id, entry);
      this.publishStatuses();

      try {
        if (fileConfig.enabled) {
          await this.connectEntry(entry, { throwOnFailure: true, publishFailureStatus: false });
        }
        await this.writeConfig(this.serializeConfig());
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

  async removeServer(serverId: string): Promise<void> {
    await this.runConfigMutation(async () => {
      const entry = this.requireEntry(serverId);

      await this.pool.disconnect(serverId);
      this.servers.delete(serverId);
      this.publishStatuses();

      try {
        await this.writeConfig(this.serializeConfig());
      } catch (error) {
        entry.connectedAt = undefined;
        entry.status = createDisconnectedStatus(entry.fileConfig);
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

  getStatus(): McpServerStatus[] {
    return [...this.servers.values()].map((entry) => ({
      ...entry.status,
      state: this.pool.isCrashed(entry.fileConfig.id) ? "error" : entry.status.state,
      uptimeMs:
        entry.status.state === "connected" && entry.connectedAt !== undefined
          ? Date.now() - entry.connectedAt
          : undefined,
    }));
  }

  private async loadConfig(): Promise<z.infer<typeof McpServersFileSchema>> {
    const configPath = this.getConfigPath();

    try {
      const raw = await readFile(configPath, "utf8");
      return McpServersFileSchema.parse(JSON.parse(raw));
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
    this.servers.clear();

    for (const config of configFile.servers) {
      this.servers.set(config.id, {
        fileConfig: config,
        runtimeConfig: toDevelopmentConfig(config),
        status: createDisconnectedStatus(config),
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
        id: entry.fileConfig.id,
        name: entry.fileConfig.name,
        state: "connected",
        toolCount: tools.length,
        tools: tools.map((tool) => tool.name),
        uptimeMs: 0,
      };
      this.publishStatuses();
    } catch (error) {
      this.logger.error({ error, serverId: entry.fileConfig.id }, "Failed to connect MCP server");
      if (options.publishFailureStatus !== false) {
        entry.connectedAt = undefined;
        entry.status = {
          id: entry.fileConfig.id,
          name: entry.fileConfig.name,
          state: "error",
          toolCount: 0,
          tools: [],
          error: error instanceof Error ? error.message : String(error),
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
    entry.status = {
      id: entry.fileConfig.id,
      name: entry.fileConfig.name,
      state: "error",
      toolCount: 0,
      tools: [],
      error: "MCP server process exited unexpectedly",
      uptimeMs: undefined,
    };
    this.publishStatuses();
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
