export interface ITtsProvider {
  synthesize(text: string): AsyncIterable<Buffer>;
  dispose(): void;
}
