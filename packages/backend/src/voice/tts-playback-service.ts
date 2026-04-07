import { type Env, type UserSettings, markdownToSpeechText } from "@spira/shared";
import type { Logger } from "pino";
import { resolveAppPath } from "../util/app-paths.js";
import { SpiraError, VoiceError } from "../util/errors.js";
import type { SpiraEventBus } from "../util/event-bus.js";
import { PiperTtsProvider } from "./tts-piper.js";
import type { ITtsProvider } from "./tts-provider.js";
import { ElevenLabsTtsProvider } from "./tts.js";

type TtsPlaybackSettings = Pick<UserSettings, "ttsProvider" | "elevenLabsVoiceId">;

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export class TtsPlaybackService {
  private readonly piperExecutable: string;
  private readonly piperModelPath: string;
  private readonly elevenLabsApiKey: string;
  private readonly defaultVoiceId: string;
  private readonly defaultProvider: UserSettings["ttsProvider"];
  private settings: TtsPlaybackSettings;
  private activeProvider: ITtsProvider | null = null;
  private playbackSequence = 0;

  constructor(
    env: Env,
    private readonly bus: SpiraEventBus,
    private readonly logger: Logger,
  ) {
    this.piperExecutable = env.PIPER_EXECUTABLE ?? "piper";
    this.piperModelPath = env.PIPER_MODEL ? resolveAppPath(env.PIPER_MODEL) : "";
    this.elevenLabsApiKey = env.ELEVENLABS_API_KEY?.trim() ?? "";
    this.defaultVoiceId = env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE_ID;
    this.defaultProvider = this.elevenLabsApiKey ? "elevenlabs" : "piper";
    this.settings = {
      ttsProvider: this.defaultProvider,
      elevenLabsVoiceId: env.ELEVENLABS_VOICE_ID?.trim() ?? "",
    };
  }

  updateSettings(settings: Partial<UserSettings>): void {
    this.settings = {
      ttsProvider: settings.ttsProvider ?? this.settings.ttsProvider,
      elevenLabsVoiceId: settings.elevenLabsVoiceId ?? this.settings.elevenLabsVoiceId,
    };
  }

  async speak(text: string): Promise<void> {
    const trimmed = markdownToSpeechText(text).trim();
    if (!trimmed) {
      this.stop();
      return;
    }

    this.activeProvider?.dispose();
    this.activeProvider = null;
    this.bus.emit("tts:amplitude", { amplitude: 0 });
    const sequence = ++this.playbackSequence;
    const provider = this.createProvider();
    this.activeProvider = provider;
    const sampleRate = TtsPlaybackService.resolveSampleRate(provider);
    const chunks: Buffer[] = [];

    try {
      for await (const chunk of provider.synthesize(trimmed)) {
        if (this.playbackSequence !== sequence) {
          return;
        }

        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      if (this.playbackSequence !== sequence) {
        return;
      }

      const pcmAudio = Buffer.concat(chunks);
      if (pcmAudio.length === 0) {
        throw new VoiceError("TTS provider returned no audio");
      }

      const wavAudio = TtsPlaybackService.createWavAudio(pcmAudio, sampleRate);
      this.logger.info(
        { provider: this.settings.ttsProvider, sampleRate, audioBytes: wavAudio.length },
        "Prepared chat TTS audio for renderer playback",
      );
      this.bus.emit("tts:audio", { audioBase64: wavAudio.toString("base64"), mimeType: "audio/wav" });
    } catch (error) {
      if (this.playbackSequence !== sequence) {
        return;
      }

      throw error;
    } finally {
      if (this.activeProvider === provider) {
        provider.dispose();
        this.activeProvider = null;
      }

      if (this.playbackSequence === sequence) {
        this.bus.emit("tts:amplitude", { amplitude: 0 });
      }
    }
  }

  stop(): void {
    this.playbackSequence += 1;
    this.activeProvider?.dispose();
    this.activeProvider = null;
    this.bus.emit("tts:amplitude", { amplitude: 0 });
  }

  dispose(): void {
    this.stop();
  }

  private createProvider(): ITtsProvider {
    if (this.settings.ttsProvider === "elevenlabs") {
      if (!this.elevenLabsApiKey) {
        throw new SpiraError("ELEVENLABS_NOT_CONFIGURED", "ElevenLabs TTS is selected but no API key is configured");
      }

      return new ElevenLabsTtsProvider(
        {
          apiKey: this.elevenLabsApiKey,
          voiceId: this.settings.elevenLabsVoiceId.trim() || this.defaultVoiceId,
        },
        this.logger,
      );
    }

    return new PiperTtsProvider(this.piperExecutable, this.piperModelPath, this.logger);
  }

  private static resolveSampleRate(provider: ITtsProvider): number {
    const sampleRate = (provider as ITtsProvider & { sampleRate?: number }).sampleRate;
    return typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 16_000;
  }

  private static createWavAudio(pcmAudio: Buffer, sampleRate: number): Buffer {
    const header = Buffer.alloc(44);
    const bytesPerSample = 2;
    const channels = 1;
    const byteRate = sampleRate * channels * bytesPerSample;
    const blockAlign = channels * bytesPerSample;

    header.write("RIFF", 0);
    header.writeUInt32LE(36 + pcmAudio.length, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bytesPerSample * 8, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcmAudio.length, 40);

    return Buffer.concat([header, pcmAudio]);
  }
}
