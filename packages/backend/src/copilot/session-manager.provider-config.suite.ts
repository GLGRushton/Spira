import { describe, expect, it, vi } from "vitest";
import { createManager } from "./session-manager.test-support.js";
import type { SessionManagerInternals } from "./session-manager.test-support.js";

describe("StationSessionManager", () => {
  it("omits duplicated host tools when using the copilot provider", () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "copilot" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const toolNames = internals
      .getSessionConfig(undefined, {
        providerId: "copilot",
        capabilities: {
          persistentSessions: true,
          abortableTurns: true,
          sessionResumption: "provider-managed",
          turnCancellation: "provider-abort",
          responseStreaming: "native",
          usageReporting: "full",
          toolManifestMode: "projected",
          modelSelection: "session-scoped",
          toolCalling: "native",
        },
      })
      .tools.map((tool) => tool.name);

    expect(toolNames).not.toContain("view");
    expect(toolNames).not.toContain("glob");
    expect(toolNames).not.toContain("rg");
  });

  it("keeps host tools for the azure-openai provider", () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const toolNames = internals
      .getSessionConfig(undefined, {
        providerId: "azure-openai",
        capabilities: {
          persistentSessions: false,
          abortableTurns: true,
          sessionResumption: "host-managed",
          turnCancellation: "provider-abort",
          responseStreaming: "native",
          usageReporting: "partial",
          toolManifestMode: "literal",
          modelSelection: "provider-default",
          toolCalling: "native",
        },
      })
      .tools.map((tool) => tool.name);

    expect(toolNames).toEqual(expect.arrayContaining(["view", "glob", "rg"]));
  });

  it("includes the requested station model in the session config", () => {
    const manager = createManager([], {
      requestedModel: "gpt-5.5",
    });
    const internals = manager as unknown as SessionManagerInternals & { getSessionConfig(): { model?: string } };

    expect(internals.getSessionConfig()).toMatchObject({
      model: "gpt-5.5",
    });
  });

  it("recreates the session and retries when the SDK reports Session not found", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const staleSession = {
      sessionId: "stale-session",
      send: vi
        .fn()
        .mockRejectedValue(new Error("Request session.send failed with message: Session not found: stale-session")),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const freshSession = {
      sessionId: "fresh-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.session = staleSession;
    const getOrCreateSessionSpy = vi
      .spyOn(manager as unknown as { getOrCreateSession: () => Promise<typeof staleSession> }, "getOrCreateSession")
      .mockResolvedValueOnce(staleSession)
      .mockResolvedValueOnce(freshSession);

    await expect(manager.sendMessage("hello")).resolves.toBeUndefined();

    expect(staleSession.send).toHaveBeenCalledTimes(1);
    expect(staleSession.disconnect).toHaveBeenCalledTimes(1);
    expect(freshSession.send).toHaveBeenCalledTimes(1);
    expect(getOrCreateSessionSpy).toHaveBeenCalledTimes(2);
  });

  it("applies the requested model before sending a station prompt", async () => {
    const manager = createManager([], {
      requestedModel: "gpt-5.5",
    });
    const session = {
      sessionId: "model-session",
      send: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Use the requested model")).resolves.toBeUndefined();

    expect(session.setModel).toHaveBeenCalledWith("gpt-5.5");
    expect(session.setModel.mock.invocationCallOrder[0]).toBeLessThan(session.send.mock.invocationCallOrder[0] ?? 0);
  });
});
