export class StreamAssembler {
  private readonly chunks = new Map<string, string>();

  append(messageId: string, delta: string): void {
    const current = this.chunks.get(messageId) ?? "";
    this.chunks.set(messageId, current + delta);
  }

  finalize(messageId: string): string {
    const fullText = this.chunks.get(messageId) ?? "";
    this.chunks.delete(messageId);
    return fullText;
  }

  clear(): void {
    this.chunks.clear();
  }
}
