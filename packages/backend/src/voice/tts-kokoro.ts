import { KokoroTTS } from "kokoro-js";
import type { Logger } from "pino";
import { VoiceError } from "../util/errors.js";
import type { ITtsProvider } from "./tts-provider.js";

type KokoroDtype = "fp32" | "fp16" | "q8" | "q4" | "q4f16";

export interface KokoroOptions {
  modelId: string;
  voice: string;
  dtype: KokoroDtype;
  speed: number;
}

interface KokoroVoiceLayer {
  voice: string;
  weight: number;
}

export class KokoroTtsProvider implements ITtsProvider {
  readonly sampleRate = 24_000;
  private static readonly modelCache = new Map<string, Promise<KokoroTTS>>();
  private disposed = false;

  constructor(
    private readonly options: KokoroOptions,
    private readonly logger: Logger,
  ) {}

  async *synthesize(text: string): AsyncGenerator<Buffer> {
    this.disposed = false;

    try {
      const model = await KokoroTtsProvider.loadModel(this.options);
      if (this.disposed) {
        return;
      }

      this.logger.info(
        {
          modelId: this.options.modelId,
          voice: this.options.voice,
          dtype: this.options.dtype,
          speed: this.options.speed,
        },
        "Generating Kokoro TTS audio",
      );
      const voiceLayers = KokoroTtsProvider.parseVoiceLayers(this.options.voice, model.voices);
      const audio =
        voiceLayers.length === 1
          ? await model.generate(text, {
              voice: voiceLayers[0]?.voice as keyof typeof model.voices,
              speed: this.options.speed,
            })
          : await KokoroTtsProvider.generateBlendedAudio(model, text, voiceLayers, this.options.speed);

      if (this.disposed) {
        return;
      }

      yield KokoroTtsProvider.float32ToPcm16(audio.audio);
    } catch (error) {
      throw new VoiceError("Kokoro TTS failed", error);
    }
  }

  dispose(): void {
    this.disposed = true;
  }

  private static loadModel(options: KokoroOptions): Promise<KokoroTTS> {
    const cacheKey = `${options.modelId}:${options.dtype}`;
    const cached = KokoroTtsProvider.modelCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const promise = KokoroTTS.from_pretrained(options.modelId, {
      dtype: options.dtype,
      device: "cpu",
    }).catch((error) => {
      KokoroTtsProvider.modelCache.delete(cacheKey);
      throw error;
    });

    KokoroTtsProvider.modelCache.set(cacheKey, promise);
    return promise;
  }

  private static parseVoiceLayers(
    voiceSpec: string,
    availableVoices: Readonly<Record<string, unknown>>,
  ): KokoroVoiceLayer[] {
    const rawLayers = voiceSpec
      .split(",")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

    if (rawLayers.length === 0) {
      throw new VoiceError("Kokoro voice specification is empty");
    }

    const parsedLayers = rawLayers.map((layer) => {
      const [rawVoice, rawWeight] = layer.split(":").map((segment) => segment.trim());
      if (!rawVoice) {
        throw new VoiceError(`Invalid Kokoro voice layer: "${layer}"`);
      }

      if (!(rawVoice in availableVoices)) {
        throw new VoiceError(`Unknown Kokoro voice: "${rawVoice}"`);
      }

      const weight = rawWeight ? Number(rawWeight) : 1;
      if (!Number.isFinite(weight) || weight <= 0) {
        throw new VoiceError(`Invalid Kokoro voice weight for "${rawVoice}": "${rawWeight}"`);
      }

      return { voice: rawVoice, weight };
    });

    const totalWeight = parsedLayers.reduce((sum, layer) => sum + layer.weight, 0);
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
      throw new VoiceError("Kokoro voice weights must sum to a positive value");
    }

    return parsedLayers.map((layer) => ({
      voice: layer.voice,
      weight: layer.weight / totalWeight,
    }));
  }

  private static async generateBlendedAudio(
    model: KokoroTTS,
    text: string,
    voiceLayers: KokoroVoiceLayer[],
    speed: number,
  ) {
    const generatedLayers = await Promise.all(
      voiceLayers.map(async ({ voice, weight }) => {
        const audio = await model.generate(text, {
          voice: voice as keyof typeof model.voices,
          speed,
        });
        return { audio: audio.audio, weight };
      }),
    );

    const maxLength = generatedLayers.reduce((length, layer) => Math.max(length, layer.audio.length), 0);
    const blended = new Float32Array(maxLength);
    for (const layer of generatedLayers) {
      for (let index = 0; index < layer.audio.length; index += 1) {
        blended[index] += (layer.audio[index] ?? 0) * layer.weight;
      }
    }

    let peak = 0;
    for (let index = 0; index < blended.length; index += 1) {
      peak = Math.max(peak, Math.abs(blended[index] ?? 0));
    }

    if (peak > 1) {
      for (let index = 0; index < blended.length; index += 1) {
        blended[index] /= peak;
      }
    }

    return {
      audio: blended,
    };
  }

  private static float32ToPcm16(audio: Float32Array): Buffer {
    const pcmAudio = Buffer.alloc(audio.length * 2);
    for (let index = 0; index < audio.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, audio[index] ?? 0));
      const value = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
      pcmAudio.writeInt16LE(value, index * 2);
    }

    return pcmAudio;
  }
}
