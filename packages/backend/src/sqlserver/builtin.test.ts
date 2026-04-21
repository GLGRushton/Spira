import { describe, expect, it } from "vitest";
import {
  MANAGED_SQL_SERVER_BUILTIN_SERVER_IDS,
  SQL_SERVER_BUILTIN_SERVER_ID,
  buildSqlServerBuiltinMcpServers,
  hasSqlServerCredentials,
} from "./builtin.js";

describe("hasSqlServerCredentials", () => {
  it("requires both username and password", () => {
    expect(
      hasSqlServerCredentials({
        SQL_SERVER_USERNAME: "readonly",
        SQL_SERVER_PASSWORD: "secret",
      } as never),
    ).toBe(true);
    expect(
      hasSqlServerCredentials({
        SQL_SERVER_USERNAME: "readonly",
        SQL_SERVER_PASSWORD: "",
      } as never),
    ).toBe(false);
  });
});

describe("buildSqlServerBuiltinMcpServers", () => {
  it("returns no built-in server when SQL credentials are missing", () => {
    expect(buildSqlServerBuiltinMcpServers({} as never)).toEqual([]);
  });

  it("returns a read-only built-in stdio server when SQL credentials are present", () => {
    expect(
      buildSqlServerBuiltinMcpServers({
        SQL_SERVER_USERNAME: "readonly",
        SQL_SERVER_PASSWORD: "secret",
        SQL_SERVER_ALLOWED_DATABASES: "Sales,Reporting",
      } as never),
    ).toEqual([
      expect.objectContaining({
        id: SQL_SERVER_BUILTIN_SERVER_ID,
        transport: "stdio",
        command: "node",
        args: ["packages/mcp-sql-server/dist/index.js"],
        env: {
          SQL_SERVER_SERVER: ".",
          SQL_SERVER_USERNAME: "readonly",
          SQL_SERVER_PASSWORD: "secret",
          SQL_SERVER_ALLOWED_DATABASES: "Sales,Reporting",
        },
        toolAccess: {
          readOnlyToolNames: [
            "sqlserver_list_databases",
            "sqlserver_list_schemas",
            "sqlserver_list_tables",
            "sqlserver_describe_table",
            "sqlserver_query",
          ],
        },
        source: "builtin",
      }),
    ]);
  });

  it("preserves credential whitespace exactly as entered", () => {
    expect(
      buildSqlServerBuiltinMcpServers({
        SQL_SERVER_USERNAME: " readonly ",
        SQL_SERVER_PASSWORD: "  secret  ",
      } as never),
    ).toEqual([
      expect.objectContaining({
        env: {
          SQL_SERVER_SERVER: ".",
          SQL_SERVER_USERNAME: " readonly ",
          SQL_SERVER_PASSWORD: "  secret  ",
        },
      }),
    ]);
  });

  it("suppresses the server when optional values are invalid", () => {
    expect(
      buildSqlServerBuiltinMcpServers({
        SQL_SERVER_USERNAME: "readonly",
        SQL_SERVER_PASSWORD: "secret",
        SQL_SERVER_PORT: "nope",
      } as never),
    ).toEqual([]);
  });
});

describe("MANAGED_SQL_SERVER_BUILTIN_SERVER_IDS", () => {
  it("tracks the SQL Server built-in id", () => {
    expect(MANAGED_SQL_SERVER_BUILTIN_SERVER_IDS).toEqual([SQL_SERVER_BUILTIN_SERVER_ID]);
  });
});
