import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  SPIRA_UI_ACTION_TYPES,
  SPIRA_UI_CONTROL_BRIDGE_VERSION,
  SPIRA_UI_ROOT_VIEWS,
  SPIRA_UI_WAIT_CONDITION_TYPES,
  type SpiraUiBridgeCommand,
  type SpiraUiBridgeDiscovery,
  type SpiraUiBridgeError,
  type SpiraUiBridgeRequest,
  type SpiraUiBridgeResponse,
  type SpiraUiBridgeResult,
  type SpiraUiCapabilities,
} from "@spira/shared";
import type { BrowserWindow } from "electron";
import type WebSocket from "ws";
import { WebSocketServer } from "ws";

const resolveDiscoveryPath = (): string =>
  path.join(
    process.env.SPIRA_UI_CONTROL_DIR ?? process.env.LOCALAPPDATA ?? os.tmpdir(),
    "Spira",
    "spira-ui-control.json",
  );

const toBridgeError = (message: string, code: SpiraUiBridgeError["code"], details?: string): SpiraUiBridgeError => ({
  code,
  message,
  details,
});

const getCapabilities = (): SpiraUiCapabilities => ({
  bridgeVersion: SPIRA_UI_CONTROL_BRIDGE_VERSION,
  rootViews: [...SPIRA_UI_ROOT_VIEWS],
  actionTypes: [...SPIRA_UI_ACTION_TYPES],
  waitConditionTypes: [...SPIRA_UI_WAIT_CONDITION_TYPES],
});

interface BridgeLogger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export class SpiraUiControlBridge {
  private server: WebSocketServer | null = null;
  private readonly token = randomUUID();
  private port: number | null = null;
  private readonly discoveryPath = resolveDiscoveryPath();

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly logger: BridgeLogger,
  ) {}

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once("listening", () => {
        resolve();
      });
      server.once("error", (error) => {
        reject(error);
      });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Spira UI control bridge did not expose a usable port.");
    }

    this.port = address.port;
    server.on("connection", (socket) => {
      this.handleConnection(socket);
    });
    server.on("error", (error) => {
      this.logger.error({ error }, "Spira UI control bridge error");
    });

    await this.writeDiscoveryFile();
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.port = null;

    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const client of server.clients) {
          client.close(1001, "Spira UI control bridge shutting down");
        }
      });
    }

    await rm(this.discoveryPath, { force: true }).catch((error) => {
      this.logger.warn({ error, discoveryPath: this.discoveryPath }, "Failed to remove Spira UI control bridge file");
    });
  }

  private async writeDiscoveryFile(): Promise<void> {
    if (!this.port) {
      throw new Error("Spira UI control bridge port is unavailable.");
    }

    const payload: SpiraUiBridgeDiscovery = {
      version: SPIRA_UI_CONTROL_BRIDGE_VERSION,
      port: this.port,
      token: this.token,
      pid: process.pid,
    };

    await mkdir(path.dirname(this.discoveryPath), { recursive: true });
    await writeFile(this.discoveryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  private handleConnection(socket: WebSocket): void {
    socket.on("message", async (raw) => {
      try {
        const response = await this.handleMessage(raw.toString());
        socket.send(JSON.stringify(response));
      } catch (error) {
        this.logger.warn({ error }, "Spira UI control bridge failed to send a response");
      }
    });

    socket.on("error", (error) => {
      this.logger.warn({ error }, "Spira UI control bridge client error");
    });
  }

  private async handleMessage(raw: string): Promise<SpiraUiBridgeResponse> {
    let requestId: string = randomUUID();
    try {
      const request = JSON.parse(raw) as Partial<SpiraUiBridgeRequest>;
      requestId = typeof request.requestId === "string" ? request.requestId : requestId;
      if (request.token !== this.token) {
        return {
          requestId,
          ok: false,
          error: toBridgeError("Spira UI control bridge authentication failed.", "AUTH_FAILED"),
        };
      }

      if (typeof request.kind !== "string") {
        return {
          requestId,
          ok: false,
          error: toBridgeError("Spira UI control bridge request is missing a valid kind.", "INVALID_REQUEST"),
        };
      }

      const data = await this.handleCommand(request as SpiraUiBridgeRequest);
      return { requestId, ok: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes("window is unavailable")
        ? "WINDOW_UNAVAILABLE"
        : message.includes("Timed out waiting for condition")
          ? "WAIT_TIMEOUT"
          : message.includes("runtime is unavailable")
            ? "RENDERER_UNAVAILABLE"
            : "INTERNAL_ERROR";
      return {
        requestId,
        ok: false,
        error: toBridgeError("Spira UI control bridge request failed.", code, message),
      };
    }
  }

  private async handleCommand(request: SpiraUiBridgeRequest): Promise<SpiraUiBridgeResult> {
    if (request.kind === "ping") {
      return {
        type: "pong",
        capabilities: getCapabilities(),
      };
    }

    if (request.kind === "get-capabilities") {
      return {
        type: "capabilities",
        capabilities: getCapabilities(),
      };
    }

    const { requestId: _requestId, token: _token, ...command } = request;
    return await this.invokeRenderer(command);
  }

  private async invokeRenderer(request: SpiraUiBridgeCommand): Promise<SpiraUiBridgeResult> {
    const targetWindow = this.getWindow();
    if (!targetWindow || targetWindow.isDestroyed()) {
      throw new Error("The Spira window is unavailable.");
    }

    const escapedRequest = JSON.stringify(request);
    try {
      const result = await targetWindow.webContents.executeJavaScript(
        `window.__spiraUiControl?.handleRequest(${escapedRequest})`,
        true,
      );

      if (!result || typeof result !== "object") {
        throw new Error("Renderer control runtime is unavailable.");
      }

      return result as SpiraUiBridgeResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("__spiraUiControl")) {
        throw new Error("Renderer control runtime is unavailable.");
      }
      throw error;
    }
  }
}
