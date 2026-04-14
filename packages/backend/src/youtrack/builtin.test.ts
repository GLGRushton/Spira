import { describe, expect, it } from "vitest";
import {
  YOUTRACK_BUILTIN_DOMAIN_ID,
  YOUTRACK_BUILTIN_SERVER_ID,
  buildYouTrackBuiltinMcpServers,
  buildYouTrackBuiltinSubagents,
  hasYouTrackCredentials,
} from "./builtin.js";

describe("hasYouTrackCredentials", () => {
  it("returns true only when both the base URL and token are configured", () => {
    expect(
      hasYouTrackCredentials({
        YOUTRACK_BASE_URL: "https://example.youtrack.cloud",
        YOUTRACK_TOKEN: "secret",
      } as never),
    ).toBe(true);
    expect(
      hasYouTrackCredentials({
        YOUTRACK_BASE_URL: "https://example.youtrack.cloud",
        YOUTRACK_TOKEN: "",
      } as never),
    ).toBe(false);
    expect(
      hasYouTrackCredentials({
        YOUTRACK_BASE_URL: "",
        YOUTRACK_TOKEN: "secret",
      } as never),
    ).toBe(false);
  });
});

describe("buildYouTrackBuiltinMcpServers", () => {
  it("returns no built-in MCP server when YouTrack credentials are missing", () => {
    expect(buildYouTrackBuiltinMcpServers({} as never)).toEqual([]);
  });

  it("returns the built-in MCP server config when YouTrack credentials are present", () => {
    expect(
      buildYouTrackBuiltinMcpServers({
        YOUTRACK_BASE_URL: "https://example.youtrack.cloud",
        YOUTRACK_TOKEN: "secret",
      } as never),
    ).toEqual([
      expect.objectContaining({
        id: YOUTRACK_BUILTIN_SERVER_ID,
        name: "YouTrack",
        transport: "streamable-http",
        url: "https://example.youtrack.cloud/mcp",
        headers: {
          Authorization: "Bearer secret",
        },
        source: "builtin",
        enabled: true,
        autoRestart: false,
      }),
    ]);
  });
});

describe("buildYouTrackBuiltinSubagents", () => {
  it("returns no built-in subagent domain when YouTrack credentials are missing", () => {
    expect(buildYouTrackBuiltinSubagents({} as never)).toEqual([]);
  });

  it("returns the built-in YouTrack subagent domain when YouTrack credentials are present", () => {
    expect(
      buildYouTrackBuiltinSubagents({
        YOUTRACK_BASE_URL: "https://example.youtrack.cloud",
        YOUTRACK_TOKEN: "secret",
      } as never),
    ).toEqual([
      expect.objectContaining({
        id: YOUTRACK_BUILTIN_DOMAIN_ID,
        delegationToolName: "delegate_to_youtrack",
        serverIds: [YOUTRACK_BUILTIN_SERVER_ID],
        allowWrites: true,
        source: "builtin",
      }),
    ]);
  });
});
