import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SpiraMemoryDatabase, getSpiraMemoryDbPath } from "@spira/memory-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RepoProfilesService } from "./repo-profiles-service.js";

describe("RepoProfilesService (Phase 3.2)", () => {
  let database: SpiraMemoryDatabase;
  let tempDir: string;
  let service: RepoProfilesService;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "spira-repo-profiles-"));
    database = SpiraMemoryDatabase.open(getSpiraMemoryDbPath(tempDir));
    service = new RepoProfilesService(database);
  });

  afterEach(() => {
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns an empty snapshot when no profiles are registered", () => {
    expect(service.list().profiles).toEqual([]);
  });

  it("upserts a profile with full metadata + lists it back", () => {
    service.upsert({
      projectKey: "legapp-entry",
      displayName: "LegApp Entry",
      description: "Public-facing entry app",
      defaultBranch: "main",
      defaultBuildWorkingDirectory: "LegApp.Entry.UI/ClientApp",
      defaultRegistry: "https://npm.parliament.uk",
      registryHints: ["@pds-design-system/* needs the Parliament registry"],
      requiredEnvVars: ["GITHUB_TOKEN"],
      requiredSdks: ["node 22"],
      userFacingCopyGlobs: ["LegApp.Entry.UI/ClientApp/src/**/*.html"],
      uiTestGlobs: ["LegApp.Admin.UI.Tests/**/*.cs"],
      notes: "Prefer registry override on dependency install.",
    });
    const snapshot = service.list();
    expect(snapshot.profiles).toHaveLength(1);
    const profile = snapshot.profiles[0];
    expect(profile?.projectKey).toBe("legapp-entry");
    expect(profile?.requiredSdks).toEqual(["node 22"]);
    expect(profile?.source).toBe("user");
    expect(profile?.createdAt).toBeDefined();
  });

  it("upsert with same projectKey updates instead of duplicating", () => {
    service.upsert({ projectKey: "alpha", displayName: "Alpha v1" });
    service.upsert({ projectKey: "alpha", displayName: "Alpha v2" });
    const snapshot = service.list();
    expect(snapshot.profiles).toHaveLength(1);
    expect(snapshot.profiles[0]?.displayName).toBe("Alpha v2");
  });

  it("delete removes the profile and returns the fresh snapshot", () => {
    service.upsert({ projectKey: "to-remove", displayName: "Doomed" });
    expect(service.list().profiles).toHaveLength(1);
    const after = service.delete("to-remove");
    expect(after.profiles).toHaveLength(0);
  });

  it("preserves source = 'learned' / 'builtin' when explicitly set", () => {
    service.upsert({ projectKey: "learned-one", displayName: "From learner", source: "learned" });
    service.upsert({ projectKey: "builtin-one", displayName: "Shipped", source: "builtin" });
    const profiles = service.list().profiles;
    expect(profiles.find((p) => p.projectKey === "learned-one")?.source).toBe("learned");
    expect(profiles.find((p) => p.projectKey === "builtin-one")?.source).toBe("builtin");
  });
});
