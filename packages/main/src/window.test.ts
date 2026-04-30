import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDevelopmentBootstrapUrl, loadDevelopmentRenderer, loadUrlWithTimeout } from "./window.js";

type FakeWindow = {
  readonly loadURL: ReturnType<typeof vi.fn>;
  readonly show: ReturnType<typeof vi.fn>;
  readonly isVisible: ReturnType<typeof vi.fn>;
  readonly isDestroyed: ReturnType<typeof vi.fn>;
  readonly webContents: {
    readonly stop: ReturnType<typeof vi.fn>;
  };
};

const createFakeWindow = (
  loadURL: ReturnType<typeof vi.fn<(url: string) => Promise<void>>>,
  visible = false,
): FakeWindow => ({
  loadURL,
  show: vi.fn(() => undefined),
  isVisible: vi.fn(() => visible),
  isDestroyed: vi.fn(() => false),
  webContents: {
    stop: vi.fn(() => undefined),
  },
});

describe("window bootstrap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates a data URL bootstrap page", () => {
    expect(createDevelopmentBootstrapUrl("Loading Spira...", "Details")).toContain("data:text/html");
  });

  it("times out hung navigations and stops the current load", async () => {
    const window = createFakeWindow(vi.fn(() => new Promise<void>(() => undefined)));
    const result = loadUrlWithTimeout(window, "http://127.0.0.1:5173", 5_000).then(
      () => null,
      (error) => error,
    );

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toEqual(new Error("Timed out loading http://127.0.0.1:5173 after 5000ms."));
    expect(window.webContents.stop).toHaveBeenCalledTimes(1);
  });

  it("shows the bootstrap page and retries until the dev renderer loads", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const loadURL = vi.fn<(url: string) => Promise<void>>().mockImplementation(async (url) => {
      if (url.startsWith("data:text/html")) {
        return;
      }

      if (loadURL.mock.calls.filter(([value]) => value === "http://127.0.0.1:5173").length === 1) {
        throw new Error("Renderer not ready yet.");
      }
    });
    const window = createFakeWindow(loadURL);

    const promise = loadDevelopmentRenderer(window);
    await vi.runAllTimersAsync();
    await promise;

    expect(window.show).toHaveBeenCalledTimes(2);
    expect(loadURL.mock.calls.map(([url]) => url)).toEqual([
      expect.stringContaining("data:text/html"),
      "http://127.0.0.1:5173",
      expect.stringContaining("data:text/html"),
      "http://127.0.0.1:5173",
    ]);
  });
});
