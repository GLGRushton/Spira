import type { Readable } from "node:stream";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool as SdkMcpTool } from "@modelcontextprotocol/sdk/types.js";
import type { McpServerConfig, McpTool } from "@spira/shared";
import type { Logger } from "pino";
import { appRootDir } from "../util/app-paths.js";
import { McpError } from "../util/errors.js";
import type { SpiraEventBus } from "../util/event-bus.js";

interface McpClientEntry {
  readonly client: McpClient;
  readonly transport: StdioClientTransport;
  readonly config: McpServerConfig;
  readonly tools: McpTool[];
  readonly connectedAt: number;
  readonly stderrStream: Readable | null;
  readonly stderrHandler: (chunk: Buffer | string) => void;
  readonly closeHandler: () => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const serializeContentBlock = (block: Record<string, unknown>): string => {
  if (block.type === "text" && typeof block.text === "string") {
    return block.text;
  }

  if (block.type === "resource") {
    const resource = block.resource;
    if (isRecord(resource)) {
      if (typeof resource.text === "string") {
        return resource.text;
      }

      return JSON.stringify(resource);
    }
  }

  return JSON.stringify(block);
};

const normalizeEnv = (env: NodeJS.ProcessEnv & Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));

const normalizeTool = (config: McpServerConfig, tool: SdkMcpTool): McpTool => ({
  serverId: config.id,
  serverName: config.name,
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
  outputSchema: tool.outputSchema,
  annotations: tool.annotations,
  execution: tool.execution,
});

export class McpClientPool {
  private readonly clients = new Map<string, McpClientEntry>();
  private readonly crashedServers = new Set<string>();

  constructor(
    private readonly bus: SpiraEventBus,
    private readonly logger: Logger,
  ) {}

  async connect(config: McpServerConfig): Promise<McpClient> {
    if (config.transport !== "stdio") {
      throw new McpError(`Unsupported MCP transport for ${config.id}: ${config.transport}`);
    }

    await this.disconnect(config.id).catch((error) => {
      this.logger.warn({ error, serverId: config.id }, "Failed to disconnect existing MCP client before reconnecting");
    });

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      cwd: appRootDir,
      env: normalizeEnv({ ...process.env, ...config.env }),
      stderr: "pipe",
    });

    const client = new McpClient({ name: "spira-backend", version: "0.1.0" }, {});

    const stderrStream = transport.stderr as Readable | null;
    stderrStream?.setEncoding("utf8");
    const stderrHandler = (chunk: Buffer | string): void => {
      const stderr = chunk.toString().trim();
      if (stderr !== "") {
        this.logger.warn({ serverId: config.id, stderr }, "MCP server stderr");
      }
    };
    stderrStream?.on("data", stderrHandler);

    const closeHandler = (): void => {
      const entry = this.clients.get(config.id);
      if (!entry || entry.transport !== transport) {
        return;
      }

      this.clients.delete(config.id);
      this.crashedServers.add(config.id);
      this.logger.warn({ serverId: config.id }, "MCP server process exited unexpectedly");
      this.bus.emit("mcp:server-crashed", config.id);
    };
    transport.onclose = closeHandler;

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      const normalizedTools = tools.map((tool) => normalizeTool(config, tool));
      this.crashedServers.delete(config.id);

      this.clients.set(config.id, {
        client,
        transport,
        config,
        tools: normalizedTools,
        connectedAt: Date.now(),
        stderrStream,
        stderrHandler,
        closeHandler,
      });

      this.logger.info({ serverId: config.id, toolCount: normalizedTools.length }, "Connected MCP server");
      return client;
    } catch (error) {
      stderrStream?.off("data", stderrHandler);
      if (transport.onclose === closeHandler) {
        transport.onclose = undefined;
      }
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
      throw new McpError(
        `Failed to connect MCP server ${config.name}: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  async disconnect(serverId: string): Promise<void> {
    const entry = this.clients.get(serverId);
    this.crashedServers.delete(serverId);
    if (!entry) {
      return;
    }

    this.clients.delete(serverId);
    entry.stderrStream?.off("data", entry.stderrHandler);
    if (entry.transport.onclose === entry.closeHandler) {
      entry.transport.onclose = undefined;
    }

    await entry.client.close().catch((error) => {
      this.logger.warn({ error, serverId }, "Failed to close MCP client cleanly");
    });

    await entry.transport.close().catch((error) => {
      this.logger.warn({ error, serverId }, "Failed to close MCP transport cleanly");
    });
  }

  async disconnectAll(): Promise<void> {
    const serverIds = [...this.clients.keys()];
    await Promise.all(serverIds.map((serverId) => this.disconnect(serverId)));
    this.crashedServers.clear();
  }

  listTools(serverId: string): McpTool[] {
    const entry = this.clients.get(serverId);
    if (!entry) {
      return [];
    }

    return [...entry.tools];
  }

  allTools(): McpTool[] {
    return [...this.clients.values()].flatMap((entry) => entry.tools);
  }

  getConnectedAt(serverId: string): number | undefined {
    return this.clients.get(serverId)?.connectedAt;
  }

  isCrashed(serverId: string): boolean {
    return this.crashedServers.has(serverId);
  }

  async callTool(serverId: string, toolName: string, args: unknown): Promise<unknown> {
    const entry = this.clients.get(serverId);
    if (!entry) {
      throw new McpError(`MCP server ${serverId} is not connected`);
    }

    try {
      const result = await entry.client.callTool({
        name: toolName,
        arguments: isRecord(args) ? args : {},
      });

      if ("structuredContent" in result && result.structuredContent !== undefined) {
        return result.structuredContent;
      }

      if ("toolResult" in result) {
        return result.toolResult;
      }

      if (Array.isArray(result.content)) {
        return result.content.map((block) => serializeContentBlock(block)).join("\n");
      }

      return null;
    } catch (error) {
      throw new McpError(
        `Tool ${toolName} on MCP server ${entry.config.name} failed: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }
}
