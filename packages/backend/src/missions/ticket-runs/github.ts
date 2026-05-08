import type { TicketRunPullRequestLinks } from "@spira/shared";

export interface GitHubOriginInfo {
  repositoryUrl: string;
  defaultBranch: string | null;
}

export interface GitHubPullRequestResponse {
  html_url?: string;
}

interface GitHubPullRequestValidationError {
  message?: string;
}

export interface GitHubPullRequestErrorResponse {
  message?: string;
  errors?: GitHubPullRequestValidationError[];
}

export const parseGitHubRepositoryUrl = (remoteUrl: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    return null;
  }

  const repositoryPath = parsed.pathname.replace(/\.git$/iu, "").replace(/\/+$/u, "");
  if (!/^\/[^/]+\/[^/]+$/u.test(repositoryPath)) {
    return null;
  }

  return `https://github.com${repositoryPath}`;
};

export const parseRepositoryCoordinates = (repositoryUrl: string): { owner: string; repo: string } | null => {
  let parsed: URL;
  try {
    parsed = new URL(repositoryUrl);
  } catch {
    return null;
  }

  const segments = parsed.pathname.replace(/^\/+|\/+$/gu, "").split("/");
  if (segments.length !== 2) {
    return null;
  }

  const [owner, repo] = segments;
  if (!owner || !repo) {
    return null;
  }

  return { owner, repo };
};

export const buildPullRequestUrls = (
  repositoryUrl: string,
  defaultBranch: string | null,
  branchName: string,
): TicketRunPullRequestLinks => {
  const branchSpec = defaultBranch
    ? `${encodeURIComponent(defaultBranch)}...${encodeURIComponent(branchName)}`
    : encodeURIComponent(branchName);
  const openUrl = new URL(`${repositoryUrl.replace(/\/+$/u, "")}/pull/new/${branchSpec}`);
  const draftUrl = new URL(openUrl.toString());
  draftUrl.searchParams.set("draft", "1");
  return {
    open: openUrl.toString(),
    draft: draftUrl.toString(),
  };
};
