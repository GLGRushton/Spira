declare module "@picovoice/pvrecorder-node" {
  export class PvRecorder {
    constructor(frameLength: number, deviceIndex?: number, bufferedFramesCount?: number);
    static getAvailableDevices(): string[];
    readonly isRecording: boolean;
    start(): void;
    stop(): void;
    release(): void;
    read(): Promise<Int16Array>;
    readSync(): Int16Array;
  }
}

declare module "@picovoice/porcupine-node" {
  export const BuiltinKeyword: Record<string, string>;

  export class Porcupine {
    constructor(accessKey: string, keywords: string[], sensitivities: number[], modelPath?: string);
    readonly frameLength: number;
    readonly sampleRate: number;
    process(frame: Int16Array): number;
    release(): void;
  }
}

declare module "nodejs-whisper" {
  export interface NodeWhisperOptions {
    modelName: string;
    autoDownloadModelName?: string;
    removeWavFileAfterTranscription?: boolean;
    withCuda?: boolean;
    logger?: {
      log?: (...args: unknown[]) => void;
      warn?: (...args: unknown[]) => void;
      error?: (...args: unknown[]) => void;
    };
    whisperOptions?: Record<string, unknown>;
  }

  export function nodewhisper(filePath: string, options: NodeWhisperOptions): Promise<unknown>;
}

declare module "speaker" {
  import { Writable } from "node:stream";

  export interface SpeakerOptions {
    channels?: number;
    bitDepth?: number;
    sampleRate?: number;
    signed?: boolean;
    float?: boolean;
    samplesPerFrame?: number;
    device?: string | null;
  }

  export default class Speaker extends Writable {
    constructor(options?: SpeakerOptions);
  }
}
