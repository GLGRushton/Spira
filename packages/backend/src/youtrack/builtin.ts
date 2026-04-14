import type { Env, McpServerConfig, SubagentDomain } from "@spira/shared";

export const YOUTRACK_BUILTIN_SERVER_ID = "youtrack";
export const YOUTRACK_BUILTIN_DOMAIN_ID = "youtrack";
export const MANAGED_YOUTRACK_BUILTIN_SERVER_IDS = [YOUTRACK_BUILTIN_SERVER_ID] as const;
export const MANAGED_YOUTRACK_BUILTIN_DOMAIN_IDS = [YOUTRACK_BUILTIN_DOMAIN_ID] as const;

export const hasYouTrackCredentials = (env: Env): boolean =>
  Boolean(env.YOUTRACK_BASE_URL?.trim() && env.YOUTRACK_TOKEN?.trim());

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.trim().replace(/\/+$/, "");

const isLocalHostname = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";

const validateBaseUrl = (baseUrl: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch (error) {
    throw new Error(
      `YouTrack base URL must be a valid absolute URL. ${error instanceof Error ? error.message : ""}`.trim(),
    );
  }

  if (parsed.protocol === "https:") {
    return normalizeBaseUrl(parsed.toString());
  }

  if (parsed.protocol === "http:" && isLocalHostname(parsed.hostname)) {
    return normalizeBaseUrl(parsed.toString());
  }

  throw new Error("YouTrack base URL must use https:// unless it points to localhost.");
};

export const buildYouTrackBuiltinMcpServers = (env: Env): McpServerConfig[] =>
  hasYouTrackCredentials(env)
    ? [
        {
          id: YOUTRACK_BUILTIN_SERVER_ID,
          name: "YouTrack",
          description: "First-class YouTrack tools for assigned ticket intake, issue lookup, and project search.",
          transport: "streamable-http",
          url: `${validateBaseUrl(env.YOUTRACK_BASE_URL ?? "")}/mcp`,
          headers: {
            Authorization: `Bearer ${env.YOUTRACK_TOKEN?.trim() ?? ""}`,
          },
          enabled: true,
          autoRestart: false,
          maxRestarts: 3,
          source: "builtin",
        },
      ]
    : [];

export const buildYouTrackBuiltinSubagents = (env: Env): SubagentDomain[] =>
  hasYouTrackCredentials(env)
    ? [
        {
          id: YOUTRACK_BUILTIN_DOMAIN_ID,
          label: "YouTrack Agent",
          description:
            "Handles YouTrack ticket lookup, project discovery, and intake research for the Missions workflow.",
          serverIds: [YOUTRACK_BUILTIN_SERVER_ID],
          allowedToolNames: null,
          delegationToolName: "delegate_to_youtrack",
          allowWrites: true,
          systemPrompt:
            "Focus on YouTrack issue triage, project discovery, and ticket context gathering. Use only the YouTrack tool surface unless the caller explicitly asks for broader coordination.",
          ready: true,
          source: "builtin",
        },
      ]
    : [];
