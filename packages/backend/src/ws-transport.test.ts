import type { ClientMessage, ServerMessage } from "@spira/shared";
import { describe, expect, it, vi } from "vitest";
import { WsTransport } from "./ws-transport.js";

describe("WsTransport", () => {
  it("delegates send, subscribe, and close to the websocket server", () => {
    const unsubscribe = vi.fn();
    const onMessage = vi.fn((_handler: (message: ClientMessage) => void) => unsubscribe);
    const send = vi.fn((_message: ServerMessage) => {});
    const stop = vi.fn();
    const server = { onMessage, send, stop };
    const transport = new WsTransport(server as never);
    const handler = vi.fn();
    const message = { type: "state:change", state: "idle" } as const satisfies ServerMessage;

    expect(transport.onMessage(handler)).toBe(unsubscribe);

    transport.send(message);
    transport.close();

    expect(onMessage).toHaveBeenCalledWith(handler);
    expect(send).toHaveBeenCalledWith(message);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
