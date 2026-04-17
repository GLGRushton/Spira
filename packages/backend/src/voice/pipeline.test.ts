import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpiraEventBus } from "../util/event-bus.js";
import { VoicePipeline } from "./pipeline.js";

class FakeAudioCapture {
  sampleRate = 16_000;
  frameLength = 4;
  private handler: ((frame: Int16Array) => void) | null = null;
  readonly start = vi.fn();
  readonly stop = vi.fn();

  onFrame(handler: (frame: Int16Array) => void): () => void {
    this.handler = handler;
    return () => {
      this.handler = null;
    };
  }

  emitFrame(frame: Int16Array): void {
    this.handler?.(frame);
  }

  isSilent(frame: Int16Array): boolean {
    return frame.every((sample) => sample === 0);
  }
}

class FakeWakeWordProvider {
  frameLength = 4;
  sampleRate = 16_000;
  providerName = "fake";
  requiresExactFrameLength = false;
  private detections: boolean[] = [];
  readonly initialize = vi.fn(async () => {});
  readonly dispose = vi.fn();

  queueDetections(...detections: boolean[]): void {
    this.detections = detections;
  }

  processFrame(): boolean {
    return this.detections.shift() ?? false;
  }
}

class FakeSttProvider {
  transcript = "Acknowledged";
  readonly dispose = vi.fn();
  readonly transcribe = vi.fn(async () => this.transcript);
}

const createLogger = () =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }) as never;

const advanceTime = (ms: number) => {
  vi.setSystemTime(Date.now() + ms);
};

const flushMicrotasks = async (cycles = 3) => {
  for (let index = 0; index < cycles; index += 1) {
    await Promise.resolve();
  }
};

describe("VoicePipeline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects speech after a wake word and emits the transcript", async () => {
    const capture = new FakeAudioCapture();
    const wakeWord = new FakeWakeWordProvider();
    const stt = new FakeSttProvider();
    const bus = new SpiraEventBus();
    const states: string[] = [];
    const transcripts: string[] = [];

    bus.on("voice:pipeline", ({ state }) => {
      states.push(state);
    });
    bus.on("voice:transcript", ({ text }) => {
      transcripts.push(text);
    });

    wakeWord.queueDetections(true);

    const pipeline = new VoicePipeline(capture as never, wakeWord as never, stt as never, bus, createLogger());
    await pipeline.start();

    capture.emitFrame(new Int16Array([1, 1, 1, 1]));
    advanceTime(100);
    capture.emitFrame(new Int16Array([4_000, 4_000, 4_000, 4_000]));
    advanceTime(1_700);
    capture.emitFrame(new Int16Array([0, 0, 0, 0]));
    await stt.transcribe.mock.results[0]?.value;
    await flushMicrotasks();

    expect(states).toEqual(["idle", "listening", "transcribing", "thinking"]);
    expect(transcripts).toEqual(["Acknowledged"]);
    expect(stt.transcribe).toHaveBeenCalledTimes(1);
  });

  it("resets to idle when muted during listening", async () => {
    const capture = new FakeAudioCapture();
    const wakeWord = new FakeWakeWordProvider();
    const stt = new FakeSttProvider();
    const bus = new SpiraEventBus();
    const states: string[] = [];
    const mutedStates: boolean[] = [];

    bus.on("voice:pipeline", ({ state }) => {
      states.push(state);
    });
    bus.on("voice:muted", ({ muted }) => {
      mutedStates.push(muted);
    });

    const pipeline = new VoicePipeline(capture as never, wakeWord as never, stt as never, bus, createLogger());
    await pipeline.start();

    pipeline.activatePushToTalk();
    pipeline.setMuted(true);

    expect(states).toEqual(["idle", "listening", "idle"]);
    expect(mutedStates).toEqual([false, true]);
    expect(pipeline.isMuted()).toBe(true);
  });

  it("throttles audio level events while listening", async () => {
    const capture = new FakeAudioCapture();
    const wakeWord = new FakeWakeWordProvider();
    const stt = new FakeSttProvider();
    const bus = new SpiraEventBus();
    const levels: number[] = [];

    bus.on("audio:level", ({ level }) => {
      levels.push(level);
    });

    const pipeline = new VoicePipeline(capture as never, wakeWord as never, stt as never, bus, createLogger());
    await pipeline.start();

    pipeline.activatePushToTalk();
    capture.emitFrame(new Int16Array([2_000, 2_000, 2_000, 2_000]));
    advanceTime(50);
    capture.emitFrame(new Int16Array([2_500, 2_500, 2_500, 2_500]));
    advanceTime(49);
    capture.emitFrame(new Int16Array([3_000, 3_000, 3_000, 3_000]));
    advanceTime(1);
    capture.emitFrame(new Int16Array([3_500, 3_500, 3_500, 3_500]));

    expect(levels).toHaveLength(2);
  });

  it("returns to idle after Copilot finishes responding", async () => {
    const capture = new FakeAudioCapture();
    const wakeWord = new FakeWakeWordProvider();
    const stt = new FakeSttProvider();
    const bus = new SpiraEventBus();
    const states: string[] = [];

    bus.on("voice:pipeline", ({ state }) => {
      states.push(state);
    });

    wakeWord.queueDetections(true);

    const pipeline = new VoicePipeline(capture as never, wakeWord as never, stt as never, bus, createLogger());
    await pipeline.start();

    capture.emitFrame(new Int16Array([1, 1, 1, 1]));
    advanceTime(100);
    capture.emitFrame(new Int16Array([5_000, 5_000, 5_000, 5_000]));
    advanceTime(1_700);
    capture.emitFrame(new Int16Array([0, 0, 0, 0]));
    await stt.transcribe.mock.results[0]?.value;
    await flushMicrotasks();

    bus.emit("copilot:response-end", { text: "Done", messageId: "assistant-1", timestamp: Date.now() });
    await flushMicrotasks();

    expect(states.at(-1)).toBe("idle");
  });

  it("waits for Copilot to become idle before recovering after a response", async () => {
    const capture = new FakeAudioCapture();
    const wakeWord = new FakeWakeWordProvider();
    const stt = new FakeSttProvider();
    const bus = new SpiraEventBus();
    const states: string[] = [];

    bus.on("voice:pipeline", ({ state }) => {
      states.push(state);
    });

    wakeWord.queueDetections(true);

    const pipeline = new VoicePipeline(capture as never, wakeWord as never, stt as never, bus, createLogger());
    await pipeline.start();

    capture.emitFrame(new Int16Array([1, 1, 1, 1]));
    advanceTime(100);
    capture.emitFrame(new Int16Array([5_000, 5_000, 5_000, 5_000]));
    advanceTime(1_700);
    capture.emitFrame(new Int16Array([0, 0, 0, 0]));
    await stt.transcribe.mock.results[0]?.value;
    await flushMicrotasks();

    bus.emit("copilot:state", "speaking");
    bus.emit("copilot:response-end", { text: "Done", messageId: "assistant-2", timestamp: Date.now() });
    await flushMicrotasks();

    expect(states.at(-1)).toBe("thinking");

    bus.emit("copilot:state", "idle");
    await flushMicrotasks();

    expect(states.at(-1)).toBe("idle");
  });
});
