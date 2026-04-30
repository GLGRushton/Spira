import { createRequire } from "node:module";
import path from "node:path";
import { CopilotClient } from "@github/copilot-sdk";
import type { Env } from "@spira/shared";
import type { Logger } from "pino";
import { CopilotError } from "../../util/errors.js";
import { CopilotProviderClient } from "./adapter.js";

const require = createRequire(import.meta.url);
const COPILOT_AUTH_ENV_KEYS = ["COPILOT_SDK_AUTH_TOKEN", "GITHUB_ACCESS_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"] as const;

export type CopilotAuthStrategy = "logged-in-user" | "github-token";

const getSanitizedCopilotEnv = (): NodeJS.ProcessEnv => {
  const sanitizedEnv = { ...process.env };
  for (const key of COPILOT_AUTH_ENV_KEYS) {
    delete sanitizedEnv[key];
  }
  return sanitizedEnv;
};

const resolveCliPath = (logger: Pick<Logger, "warn">): string | undefined => {
  try {
    if (process.platform === "win32") {
      const packageName = process.arch === "arm64" ? "@github/copilot-win32-arm64" : "@github/copilot-win32-x64";
      const packageJsonPath = require.resolve(`${packageName}/package.json`);
      return path.join(path.dirname(packageJsonPath), "copilot.exe");
    }

    return undefined;
  } catch (error) {
    logger.warn({ error, platform: process.platform, arch: process.arch }, "Falling back to default Copilot CLI path");
    return undefined;
  }
};

const stopRawCopilotClient = async (client: CopilotClient, logger: Pick<Logger, "warn">): Promise<void> => {
  try {
    const stopErrors = await client.stop();
    if (stopErrors.length > 0) {
      logger.warn({ stopErrors }, "GitHub Copilot client stopped with cleanup errors");
    }
  } catch (error) {
    logger.warn({ error }, "Failed to stop GitHub Copilot client cleanly");
  }
};

export const createCopilotProviderClient = async (
  env: Env,
  logger: Pick<Logger, "info" | "warn">,
): Promise<{ client: CopilotProviderClient; strategy: CopilotAuthStrategy }> => {
  const cliPath = resolveCliPath(logger);
  const loggedInClient = new CopilotClient({
    cliPath,
    env: getSanitizedCopilotEnv(),
    useLoggedInUser: true,
    useStdio: true,
  });

  try {
    await loggedInClient.start();
    const authStatus = await loggedInClient.getAuthStatus();

    if (authStatus.isAuthenticated) {
      logger.info(
        { authType: authStatus.authType ?? "unknown", strategy: "logged-in-user" },
        "Using logged-in Copilot authentication",
      );
      return { client: new CopilotProviderClient(loggedInClient, logger), strategy: "logged-in-user" };
    }
  } catch (error) {
    logger.warn({ error }, "Logged-in Copilot authentication check failed");
  }

  await stopRawCopilotClient(loggedInClient, logger);

  if (env.GITHUB_TOKEN.trim()) {
    const tokenClient = new CopilotClient({
      cliPath,
      env: getSanitizedCopilotEnv(),
      gitHubToken: env.GITHUB_TOKEN,
      useStdio: true,
    });

    try {
      await tokenClient.start();
      const authStatus = await tokenClient.getAuthStatus();
      if (authStatus.isAuthenticated) {
        logger.info(
          { authType: authStatus.authType ?? "unknown", strategy: "github-token" },
          "Using token-based Copilot authentication",
        );
        return { client: new CopilotProviderClient(tokenClient, logger), strategy: "github-token" };
      }

      await stopRawCopilotClient(tokenClient, logger);
    } catch (error) {
      logger.warn({ error }, "Token-based Copilot authentication check failed");
      await stopRawCopilotClient(tokenClient, logger);
    }
  }

  throw new CopilotError("GitHub Copilot is not authenticated. Run /login in the Copilot CLI.");
};
