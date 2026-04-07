import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { type Interface, createInterface } from "node:readline";
import type { Logger } from "pino";
import { resolveUnpackedAppPath } from "../util/app-paths.js";
import { VoiceError } from "../util/errors.js";
import type { WakeWordProvider } from "./wake-word.js";

interface OpenWakeWordProviderOptions {
  runtimeDir: string;
  workerPath: string;
  modelPath?: string;
  modelName?: string;
  threshold: number;
}

interface WorkerReadyMessage {
  type: "ready";
  preferredFrameLength?: number;
  sampleRate?: number;
  modelKey?: string;
}

interface WorkerDetectedMessage {
  type: "detected";
  score?: number;
}

interface WorkerErrorMessage {
  type: "error";
  message?: string;
  traceback?: string;
}

const DEFAULT_FRAME_LENGTH = 1280;
const DEFAULT_SAMPLE_RATE = 16_000;
const MAX_PENDING_MULTIPLIER = 4;
const READY_TIMEOUT_MS = 15_000;

export class OpenWakeWordProvider implements WakeWordProvider {
  readonly providerName = "openwakeword";
  readonly requiresExactFrameLength = false;
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutReader: Interface | null = null;
  private pendingSamples = new Int16Array(0);
  private pendingDetectionCount = 0;
  private preferredFrameLength = DEFAULT_FRAME_LENGTH;
  private writeBackpressured = false;
  private disposed = false;
  private ready = false;

  constructor(
    private readonly options: OpenWakeWordProviderOptions,
    private readonly logger: Logger,
  ) {}

  get frameLength(): number {
    return this.preferredFrameLength;
  }

  get sampleRate(): number {
    return DEFAULT_SAMPLE_RATE;
  }

