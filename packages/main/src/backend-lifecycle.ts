import type { ChildProcess } from "node:child_process";
import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UpgradeProposal } from "@spira/shared";
import { app } from "electron";
import WebSocket from "ws";

type Callback = () => void;
export interface BackendExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  willRetry: boolean;
  retryDelayMs: number | null;
}
type BackendLifecycleMessage = { type: "upgrade:propose"; proposal: UpgradeProposal };
type BackendLifecycleResponse = {
  type: "upgrade:proposal-response";
  proposalId: string;
  accepted: boolean;
  reason?: string;
};
interface BackendLifecycleOptions {
  onFatal?: (info: BackendExitInfo) => void;
  onMessage?: (message: BackendLifecycleMessage) => void;
}

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const repoRoot = path.resolve(currentDir, "../../..");

export class BackendLifecycle {
  private child: ChildProcess | null = null;
  private restartCount = 0;
  private readonly MAX_RETRIES = 3;
  private readonly BASE_DELAY = 1000;
  private readonly readyCallbacks = new Set<Callback>();
  private readonly crashCallbacks = new Set<(info: BackendExitInfo) => void>();
  private readonly backendPort: number;
  private stopping = false;
  private ready = false;
  private generation = 0;
  private stopPromise: Promise<void> | null = null;
  private readonly onFatal?: (info: BackendExitInfo) => void;
  private readonly onMessage?: (message: BackendLifecycleMessage) => void;
  private envOverrides: Record<string, string> = {};

  constructor(backendPort = 9720, options: BackendLifecycleOptions = {}) {
    this.backendPort = backendPort;
    this.onFatal = options.onFatal;
    this.onMessage = options.onMessage;
  }

  get isReady(): boolean {
    return this.ready;
  }

  start(): void {
    this.stopping = false;
    this.spawnChild();
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    this.stopping = true;
    this.ready = false;
    const child = this.child;
    this.child = null;
    if (!child) {
      return;
    }
    const childEvents = child as ChildProcess & NodeJS.EventEmitter;
    this.stopPromise = new Promise((resolve) => {
      const finish = () => {
        clearTimeout(killTimer);
        this.stopPromise = null;
        resolve();
      };

      const killTimer = setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 5_000);

      childEvents.once("exit", finish);

      try {
        child.send({ type: "shutdown" });
      } catch {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }
    });

