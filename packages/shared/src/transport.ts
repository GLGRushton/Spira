import type { ClientMessage, ServerMessage } from "./protocol.js";

export interface ITransport {
  send(message: ServerMessage): void;
  onMessage(handler: (message: ClientMessage) => void): () => void;
  close(): void;
}
