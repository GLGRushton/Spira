import { EventEmitter } from "node:events";
import type { McpServerConfig } from "@spira/shared";
import { describe, expect, it, vi } from "vitest";
import { SpiraEventBus } from "../util/event-bus.js";

class FakeTransport {
  static instances: FakeTransport[] = [];

  readonly stderr = new EventEmitter();
  readonly close = vi.fn(async () => {});
  onclose: (() => void) | undefined;

  constructor(readonly options: Record<string, unknown>) {
    (this.stderr as EventEmitter & { setEncoding: (encoding: string) => void }).setEncoding = vi.fn();
    FakeTransport.instances.push(this);
  }
}

class FakeClient {
  static instances: FakeClient[] = [];
  static nextTools: Array<Record<string, unknown>> = [];
  static nextCallResult: unknown = null;
  static connectError: unknown = null;
  static callToolError: unknown = null;

  readonly connect = vi.fn(async (_transport: FakeTransport) => {
    if (FakeClient.connectError) {
      throw FakeClient.connectError;
    }
  });
  readonly listTools = vi.fn(async () => ({ tools: FakeClient.nextTools }));
  readonly callTool = vi.fn(async () => {
    if (FakeClient.callToolError) {
      throw FakeClient.callToolError;
    }
    return FakeClient.nextCallResult;
  });
  readonly close = vi.fn(async () => {});

  constructor() {
    FakeClient.instances.push(this);
  }
}

const createConfig = (): McpServerConfig => ({
  id: "vision",
  name: "Spira Vision",
  transport: "stdio",
  command: "node",
  args: ["packages/mcp-vision/dist/index.js"],
  env: { SPIRA_TEST: "1" },
  enabled: true,
  autoRestart: true,
  maxRestarts: 3,
});

const createLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

const loadClientPool = async () => {
  vi.resetModules();
  FakeTransport.instances.length = 0;
  FakeClient.instances.length = 0;
  FakeClient.nextTools = [];
  FakeClient.nextCallResult = null;
  FakeClient.connectError = null;
  FakeClient.callToolError = null;

  vi.doMock("@modelcontextprotocol/sdk/client/index.js", () => ({
    Client: FakeClient,
  }));
  vi.doMock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
    StdioClientTransport: FakeTransport,
  }));

  return await import("./client-pool.js");
};

describe("McpClientPool", () => {
  it("connects a stdio server, normalizes tools, and calls tools with object arguments", async () => {
    const { McpClientPool } = await loadClientPool();
    FakeClient.nextTools = [
      {
        name: "capture_screen",
        description: "Capture the active window",
        inputSchema: { type: "object", properties: { windowId: { type: "string" } } },
      },
    ];
    FakeClient.nextCallResult = { structuredContent: { ok: true } };

    const bus = new SpiraEventBus();
    const logger = createLogger();
    const pool = new McpClientPool(bus, logger as never);
    const config = createConfig();

    await pool.connect(config);

    expect(pool.listTools(config.id)).toEqual([
      {
        serverId: "vision",
        serverName: "Spira Vision",
        name: "capture_screen",
        description: "Capture the active window",
        inputSchema: { type: "object", properties: { windowId: { type: "string" } } },
      },
    ]);
    await expect(pool.callTool(config.id, "capture_screen", "not-an-object")).resolves.toEqual({ ok: true });
    expect(FakeClient.instances[0]?.callTool).toHaveBeenCalledWith({
      name: "capture_screen",
      arguments: {},
    });
    expect(FakeTransport.instances[0]?.options).toMatchObject({
      command: "node",
      args: ["packages/mcp-vision/dist/index.js"],
      stderr: "pipe",
    });
  });

  it("emits stderr and crash events when the MCP process misbehaves", async () => {
    const { McpClientPool } = await loadClientPool();
    const bus = new SpiraEventBus();
    const logger = createLogger();
    const pool = new McpClientPool(bus, logger as never);
    const config = createConfig();
    const stderrEvents: string[] = [];
    const crashEvents: string[] = [];

    bus.on("mcp:server-stderr", (serverId, line) => {
      stderrEvents.push(`${serverId}:${line}`);
    });
    bus.on("mcp:server-crashed", (serverId) => {
      crashEvents.push(serverId);
    });

    await pool.connect(config);

    FakeTransport.instances[0]?.stderr.emit("data", " first line \n\nsecond line  ");
    FakeTransport.instances[0]?.onclose?.();

    expect(stderrEvents).toEqual(["vision:first line", "vision:second line"]);
    expect(crashEvents).toEqual(["vision"]);
    expect(pool.isCrashed("vision")).toBe(true);
    expect(pool.listTools("vision")).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("disconnects cleanly and removes transport listeners", async () => {
    const { McpClientPool } = await loadClientPool();
    const bus = new SpiraEventBus();
    const pool = new McpClientPool(bus, createLogger() as never);
    const config = createConfig();
    const crashEvents: string[] = [];

    bus.on("mcp:server-crashed", (serverId) => {
      crashEvents.push(serverId);
    });

    await pool.connect(config);
    const transport = FakeTransport.instances[0];
    const client = FakeClient.instances[0];

    expect(transport?.stderr.listenerCount("data")).toBe(1);

    await pool.disconnect(config.id);
    transport?.stderr.emit("data", "should stay quiet");
    transport?.onclose?.();

    expect(transport?.stderr.listenerCount("data")).toBe(0);
    expect(transport?.onclose).toBeUndefined();
    expect(client?.close).toHaveBeenCalledTimes(1);
    expect(transport?.close).toHaveBeenCalledTimes(1);
    expect(crashEvents).toEqual([]);
  });

  it("returns alternate MCP tool result shapes", async () => {
    const { McpClientPool } = await loadClientPool();
    const pool = new McpClientPool(new SpiraEventBus(), createLogger() as never);
    const config = createConfig();

    await pool.connect(config);

    FakeClient.nextCallResult = { toolResult: { ok: true } };
    await expect(pool.callTool(config.id, "capture_screen", { path: "one" })).resolves.toEqual({ ok: true });

    FakeClient.nextCallResult = {
      content: [
        { type: "text", text: "Captured" },
        { type: "resource", resource: { text: "Window metadata" } },
      ],
    };
    await expect(pool.callTool(config.id, "capture_screen", { path: "two" })).resolves.toBe(
      "Captured\nWindow metadata",
    );
  });

  it("wraps tool execution failures as McpError", async () => {
    const { McpClientPool } = await loadClientPool();
    const pool = new McpClientPool(new SpiraEventBus(), createLogger() as never);
    const config = createConfig();

    await pool.connect(config);
    FakeClient.callToolError = new Error("tool blew up");

    await expect(pool.callTool(config.id, "capture_screen", {})).rejects.toMatchObject({
      name: "McpError",
      message: "Tool capture_screen on MCP server Spira Vision failed: tool blew up",
    });
  });

  it("wraps connection failures as McpError and cleans up transport state", async () => {
    const { McpClientPool } = await loadClientPool();
    FakeClient.connectError = new Error("spawn failed");

    const logger = createLogger();
    const pool = new McpClientPool(new SpiraEventBus(), logger as never);

    await expect(pool.connect(createConfig())).rejects.toMatchObject({
      name: "McpError",
      message: "Failed to connect MCP server Spira Vision: spawn failed",
    });
    expect(FakeClient.instances[0]?.close).toHaveBeenCalledTimes(1);
    expect(FakeTransport.instances[0]?.close).toHaveBeenCalledTimes(1);
  });
});
