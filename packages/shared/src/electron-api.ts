import type { AssistantState } from "./assistant-state.js";
import type { ClientMessage, ServerMessage } from "./protocol.js";

export interface ElectronApi {
  send(message: ClientMessage): void;
  onMessage(handler: (message: ServerMessage) => void): () => void;
  onStateChange(handler: (state: AssistantState) => void): () => void;
}
