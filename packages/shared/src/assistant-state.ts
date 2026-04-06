/**
 * All possible states of the Spira assistant.
 *
 * Valid transitions:
 *   idle        → listening  (voice toggled on / push-to-talk pressed)
 *   idle        → thinking   (text message sent)
 *   listening   → idle       (push-to-talk released with no audio / voice toggled off)
 *   listening   → transcribing (audio capture ended)
 *   transcribing → thinking  (STT result received)
 *   transcribing → error     (STT failure)
 *   thinking    → speaking   (response received, TTS starts)
 *   thinking    → idle       (response received, voice disabled)
 *   thinking    → error      (LLM / tool error)
 *   speaking    → idle       (TTS playback complete)
 *   speaking    → error      (TTS failure)
 *   error       → idle       (error acknowledged / auto-recovery)
 */
export type AssistantState = "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "error";
