import type { WakeWordProvider } from "./wake-word.js";

const DEFAULT_FRAME_LENGTH = 512;
const DEFAULT_SAMPLE_RATE = 16_000;

export class NullWakeWordProvider implements WakeWordProvider {
  readonly providerName = "none";
  readonly frameLength = DEFAULT_FRAME_LENGTH;
  readonly sampleRate = DEFAULT_SAMPLE_RATE;
  readonly requiresExactFrameLength = false;

  async initialize(): Promise<void> {}

  dispose(): void {}

  processFrame(_frame: Int16Array): boolean {
    return false;
  }
}
