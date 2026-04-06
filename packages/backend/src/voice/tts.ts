import fetch from "node-fetch";
import type { Logger } from "pino";
import { VoiceError } from "../util/errors.js";
import type { ITtsProvider } from "./tts-provider.js";

export interface ElevenLabsOptions {
  apiKey: string;
  voiceId: string;
  modelId?: string;
  outputFormat?: string;
}

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const DEFAULT_MODEL_ID = "eleven_turbo_v2_5";
const DEFAULT_OUTPUT_FORMAT = "pcm_16000";

export class ElevenLabsTtsProvider implements ITtsProvider {
  readonly sampleRate = 16_000;

  constructor(
    private readonly options: ElevenLabsOptions,
    private readonly logger: Logger,
  ) {}

  async *synthesize(text: string): AsyncGenerator<Buffer> {
    const voiceId = this.options.voiceId || DEFAULT_VOICE_ID;
    const outputFormat = this.options.outputFormat ?? DEFAULT_OUTPUT_FORMAT;

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=${encodeURIComponent(outputFormat)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "xi-api-key": this.options.apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: this.options.modelId ?? DEFAULT_MODEL_ID,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      },
    );

    if (!response.ok) {
      const rawBody = await response.text();
      const body = rawBody.slice(0, 1000);
      throw new VoiceError(`ElevenLabs TTS request failed with status ${response.status}: ${body}`);
    }

    if (!response.body) {
      throw new VoiceError("ElevenLabs TTS response body was empty");
    }

    this.logger.info({ voiceId, outputFormat }, "Streaming ElevenLabs TTS audio");

    for await (const chunk of response.body as AsyncIterable<Buffer | Uint8Array>) {
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    }
  }

  dispose(): void {}
}
