import type { ClientMessage, ServerMessage } from "./protocol.js";

export interface ITransport {
  send(message: ServerMessage): void;
  onMessage(handler: (message: ClientMessage) => void): () => void;
  onConnect(handler: () => void): () => void;
  onDisconnect(handler: (reason: string) => void): () => void;
  close(): Promise<void>;
}
