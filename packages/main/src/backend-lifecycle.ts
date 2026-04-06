import type { ChildProcess } from "node:child_process";
import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

type Callback = () => void;

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

  constructor(backendPort = 9720) {
    this.backendPort = backendPort;
  }

  get isReady(): boolean {
    return this.ready;
  }

  start(): void {
    this.stopping = false;
    this.spawnChild();
  }

  stop(): void {
    this.stopping = true;
    this.ready = false;
    const child = this.child;
    this.child = null;
    if (!child) {
      return;
    }

    child.send({ type: "shutdown" });
    const killTimer = setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(killTimer);
    });
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

    const isDevelopment = process.env.NODE_ENV !== "production";
    const modulePath = isDevelopment
      ? path.resolve(repoRoot, "packages/backend/src/index.ts")
      : path.resolve(repoRoot, "packages/backend/dist/index.js");
    const execArgv = isDevelopment ? ["--import", "tsx"] : [];

    this.child = fork(modulePath, [], {
      cwd: repoRoot,
      env: {
        ...process.env,
        SPIRA_PORT: String(this.backendPort),
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

    const myGeneration = ++this.generation;
    void this.waitForReady(myGeneration);

    this.child.once("exit", (_code, signal) => {
      this.child = null;
      this.ready = false;
      if (this.stopping) {
        return;
      }

      for (const callback of this.crashCallbacks) {
        callback();
      }

      if (this.restartCount >= this.MAX_RETRIES) {
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
      socket.once("message", (raw) => {
        if (settled) {
          return;
        }
        settled = true;
        const message = JSON.parse(raw.toString()) as { type?: string };
        cleanup();
        resolve(message.type === "pong");
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
