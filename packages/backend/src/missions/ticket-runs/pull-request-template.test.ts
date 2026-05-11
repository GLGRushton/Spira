import { describe, expect, it } from "vitest";
import { buildPullRequestBody, categorizeChangedFiles } from "./pull-request-template.js";

describe("categorizeChangedFiles", () => {
  it("returns all false for an empty list", () => {
    expect(categorizeChangedFiles([])).toEqual({ hasBackend: false, hasFrontend: false, hasMigrations: false });
  });

  it("detects backend C# files", () => {
    const result = categorizeChangedFiles([
      "LegApp.Services.Api/Controllers/BillsController.cs",
      "LegApp.Services.Api/LegApp.Services.Api.csproj",
    ]);
    expect(result).toEqual({ hasBackend: true, hasFrontend: false, hasMigrations: false });
  });

  it("detects frontend TypeScript and SCSS files", () => {
    const result = categorizeChangedFiles([
      "src/components/Bills.tsx",
      "src/pages/bills.scss",
      "package.json",
    ]);
    expect(result).toEqual({ hasBackend: false, hasFrontend: true, hasMigrations: false });
  });

  it("detects migrations from a Windows-style path", () => {
    const result = categorizeChangedFiles([
      "LegApp.Services.Api\\Database\\Migrations\\20260101_AddBillSoftDelete.cs",
    ]);
    expect(result).toEqual({ hasBackend: true, hasFrontend: false, hasMigrations: true });
  });

  it("detects migrations from a POSIX-style path with mixed case", () => {
    const result = categorizeChangedFiles([
      "db/Migrations/20260101_AddBillSoftDelete.sql",
    ]);
    expect(result.hasMigrations).toBe(true);
  });

  it("detects backend, frontend, and migrations together", () => {
    const result = categorizeChangedFiles([
      "LegApp.Services.Api/Migrations/20260101_AddSoftDelete.cs",
      "src/components/BillEditor.tsx",
      "LegApp.Services.Api/Controllers/BillsController.cs",
    ]);
    expect(result).toEqual({ hasBackend: true, hasFrontend: true, hasMigrations: true });
  });

  it("ignores files without an extension", () => {
    const result = categorizeChangedFiles(["LICENSE", "Dockerfile"]);
    expect(result).toEqual({ hasBackend: false, hasFrontend: false, hasMigrations: false });
  });

  it("recognises Razor and cshtml as backend", () => {
    const result = categorizeChangedFiles(["LegApp.Admin.UI/Pages/Index.cshtml", "LegApp.Admin.UI/Components/Foo.razor"]);
    expect(result.hasBackend).toBe(true);
    expect(result.hasFrontend).toBe(false);
  });
});

describe("buildPullRequestBody", () => {
  it("renders all commit messages joined by separators", () => {
    const body = buildPullRequestBody({
      commitMessages: ["feat(LA-1): add soft delete\n\n- adds DELETE endpoint", "fix(LA-1): tighten validation"],
      categories: { hasBackend: false, hasFrontend: false, hasMigrations: false },
    });
    expect(body).toContain("## Summary\n\nfeat(LA-1): add soft delete\n\n- adds DELETE endpoint\n\n---\n\nfix(LA-1): tighten validation");
  });

  it("falls back to a placeholder when no commit messages are supplied", () => {
    const body = buildPullRequestBody({
      commitMessages: [],
      categories: { hasBackend: false, hasFrontend: false, hasMigrations: false },
    });
    expect(body).toContain("_No commit messages found on this branch._");
  });

  it("always includes the Conformity and Database sections", () => {
    const body = buildPullRequestBody({
      commitMessages: ["fix: thing"],
      categories: { hasBackend: false, hasFrontend: false, hasMigrations: false },
    });
    expect(body).toContain("## Conformity");
    expect(body).toContain("#### Database");
    expect(body).toContain("- [ ] Does this change have migrations? (if yes, have they been rebased)");
  });

  it("ticks the migrations box when migrations are detected", () => {
    const body = buildPullRequestBody({
      commitMessages: ["feat: migrations"],
      categories: { hasBackend: false, hasFrontend: false, hasMigrations: true },
    });
    expect(body).toContain("- [x] Does this change have migrations? (if yes, have they been rebased)");
  });

  it("omits the Backend section when hasBackend is false", () => {
    const body = buildPullRequestBody({
      commitMessages: ["fix(ui): tweak"],
      categories: { hasBackend: false, hasFrontend: true, hasMigrations: false },
    });
    expect(body).not.toContain("#### Backend");
    expect(body).toContain("#### Frontend");
  });

  it("omits the Frontend section when hasFrontend is false", () => {
    const body = buildPullRequestBody({
      commitMessages: ["feat(api): endpoint"],
      categories: { hasBackend: true, hasFrontend: false, hasMigrations: false },
    });
    expect(body).toContain("#### Backend");
    expect(body).not.toContain("#### Frontend");
  });

  it("includes both Backend and Frontend sections when both apply", () => {
    const body = buildPullRequestBody({
      commitMessages: ["feat: full stack"],
      categories: { hasBackend: true, hasFrontend: true, hasMigrations: true },
    });
    expect(body).toContain("#### Backend");
    expect(body).toContain("#### Frontend");
    expect(body).toContain("- [x] Does this change have migrations? (if yes, have they been rebased)");
  });

  it("trims whitespace-only commit messages and falls back to placeholder", () => {
    const body = buildPullRequestBody({
      commitMessages: ["   ", "\n", "\t"],
      categories: { hasBackend: false, hasFrontend: false, hasMigrations: false },
    });
    expect(body).toContain("_No commit messages found on this branch._");
  });
});
