import type { Env } from "@spira/shared";
import type { Logger } from "pino";
import { ClaudeAgentProviderClient } from "./adapter.js";

export type ClaudeAgentAuthStrategy = "claude-subscription";

export const createClaudeAgentProviderClient = async (
  env: Env,
  logger: Pick<Logger, "info" | "warn">,
): Promise<{ client: ClaudeAgentProviderClient; strategy: ClaudeAgentAuthStrategy }> => {
  const defaultModel = env.CLAUDE_AGENT_MODEL?.trim() || null;
  logger.info(
    {
      providerId: "claude-agent",
      strategy: "claude-subscription",
      ...(defaultModel ? { defaultModel } : {}),
    },
    "Using Claude Agent SDK with subscription authentication",
  );
  return {
    client: new ClaudeAgentProviderClient(defaultModel, logger),
    strategy: "claude-subscription",
  };
};
