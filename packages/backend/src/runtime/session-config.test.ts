import { parseEnv } from "@spira/shared";
import { describe, expect, it } from "vitest";
import {
  buildOutgoingPrompt,
  createSessionConfig,
  getToolAwarenessInstructions,
  getUpgradeToolInstructions,
} from "./session-config.js";

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
    expect(instructions).toContain("delegate_to_data_entry");
    expect(instructions).toContain("delegate_to_code_review");
    expect(instructions).toContain("read_subagent");
  });

  it("steers model-sensitive review work away from background task agents", () => {
    const instructions = getToolAwarenessInstructions(parseEnv({ SPIRA_SUBAGENTS_ENABLED: "true" }), {
      getTools: () => [],
    } as never);

    expect(instructions).toContain("prefer the matching delegate_to_* tool over built-in task/background agents");
    expect(instructions).toContain("including the observed model");
    expect(instructions).toContain("prefer delegate_to_code_review over built-in task/background agents");
    expect(instructions).toContain("instead of relying on read_agent");
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
    expect(getUpgradeToolInstructions({})).toBe("");
    expect(getUpgradeToolInstructions({ requestUpgradeProposal: async () => undefined }, "openai-escalation")).toBe("");
    expect(getUpgradeToolInstructions({ requestUpgradeProposal: async () => undefined }, "openai")).toContain(
      "spira_propose_upgrade",
    );
    expect(getUpgradeToolInstructions({ requestUpgradeProposal: async () => undefined }, "openai")).toContain(
      "Do not use it to ask for model escalation",
    );
  });

  it("warns that requested background-agent models are not confirmed until the runtime reports them", () => {
    const config = createSessionConfig({
      env: parseEnv({}),
      toolAggregator: {
        getTools: () => [],
      } as never,
      toolBridgeOptions: {},
      onEvent: () => undefined,
      onPermissionRequest: async () => ({ kind: "approve-once" }),
    });

    expect(config.systemMessage.sections?.custom_instructions?.content).toContain(
      "Do not claim a specific background-agent model actually ran unless a returned tool result explicitly confirms it.",
    );
  });

  it("steers file edits toward apply_patch and away from partial write_file overwrites", () => {
    const config = createSessionConfig({
      env: parseEnv({}),
      toolAggregator: {
        getTools: () => [],
      } as never,
      toolBridgeOptions: {},
      onEvent: () => undefined,
      onPermissionRequest: async () => ({ kind: "approve-once" }),
    });

    expect(config.systemMessage.sections?.custom_instructions?.content).toContain(
      "use apply_patch for targeted edits to existing files",
    );
    expect(config.systemMessage.sections?.custom_instructions?.content).toContain(
      "Do not use write_file for partial edits to an existing file.",
    );
    expect(config.systemMessage.sections?.custom_instructions?.content).toContain("overwriteExisting: true");
  });
});
