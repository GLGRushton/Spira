import path from "node:path";

type EnvInput = Record<string, string | undefined>;

const defaultEnvInput: EnvInput = (globalThis as { process?: { env?: EnvInput } }).process?.env ?? {};

export const DEFAULT_SQL_SERVER_SERVER = ".";
export const DEFAULT_SQL_SERVER_ROW_LIMIT = 200;
export const DEFAULT_SQL_SERVER_TIMEOUT_MS = 10_000;

export interface SqlServerRuntimeConfig {
  server: string;
  username: string;
  password: string;
  port?: number;
  encrypt: boolean;
  trustServerCertificate: boolean;
  allowedDatabases: string[];
  rowLimit: number;
  timeoutMs: number;
}

const loadEnvFromFile = (): void => {
  try {
    process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
};

const trimEnv = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const getCredentialEnv = (value: string | undefined): string | undefined =>
  value !== undefined && value.trim().length > 0 ? value : undefined;

const parseBooleanEnv = (value: string | undefined, key: string, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`${key} must be one of true, false, 1, 0, yes, or no.`);
};

const parseIntegerEnv = (
  value: string | undefined,
  key: string,
  fallback: number | undefined,
  bounds: { min: number; max: number },
): number | undefined => {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    throw new Error(`${key} must be an integer between ${bounds.min} and ${bounds.max}.`);
  }
  return parsed;
};

const parseAllowedDatabases = (value: string | undefined): string[] => {
  if (value === undefined) {
    return [];
  }
  const seen = new Set<string>();
  const databases: string[] = [];
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      databases.push(trimmed);
    }
  }
  return databases;
};

export const normalizeSqlServerServer = (value: string): string => {
  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase();
  if (normalized === "." || normalized === "(local)" || normalized === "localhost") {
    return "localhost";
  }
  return trimmed;
};

const hasAnySqlServerSetting = (input: EnvInput): boolean =>
  [
    "SQL_SERVER_SERVER",
    "SQL_SERVER_PORT",
    "SQL_SERVER_USERNAME",
    "SQL_SERVER_PASSWORD",
    "SQL_SERVER_ENCRYPT",
    "SQL_SERVER_TRUST_SERVER_CERTIFICATE",
    "SQL_SERVER_ALLOWED_DATABASES",
    "SQL_SERVER_ROW_LIMIT",
    "SQL_SERVER_TIMEOUT_MS",
  ].some((key) => trimEnv(input[key]) !== undefined);

export const loadSqlServerRuntimeConfig = (input: EnvInput = defaultEnvInput): SqlServerRuntimeConfig => {
  loadEnvFromFile();
  if (!hasAnySqlServerSetting(input)) {
    throw new Error("SQL Server MCP requires SQL_SERVER_USERNAME and SQL_SERVER_PASSWORD to be configured.");
  }

  const username = getCredentialEnv(input.SQL_SERVER_USERNAME);
  const password = getCredentialEnv(input.SQL_SERVER_PASSWORD);
  const rowLimit = parseIntegerEnv(
    trimEnv(input.SQL_SERVER_ROW_LIMIT),
    "SQL_SERVER_ROW_LIMIT",
    DEFAULT_SQL_SERVER_ROW_LIMIT,
    {
      min: 1,
      max: 5_000,
    },
  );
  const timeoutMs = parseIntegerEnv(
    trimEnv(input.SQL_SERVER_TIMEOUT_MS),
    "SQL_SERVER_TIMEOUT_MS",
    DEFAULT_SQL_SERVER_TIMEOUT_MS,
    {
      min: 100,
      max: 120_000,
    },
  );
  if (!username || !password) {
    throw new Error("SQL Server MCP requires SQL_SERVER_USERNAME and SQL_SERVER_PASSWORD.");
  }
  if (rowLimit === undefined || timeoutMs === undefined) {
    throw new Error("SQL Server MCP row and timeout limits must be configured with integer values.");
  }

  return {
    server: normalizeSqlServerServer(trimEnv(input.SQL_SERVER_SERVER) ?? DEFAULT_SQL_SERVER_SERVER),
    username,
    password,
    port: parseIntegerEnv(trimEnv(input.SQL_SERVER_PORT), "SQL_SERVER_PORT", undefined, { min: 1, max: 65535 }),
    encrypt: parseBooleanEnv(trimEnv(input.SQL_SERVER_ENCRYPT), "SQL_SERVER_ENCRYPT", true),
    trustServerCertificate: parseBooleanEnv(
      trimEnv(input.SQL_SERVER_TRUST_SERVER_CERTIFICATE),
      "SQL_SERVER_TRUST_SERVER_CERTIFICATE",
      false,
    ),
    allowedDatabases: parseAllowedDatabases(trimEnv(input.SQL_SERVER_ALLOWED_DATABASES)),
    rowLimit,
    timeoutMs,
  };
};
