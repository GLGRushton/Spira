import type { SubagentDomain } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../util/errors.js";
import { SpiraEventBus } from "../util/event-bus.js";
import { SubagentRegistry, filterManagedBuiltinDomains, mergeBuiltinDomains } from "./registry.js";

const youTrackDomain: SubagentDomain = {
  id: "youtrack",
  label: "YouTrack Agent",
  description: "Built-in YouTrack delegation.",
  serverIds: ["youtrack"],
  allowedToolNames: null,
  delegationToolName: "delegate_to_youtrack",
  allowWrites: false,
  systemPrompt: "",
  ready: true,
  source: "builtin",
};

describe("mergeBuiltinDomains", () => {
  it("adds dynamic builtin domains alongside the static catalog", () => {
    expect(mergeBuiltinDomains([], [youTrackDomain])).toEqual([youTrackDomain]);
  });
});

describe("filterManagedBuiltinDomains", () => {
  it("removes stale managed domains when they are not currently active", () => {
    expect(filterManagedBuiltinDomains([youTrackDomain], [], ["youtrack"])).toEqual([]);
  });

  it("keeps active managed domains", () => {
    expect(filterManagedBuiltinDomains([youTrackDomain], ["youtrack"], ["youtrack"])).toEqual([youTrackDomain]);
  });
});

describe("SubagentRegistry", () => {
  it("reserves managed dynamic builtin ids for future activation", () => {
    const registry = new SubagentRegistry(
      new SpiraEventBus(),
      {
        upsertSubagentConfig: () => {
          throw new Error("not reached");
        },
        listSubagentConfigs: () => [],
      } as never,
      [],
      ["youtrack"],
    );

    expect(() =>
      registry.createCustom({
        id: "youtrack",
        label: "YouTrack",
        description: "Shadow built-in",
        serverIds: ["custom"],
        allowedToolNames: null,
        allowWrites: false,
        systemPrompt: "",
      }),
    ).toThrowError(ConfigError);
  });
});
