import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SpiraMemoryDatabase, getSpiraMemoryDbPath } from "@spira/memory-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValidationProfilesService } from "./validation-profiles-service.js";

describe("ValidationProfilesService (Phase 3.4)", () => {
  let database: SpiraMemoryDatabase;
  let tempDir: string;
  let service: ValidationProfilesService;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "spira-validation-profiles-"));
    database = SpiraMemoryDatabase.open(getSpiraMemoryDbPath(tempDir));
    // Seed one builtin so source semantics can be exercised.
    database.upsertValidationProfile({
      id: "global-test-builtin",
      projectKey: null,
      repoRelativePath: null,
      label: "Workspace lint",
      kind: "lint",
      command: "pnpm lint",
      workingDirectory: ".",
      source: "builtin",
      confidence: 0.85,
    });
    service = new ValidationProfilesService(database);
  });

  afterEach(() => {
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("lists builtin and user profiles with correct source tags", () => {
    service.upsert({
      label: "ClientApp build",
      kind: "build",
      command: "npm run build",
      workingDirectory: "ClientApp",
    });
    const snapshot = service.list();
    const builtin = snapshot.profiles.find((p) => p.id === "global-test-builtin");
    const user = snapshot.profiles.find((p) => p.id !== "global-test-builtin");
    expect(builtin?.source).toBe("builtin");
    expect(user?.source).toBe("user");
    expect(user?.id.startsWith("user-")).toBe(true);
  });

  it("supports the new validation kinds (restore, format, e2e-smoke)", () => {
    const restore = service.upsert({
      label: "npm restore",
      kind: "restore",
      command: "npm ci --registry https://npm.parliament.uk",
      workingDirectory: "ClientApp",
    });
    expect(restore.profiles.find((p) => p.kind === "restore")).toBeDefined();
    const format = service.upsert({
      label: "biome",
      kind: "format",
      command: "biome check .",
      workingDirectory: ".",
    });
    expect(format.profiles.find((p) => p.kind === "format")).toBeDefined();
    const e2e = service.upsert({
      label: "smoke",
      kind: "e2e-smoke",
      command: "npm run test:smoke",
      workingDirectory: "ClientApp",
    });
    expect(e2e.profiles.find((p) => p.kind === "e2e-smoke")).toBeDefined();
  });

  it("refuses to upsert into a builtin id", () => {
    expect(() =>
      service.upsert({
        id: "global-injection-attempt",
        label: "x",
        kind: "build",
        command: "x",
        workingDirectory: ".",
      }),
    ).toThrow(/builtin validation profile/);
  });

  it("refuses to delete a builtin profile", () => {
    expect(() => service.delete("global-test-builtin")).toThrow(/builtin validation profile/);
    expect(service.list().profiles.some((p) => p.id === "global-test-builtin")).toBe(true);
  });

  it("delete removes a user profile", () => {
    const after = service.upsert({
      id: "user-remove-me",
      label: "x",
      kind: "build",
      command: "x",
      workingDirectory: ".",
    });
    expect(after.profiles.some((p) => p.id === "user-remove-me")).toBe(true);
    const snapshot = service.delete("user-remove-me");
    expect(snapshot.profiles.some((p) => p.id === "user-remove-me")).toBe(false);
  });

  it("exposes lastObservedRuntimeMs in the snapshot (null until populated by Phase 5)", () => {
    service.upsert({
      label: "test",
      kind: "build",
      command: "x",
      workingDirectory: ".",
      expectedRuntimeMs: 60_000,
    });
    const snapshot = service.list();
    const fresh = snapshot.profiles.find((p) => p.id !== "global-test-builtin");
    expect(fresh?.expectedRuntimeMs).toBe(60_000);
    expect(fresh?.lastObservedRuntimeMs).toBeNull();
  });
});