    await this.stopPromise;
  }

  onReady(cb: Callback): () => void {
    this.readyCallbacks.add(cb);
    return () => {
      this.readyCallbacks.delete(cb);
    };
  }

  onCrash(cb: (info: BackendExitInfo) => void): () => void {
    this.crashCallbacks.add(cb);
    return () => {
      this.crashCallbacks.delete(cb);
    };
  }

  async waitUntilReady(timeoutMs = 15_000): Promise<void> {
    if (this.ready) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for backend readiness"));
      }, timeoutMs);
      const offReady = this.onReady(() => {
        cleanup();
        resolve();
      });
      const offCrash = this.onCrash(() => {
        cleanup();
        reject(new Error("Backend crashed before becoming ready"));
      });

      const cleanup = () => {
        clearTimeout(timer);
        offReady();
        offCrash();
      };
    });
  }

  async restart(): Promise<void> {
    await this.stop();
    this.restartCount = 0;
    this.start();
    await this.waitUntilReady();
  }

  setEnvOverrides(overrides: Record<string, string>): void {
    this.envOverrides = { ...overrides };
  }

  send(message: BackendLifecycleResponse): void {
    this.child?.send(message);
  }

  private spawnChild(): void {
    if (this.child) {
      return;
    }

    const myGeneration = ++this.generation;
    const backendEntryPath = this.getBackendEntryPath();
    const isPackaged = app.isPackaged;
    const execPath = isPackaged ? process.execPath : process.env.SPIRA_BACKEND_EXEC_PATH?.trim() || process.execPath;
    const execArgv = isPackaged ? [] : ["--import", "tsx"];

    this.child = fork(backendEntryPath, [], {
      cwd: isPackaged ? app.getPath("userData") : repoRoot,
      execPath,
      env: {
        ...process.env,
        ...this.envOverrides,
        SPIRA_PORT: String(this.backendPort),
        SPIRA_GENERATION: String(myGeneration),
        SPIRA_BUILD_ID: this.getBuildId(),
        ...(isPackaged
          ? {
              SPIRA_RESOURCES_PATH: process.resourcesPath,
              SPIRA_MCP_CONFIG_PATH:
                process.env.SPIRA_MCP_CONFIG_PATH ?? path.join(process.resourcesPath, "mcp-servers.json"),
            }
          : {}),
      },
      execArgv,
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    this.child.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(`[backend] ${chunk.toString()}`);
    });
    this.child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[backend] ${chunk.toString()}`);
    });
    const childEvents = this.child as ChildProcess & NodeJS.EventEmitter;
    childEvents.on("message", (message: unknown) => {
      if (
        message &&
        typeof message === "object" &&
        (message as { type?: string }).type === "upgrade:propose" &&
        "proposal" in (message as Record<string, unknown>)
      ) {
        this.onMessage?.(message as BackendLifecycleMessage);
      }
    });

    void this.waitForReady(myGeneration);

    childEvents.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      this.child = null;
      this.ready = false;
      if (this.stopping) {
        return;
      }

      const willRetry = this.restartCount < this.MAX_RETRIES;
      const retryDelayMs = willRetry ? Math.min(this.BASE_DELAY * 2 ** this.restartCount, 8000) : null;
      const exitInfo: BackendExitInfo = {
        code,
        signal,
        willRetry,
        retryDelayMs,
      };

      for (const callback of this.crashCallbacks) {
        callback(exitInfo);
      }

      if (!willRetry) {
        process.stderr.write("[backend] failed to restart after maximum retries; manual restart required\n");
        this.onFatal?.(exitInfo);
        return;
      }

      this.restartCount += 1;
      setTimeout(() => {
        if (!this.stopping) {
          this.spawnChild();
        }
      }, retryDelayMs ?? 0);

      process.stderr.write(
        `[backend] exited unexpectedly (${signal ?? `code ${code ?? "unknown"}`}); restarting in ${retryDelayMs}ms\n`,
      );
    });
  }

  private getBackendEntryPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "app.asar.unpacked", "packages", "backend", "dist", "index.js");
    }

    return path.resolve(repoRoot, "packages", "backend", "src", "index.ts");
  }

  private getBuildId(): string {
    return process.env.SPIRA_BUILD_ID?.trim() || (app.isPackaged ? app.getVersion() : "dev");
  }

  private async waitForReady(generation: number): Promise<void> {
    const deadline = Date.now() + 15_000;

    while (!this.stopping && this.generation === generation && Date.now() < deadline) {
      const ready = await this.pingBackend();
      if (ready) {
        if (this.generation !== generation) {
          return;
        }
        this.restartCount = 0;
        this.ready = true;
        for (const callback of this.readyCallbacks) {
          callback();
        }
        return;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });
    }
  }

  private pingBackend(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${this.backendPort}`);
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(false);
        }
      }, 3_000);

      const cleanup = () => {
        clearTimeout(timer);
        socket.removeAllListeners();
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      };

      socket.once("open", () => {
        socket.send(JSON.stringify({ type: "ping" }));
      });
      socket.on("message", (raw) => {
        if (settled) {
          return;
        }
        let message: { type?: string };
        try {
          message = JSON.parse(raw.toString()) as { type?: string };
        } catch {
          cleanup();
          settled = true;
          resolve(false);
          return;
        }
        if (message.type !== "pong") {
          return;
        }
        settled = true;
        cleanup();
        resolve(true);
      });
      socket.once("error", () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(false);
      });
      socket.once("close", () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(false);
      });
    });
  }
}
