import type { TicketRunSubmoduleParentRef, TicketRunSubmoduleSummary } from "@spira/shared";

export interface GitmodulesEntry {
  path: string;
  url: string;
}

export const normalizeSubmoduleCanonicalUrl = (rawUrl: string): string => {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }

  if (!trimmed.includes("://")) {
    const scpLikeMatch = /^(?:[^@]+@)?([^:]+):(.+)$/u.exec(trimmed);
    if (scpLikeMatch) {
      return `${scpLikeMatch[1]}/${scpLikeMatch[2]}`
        .replace(/\\/gu, "/")
        .replace(/\.git$/iu, "")
        .replace(/\/+$/u, "")
        .toLowerCase();
    }
  }

  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.replace(/\.git$/iu, "").replace(/\/+$/u, "");
    return `${parsed.host}${pathname}`.replace(/\\/gu, "/").toLowerCase();
  } catch {
    return trimmed
      .replace(/\\/gu, "/")
      .replace(/\.git$/iu, "")
      .replace(/\/+$/u, "")
      .toLowerCase();
  }
};

export const parseGitmodulesEntries = (stdout: string): GitmodulesEntry[] => {
  const entriesByName = new Map<string, Partial<GitmodulesEntry>>();
  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const separatorIndex = line.indexOf(" ");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1).trim();
    const match = /^submodule\.(.+)\.(path|url)$/u.exec(key);
    if (!match || !value) {
      continue;
    }

    const [, name, property] = match;
    const current = entriesByName.get(name) ?? {};
    if (property === "path") {
      current.path = value;
    } else {
      current.url = value;
    }
    entriesByName.set(name, current);
  }

  return [...entriesByName.values()]
    .filter((entry): entry is GitmodulesEntry => typeof entry.path === "string" && typeof entry.url === "string")
    .map((entry) => ({ path: entry.path.trim(), url: entry.url.trim() }))
    .filter((entry) => entry.path.length > 0 && entry.url.length > 0);
};

export const sortSubmoduleParentRefs = (
  parentRefs: readonly TicketRunSubmoduleParentRef[],
): TicketRunSubmoduleParentRef[] =>
  [...parentRefs].sort(
    (left, right) =>
      left.parentRepoRelativePath.localeCompare(right.parentRepoRelativePath) ||
      left.submodulePath.localeCompare(right.submodulePath),
  );

export const areSubmoduleSummariesEqual = (
  left: readonly TicketRunSubmoduleSummary[],
  right: readonly TicketRunSubmoduleSummary[],
): boolean =>
  JSON.stringify(
    [...left]
      .map((submodule) => ({
        canonicalUrl: submodule.canonicalUrl,
        name: submodule.name,
        branchName: submodule.branchName,
        commitMessageDraft: submodule.commitMessageDraft ?? null,
        parentRefs: sortSubmoduleParentRefs(submodule.parentRefs),
      }))
      .sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl)),
  ) ===
  JSON.stringify(
    [...right]
      .map((submodule) => ({
        canonicalUrl: submodule.canonicalUrl,
        name: submodule.name,
        branchName: submodule.branchName,
        commitMessageDraft: submodule.commitMessageDraft ?? null,
        parentRefs: sortSubmoduleParentRefs(submodule.parentRefs),
      }))
      .sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl)),
  );
