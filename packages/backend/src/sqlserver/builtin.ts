import type { Env, McpServerConfig } from "@spira/shared";

export const SQL_SERVER_BUILTIN_SERVER_ID = "sql-server";
export const MANAGED_SQL_SERVER_BUILTIN_SERVER_IDS = [SQL_SERVER_BUILTIN_SERVER_ID] as const;

const SQL_SERVER_READONLY_TOOLS = [
  "sqlserver_list_databases",
  "sqlserver_list_schemas",
  "sqlserver_list_tables",
  "sqlserver_describe_table",
  "sqlserver_query",
] as const;
type SqlServerEnvKey =
  | "SQL_SERVER_PORT"
  | "SQL_SERVER_ENCRYPT"
  | "SQL_SERVER_TRUST_SERVER_CERTIFICATE"
  | "SQL_SERVER_ROW_LIMIT"
  | "SQL_SERVER_TIMEOUT_MS"
  | "SQL_SERVER_ALLOWED_DATABASES";

const trimOptional = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const getCredentialValue = (value: string | undefined): string | undefined =>
  value !== undefined && value.trim().length > 0 ? value : undefined;

const isBooleanLike = (value: string): boolean => /^(true|false|1|0|yes|no|on|off)$/iu.test(value.trim());
const isPositiveIntegerLike = (value: string): boolean => /^\d+$/u.test(value.trim()) && Number(value.trim()) > 0;

export const hasSqlServerCredentials = (env: Env): boolean =>
  Boolean(getCredentialValue(env.SQL_SERVER_USERNAME) && getCredentialValue(env.SQL_SERVER_PASSWORD));

const buildBuiltinEnv = (env: Env): Record<string, string> | null => {
  const username = getCredentialValue(env.SQL_SERVER_USERNAME);
  const password = getCredentialValue(env.SQL_SERVER_PASSWORD);
  if (!username || !password) {
    return null;
  }

  const builtInEnv: Record<string, string> = {
    SQL_SERVER_SERVER: trimOptional(env.SQL_SERVER_SERVER) ?? ".",
    SQL_SERVER_USERNAME: username,
    SQL_SERVER_PASSWORD: password,
  };

  const optionalValues: Array<[SqlServerEnvKey, (value: string) => boolean]> = [
    ["SQL_SERVER_PORT", isPositiveIntegerLike],
    ["SQL_SERVER_ENCRYPT", isBooleanLike],
    ["SQL_SERVER_TRUST_SERVER_CERTIFICATE", isBooleanLike],
    ["SQL_SERVER_ROW_LIMIT", isPositiveIntegerLike],
    ["SQL_SERVER_TIMEOUT_MS", isPositiveIntegerLike],
    ["SQL_SERVER_ALLOWED_DATABASES", () => true],
  ];

  for (const [key, validate] of optionalValues) {
    const value = trimOptional(env[key]);
    if (!value) {
      continue;
    }
    if (!validate(value)) {
      return null;
    }
    builtInEnv[key] = value;
  }

  return builtInEnv;
};

export const buildSqlServerBuiltinMcpServers = (env: Env): McpServerConfig[] => {
  const builtInEnv = buildBuiltinEnv(env);
  if (!builtInEnv) {
    return [];
  }

  return [
    {
      id: SQL_SERVER_BUILTIN_SERVER_ID,
      name: "SQL Server",
      description: "Read-only SQL Server tools backed by a dedicated SQL login and database allowlist guardrails.",
      transport: "stdio",
      command: "node",
      args: ["packages/mcp-sql-server/dist/index.js"],
      env: builtInEnv,
      toolAccess: {
        readOnlyToolNames: [...SQL_SERVER_READONLY_TOOLS],
      },
      enabled: true,
      autoRestart: true,
      maxRestarts: 3,
      source: "builtin",
    },
  ];
};
