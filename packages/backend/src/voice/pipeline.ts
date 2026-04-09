import type { AssistantState, VoicePipelineState } from "@spira/shared";
import type { Logger } from "pino";
import { SpiraError } from "../util/errors.js";
import type { SpiraEventBus } from "../util/event-bus.js";
import type { AudioCapture } from "./audio-capture.js";
import type { ISttProvider } from "./stt-provider.js";
import type { WakeWordProvider } from "./wake-word.js";

const LISTEN_TIMEOUT_MS = 10_000;
const SILENCE_TIMEOUT_MS = 1_500;
const MIN_SPEECH_DURATION_MS = 300;
const MAX_SPEECH_CAPTURE_MS = 8_000;
const STT_TIMEOUT_MS = 30_000;
const THINKING_TIMEOUT_MS = 30_000;
const ERROR_RECOVERY_MS = 2_000;
const DEFAULT_SAMPLE_RATE = 16_000;

export class VoicePipeline {
  private state: VoicePipelineState = "idle";
  private started = false;
  private muted = false;
  private wakeWordSuspended = false;
  private pushToTalkActive = false;
  private wakeWordReady = false;
  private audioFrames: Int16Array[] = [];
  private listeningStartedAt = 0;
  private firstSpeechAt: number | null = null;
  private lastSpeechAt: number | null = null;
  private lastLevelAt = 0;
  private responseTimer: NodeJS.Timeout | null = null;
  private recoveryTimer: NodeJS.Timeout | null = null;
  private copilotState: AssistantState = "idle";
  private waitingForCopilotIdle = false;
  private unsubscribeFrame: (() => void) | null = null;
  private unsubscribeResponseEnd: (() => void) | null = null;
  private unsubscribeCopilotState: (() => void) | null = null;

