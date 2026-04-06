export interface ISttProvider {
  transcribe(audio: Buffer, sampleRate: number): Promise<string>;
  dispose(): void;
}
