import { parseEnv } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { buildOutgoingPrompt, getToolAwarenessInstructions, getUpgradeToolInstructions } from "./session-config.js";

describe("session-config", () => {
  it("prepends continuity only for newly created sessions", () => {
    const text = "Fix the build.";
    const continuityPreamble = "Continue where we left off.";

    expect(buildOutgoingPrompt(text, continuityPreamble, false, "created")).toContain(continuityPreamble);
    expect(buildOutgoingPrompt(text, continuityPreamble, true, "created")).toBe(text);
    expect(buildOutgoingPrompt(text, continuityPreamble, false, "resumed")).toBe(text);
  });

  it("advertises delegated tooling when subagents are enabled", () => {
    const instructions = getToolAwarenessInstructions(parseEnv({ SPIRA_SUBAGENTS_ENABLED: "true" }), {
      getTools: () => [],
    } as never);

    expect(instructions).toContain("delegate_to_windows");
    expect(instructions).toContain("read_subagent");
  });

  it("lists vision tools when subagents are disabled", () => {
    const instructions = getToolAwarenessInstructions(parseEnv({}), {
      getTools: () => [
        {
          serverId: "vision",
          serverName: "Vision",
          name: "vision_read_screen",
          description: "Reads the screen.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
      ],
    } as never);

    expect(instructions).toContain("vision_read_screen");
    expect(instructions).toContain("Reads the screen.");
  });

  it("advertises spira_propose_upgrade only when upgrade proposals are available", () => {
    expect(getUpgradeToolInstructions()).toBe("");
    expect(getUpgradeToolInstructions(async () => undefined)).toContain("spira_propose_upgrade");
  });
});