  constructor(
    private readonly capture: AudioCapture,
    private readonly wakeWord: WakeWordProvider,
    private readonly stt: ISttProvider,
    private readonly bus: SpiraEventBus,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;

    try {
      try {
        await this.wakeWord.initialize();
        this.wakeWordReady = true;
      } catch (error) {
        if (error instanceof SpiraError && error.code === "VOICE_CONFIG_ERROR") {
          throw error;
        }
        this.wakeWordReady = false;
        this.logger.warn({ error }, "Wake word initialization failed; push-to-talk remains available");
      }

      if (this.wakeWordReady && this.capture.sampleRate !== this.wakeWord.sampleRate) {
        throw new SpiraError(
          "VOICE_CONFIG_ERROR",
          `Audio sample rate mismatch: capture=${this.capture.sampleRate} wakeWord=${this.wakeWord.sampleRate}`,
        );
      }

      if (
        this.wakeWordReady &&
        this.wakeWord.requiresExactFrameLength &&
        this.capture.frameLength !== this.wakeWord.frameLength
      ) {
        throw new SpiraError(
          "VOICE_CONFIG_ERROR",
          `Audio frame length mismatch: capture=${this.capture.frameLength} wakeWord=${this.wakeWord.frameLength}`,
        );
      }

      this.unsubscribeFrame = this.capture.onFrame((frame) => {
        this.handleFrame(frame);
      });

      const responseEndHandler = (_event: { text: string; messageId: string }) => {
        void this.handleCopilotResponse().catch((error) => {
          this.logger.error({ error }, "Voice pipeline failed while handling Copilot response");
          this.handleError(error);
        });
      };
      this.bus.on("copilot:response-end", responseEndHandler);
      this.unsubscribeResponseEnd = () => {
        this.bus.off("copilot:response-end", responseEndHandler);
      };

      const copilotStateHandler = (state: AssistantState) => {
        this.copilotState = state;
        if (state === "idle" && this.waitingForCopilotIdle) {
          this.waitingForCopilotIdle = false;
          this.scheduleIdleRecovery();
        }
      };
      this.bus.on("copilot:state", copilotStateHandler);
      this.unsubscribeCopilotState = () => {
        this.bus.off("copilot:state", copilotStateHandler);
      };

      this.capture.start();
      this.emitState(this.state);
      this.emitMutedState();
      this.logger.info(
        {
          wakeWordReady: this.wakeWordReady,
          wakeWordProvider: this.wakeWord.providerName,
        },
        "Voice pipeline started",
      );
    } catch (error) {
      this.started = false;
      this.unsubscribeFrame?.();
      this.unsubscribeResponseEnd?.();
      this.unsubscribeCopilotState?.();
      this.unsubscribeFrame = null;
      this.unsubscribeResponseEnd = null;
      this.unsubscribeCopilotState = null;
      this.capture.stop();
      this.wakeWord.dispose();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    this.pushToTalkActive = false;
    this.clearTimers();
    this.unsubscribeFrame?.();
    this.unsubscribeResponseEnd?.();
    this.unsubscribeCopilotState?.();
    this.unsubscribeFrame = null;
    this.unsubscribeResponseEnd = null;
    this.unsubscribeCopilotState = null;
    this.capture.stop();
    this.wakeWord.dispose();
    this.stt.dispose();
    this.resetListeningState();
    this.transitionTo("idle");
    this.logger.info("Voice pipeline stopped");
  }

  activatePushToTalk(): void {
    this.pushToTalkActive = true;
    if (!this.started) {
      return;
    }

    if (this.state === "idle") {
      this.beginListening("push-to-talk");
    }
  }

  deactivatePushToTalk(): void {
    this.pushToTalkActive = false;
    if (this.state === "listening") {
      void this.beginTranscription();
    }
  }

  setMuted(muted: boolean): void {
    if (this.muted === muted) {
      return;
    }

    this.muted = muted;
    this.pushToTalkActive = false;
    this.wakeWordSuspended = false;
    if (muted && this.state === "listening") {
      this.resetToIdle();
    }
    this.emitMutedState();
    this.logger.info({ muted }, "Voice pipeline mute state updated");
  }

  isMuted(): boolean {
    return this.muted;
  }

  private handleFrame(frame: Int16Array): void {
    if (!this.started || (this.muted && !this.pushToTalkActive)) {
      return;
    }

    if (this.state === "idle") {
      if (this.pushToTalkActive) {
        this.beginListening("push-to-talk");
        return;
      }

      if (!this.wakeWordSuspended && this.wakeWordReady && this.wakeWord.processFrame(frame)) {
        this.logger.info("Wake word detected");
        this.beginListening("wake-word");
      }
      return;
    }

    if (this.state !== "listening") {
      return;
    }

    const now = Date.now();
    this.audioFrames.push(new Int16Array(frame));

    if (now - this.lastLevelAt >= 33) {
      this.lastLevelAt = now;
      this.bus.emit("audio:level", { level: VoicePipeline.calculateLevel(frame) });
    }

    if (!this.capture.isSilent(frame)) {
      if (this.firstSpeechAt === null) {
        this.firstSpeechAt = now;
      }
      this.lastSpeechAt = now;
    }

    if (this.firstSpeechAt === null && now - this.listeningStartedAt >= LISTEN_TIMEOUT_MS) {
      this.logger.info("Listening timed out before speech was detected");
      this.resetToIdle();
      return;
    }

    if (!this.pushToTalkActive && this.firstSpeechAt !== null && now - this.firstSpeechAt >= MAX_SPEECH_CAPTURE_MS) {
      this.logger.info(
        { captureDurationMs: now - this.firstSpeechAt },
        "Forcing transcription after maximum speech capture duration",
      );
      void this.beginTranscription();
      return;
    }

    if (
      !this.pushToTalkActive &&
      this.firstSpeechAt !== null &&
      this.lastSpeechAt !== null &&
      now - this.firstSpeechAt >= MIN_SPEECH_DURATION_MS &&
      now - this.lastSpeechAt >= SILENCE_TIMEOUT_MS
    ) {
      this.logger.info(
        {
          silenceDurationMs: now - this.lastSpeechAt,
          utteranceDurationMs: now - this.firstSpeechAt,
        },
        "Silence detected; starting transcription",
      );
      void this.beginTranscription();
    }
  }

  private beginListening(trigger: "wake-word" | "push-to-talk"): void {
    this.resetListeningState();
    this.listeningStartedAt = Date.now();
    this.transitionTo("listening");
    this.logger.info({ trigger }, "Voice pipeline is listening");
  }

  private async beginTranscription(): Promise<void> {
    if (this.state !== "listening") {
      return;
    }

    const audioFrames = this.audioFrames;
    this.transitionTo("transcribing");
    this.resetListeningState();

    if (audioFrames.length === 0) {
      this.transitionTo("idle");
      return;
    }

    try {
      const pcmAudio = VoicePipeline.toPcmBuffer(audioFrames);
      const transcript = (
        await VoicePipeline.withTimeout(
          this.stt.transcribe(pcmAudio, DEFAULT_SAMPLE_RATE),
          STT_TIMEOUT_MS,
          "STT timed out after 30s",
        )
      ).trim();

      if (!this.isActiveState("transcribing")) {
        return;
      }

      if (!transcript) {
        this.logger.info("STT returned an empty transcript");
        this.transitionTo("idle");
        return;
      }

      this.waitingForCopilotIdle = false;
      this.transitionTo("thinking");
      this.bus.emit("voice:transcript", { text: transcript });
      this.responseTimer = setTimeout(() => {
        this.logger.warn("Voice pipeline timed out waiting for Copilot response");
        this.transitionTo("idle");
      }, THINKING_TIMEOUT_MS);
    } catch (error) {
      if (!this.isActiveState("transcribing")) {
        return;
      }
      this.handleError(error);
    }
  }

  private async handleCopilotResponse(): Promise<void> {
    if (this.state !== "thinking") {
      return;
    }

    this.clearResponseTimer();

    this.finishResponseCycle();
  }

  private handleError(error: unknown): void {
    this.logger.error({ error }, "Voice pipeline error");
    this.resetListeningState();
    this.transitionTo("error");
    this.recoveryTimer = setTimeout(() => {
      this.transitionTo("idle");
    }, ERROR_RECOVERY_MS);
  }

  private resetToIdle(): void {
    this.resetListeningState();
    this.waitingForCopilotIdle = false;
    this.transitionTo("idle");
  }

  private scheduleIdleRecovery(): void {
    this.resetListeningState();
    this.clearTimers();
    this.transitionTo("idle");
  }

  private finishResponseCycle(): void {
    this.wakeWordSuspended = true;
    if (this.copilotState === "idle") {
      this.waitingForCopilotIdle = false;
      this.scheduleIdleRecovery();
      return;
    }

    this.waitingForCopilotIdle = true;
    this.resetListeningState();
    this.transitionTo("thinking");
  }

  private resetListeningState(): void {
    this.audioFrames = [];
    this.listeningStartedAt = 0;
    this.firstSpeechAt = null;
    this.lastSpeechAt = null;
    this.lastLevelAt = 0;
  }

  private transitionTo(nextState: VoicePipelineState): void {
    if (this.state === nextState) {
      return;
    }

    this.clearTimers();
    this.state = nextState;
    this.emitState(nextState);
  }

  private emitState(state: VoicePipelineState): void {
    this.bus.emit("voice:pipeline", { state });
  }

  private emitMutedState(): void {
    this.bus.emit("voice:muted", { muted: this.muted });
  }

  private clearTimers(): void {
    this.clearResponseTimer();

    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  private clearResponseTimer(): void {
    if (this.responseTimer) {
      clearTimeout(this.responseTimer);
      this.responseTimer = null;
    }
  }

  private isActiveState(state: VoicePipelineState): boolean {
    return this.started && this.state === state;
  }

  private static toPcmBuffer(frames: Int16Array[]): Buffer {
    const pcmChunks = frames.map((frame) =>
      Buffer.from(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength)),
    );
    return Buffer.concat(pcmChunks);
  }

  private static calculateLevel(frame: Int16Array): number {
    let sumSquares = 0;
    for (const sample of frame) {
      const normalized = sample / 32_768;
      sumSquares += normalized * normalized;
    }
    return Math.min(1, Math.sqrt(sumSquares / Math.max(frame.length, 1)));
  }

  private static async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeout: NodeJS.Timeout | null = null;

    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
