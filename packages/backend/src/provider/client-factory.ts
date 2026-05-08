import { randomUUID } from "node:crypto";
import type { Env } from "@spira/shared";
import type { Logger } from "pino";
import { ProviderError } from "../util/errors.js";
import { setUnrefTimeout } from "../util/timers.js";
import { type AzureOpenAiAuthStrategy, createAzureOpenAiProviderClient } from "./azure-openai/client-factory.js";
import { type ClaudeAgentAuthStrategy, createClaudeAgentProviderClient } from "./claude-agent/client-factory.js";
import { type CopilotAuthStrategy, createCopilotProviderClient } from "./copilot/client-factory.js";
import { type OpenAiAuthStrategy, createOpenAiProviderClient } from "./openai/client-factory.js";
import { getConfiguredProviderId } from "./provider-config.js";
import type { ProviderClient, ProviderId, ProviderSession, ProviderSessionConfig } from "./types.js";

export type ProviderAuthStrategy =
  | CopilotAuthStrategy
  | AzureOpenAiAuthStrategy
  | OpenAiAuthStrategy
  | ClaudeAgentAuthStrategy;

export const createProviderClient = async (
  env: Env,
  logger: Pick<Logger, "info" | "warn">,
): Promise<{ client: ProviderClient; strategy: ProviderAuthStrategy }> => {
  return createProviderClientForProvider(env, getConfiguredProviderId(env), logger);
};

export const createProviderClientForProvider = async (
  env: Env,
  providerId: ProviderId,
  logger: Pick<Logger, "info" | "warn">,
): Promise<{ client: ProviderClient; strategy: ProviderAuthStrategy }> => {
  switch (providerId) {
    case "azure-openai":
    case "azure-openai-escalation":
      return createAzureOpenAiProviderClient(env, logger, providerId);
    case "openai":
    case "openai-escalation":
      return createOpenAiProviderClient(env, logger, providerId);
    case "claude-agent":
      return createClaudeAgentProviderClient(env, logger);
    default:
      return createCopilotProviderClient(env, logger);
  }
};

export const stopProviderClient = async (client: ProviderClient, logger: Pick<Logger, "warn">): Promise<void> => {
  try {
    const stopErrors = await client.stop();
    if (stopErrors.length > 0) {
      logger.warn({ stopErrors, providerId: client.providerId }, "Provider client stopped with cleanup errors");
    }
  } catch (error) {
    logger.warn({ error, providerId: client.providerId }, "Failed to stop provider client cleanly");
  }
};

export const createFreshProviderSession = (
  client: ProviderClient,
  sessionConfig: Omit<ProviderSessionConfig, "sessionId">,
  sessionId = randomUUID(),
): Promise<ProviderSession> =>
  client.createSession({
    ...sessionConfig,
    sessionId,
  });

export const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
  let timeoutId: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setUnrefTimeout(() => {
          reject(new ProviderError(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};
