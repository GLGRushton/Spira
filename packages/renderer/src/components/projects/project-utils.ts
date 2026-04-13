import { type YouTrackProjectSummary, normalizeProjectKey } from "@spira/shared";

export { normalizeProjectKey } from "@spira/shared";

export const findExactProjectMatch = (
  projects: readonly YouTrackProjectSummary[],
  value: string,
): YouTrackProjectSummary | null => {
  const normalizedValue = normalizeProjectKey(value);
  return projects.find((project) => normalizeProjectKey(project.shortName) === normalizedValue) ?? null;
};
