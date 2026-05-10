import { describe, expect, it } from "vitest";
import { runWorkSessionPreflight } from "./work-session-preflight.js";

describe("runWorkSessionPreflight (Phase 7.3)", () => {
  it("passes when node + node_modules present and port is free", async () => {
    const result = await runWorkSessionPreflight({
      workspaceRoot: "C:\\Repos\\Spira",
      devServerPort: 9720,
      hooks: {
        binaryAvailable: async () => true,
        pathExists: async () => true,
        portInUse: async () => false,
      },
    });
    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("flags missing node binary", async () => {
    const result = await runWorkSessionPreflight({
      workspaceRoot: "C:\\Repos\\Spira",
      hooks: {
        binaryAvailable: async (binary) => binary !== "node",
        pathExists: async () => true,
      },
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.id === "binary-missing:node")).toBe(true);
  });

  it("flags missing node_modules", async () => {
    const result = await runWorkSessionPreflight({
      workspaceRoot: "C:\\Repos\\Spira",
      hooks: {
        binaryAvailable: async () => true,
        pathExists: async () => false,
      },
    });
    expect(result.blockers.some((b) => b.id === "deps-not-installed")).toBe(true);
  });

  it("flags port-in-use when devServerPort is supplied", async () => {
    const result = await runWorkSessionPreflight({
      workspaceRoot: "C:\\Repos\\Spira",
      devServerPort: 9720,
      hooks: {
        binaryAvailable: async () => true,
        pathExists: async () => true,
        portInUse: async () => true,
      },
    });
    expect(result.blockers.some((b) => b.id === "port-in-use:9720")).toBe(true);
  });

  it("treats an inconclusive port probe as a warning, not a blocker", async () => {
    const result = await runWorkSessionPreflight({
      workspaceRoot: "C:\\Repos\\Spira",
      devServerPort: 9720,
      hooks: {
        binaryAvailable: async () => true,
        pathExists: async () => true,
        portInUse: async () => null,
      },
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.id === "port-probe-inconclusive:9720")).toBe(true);
  });

  it("skips workspace + port checks when not provided", async () => {
    const result = await runWorkSessionPreflight({
      workspaceRoot: null,
      hooks: {
        binaryAvailable: async () => true,
      },
    });
    expect(result.ok).toBe(true);
  });

  it("summary string lists blocker messages when not ok", async () => {
    const result = await runWorkSessionPreflight({
      workspaceRoot: "C:\\Repos\\Spira",
      hooks: {
        binaryAvailable: async () => false,
        pathExists: async () => false,
      },
    });
    expect(result.summary).toMatch(/node was not found on PATH/);
    expect(result.summary).toMatch(/node_modules is missing/);
  });
});
