import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type McpServerConfig, type McpServerStatus, type McpServersFile, McpServersFileSchema } from "@spira/shared";
import type { Logger } from "pino";
import { z } from "zod";
import { ConfigError } from "../util/errors.js";
import type { SpiraEventBus } from "../util/event-bus.js";
import type { McpClientPool } from "./client-pool.js";

interface McpServerEntry {
  readonly config: McpServerConfig;
  status: McpServerStatus;
  connectedAt?: number;
}

const toDevelopmentConfig = (config: McpServersFile["servers"][number]): McpServersFile["servers"][number] => {
  if (process.env.NODE_ENV !== "development" || config.transport !== "stdio" || config.command !== "node") {
    return config;
  }

  return {
    ...config,
    command: "tsx",
    args: config.args.map((arg) => arg.replace(/([\\/])dist([\\/])/g, "$1src$2").replace(/\.js$/u, ".ts")),
  };
};

export class McpRegistry {
  private readonly servers = new Map<string, McpServerEntry>();

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
      this.servers.clear();

      for (const config of configFile.servers) {
        this.servers.set(config.id, {
          config,
          status: {
            id: config.id,
            name: config.name,
            state: config.enabled ? "starting" : "disconnected",
            toolCount: 0,
            tools: [],
          },
        });
      }

      this.publishStatuses();

      const enabledServers = configFile.servers.filter((config) => config.enabled);
      await Promise.allSettled(enabledServers.map((config) => this.connectServer(config)));
    } catch (error) {
      this.logger.error({ error }, "Failed to initialize MCP registry");
      throw error;
    }
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

  getStatus(): McpServerStatus[] {
    return [...this.servers.values()].map((entry) => ({
      ...entry.status,
      state: this.pool.isCrashed(entry.config.id) ? "error" : entry.status.state,
      uptimeMs:
        entry.status.state === "connected" && entry.connectedAt !== undefined
          ? Date.now() - entry.connectedAt
          : undefined,
    }));
  }

  private async loadConfig(): Promise<z.infer<typeof McpServersFileSchema>> {
    const configPath = resolve(process.env.SPIRA_MCP_CONFIG_PATH ?? resolve(process.cwd(), "mcp-servers.json"));

    try {
      const raw = await readFile(configPath, "utf8");
      const parsed = McpServersFileSchema.parse(JSON.parse(raw));
      return {
        ...parsed,
        servers: parsed.servers.map((config) => toDevelopmentConfig(config)),
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ConfigError(`Invalid MCP server configuration in ${configPath}`, error);
      }

      throw new ConfigError(`Failed to read MCP server configuration from ${configPath}`, error);
    }
  }

  private async connectServer(config: McpServerConfig): Promise<void> {
    this.updateStatus(config.id, {
      state: "starting",
      toolCount: 0,
      tools: [],
      error: undefined,
    });

    try {
      await this.pool.connect(config);
      const tools = this.pool.listTools(config.id);
      const connectedAt = this.pool.getConnectedAt(config.id) ?? Date.now();
      const entry = this.requireEntry(config.id);
      entry.connectedAt = connectedAt;
      entry.status = {
        id: config.id,
        name: config.name,
        state: "connected",
        toolCount: tools.length,
        tools: tools.map((tool) => tool.name),
        uptimeMs: 0,
      };
      this.publishStatuses();
    } catch (error) {
      this.logger.error({ error, serverId: config.id }, "Failed to connect MCP server");
      const entry = this.requireEntry(config.id);
      entry.connectedAt = undefined;
      entry.status = {
        id: config.id,
        name: config.name,
        state: "error",
        toolCount: 0,
        tools: [],
        error: error instanceof Error ? error.message : String(error),
      };
      this.publishStatuses();
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
      id: entry.config.id,
      name: entry.config.name,
      state: "error",
      toolCount: 0,
      tools: [],
      error: "MCP server process exited unexpectedly",
      uptimeMs: undefined,
    };
    this.publishStatuses();
  }

  private publishStatuses(): void {
    this.bus.emit("mcp:servers-changed", this.getStatus());
  }
}
