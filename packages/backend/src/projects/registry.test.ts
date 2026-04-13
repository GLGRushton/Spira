import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SpiraMemoryDatabase, getSpiraMemoryDbPath } from "@spira/memory-db";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectRegistry } from "./registry.js";

const tempDirs: string[] = [];
const openDatabases: SpiraMemoryDatabase[] = [];

const createTestDatabase = (): SpiraMemoryDatabase => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "spira-project-registry-db-"));
  tempDirs.push(tempDir);
  const database = SpiraMemoryDatabase.open(getSpiraMemoryDbPath(tempDir));
  openDatabases.push(database);
  return database;
};

const createWorkspace = (): string => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "spira-project-registry-workspace-"));
  tempDirs.push(workspaceRoot);

  mkdirSync(path.join(workspaceRoot, "repo-a", ".git"), { recursive: true });
  mkdirSync(path.join(workspaceRoot, "nested", "repo-b"), { recursive: true });
  writeFileSync(path.join(workspaceRoot, "nested", "repo-b", ".git"), "gitdir: ../.git/modules/repo-b\n");
  writeFileSync(path.join(workspaceRoot, "nested", "repo-b", ".gitmodules"), "[submodule]\n");

  return workspaceRoot;
};

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close();
  }

  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (!directory) {
      continue;
    }

    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ProjectRegistry", () => {
  it("scans workspace repos and resolves project mappings", async () => {
    const database = createTestDatabase();
    const workspaceRoot = createWorkspace();
    const registry = new ProjectRegistry(database);

    const initialSnapshot = await registry.setWorkspaceRoot(workspaceRoot);
    expect(initialSnapshot.repos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "repo-a",
          relativePath: "repo-a",
          hasSubmodules: false,
          mappedProjectKeys: [],
        }),
        expect.objectContaining({
          name: "repo-b",
          relativePath: path.join("nested", "repo-b"),
          hasSubmodules: true,
          mappedProjectKeys: [],
        }),
      ]),
    );

    const mappedSnapshot = await registry.setProjectMapping("spi", ["repo-a", path.join("nested", "repo-b")]);
    expect(mappedSnapshot.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectKey: "SPI",
          repoRelativePaths: expect.arrayContaining(["repo-a", path.join("nested", "repo-b")]),
          missingRepoRelativePaths: [],
        }),
      ]),
    );

    const sharedSnapshot = await registry.setProjectMapping("ops", ["repo-a"]);
    expect(sharedSnapshot.repos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "repo-a",
          mappedProjectKeys: ["OPS", "SPI"],
        }),
        expect.objectContaining({
          relativePath: path.join("nested", "repo-b"),
          mappedProjectKeys: ["SPI"],
        }),
      ]),
    );

    const resolvedRepos = await registry.resolveProjectRepos("SPI");
    expect(resolvedRepos).toHaveLength(2);
    expect(resolvedRepos.map((repo) => repo.relativePath)).toEqual(
      expect.arrayContaining(["repo-a", path.join("nested", "repo-b")]),
    );
  });

  it("rejects mappings for repos outside the scanned workspace", async () => {
    const database = createTestDatabase();
    const workspaceRoot = createWorkspace();
    const registry = new ProjectRegistry(database);

    await registry.setWorkspaceRoot(workspaceRoot);

    await expect(registry.setProjectMapping("SPI", ["..\\escape"])).rejects.toThrow(
      "Mapped repo paths must stay inside the workspace root.",
    );
  });
});
