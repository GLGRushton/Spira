import { createRequire } from "node:module";
import type { Logger } from "pino";
import { VoiceError } from "../util/errors.js";

const require = createRequire(import.meta.url);

interface PvRecorderModule {
  PvRecorder: {
    new (
      frameLength: number,
      deviceIndex?: number,
      bufferedFramesCount?: number,
    ): {
      readonly isRecording: boolean;
      start(): void;
      stop(): void;
      release(): void;
      read(): Promise<Int16Array>;
    };
    getAvailableDevices(): string[];
  };
}

export interface AudioCaptureOptions {
  frameLength?: number;
  sampleRate?: number;
  deviceIndex?: number;
  silenceThresholdDb?: number;
  minSpeechDurationMs?: number;
}

const DEFAULT_OPTIONS: Required<AudioCaptureOptions> = {
  frameLength: 512,
  sampleRate: 16_000,
  deviceIndex: -1,
  silenceThresholdDb: -45,
  minSpeechDurationMs: 300,
};

export class AudioCapture {
  private readonly options: Required<AudioCaptureOptions>;
  private readonly handlers = new Set<(frame: Int16Array) => void>();
  private recorder: InstanceType<PvRecorderModule["PvRecorder"]> | null = null;
  private running = false;
  private readLoopPromise: Promise<void> | null = null;

  constructor(
    options: AudioCaptureOptions | undefined,
    private readonly logger: Logger,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
  }

  start(): void {
    if (this.running) {
      return;
    }

    const { PvRecorder } = this.loadRecorderModule();
    const availableDevices = PvRecorder.getAvailableDevices();
    let actualDeviceIndex = this.options.deviceIndex;
    if (availableDevices.length === 0) {
      throw new VoiceError("No audio input devices are available for voice capture");
    }

    try {
      this.recorder = new PvRecorder(this.options.frameLength, this.options.deviceIndex);
    } catch (error) {
      if (this.options.deviceIndex === -1 && availableDevices.length > 0) {
        this.logger.warn(
          { fallbackDeviceIndex: 0, availableDeviceCount: availableDevices.length },
          "Default audio input device failed; retrying first available microphone",
        );
        try {
          this.recorder = new PvRecorder(this.options.frameLength, 0);
          actualDeviceIndex = 0;
        } catch (fallbackError) {
          this.running = false;
          this.recorder = null;
          throw new VoiceError("Failed to start audio capture", fallbackError);
        }
      } else {
        this.running = false;
        this.recorder = null;
        throw new VoiceError("Failed to start audio capture", error);
      }
    }

    try {
      this.recorder.start();
      this.running = true;
      this.readLoopPromise = this.readLoop();
      this.logger.info(
        {
          frameLength: this.options.frameLength,
          sampleRate: this.options.sampleRate,
          deviceIndex: actualDeviceIndex,
          availableDeviceCount: availableDevices.length,
        },
        "Audio capture started",
      );
    } catch (error) {
      this.running = false;
      this.recorder = null;
      throw new VoiceError("Failed to start audio capture", error);
    }
  }

  stop(): void {
    this.running = false;

    if (!this.recorder) {
      return;
    }

    try {
      this.recorder.stop();
    } catch (error) {
      this.logger.debug({ error }, "Audio capture stop raised an error");
    }

    try {
      this.recorder.release();
    } catch (error) {
      this.logger.debug({ error }, "Audio capture release raised an error");
    }

    this.recorder = null;
    this.readLoopPromise = null;
    this.logger.info("Audio capture stopped");
  }

  onFrame(handler: (frame: Int16Array) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  isSilent(frame: Int16Array): boolean {
    return AudioCapture.toDb(frame) < this.options.silenceThresholdDb;
  }

  get frameLength(): number {
    return this.options.frameLength;
  }

  get sampleRate(): number {
    return this.options.sampleRate;
  }

  getDeviceList(): string[] {
    return AudioCapture.getDeviceList();
  }

  static getDeviceList(): string[] {
    try {
      const { PvRecorder } = require("@picovoice/pvrecorder-node") as PvRecorderModule;
      return PvRecorder.getAvailableDevices();
    } catch {
      return [];
    }
  }

  private loadRecorderModule(): PvRecorderModule {
    try {
      return require("@picovoice/pvrecorder-node") as PvRecorderModule;
    } catch (error) {
      throw new VoiceError("PvRecorder native module is unavailable", error);
    }
  }

  private async readLoop(): Promise<void> {
    while (this.running && this.recorder) {
      try {
        const frame = await this.recorder.read();
        for (const handler of this.handlers) {
          handler(frame);
        }
      } catch (error) {
        if (!this.running) {
          return;
        }

        this.logger.error({ error }, "Audio capture read loop failed");
        this.stop();
        return;
      }
    }
  }

  private static toDb(frame: Int16Array): number {
    let sumSquares = 0;
    for (const sample of frame) {
      const normalized = sample / 32_768;
      sumSquares += normalized * normalized;
    }

    const rms = Math.sqrt(sumSquares / Math.max(frame.length, 1));
    return 20 * Math.log10(Math.max(rms, 1e-8));
  }
}
