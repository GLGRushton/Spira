import type { SqlServerRuntimeConfig } from "./env.js";

const FORBIDDEN_SQL_KEYWORDS =
  /\b(insert|update|delete|drop|alter|create|exec|execute|merge|truncate|grant|revoke|deny|backup|restore|reconfigure|shutdown|kill|use|declare|set|into|openquery|openrowset|opendatasource)\b/iu;

const stripCommentsAndLiterals = (sql: string): string => {
  let output = "";
  let index = 0;
  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];

    if (current === "-" && next === "-") {
      while (index < sql.length && sql[index] !== "\n") {
        output += " ";
        index += 1;
      }
      continue;
    }

    if (current === "/" && next === "*") {
      output += "  ";
      index += 2;
      while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) {
        output += sql[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      if (index < sql.length) {
        output += "  ";
        index += 2;
      }
      continue;
    }

    if (current === "'") {
      output += " ";
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          output += "  ";
          index += 2;
          continue;
        }
        output += sql[index] === "\n" ? "\n" : " ";
        if (sql[index] === "'") {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (current === '"') {
      output += " ";
      index += 1;
      while (index < sql.length) {
        output += sql[index] === "\n" ? "\n" : " ";
        if (sql[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (current === "[") {
      output += " ";
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "]" && sql[index + 1] === "]") {
          output += "  ";
          index += 2;
          continue;
        }
        output += sql[index] === "\n" ? "\n" : " ";
        if (sql[index] === "]") {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    output += current;
    index += 1;
  }

  return output;
};

export const assertReadOnlyQuery = (query: string): string => {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("A SQL query is required.");
  }

  const stripped = stripCommentsAndLiterals(trimmed);
  const statements = stripped
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  if (statements.length !== 1) {
    throw new Error("Only a single SQL statement is allowed per call.");
  }

  const statement = statements[0];
  if (!statement) {
    throw new Error("A SQL query is required.");
  }
  const normalizedStatement = statement.toLowerCase();
  const firstKeyword = normalizedStatement.match(/\b[a-z_][a-z0-9_]*\b/u)?.[0];
  if (firstKeyword !== "select" && firstKeyword !== "with") {
    throw new Error("Only SELECT statements or CTEs that end in SELECT are allowed.");
  }
  if (firstKeyword === "with" && !/\bselect\b/iu.test(normalizedStatement)) {
    throw new Error("CTE queries must end in a SELECT statement.");
  }
  const forbiddenKeyword = normalizedStatement.match(FORBIDDEN_SQL_KEYWORDS)?.[0];
  if (forbiddenKeyword) {
    throw new Error(`Only read-only SQL is allowed. Found forbidden keyword "${forbiddenKeyword.toUpperCase()}".`);
  }

  return trimmed.replace(/;\s*$/u, "");
};

export const resolveDatabaseName = (config: SqlServerRuntimeConfig, database: string): string => {
  const trimmed = database.trim();
  if (!trimmed) {
    throw new Error("A database name is required.");
  }
  if (config.allowedDatabases.length === 0) {
    return trimmed;
  }

  const match = config.allowedDatabases.find((candidate) => candidate.toLowerCase() === trimmed.toLowerCase());
  if (!match) {
    throw new Error(`Database "${trimmed}" is not in the configured SQL Server allowlist.`);
  }
  return match;
};
