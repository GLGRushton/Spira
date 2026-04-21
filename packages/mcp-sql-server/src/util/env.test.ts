import { describe, expect, it } from "vitest";
import {
  DEFAULT_SQL_SERVER_ROW_LIMIT,
  DEFAULT_SQL_SERVER_TIMEOUT_MS,
  loadSqlServerRuntimeConfig,
  normalizeSqlServerServer,
} from "./env.js";

describe("normalizeSqlServerServer", () => {
  it("normalizes local aliases to localhost", () => {
    expect(normalizeSqlServerServer(".")).toBe("localhost");
    expect(normalizeSqlServerServer("(local)")).toBe("localhost");
    expect(normalizeSqlServerServer("localhost")).toBe("localhost");
  });
});

describe("loadSqlServerRuntimeConfig", () => {
  it("applies defaults and normalizes allowlisted databases", () => {
    expect(
      loadSqlServerRuntimeConfig({
        SQL_SERVER_SERVER: ".",
        SQL_SERVER_USERNAME: "readonly",
        SQL_SERVER_PASSWORD: "secret",
        SQL_SERVER_ALLOWED_DATABASES: "Sales, sales, Reporting",
      }),
    ).toEqual({
      server: "localhost",
      username: "readonly",
      password: "secret",
      port: undefined,
      encrypt: true,
      trustServerCertificate: false,
      allowedDatabases: ["Sales", "Reporting"],
      rowLimit: DEFAULT_SQL_SERVER_ROW_LIMIT,
      timeoutMs: DEFAULT_SQL_SERVER_TIMEOUT_MS,
    });
  });

  it("rejects partial credential configuration", () => {
    expect(() =>
      loadSqlServerRuntimeConfig({
        SQL_SERVER_USERNAME: "readonly",
      }),
    ).toThrow("SQL Server MCP requires SQL_SERVER_USERNAME and SQL_SERVER_PASSWORD.");
  });

  it("parses numeric and boolean overrides", () => {
    expect(
      loadSqlServerRuntimeConfig({
        SQL_SERVER_USERNAME: "readonly",
        SQL_SERVER_PASSWORD: "secret",
        SQL_SERVER_PORT: "1433",
        SQL_SERVER_ENCRYPT: "false",
        SQL_SERVER_TRUST_SERVER_CERTIFICATE: "yes",
        SQL_SERVER_ROW_LIMIT: "25",
        SQL_SERVER_TIMEOUT_MS: "3000",
      }),
    ).toMatchObject({
      port: 1433,
      encrypt: false,
      trustServerCertificate: true,
      rowLimit: 25,
      timeoutMs: 3000,
    });
  });

  it("preserves credential whitespace while still rejecting blank values", () => {
    expect(
      loadSqlServerRuntimeConfig({
        SQL_SERVER_USERNAME: " readonly ",
        SQL_SERVER_PASSWORD: "  secret  ",
      }),
    ).toMatchObject({
      username: " readonly ",
      password: "  secret  ",
    });
  });
});
