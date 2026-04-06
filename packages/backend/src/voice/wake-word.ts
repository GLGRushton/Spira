import { createRequire } from "node:module";
import type { Logger } from "pino";
import { VoiceError } from "../util/errors.js";

const require = createRequire(import.meta.url);

interface PorcupineModule {
  BuiltinKeyword?: Record<string, string>;
  Porcupine: new (
    accessKey: string,
    keywordPaths: string[],
    sensitivities: number[],
    options?: {
      modelPath?: string;
    },
  ) => {
    readonly frameLength: number;
    readonly sampleRate: number;
    process(frame: Int16Array): number;
    release(): void;
  };
}

export interface WakeWordOptions {
  accessKey: string;
  keyword?: "porcupine" | "alexa" | "jarvis" | "hey barista";
  keywordPath?: string;
  sensitivity?: number;
}

const DEFAULT_KEYWORD: NonNullable<WakeWordOptions["keyword"]> = "porcupine";
const DEFAULT_SENSITIVITY = 0.5;
const DEFAULT_FRAME_LENGTH = 512;
const DEFAULT_SAMPLE_RATE = 16_000;

export class WakeWordDetector {
  private porcupine: InstanceType<PorcupineModule["Porcupine"]> | null = null;

  constructor(
    private readonly options: WakeWordOptions,
    private readonly logger: Logger,
  ) {}

  async initialize(): Promise<void> {
    if (this.porcupine) {
      return;
    }

    try {
      const module = this.loadPorcupineModule();
      const keywordPath = this.options.keywordPath ?? this.resolveKeyword(module.BuiltinKeyword);
      this.porcupine = new module.Porcupine(
        this.options.accessKey,
        [keywordPath],
        [this.options.sensitivity ?? DEFAULT_SENSITIVITY],
      );
      this.logger.info(
        {
          keyword: this.options.keyword ?? DEFAULT_KEYWORD,
          keywordPath: this.options.keywordPath,
          frameLength: this.porcupine.frameLength,
          sampleRate: this.porcupine.sampleRate,
        },
        "Wake word detector initialized",
      );
    } catch (error) {
      throw new VoiceError("Failed to initialize wake word detection", error);
    }
  }

  dispose(): void {
    if (!this.porcupine) {
      return;
    }

    try {
      this.porcupine.release();
    } catch (error) {
      this.logger.debug({ error }, "Wake word detector release raised an error");
    }

    this.porcupine = null;
  }

  processFrame(frame: Int16Array): boolean {
    if (!this.porcupine) {
      return false;
    }

    if (frame.length !== this.porcupine.frameLength) {
      this.logger.warn({ got: frame.length, expected: this.porcupine.frameLength }, "Frame length mismatch — skipping");
      return false;
    }

    return this.porcupine.process(frame) >= 0;
  }

  get frameLength(): number {
    return this.porcupine?.frameLength ?? DEFAULT_FRAME_LENGTH;
  }

  get sampleRate(): number {
    return this.porcupine?.sampleRate ?? DEFAULT_SAMPLE_RATE;
  }

  private loadPorcupineModule(): PorcupineModule {
    try {
      return require("@picovoice/porcupine-node") as PorcupineModule;
    } catch (error) {
      throw new VoiceError("Porcupine native module is unavailable", error);
    }
  }

  private resolveKeyword(builtinKeyword?: Record<string, string>): string {
    const keyword = this.options.keyword ?? DEFAULT_KEYWORD;
    const builtinKey = keyword.toUpperCase().replaceAll(" ", "_").replaceAll("-", "_");
    return builtinKeyword?.[builtinKey] ?? keyword;
  }
}
