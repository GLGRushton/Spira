import { describe, expect, it } from "vitest";
import { assertReadOnlyQuery, resolveDatabaseName } from "./guard.js";

describe("assertReadOnlyQuery", () => {
  it("allows plain select statements", () => {
    expect(assertReadOnlyQuery("SELECT TOP (10) * FROM dbo.Users;")).toBe("SELECT TOP (10) * FROM dbo.Users");
  });

  it("allows CTEs that end in select", () => {
    expect(assertReadOnlyQuery("WITH recent AS (SELECT * FROM dbo.Users) SELECT * FROM recent")).toContain(
      "WITH recent",
    );
  });

  it("ignores forbidden words inside comments and strings", () => {
    expect(assertReadOnlyQuery("SELECT 'drop table' AS note -- update later")).toContain("SELECT 'drop table'");
  });

  it("rejects multiple statements", () => {
    expect(() => assertReadOnlyQuery("SELECT 1; SELECT 2;")).toThrow("Only a single SQL statement is allowed");
  });

  it("rejects write keywords", () => {
    expect(() => assertReadOnlyQuery("SELECT * INTO dbo.CopyOfUsers FROM dbo.Users")).toThrow(
      'Found forbidden keyword "INTO"',
    );
  });

  it("rejects non-select verbs", () => {
    expect(() => assertReadOnlyQuery("UPDATE dbo.Users SET name = 'x'")).toThrow(
      "Only SELECT statements or CTEs that end in SELECT are allowed.",
    );
  });
});

describe("resolveDatabaseName", () => {
  it("matches allowlisted databases case-insensitively", () => {
    expect(
      resolveDatabaseName(
        {
          server: "localhost",
          username: "readonly",
          password: "secret",
          encrypt: true,
          trustServerCertificate: false,
          allowedDatabases: ["Sales"],
          rowLimit: 100,
          timeoutMs: 1000,
        },
        "sales",
      ),
    ).toBe("Sales");
  });

  it("rejects databases outside the allowlist", () => {
    expect(() =>
      resolveDatabaseName(
        {
          server: "localhost",
          username: "readonly",
          password: "secret",
          encrypt: true,
          trustServerCertificate: false,
          allowedDatabases: ["Sales"],
          rowLimit: 100,
          timeoutMs: 1000,
        },
        "master",
      ),
    ).toThrow('Database "master" is not in the configured SQL Server allowlist.');
  });
});
