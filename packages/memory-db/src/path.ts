import path from "node:path";

export const DEFAULT_SPIRA_MEMORY_DB_FILENAME = "spira.db";
export const SPIRA_MEMORY_DB_PATH_ENV = "SPIRA_MEMORY_DB_PATH";

export const getSpiraMemoryDbPath = (baseDirectory: string): string =>
  path.join(baseDirectory, DEFAULT_SPIRA_MEMORY_DB_FILENAME);
