import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { Logger } from "pino";
import { SpiraError, VoiceError } from "../util/errors.js";
import type { ITtsProvider } from "./tts-provider.js";

export class PiperTtsProvider implements ITtsProvider {
  readonly sampleRate = 22_050;
  private child: ChildProcessWithoutNullStreams | null = null;

  constructor(
    private readonly piperExecutable: string,
    private readonly modelPath: string,
    private readonly logger: Logger,
  ) {}

  async *synthesize(text: string): AsyncGenerator<Buffer> {
    if (!this.piperExecutable.trim()) {
      throw new SpiraError("PIPER_NOT_FOUND", "Piper executable is not configured");
    }

    if (!this.modelPath.trim()) {
      throw new SpiraError("PIPER_MODEL_NOT_CONFIGURED", "Piper model path is not configured");
    }

    const child = spawn(this.piperExecutable, ["--model", this.modelPath, "--output-raw"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child = child;
    const childEvents = child as ChildProcessWithoutNullStreams & NodeJS.EventEmitter;
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    const exitPromise = new Promise<void>((resolve, reject) => {
      childEvents.once("error", (error: Error) => {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          reject(new SpiraError("PIPER_NOT_FOUND", `Piper executable not found: ${this.piperExecutable}`, error));
          return;
        }

        reject(new VoiceError("Failed to start Piper TTS", error));
      });

      childEvents.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
        if (code === 0 || signal === "SIGTERM") {
          resolve();
          return;
        }

        reject(new VoiceError(`Piper TTS exited unexpectedly (${code ?? signal ?? "unknown"})`, stderr));
      });
    });

    this.logger.info({ modelPath: this.modelPath }, "Streaming Piper TTS audio");
    child.stdin.end(text);

    try {
      for await (const chunk of child.stdout as AsyncIterable<Buffer | Uint8Array>) {
        yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      }

      await exitPromise;
    } finally {
      if (this.child === child) {
        this.child = null;
      }
    }
  }

  dispose(): void {
    this.child?.kill();
    this.child = null;
  }
}
