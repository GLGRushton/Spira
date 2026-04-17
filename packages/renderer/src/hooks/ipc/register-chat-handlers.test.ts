import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatDeltaBatcher } from "./register-chat-handlers.js";

describe("createChatDeltaBatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("coalesces token deltas per station and conversation before flushing", () => {
    const actions = {
      appendDelta: vi.fn(),
      markStationActivity: vi.fn(),
    };
    const batcher = createChatDeltaBatcher(actions);

    batcher.enqueue("assistant-1", "Hel", "primary");
    batcher.enqueue("assistant-1", "lo", "primary");
    batcher.enqueue("assistant-2", "Ops", "primary");
    batcher.enqueue("assistant-1", "Ready", "bravo");

    expect(actions.appendDelta).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);

    expect(actions.appendDelta).toHaveBeenCalledTimes(3);
    expect(actions.appendDelta).toHaveBeenNthCalledWith(1, "assistant-1", "Hello", "primary");
    expect(actions.appendDelta).toHaveBeenNthCalledWith(2, "assistant-2", "Ops", "primary");
    expect(actions.appendDelta).toHaveBeenNthCalledWith(3, "assistant-1", "Ready", "bravo");
    expect(actions.markStationActivity).toHaveBeenCalledTimes(2);
    expect(actions.markStationActivity).toHaveBeenNthCalledWith(1, "primary");
    expect(actions.markStationActivity).toHaveBeenNthCalledWith(2, "bravo");
  });

  it("flushes a conversation immediately without replaying it on the scheduled timer", () => {
    const actions = {
      appendDelta: vi.fn(),
      markStationActivity: vi.fn(),
    };
    const batcher = createChatDeltaBatcher(actions);

    batcher.enqueue("assistant-1", "Partial", "primary");
    batcher.enqueue("assistant-2", "Queued", "primary");

    batcher.flushConversation("assistant-1", "primary");

    expect(actions.appendDelta).toHaveBeenCalledTimes(1);
    expect(actions.appendDelta).toHaveBeenCalledWith("assistant-1", "Partial", "primary");
    expect(actions.markStationActivity).toHaveBeenCalledTimes(1);
    expect(actions.markStationActivity).toHaveBeenCalledWith("primary");

    vi.advanceTimersByTime(16);

    expect(actions.appendDelta).toHaveBeenCalledTimes(2);
    expect(actions.appendDelta).toHaveBeenLastCalledWith("assistant-2", "Queued", "primary");
    expect(actions.markStationActivity).toHaveBeenCalledTimes(2);
  });

  it("drops superseded deltas so a final message does not get duplicated", () => {
    const actions = {
      appendDelta: vi.fn(),
      markStationActivity: vi.fn(),
    };
    const batcher = createChatDeltaBatcher(actions);

    batcher.enqueue("assistant-1", "Superseded", "primary");
    batcher.dropConversation("assistant-1", "primary");

    vi.advanceTimersByTime(16);

    expect(actions.appendDelta).not.toHaveBeenCalled();
    expect(actions.markStationActivity).not.toHaveBeenCalled();
  });

  it("flushes only the requested station when preserving trailing partial output", () => {
    const actions = {
      appendDelta: vi.fn(),
      markStationActivity: vi.fn(),
    };
    const batcher = createChatDeltaBatcher(actions);

    batcher.enqueue("assistant-1", "Alpha", "primary");
    batcher.enqueue("assistant-2", "Bravo", "secondary");

    batcher.flushStation("primary");

    expect(actions.appendDelta).toHaveBeenCalledTimes(1);
    expect(actions.appendDelta).toHaveBeenCalledWith("assistant-1", "Alpha", "primary");
    expect(actions.markStationActivity).toHaveBeenCalledTimes(1);
    expect(actions.markStationActivity).toHaveBeenCalledWith("primary");

    vi.advanceTimersByTime(16);

    expect(actions.appendDelta).toHaveBeenCalledTimes(2);
    expect(actions.appendDelta).toHaveBeenLastCalledWith("assistant-2", "Bravo", "secondary");
    expect(actions.markStationActivity).toHaveBeenCalledTimes(2);
    expect(actions.markStationActivity).toHaveBeenLastCalledWith("secondary");
  });
});
