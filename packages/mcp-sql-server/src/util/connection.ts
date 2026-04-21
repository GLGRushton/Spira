import sql from "mssql";
import type { SqlServerRuntimeConfig } from "./env.js";

interface RecordsetWithColumns extends Array<Record<string, unknown>> {
  columns?: Record<string, unknown>;
}

export interface SqlServerQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRowCount: number;
  truncated: boolean;
  rowLimit: number;
  timeoutMs: number;
}

const buildPoolConfig = (config: SqlServerRuntimeConfig, database?: string): sql.config => ({
  server: config.server,
  ...(config.port !== undefined ? { port: config.port } : {}),
  user: config.username,
  password: config.password,
  ...(database ? { database } : {}),
  options: {
    encrypt: config.encrypt,
    trustServerCertificate: config.trustServerCertificate,
    enableArithAbort: true,
  },
  pool: {
    max: 4,
    min: 0,
    idleTimeoutMillis: 30_000,
  },
  requestTimeout: config.timeoutMs,
  connectionTimeout: config.timeoutMs,
});

const getColumns = (recordset: RecordsetWithColumns): string[] =>
  recordset.columns ? Object.keys(recordset.columns) : Object.keys(recordset[0] ?? {});

const connectPool = async (config: SqlServerRuntimeConfig, database?: string): Promise<sql.ConnectionPool> => {
  const pool = new sql.ConnectionPool(buildPoolConfig(config, database));
  try {
    await pool.connect();
    return pool;
  } catch (error) {
    await pool.close().catch(() => {});
    throw error;
  }
};

export class SqlServerPoolManager {
  private masterPoolPromise: Promise<sql.ConnectionPool> | null = null;
  private readonly databasePools = new Map<string, Promise<sql.ConnectionPool>>();

  constructor(private readonly config: SqlServerRuntimeConfig) {}

  async getMasterPool(): Promise<sql.ConnectionPool> {
    if (!this.masterPoolPromise) {
      this.masterPoolPromise = connectPool(this.config, "master");
    }

    return this.masterPoolPromise;
  }

  async getDatabasePool(database: string): Promise<sql.ConnectionPool> {
    const key = database.trim().toLowerCase();
    const existing = this.databasePools.get(key);
    if (existing) {
      return existing;
    }

    const poolPromise = connectPool(this.config, database).catch((error) => {
      this.databasePools.delete(key);
      throw error;
    });
    this.databasePools.set(key, poolPromise);
    return poolPromise;
  }

  async closeAll(): Promise<void> {
    const pools = [this.masterPoolPromise, ...this.databasePools.values()].filter(
      (pool): pool is Promise<sql.ConnectionPool> => pool !== null,
    );
    this.masterPoolPromise = null;
    this.databasePools.clear();
    await Promise.allSettled(
      pools.map(async (poolPromise) => {
        const pool = await poolPromise;
        await pool.close();
      }),
    );
  }
}

export const executeSqlQuery = async (
  pool: sql.ConnectionPool,
  sqlText: string,
  config: SqlServerRuntimeConfig,
): Promise<SqlServerQueryResult> => {
  return await new Promise<SqlServerQueryResult>((resolve, reject) => {
    const request = pool.request();
    request.stream = true;

    const rows: Record<string, unknown>[] = [];
    let columns: string[] = [];
    let rowCount = 0;
    let truncated = false;
    let canceledByLimit = false;
    let settled = false;

    const finishResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        columns,
        rows,
        totalRowCount: rowCount,
        truncated,
        rowLimit: config.rowLimit,
        timeoutMs: config.timeoutMs,
      });
    };

    const finishReject = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    request.on("recordset", (recordset: RecordsetWithColumns) => {
      if (columns.length === 0) {
        columns = getColumns(recordset);
      }
    });

    request.on("row", (row: Record<string, unknown>) => {
      rowCount += 1;
      if (rows.length < config.rowLimit) {
        rows.push(row);
        if (columns.length === 0) {
          columns = Object.keys(row);
        }
        return;
      }

      truncated = true;
      if (!canceledByLimit) {
        canceledByLimit = true;
        request.cancel();
      }
    });

    request.on("error", (error: unknown) => {
      if (canceledByLimit && error instanceof Error && error.message.toLowerCase().includes("canceled")) {
        return;
      }
      finishReject(error);
    });

    request.query(sqlText, (error?: Error) => {
      if (canceledByLimit && error instanceof Error && error.message.toLowerCase().includes("canceled")) {
        finishResolve();
        return;
      }
      if (error) {
        finishReject(error);
        return;
      }
      finishResolve();
    });
  });
};

export const describeSqlServerError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("login failed")) {
    return "SQL Server login failed. Check the configured dedicated read-only username and password.";
  }
  if (
    normalized.includes("failed to connect") ||
    normalized.includes("econnrefused") ||
    normalized.includes("ehostunreach") ||
    normalized.includes("esocket")
  ) {
    return "Could not connect to SQL Server. Check the server, port, and TLS settings.";
  }
  if (normalized.includes("cannot open database")) {
    return "The requested database is unavailable to the configured SQL Server login.";
  }
  if (normalized.includes("timeout")) {
    return "SQL Server timed out before the read-only request completed.";
  }
  if (normalized.includes("permission") || normalized.includes("not able to access")) {
    return "The configured SQL Server login does not have read access to that database object.";
  }
  return message;
};
