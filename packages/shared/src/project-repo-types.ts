export interface WorkspaceRepoSummary {
  name: string;
  relativePath: string;
  absolutePath: string;
  hasSubmodules: boolean;
  mappedProjectKeys: string[];
}

export const normalizeProjectKey = (value: string): string => value.trim().toUpperCase();

export interface ProjectRepoMappingSummary {
  projectKey: string;
  repoRelativePaths: string[];
  missingRepoRelativePaths: string[];
  updatedAt: number;
}

export interface ProjectRepoMappingsSnapshot {
  workspaceRoot: string | null;
  repos: WorkspaceRepoSummary[];
  mappings: ProjectRepoMappingSummary[];
}
