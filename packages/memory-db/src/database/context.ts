import type { SqliteDatabase } from "./helpers.js";

export interface DatabasePersistenceContext {
  db: SqliteDatabase;
  isReadonly: boolean;
}

export const assertDatabaseWritable = (context: Pick<DatabasePersistenceContext, "isReadonly">): void => {
  if (context.isReadonly) {
    throw new Error("The memory database is open in read-only mode.");
  }
};

export const matchesScopedRecord = (
  entry: { projectKey: string | null; repoRelativePath: string | null },
  projectKey: string | null,
  repoPathSet: ReadonlySet<string>,
): boolean => {
  const projectMatches = entry.projectKey === null || (projectKey !== null && entry.projectKey === projectKey);
  const repoMatches =
    entry.repoRelativePath === null || repoPathSet.size === 0 || repoPathSet.has(entry.repoRelativePath);
  return projectMatches && repoMatches;
};
