import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SpiraMemoryDatabase, getSpiraMemoryDbPath } from "@spira/memory-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProofRulesService } from "./proof-rules-service.js";

describe("ProofRulesService (Phase 2.5)", () => {
  let database: SpiraMemoryDatabase;
  let tempDir: string;
  let service: ProofRulesService;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "spira-proof-rules-"));
    database = SpiraMemoryDatabase.open(getSpiraMemoryDbPath(tempDir));
    // Seed one builtin rule so list/source semantics can be exercised.
    database.upsertProofRule({
      id: "global-test-builtin",
      classificationKind: "ui",
      uiChange: true,
      proofRequired: true,
      summaryKeywords: [],
      recommendedLevel: "targeted-screenshot",
      rationale: "Builtin rule for tests.",
    });
    service = new ProofRulesService(database);
  });

  afterEach(() => {
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("derives source = 'builtin' from the global- prefix and 'user' for everything else", () => {
    service.upsert({
      id: "user-test",
      classificationKind: "frontend",
      recommendedLevel: "manual-review-only",
      rationale: "Test user rule.",
    });
    const snapshot = service.list();
    const builtin = snapshot.rules.find((rule) => rule.id === "global-test-builtin");
    const user = snapshot.rules.find((rule) => rule.id === "user-test");
    expect(builtin?.source).toBe("builtin");
    expect(user?.source).toBe("user");
  });

  it("upsert mints a uuid id when none is supplied", () => {
    const before = service.list().rules.length;
    service.upsert({
      classificationKind: "frontend",
      recommendedLevel: "light",
      rationale: "Mint an id for me.",
    });
    const after = service.list().rules;
    expect(after.length).toBe(before + 1);
    const newRule = after.find((rule) => rule.id !== "global-test-builtin");
    expect(newRule?.id.startsWith("user-")).toBe(true);
  });

  it("refuses to upsert into a builtin id", () => {
    expect(() =>
      service.upsert({
        id: "global-injection-attempt",
        recommendedLevel: "none",
        rationale: "Should fail.",
      }),
    ).toThrow(/builtin proof rule/);
  });

  it("refuses to delete a builtin rule", () => {
    expect(() => service.delete("global-test-builtin")).toThrow(/builtin proof rule/);
    expect(service.list().rules.some((rule) => rule.id === "global-test-builtin")).toBe(true);
  });

  it("delete removes a user rule and returns the fresh snapshot", () => {
    service.upsert({
      id: "user-remove-me",
      classificationKind: "ui",
      recommendedLevel: "light",
      rationale: "Will be deleted.",
    });
    expect(service.list().rules.some((rule) => rule.id === "user-remove-me")).toBe(true);
    const snapshot = service.delete("user-remove-me");
    expect(snapshot.rules.some((rule) => rule.id === "user-remove-me")).toBe(false);
  });
});
