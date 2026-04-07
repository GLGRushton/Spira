import type { ChildProcess } from "node:child_process";
import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import WebSocket from "ws";

type Callback = () => void;
interface BackendLifecycleOptions {
  onFatal?: Callback;
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
  private readonly crashCallbacks = new Set<Callback>();
  private readonly backendPort: number;
  private stopping = false;
  private ready = false;
  private generation = 0;
  private stopPromise: Promise<void> | null = null;
  private readonly onFatal?: Callback;

  constructor(backendPort = 9720, options: BackendLifecycleOptions = {}) {
    this.backendPort = backendPort;
    this.onFatal = options.onFatal;
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

  onReady(cb: Callback): void {
    this.readyCallbacks.add(cb);
  }

  onCrash(cb: Callback): void {
    this.crashCallbacks.add(cb);
  }

  private spawnChild(): void {
    if (this.child) {
      return;
    }

    const backendEntryPath = this.getBackendEntryPath();
    const isPackaged = app.isPackaged;
    const execArgv = isPackaged ? [] : ["--import", "tsx"];

    this.child = fork(backendEntryPath, [], {
      cwd: isPackaged ? app.getPath("userData") : repoRoot,
      env: {
        ...process.env,
        SPIRA_PORT: String(this.backendPort),
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

    const myGeneration = ++this.generation;
    void this.waitForReady(myGeneration);

    childEvents.once("exit", (_code: number | null, signal: NodeJS.Signals | null) => {
      this.child = null;
      this.ready = false;
      if (this.stopping) {
        return;
      }

      for (const callback of this.crashCallbacks) {
        callback();
      }

      if (this.restartCount >= this.MAX_RETRIES) {
        process.stderr.write("[backend] failed to restart after maximum retries; manual restart required\n");
        this.onFatal?.();
        return;
      }

      const delay = Math.min(this.BASE_DELAY * 2 ** this.restartCount, 8000);
      this.restartCount += 1;
      setTimeout(() => {
        if (!this.stopping) {
          this.spawnChild();
        }
      }, delay);

      process.stderr.write(`[backend] exited unexpectedly (${signal ?? "no signal"}); restarting in ${delay}ms\n`);
    });
  }

  private getBackendEntryPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "app.asar.unpacked", "packages", "backend", "dist", "index.js");
    }

    return path.resolve(repoRoot, "packages", "backend", "src", "index.ts");
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
