import type { McpTool } from "@spira/shared";
import { describe, expect, it } from "vitest";
import {
  SUBAGENT_DOMAINS,
  getDelegatedServerIds,
  getDomainTools,
  getSubagentDomain,
  getSubagentDomainForServer,
} from "./domain-registry.js";

const createTool = (serverId: string, name: string): McpTool => ({
  serverId,
  serverName: serverId,
  name,
  description: `${name} description`,
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
});

describe("domain registry", () => {
  it("defines the expected initial domains", () => {
    expect(SUBAGENT_DOMAINS.map((domain) => domain.id)).toEqual(["windows", "spira", "nexus", "data-entry"]);
  });

  it("finds a domain by id and server id", () => {
    expect(getSubagentDomain("windows")?.delegationToolName).toBe("delegate_to_windows");
    expect(getSubagentDomainForServer("spira-ui")?.id).toBe("spira");
    expect(getSubagentDomainForServer("spira-data-entry")?.id).toBe("data-entry");
    expect(getSubagentDomainForServer("unknown-server")).toBeUndefined();
  });

  it("returns delegated server ids without duplicates", () => {
    expect(getDelegatedServerIds().sort()).toEqual([
      "nexus-mods",
      "spira-data-entry",
      "spira-ui",
      "vision",
      "windows-system",
      "windows-ui",
    ]);
  });

  it("filters tools for a domain", () => {
    const tools = [
      createTool("windows-system", "system_get_volume"),
      createTool("vision", "vision_read_screen"),
      createTool("spira-ui", "spira_ui_get_snapshot"),
      createTool("spira-data-entry", "spira_data_entry_create_mcp_server"),
      createTool("memories", "spira_memory_list_entries"),
    ];

    expect(getDomainTools("windows", tools).map((tool) => tool.name)).toEqual([
      "system_get_volume",
      "vision_read_screen",
    ]);
    expect(getDomainTools("data-entry", tools).map((tool) => tool.name)).toEqual([
      "spira_data_entry_create_mcp_server",
    ]);
    expect(getDomainTools("nexus", tools)).toEqual([]);
  });
});
