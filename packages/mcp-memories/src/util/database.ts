import { SPIRA_MEMORY_DB_PATH_ENV, SpiraMemoryDatabase } from "@spira/memory-db";

let database: SpiraMemoryDatabase | null = null;

export const getMemoryDatabase = (): SpiraMemoryDatabase => {
  if (database) {
    return database;
  }

  const databasePath = process.env[SPIRA_MEMORY_DB_PATH_ENV]?.trim();
  if (!databasePath) {
    throw new Error(`Spira memory database path is unavailable. Expected ${SPIRA_MEMORY_DB_PATH_ENV}.`);
  }

  database = SpiraMemoryDatabase.open(databasePath);
  return database;
};
