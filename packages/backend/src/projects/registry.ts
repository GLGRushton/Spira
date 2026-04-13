import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { SpiraMemoryDatabase } from "@spira/memory-db";
import { type ProjectRepoMappingsSnapshot, type WorkspaceRepoSummary, normalizeProjectKey } from "@spira/shared";
import { ConfigError } from "../util/errors.js";

const MAX_SCAN_DEPTH = 4;
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".turbo",
  ".yarn",
  "coverage",
  "dist",
  "build",
  "node_modules",
  "out",
]);

const normalizeWorkspaceRoot = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return path.resolve(trimmed);
};

const normalizeRepoRelativePath = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const normalized = path.normalize(trimmed);
  if (path.isAbsolute(normalized)) {
    throw new ConfigError("Mapped repo paths must be relative to the workspace root.");
  }

  const segments = normalized.split(path.sep).filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    throw new ConfigError("Mapped repo paths must stay inside the workspace root.");
  }

  return segments.length > 0 ? segments.join(path.sep) : ".";
};

const shouldDescend = (directoryName: string): boolean => {
  if (IGNORED_DIRECTORY_NAMES.has(directoryName)) {
    return false;
  }

  return !directoryName.startsWith(".");
};

const sortRepos = (repos: WorkspaceRepoSummary[]): WorkspaceRepoSummary[] =>
  repos.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

const sortProjectKeys = (projectKeys: string[]): string[] =>
  projectKeys.sort((left, right) => left.localeCompare(right));

export class ProjectRegistry {
  constructor(private readonly memoryDb: SpiraMemoryDatabase | null) {}

  async getSnapshot(): Promise<ProjectRepoMappingsSnapshot> {
    const workspaceRoot = this.memoryDb?.getProjectWorkspaceRoot() ?? null;
    return this.buildSnapshot(workspaceRoot);
  }

  async setWorkspaceRoot(workspaceRoot: string | null): Promise<ProjectRepoMappingsSnapshot> {
    if (!this.memoryDb) {
      throw new ConfigError("Project mapping persistence is unavailable.");
    }

    const normalizedRoot = normalizeWorkspaceRoot(workspaceRoot);
    const repos = normalizedRoot !== null ? await this.scanWorkspaceRepos(normalizedRoot) : [];

    this.memoryDb.setProjectWorkspaceRoot(normalizedRoot);
    return this.buildSnapshot(normalizedRoot, repos);
  }

  async setProjectMapping(
    projectKey: string,
    repoRelativePaths: readonly string[],
  ): Promise<ProjectRepoMappingsSnapshot> {
    if (!this.memoryDb) {
      throw new ConfigError("Project mapping persistence is unavailable.");
    }

    const normalizedProjectKey = normalizeProjectKey(projectKey);
    if (!normalizedProjectKey) {
      throw new ConfigError("Project key cannot be empty.");
    }

    const workspaceRoot = this.memoryDb.getProjectWorkspaceRoot();
    if (!workspaceRoot) {
      throw new ConfigError("Set a workspace root before mapping repositories.");
    }

    const repos = await this.scanWorkspaceRepos(workspaceRoot);
    const knownRepoPaths = new Set(repos.map((repo) => repo.relativePath));
    const normalizedRepoPaths = [...new Set(repoRelativePaths.map(normalizeRepoRelativePath).filter(Boolean))].sort(
      (left, right) => left.localeCompare(right),
    );

    for (const repoRelativePath of normalizedRepoPaths) {
      if (!knownRepoPaths.has(repoRelativePath)) {
        throw new ConfigError(`Mapped repository ${repoRelativePath} was not found beneath the workspace root.`);
      }
    }

    this.memoryDb.setProjectRepoMapping(normalizedProjectKey, normalizedRepoPaths);
    return this.buildSnapshot(workspaceRoot, repos);
  }

  async resolveProjectRepos(projectKey: string): Promise<WorkspaceRepoSummary[]> {
    const normalizedProjectKey = normalizeProjectKey(projectKey);
    if (!normalizedProjectKey) {
      return [];
    }

    const snapshot = await this.getSnapshot();
    const mapping = snapshot.mappings.find((entry) => entry.projectKey === normalizedProjectKey);
    if (!mapping) {
      return [];
    }

    const reposByPath = new Map(snapshot.repos.map((repo) => [repo.relativePath, repo]));
    return mapping.repoRelativePaths.flatMap((repoRelativePath) => {
      const repo = reposByPath.get(repoRelativePath);
      return repo ? [repo] : [];
    });
  }

  private async buildSnapshot(
    workspaceRoot: string | null,
    preScannedRepos?: WorkspaceRepoSummary[],
  ): Promise<ProjectRepoMappingsSnapshot> {
    const repos = preScannedRepos ?? (workspaceRoot ? await this.scanWorkspaceRepos(workspaceRoot) : []);
    const repoPathSet = new Set(repos.map((repo) => repo.relativePath));
    const mappings = (this.memoryDb?.listProjectRepoMappings() ?? []).map((mapping) => ({
      projectKey: mapping.projectKey,
      repoRelativePaths: [...mapping.repoRelativePaths],
      missingRepoRelativePaths: mapping.repoRelativePaths.filter((repoPath) => !repoPathSet.has(repoPath)),
      updatedAt: mapping.updatedAt,
    }));
    const mappedProjectsByRepo = new Map<string, string[]>();

    for (const mapping of mappings) {
      for (const repoRelativePath of mapping.repoRelativePaths) {
        const current = mappedProjectsByRepo.get(repoRelativePath) ?? [];
        current.push(mapping.projectKey);
        mappedProjectsByRepo.set(repoRelativePath, sortProjectKeys(current));
      }
    }

    return {
      workspaceRoot,
      repos: repos.map((repo) => ({
        ...repo,
        mappedProjectKeys: [...(mappedProjectsByRepo.get(repo.relativePath) ?? [])],
      })),
      mappings,
    };
  }

  private async scanWorkspaceRepos(workspaceRoot: string): Promise<WorkspaceRepoSummary[]> {
    let rootEntries: Dirent[];
    try {
      rootEntries = await readdir(workspaceRoot, { withFileTypes: true });
    } catch (error) {
      throw new ConfigError(`Workspace root ${workspaceRoot} could not be read.`, error);
    }

    const repos: WorkspaceRepoSummary[] = [];

    const walk = async (currentPath: string, depth: number, entries?: typeof rootEntries): Promise<void> => {
      let currentEntries = entries;
      if (!currentEntries) {
        try {
          currentEntries = await readdir(currentPath, {
            withFileTypes: true,
          });
        } catch {
          return;
        }
      }
      const gitEntry = currentEntries.find((entry) => entry.name === ".git" && (entry.isDirectory() || entry.isFile()));

      if (gitEntry) {
        const relativePath = path.relative(workspaceRoot, currentPath) || ".";
        repos.push({
          name: path.basename(currentPath),
          relativePath,
          absolutePath: currentPath,
          hasSubmodules: currentEntries.some((entry) => entry.name === ".gitmodules" && entry.isFile()),
          mappedProjectKeys: [],
        });
        return;
      }

      if (depth >= MAX_SCAN_DEPTH) {
        return;
      }

      for (const entry of currentEntries) {
        if (!entry.isDirectory() || !shouldDescend(entry.name)) {
          continue;
        }

        await walk(path.join(currentPath, entry.name), depth + 1);
      }
    };

    await walk(workspaceRoot, 0, rootEntries);
    return sortRepos(repos);
  }
}