  async initialize(): Promise<void> {
    if (this.child) {
      return;
    }

    const pythonPath = this.resolvePythonPath();
    const workerPath = this.resolveWorkerPath();
    const modelPath = this.resolveModelPath();

    this.disposed = false;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        finish(new VoiceError("Timed out waiting for openWakeWord worker readiness"));
      }, READY_TIMEOUT_MS);

      const finish = (error?: unknown) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);

        if (error) {
          this.dispose();
          reject(error);
          return;
        }

        resolve();
      };

      try {
        const child = spawn(pythonPath, [workerPath], {
          cwd: path.dirname(workerPath),
          env: {
            ...process.env,
            PYTHONUNBUFFERED: "1",
            SPIRA_OPENWAKEWORD_THRESHOLD: String(this.options.threshold),
            ...(modelPath ? { SPIRA_OPENWAKEWORD_MODEL_PATH: modelPath } : {}),
            ...(this.options.modelName ? { SPIRA_OPENWAKEWORD_MODEL_NAME: this.options.modelName } : {}),
          },
          stdio: ["pipe", "pipe", "pipe"],
        });

        this.child = child;
        this.stdoutReader = createInterface({ input: child.stdout });
        const childEvents = child as ChildProcessWithoutNullStreams & NodeJS.EventEmitter;
        const readerEvents = this.stdoutReader as Interface & NodeJS.EventEmitter;

        child.stdin.on("drain", () => {
          this.writeBackpressured = false;
          this.flushPendingAudio();
        });
        child.stdin.on("error", (error: Error) => {
          this.ready = false;
          this.logger.warn({ error }, "openWakeWord worker stdin error");
        });

        child.stderr.on("data", (chunk: Buffer) => {
          this.logger.warn({ output: chunk.toString().trim() }, "openWakeWord worker stderr");
        });

        childEvents.once("error", (error: Error) => {
          finish(new VoiceError("Failed to start openWakeWord worker", error));
        });

        childEvents.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
          if (!settled) {
            finish(
              new VoiceError(
                `openWakeWord worker exited during initialization (code=${code ?? "null"}, signal=${signal ?? "null"})`,
              ),
            );
          }

          this.ready = false;
          this.child = null;
          this.stdoutReader?.close();
          this.stdoutReader = null;

          if (!this.disposed) {
            this.logger.warn(
              { code, signal },
              "openWakeWord worker exited; wake-word detection disabled until restart",
            );
          }
        });

        readerEvents.on("line", (line: string) => {
          try {
            const message = JSON.parse(line) as WorkerReadyMessage | WorkerDetectedMessage | WorkerErrorMessage;

            if (message.type === "ready") {
              this.ready = true;
              this.preferredFrameLength = message.preferredFrameLength ?? DEFAULT_FRAME_LENGTH;
              this.logger.info(
                {
                  modelKey: message.modelKey,
                  preferredFrameLength: this.preferredFrameLength,
                  sampleRate: message.sampleRate ?? DEFAULT_SAMPLE_RATE,
                },
                "openWakeWord provider initialized",
              );
              finish();
              return;
            }

            if (message.type === "detected") {
              this.pendingDetectionCount = Math.min(this.pendingDetectionCount + 1, 1);
              this.logger.info({ score: message.score }, "openWakeWord detected wake word");
              return;
            }

            if (message.type === "error") {
              const error = new VoiceError(
                message.message ?? "openWakeWord worker reported an error",
                message.traceback,
              );
              if (!this.ready) {
                finish(error);
                return;
              }

              this.logger.error({ error }, "openWakeWord worker error");
            }
          } catch (error) {
            this.logger.warn({ error, line }, "Failed to parse openWakeWord worker output");
          }
        });
      } catch (error) {
        finish(new VoiceError("Failed to initialize openWakeWord worker", error));
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.ready = false;
    this.pendingSamples = new Int16Array(0);
    this.pendingDetectionCount = 0;
    this.writeBackpressured = false;
    this.stdoutReader?.close();
    this.stdoutReader = null;

    if (!this.child) {
      return;
    }

    try {
      this.child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`);
    } catch (error) {
      this.logger.debug({ error }, "Failed to send openWakeWord shutdown message");
    }

    this.child.kill();
    this.child = null;
  }

  processFrame(frame: Int16Array): boolean {
    const detected = this.pendingDetectionCount > 0;
    this.pendingDetectionCount = 0;

    if (!this.ready || !this.child) {
      return detected;
    }

    const merged = new Int16Array(this.pendingSamples.length + frame.length);
    merged.set(this.pendingSamples);
    merged.set(frame, this.pendingSamples.length);
    this.pendingSamples = merged;
    this.flushPendingAudio();

    return detected;
  }

  private flushPendingAudio(): void {
    if (!this.child || !this.ready || this.writeBackpressured) {
      return;
    }

    while (this.pendingSamples.length >= this.preferredFrameLength && !this.writeBackpressured) {
      const nextFrame = this.pendingSamples.slice(0, this.preferredFrameLength);
      this.pendingSamples = this.pendingSamples.slice(this.preferredFrameLength);
      const encodedFrame = Buffer.from(nextFrame.buffer, nextFrame.byteOffset, nextFrame.byteLength).toString("base64");
      const wrote = this.child.stdin.write(`${JSON.stringify({ type: "audio", pcm: encodedFrame })}\n`);
      this.writeBackpressured = !wrote;
    }

    const maxPendingSamples = this.preferredFrameLength * MAX_PENDING_MULTIPLIER;
    if (this.pendingSamples.length > maxPendingSamples) {
      this.pendingSamples = this.pendingSamples.slice(this.pendingSamples.length - maxPendingSamples);
      this.logger.warn({ maxPendingSamples }, "Dropping buffered wake-word audio after worker backpressure");
    }
  }

  private resolvePythonPath(): string {
    if (process.env.OPENWAKEWORD_PYTHON?.trim()) {
      return process.env.OPENWAKEWORD_PYTHON;
    }

    const runtimeDir = resolveUnpackedAppPath(this.options.runtimeDir);
    const bundledPython = path.join(runtimeDir, "venv", "Scripts", "python.exe");
    if (!existsSync(bundledPython)) {
      throw new VoiceError(
        `openWakeWord runtime was not found at ${bundledPython}. Run "pnpm wakeword:setup" to provision it.`,
      );
    }

    return bundledPython;
  }

  private resolveWorkerPath(): string {
    const workerPath = resolveUnpackedAppPath(this.options.workerPath);
    if (!existsSync(workerPath)) {
      throw new VoiceError(`openWakeWord worker script was not found at ${workerPath}`);
    }

    return workerPath;
  }

  private resolveModelPath(): string | undefined {
    if (!this.options.modelPath?.trim()) {
      return undefined;
    }

    const modelPath = resolveUnpackedAppPath(this.options.modelPath);
    if (!existsSync(modelPath)) {
      throw new VoiceError(`openWakeWord model path does not exist: ${modelPath}`);
    }

    return modelPath;
  }
}
