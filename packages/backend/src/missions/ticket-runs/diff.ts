import type { TicketRunDiffFileSummary } from "@spira/shared";

export const parseNameStatusMap = (stdout: string): Map<string, { status: string; previousPath: string | null }> => {
  const entries = new Map<string, { status: string; previousPath: string | null }>();
  for (const line of stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    const parts = line.split("\t");
    const statusToken = parts[0] ?? "";
    const status = statusToken.slice(0, 1) || "M";
    if ((status === "R" || status === "C") && parts.length >= 3) {
      entries.set(parts[2] ?? parts[1] ?? "", {
        status,
        previousPath: parts[1] ?? null,
      });
      continue;
    }
    if (parts[1]) {
      entries.set(parts[1], { status, previousPath: null });
    }
  }
  return entries;
};

export const parseNumstatMap = (
  stdout: string,
): Map<string, { additions: number | null; deletions: number | null }> => {
  const entries = new Map<string, { additions: number | null; deletions: number | null }>();
  for (const line of stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }
    const additions = parts[0] === "-" ? null : Number(parts[0]);
    const deletions = parts[1] === "-" ? null : Number(parts[1]);
    const path = parts.length >= 4 ? (parts[3] ?? parts[2] ?? "") : (parts[2] ?? "");
    if (!path) {
      continue;
    }
    entries.set(path, {
      additions: Number.isFinite(additions) ? additions : null,
      deletions: Number.isFinite(deletions) ? deletions : null,
    });
  }
  return entries;
};

export const parseNullSeparatedEntries = (stdout: string): string[] => {
  if (stdout.includes("\u0000")) {
    return stdout.split("\u0000").filter((entry) => entry.length > 0);
  }
  return stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

export const parseDiffFiles = (
  rawDiff: string,
  nameStatusMap: ReadonlyMap<string, { status: string; previousPath: string | null }>,
  numstatMap: ReadonlyMap<string, { additions: number | null; deletions: number | null }>,
): TicketRunDiffFileSummary[] => {
  const trimmed = rawDiff.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed
    .split(/(?=^diff --git )/gmu)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const headerMatch = /^diff --git a\/(.+?) b\/(.+)$/mu.exec(chunk);
      const currentPath = headerMatch?.[2] ?? headerMatch?.[1] ?? "unknown";
      const statusEntry = nameStatusMap.get(currentPath);
      const numstatEntry = numstatMap.get(currentPath);
      const previousPath =
        statusEntry?.previousPath ?? (headerMatch?.[1] !== currentPath ? (headerMatch?.[1] ?? null) : null);
      return {
        path: currentPath,
        previousPath,
        status: statusEntry?.status ?? "M",
        additions: numstatEntry?.additions ?? null,
        deletions: numstatEntry?.deletions ?? null,
        patch: chunk,
      };
    });
};

export const mergeUntrackedFiles = (
  files: readonly TicketRunDiffFileSummary[],
  untrackedPaths: readonly string[],
): TicketRunDiffFileSummary[] => {
  if (untrackedPaths.length === 0) {
    return [...files];
  }

  const merged = new Map(files.map((file) => [file.path, file] as const));
  for (const untrackedPath of [...untrackedPaths].sort((left, right) => left.localeCompare(right))) {
    if (merged.has(untrackedPath)) {
      continue;
    }
    merged.set(untrackedPath, {
      path: untrackedPath,
      previousPath: null,
      status: "A",
      additions: null,
      deletions: null,
      patch: "",
    });
  }

  return [...merged.values()];
};

export const buildSubmoduleDiffFingerprint = (files: readonly TicketRunDiffFileSummary[]): string | null => {
  if (files.length === 0) {
    return null;
  }

  return JSON.stringify(
    files.map((file) => ({
      path: file.path,
      previousPath: file.previousPath,
      status: file.status,
      patch: file.patch,
    })),
  );
};
