import type { ClientMessage, ITransport, ServerMessage } from "@spira/shared";
import type { WsServer } from "./server.js";

export class WsTransport implements ITransport {
  constructor(private readonly server: WsServer) {}

  send(message: ServerMessage): void {
    this.server.send(message);
  }

  onMessage(handler: (message: ClientMessage) => void): () => void {
    return this.server.onMessage(handler);
  }

  close(): void {
    this.server.stop();
  }
}
