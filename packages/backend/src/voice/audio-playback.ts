import { once } from "node:events";
import { createRequire } from "node:module";
import type { Logger } from "pino";
import { SpiraError, VoiceError } from "../util/errors.js";

const require = createRequire(import.meta.url);

type SpeakerInstance = {
  write(chunk: Buffer, callback?: (error?: Error | null) => void): boolean;
  once(event: "drain" | "close" | "error", listener: (...args: unknown[]) => void): SpeakerInstance;
  off(event: "drain" | "close" | "error", listener: (...args: unknown[]) => void): SpeakerInstance;
  emit(event: "error", error: Error): boolean;
  end(callback?: () => void): void;
  destroy?(error?: Error): void;
};

type SpeakerConstructor = new (options: {
  channels?: number;
  bitDepth?: number;
  sampleRate?: number;
}) => SpeakerInstance;

export class AudioPlayback {
  private currentSpeaker: SpeakerInstance | null = null;
  private playbackToken: symbol | null = null;
  private stopRequested = false;

  constructor(private readonly logger: Logger) {}

  async playStream(
    chunks: AsyncIterable<Buffer>,
    format: "mp3" | "pcm",
    options: { sampleRate?: number; channels?: number; bitDepth?: number } = {},
    onAmplitude?: (amplitude: number) => void,
  ): Promise<void> {
    if (format === "mp3") {
      throw new SpiraError("MP3_PLAYBACK_UNSUPPORTED", "MP3 playback is not supported yet");
    }

    this.stop();
    this.stopRequested = false;

    const Speaker = this.loadSpeaker();
    const speaker = new Speaker({
      channels: options.channels ?? 1,
      bitDepth: options.bitDepth ?? 16,
      sampleRate: options.sampleRate ?? 16_000,
    });
    const playbackToken = Symbol("playback");
    let lastAmplitudeAt = 0;

    this.playbackToken = playbackToken;
    this.currentSpeaker = speaker;
    speaker.once("error", (err) => {
      this.logger.error({ err }, "Speaker error");
    });
    this.logger.info(
      {
        sampleRate: options.sampleRate ?? 16_000,
        channels: options.channels ?? 1,
        bitDepth: options.bitDepth ?? 16,
      },
      "Audio playback started",
    );

    try {
      for await (const chunk of chunks) {
        if (this.stopRequested || this.playbackToken !== playbackToken) {
          break;
        }

        if (onAmplitude) {
          const now = Date.now();
          if (now - lastAmplitudeAt >= 33) {
            lastAmplitudeAt = now;
            onAmplitude(AudioPlayback.calculateAmplitude(chunk));
          }
        }

        const ready = speaker.write(chunk);
        if (!ready) {
          await Promise.race([
            once(speaker as never, "drain"),
            once(speaker as never, "error").then((args) => {
              throw args[0] as Error;
            }),
          ]);
        }
      }

      if (this.playbackToken === playbackToken) {
        await new Promise<void>((resolve, reject) => {
          const onError = (error: unknown) => {
            speaker.off("error", onError);
            reject(error);
          };

          speaker.once("error", onError);
          speaker.end(() => {
            speaker.off("error", onError);
            resolve();
          });
        });
      }
    } catch (error) {
      if (this.playbackToken === playbackToken) {
        throw new VoiceError("Audio playback failed", error);
      }
    } finally {
      if (this.currentSpeaker === speaker) {
        this.currentSpeaker = null;
      }

      if (this.playbackToken === playbackToken) {
        this.playbackToken = null;
      }
    }
  }

  stop(): void {
    this.stopRequested = true;
    this.playbackToken = null;

    if (!this.currentSpeaker) {
      return;
    }

    try {
      this.currentSpeaker.emit("error", new Error("Playback stopped"));
      this.currentSpeaker.destroy?.();
    } catch (error) {
      this.logger.debug({ error }, "Audio playback stop raised an error");
    }

    this.currentSpeaker = null;
  }

  private loadSpeaker(): SpeakerConstructor {
    try {
      const module = require("speaker") as { default?: SpeakerConstructor } | SpeakerConstructor;
      return typeof module === "function" ? module : (module.default as SpeakerConstructor);
    } catch (error) {
      throw new VoiceError("Speaker native module is unavailable", error);
    }
  }

  private static calculateAmplitude(chunk: Buffer): number {
    if (chunk.length < 2) {
      return 0;
    }

    let sumSquares = 0;
    const sampleCount = Math.floor(chunk.length / 2);

    for (let index = 0; index < sampleCount; index += 1) {
      const sample = chunk.readInt16LE(index * 2) / 32_768;
      sumSquares += sample * sample;
    }

    return Math.min(1, Math.sqrt(sumSquares / sampleCount));
  }
}
