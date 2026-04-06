export type VoicePipelineEvent =
  | { type: "wake-word:detected" }
  | { type: "wake-word:error"; error: string }
  | { type: "capture:start" }
  | { type: "capture:end"; durationMs: number }
  | { type: "capture:level"; level: number }
  | { type: "stt:result"; text: string; confidence: number; durationMs: number }
  | { type: "stt:error"; error: string }
  | { type: "tts:start"; text: string }
  | { type: "tts:chunk"; amplitude: number }
  | { type: "tts:end" }
  | { type: "tts:error"; error: string };

export interface TranscriptionResult {
  text: string;
  confidence: number;
  durationMs: number;
}

export interface OrbVisualParams {
  rotationSpeed: number;
  pulseFrequency: number;
  pulseAmplitude: number;
  glowIntensity: number;
  colorPrimary: [number, number, number];
  colorSecondary: [number, number, number];
  particleSpeed: number;
  particleCount: number;
  displacementScale: number;
}
