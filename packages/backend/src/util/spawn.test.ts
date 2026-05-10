import { describe, expect, it } from "vitest";
import { binaryAvailable, spawnWithTimeout } from "./spawn.js";

describe("spawnWithTimeout", () => {
  it("captures exit code 0 for a fast successful invocation", async () => {
    const isWin = process.platform === "win32";
    const result = isWin
      ? await spawnWithTimeout("cmd.exe", ["/c", "exit 0"], { timeoutMs: 5_000 })
      : await spawnWithTimeout("true", [], { timeoutMs: 5_000 });
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it("captures non-zero exit code", async () => {
    const isWin = process.platform === "win32";
    const result = isWin
      ? await spawnWithTimeout("cmd.exe", ["/c", "exit 7"], { timeoutMs: 5_000 })
      : await spawnWithTimeout("sh", ["-c", "exit 7"], { timeoutMs: 5_000 });
    expect(result.exitCode).toBe(7);
    expect(result.timedOut).toBe(false);
  });

  it("returns exitCode null and a stderrTail when the binary cannot be spawned", async () => {
    const result = await spawnWithTimeout("__definitely-not-a-binary__", [], { timeoutMs: 1_000 });
    expect(result.exitCode).toBeNull();
    expect(result.stderrTail.length).toBeGreaterThan(0);
  });
});

describe("binaryAvailable", () => {
  it("returns true for an obviously-installed binary (node)", async () => {
    expect(await binaryAvailable("node", { timeoutMs: 5_000 })).toBe(true);
  });

  it("returns false for a missing binary", async () => {
    expect(await binaryAvailable("__not-a-binary__", { timeoutMs: 1_000 })).toBe(false);
  });
});
