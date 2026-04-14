import fetch from "node-fetch";
import type { Logger } from "pino";
import { ConfigError } from "../util/errors.js";

interface GitHubUserResponse {
  id?: number;
  login?: string;
  name?: string | null;
}

interface GitHubEmailResponse {
  email?: string;
  primary?: boolean;
  verified?: boolean;
}

export interface GitHubIdentity {
  name: string;
  email: string;
}

const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_REQUEST_TIMEOUT_MS = 10_000;
const identityCache = new Map<string, GitHubIdentity>();

const buildHeaders = (token: string): Record<string, string> => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "User-Agent": "Spira",
});

const fetchJson = async <T>(path: string, token: string): Promise<T> => {
  const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new ConfigError(`GitHub authentication failed with status ${response.status}.`);
  }
  return (await response.json()) as T;
};

const buildNoreplyEmail = (user: GitHubUserResponse): string => {
  const login = user.login?.trim();
  if (!login) {
    throw new ConfigError("GitHub did not return a login for the mission git identity.");
  }
  return typeof user.id === "number"
    ? `${user.id}+${login}@users.noreply.github.com`
    : `${login}@users.noreply.github.com`;
};

export const fetchGitHubIdentity = async (token: string, logger: Logger): Promise<GitHubIdentity> => {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    throw new ConfigError("Set a mission GitHub PAT in Settings before using mission git actions.");
  }
  const cached = identityCache.get(normalizedToken);
  if (cached) {
    return cached;
  }

  const user = await fetchJson<GitHubUserResponse>("/user", normalizedToken);
  const login = user.login?.trim();
  if (!login) {
    throw new ConfigError("GitHub did not return a login for the mission git identity.");
  }

  let email = buildNoreplyEmail(user);
  try {
    const emails = await fetchJson<GitHubEmailResponse[]>("/user/emails", normalizedToken);
    const preferredEmail =
      emails.find((entry) => entry.primary && entry.verified && entry.email?.trim()) ??
      emails.find((entry) => entry.verified && entry.email?.trim()) ??
      emails.find((entry) => entry.email?.trim());
    if (preferredEmail?.email?.trim()) {
      email = preferredEmail.email.trim();
    }
  } catch (error) {
    logger.warn({ err: error }, "Falling back to GitHub noreply email for mission git identity");
  }

  const identity = {
    name: user.name?.trim() || login,
    email,
  } satisfies GitHubIdentity;
  identityCache.set(normalizedToken, identity);
  return identity;
};
