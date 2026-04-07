import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Logger } from "pino";
import { VoiceError } from "../util/errors.js";
import type { ISttProvider } from "./stt-provider.js";

const RUNTIME_DIR = path.join(os.tmpdir(), "spira-runtime", "whisper");
const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

const findWhisperCppPath = (): string => {
  const packageJsonPath = require.resolve("nodejs-whisper/package.json");
  return path.join(path.dirname(packageJsonPath), "cpp", "whisper.cpp");
};

const WHISPER_CPP_PATH = findWhisperCppPath();
const WHISPER_EXECUTABLE_PATHS = [
  path.join(WHISPER_CPP_PATH, "build", "bin", "whisper-cli"),
  path.join(WHISPER_CPP_PATH, "build", "bin", "whisper-cli.exe"),
  path.join(WHISPER_CPP_PATH, "build", "bin", "Release", "whisper-cli.exe"),
  path.join(WHISPER_CPP_PATH, "build", "bin", "Debug", "whisper-cli.exe"),
  path.join(WHISPER_CPP_PATH, "build", "whisper-cli.exe"),
  path.join(WHISPER_CPP_PATH, "whisper-cli.exe"),
] as const;

const CMAKE_CANDIDATE_PATHS = [
  process.env.CMAKE_PATH,
  "C:\\Program Files\\CMake\\bin\\cmake.exe",
  "C:\\Program Files (x86)\\CMake\\bin\\cmake.exe",
  "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe",
  "C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe",
  "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe",
  "C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe",
  "C:\\Program Files\\Microsoft Visual Studio\\2019\\Community\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe",
  "C:\\Program Files\\Microsoft Visual Studio\\2019\\Professional\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe",
  "C:\\Program Files\\Microsoft Visual Studio\\2019\\Enterprise\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe",
  "C:\\Program Files\\Microsoft Visual Studio\\2019\\BuildTools\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe",
].filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);

export class WhisperSttProvider implements ISttProvider {
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private initError: Error | null = null;
  private readonly modelName: string;

  constructor(
    modelName: string | undefined,
    private readonly logger: Logger,
  ) {
    this.modelName = modelName ?? "base.en";
  }

  async initialize(): Promise<void> {
    if (this.initError) {
      throw this.initError;
    }

    if (this.initialized) {
      return;
    }

    if (this.initializing) {
      return this.initializing;
    }

    this.initializing = (async () => {
      try {
        await this.prewarmModel();
        this.initialized = true;
      } catch (error) {
        this.initError = error instanceof Error ? error : new Error(String(error));
        throw this.initError;
      } finally {
        this.initializing = null;
      }
    })();

    return this.initializing;
  }

  async transcribe(audio: Buffer, sampleRate: number): Promise<string> {
    await this.initialize();

    const wavPath = path.join(RUNTIME_DIR, `whisper-${randomUUID()}.wav`);
    await mkdir(RUNTIME_DIR, { recursive: true });

    try {
      await this.writeWavFile(wavPath, audio, sampleRate);
      const { nodewhisper } = await import("nodejs-whisper");
      const result = await nodewhisper(wavPath, {
        modelName: this.modelName,
        autoDownloadModelName: this.modelName,
        removeWavFileAfterTranscription: false,
      });
      return WhisperSttProvider.extractText(result);
    } catch (error) {
      throw new VoiceError("Whisper transcription failed", error);
    } finally {
      await rm(wavPath, { force: true }).catch(() => undefined);
    }
  }

  dispose(): void {
    this.initError = null;
    this.initialized = false;
    this.initializing = null;
  }

  private async prewarmModel(): Promise<void> {
    const silentAudio = Buffer.alloc(16_000 * 2);
    const wavPath = path.join(RUNTIME_DIR, `whisper-${randomUUID()}.wav`);
    await mkdir(RUNTIME_DIR, { recursive: true });

    try {
      await this.ensureWhisperExecutable();
      await this.writeWavFile(wavPath, silentAudio, 16_000);
      const { nodewhisper } = await import("nodejs-whisper");
      try {
        await nodewhisper(wavPath, {
          modelName: this.modelName,
          autoDownloadModelName: this.modelName,
          removeWavFileAfterTranscription: false,
        });
      } catch (error) {
        this.logger.warn({ error, modelName: this.modelName }, "Whisper warmup produced no transcript; continuing");
      }
      this.logger.info({ modelName: this.modelName }, "Whisper model is ready");
    } catch (error) {
      throw new VoiceError(`Failed to initialize Whisper model "${this.modelName}"`, error);
    } finally {
      await rm(wavPath, { force: true }).catch(() => undefined);
    }
  }

  private async ensureWhisperExecutable(): Promise<void> {
    if (WHISPER_EXECUTABLE_PATHS.some((candidate) => existsSync(candidate))) {
      return;
    }

    const cmakePath = CMAKE_CANDIDATE_PATHS.find((candidate) => existsSync(candidate));
    if (!cmakePath) {
      throw new VoiceError(
        "Whisper CLI is not built and CMake could not be found. Install CMake or set CMAKE_PATH to cmake.exe.",
      );
    }

    this.logger.info({ cmakePath }, "Building whisper-cli for STT");

    try {
      await execFileAsync(cmakePath, ["-B", "build"], { cwd: WHISPER_CPP_PATH });
      await execFileAsync(cmakePath, ["--build", "build", "--config", "Release"], {
        cwd: WHISPER_CPP_PATH,
      });
    } catch (error) {
      throw new VoiceError("Failed to build whisper-cli for STT", error);
    }

    if (!WHISPER_EXECUTABLE_PATHS.some((candidate) => existsSync(candidate))) {
      throw new VoiceError("Whisper CLI build completed but whisper-cli.exe was not found");
    }
  }

  private async writeWavFile(wavPath: string, audio: Buffer, sampleRate: number): Promise<void> {
    await writeFile(wavPath, WhisperSttProvider.createWavBuffer(audio, sampleRate));
  }

  private static createWavBuffer(audio: Buffer, sampleRate: number): Buffer {
    const header = Buffer.alloc(44);
    const byteRate = sampleRate * 2;

    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(36 + audio.length, 4);
    header.write("WAVE", 8, "ascii");
    header.write("fmt ", 12, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36, "ascii");
    header.writeUInt32LE(audio.length, 40);

    return Buffer.concat([header, audio]);
  }

  private static extractText(result: unknown): string {
    if (typeof result === "string") {
      return WhisperSttProvider.stripTimestamps(result).trim();
    }

    if (Array.isArray(result)) {
      return result
        .map((segment) => {
          if (typeof segment === "string") return segment;
          if (segment && typeof segment === "object") {
            const s = segment as Record<string, unknown>;
            return typeof s.text === "string" ? s.text : typeof s.speech === "string" ? s.speech : "";
          }
          return "";
        })
        .join(" ")
        .trim();
    }

    if (result && typeof result === "object") {
      const record = result as Record<string, unknown>;
      const text =
        typeof record.text === "string"
          ? record.text
          : typeof record.transcript === "string"
            ? record.transcript
            : typeof record.output === "string"
              ? record.output
              : "";
      return WhisperSttProvider.stripTimestamps(text).trim();
    }

    return "";
  }

  /** Remove whisper.cpp timestamp markers like [00:00:00.000 --> 00:00:05.000] */
  private static stripTimestamps(raw: string): string {
    return raw.replaceAll(/\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g, "");
  }
}
