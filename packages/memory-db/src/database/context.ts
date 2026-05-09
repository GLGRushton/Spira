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

/**
 * Build a WHERE clause + parameter object that pre-filters scoped intelligence rows
 * down to the project/repo subset before returning them to JS for any final filtering.
 *
 * Semantics match `matchesScopedRecord`:
 *  - When projectKey is null, returns rows for *all* projects (caller hasn't scoped).
 *  - When projectKey is provided, returns rows whose project_key is NULL (repo-agnostic) OR matches.
 *  - When repoPaths is empty, no path filter (caller hasn't scoped to specific repos).
 *  - When repoPaths is provided, returns rows whose repo_relative_path is NULL (repo-agnostic) OR is in the list.
 *
 * Indices on (project_key, repo_relative_path, updated_at DESC) are used by the SQLite planner
 * for the equality on project_key; the path filter is applied as a secondary predicate.
 */
export interface ScopedRecordFilter {
  whereClause: string;
  params: Record<string, string>;
}

export const buildScopedRecordFilter = (
  projectKey: string | null,
  repoPaths: readonly string[],
): ScopedRecordFilter => {
  const clauses: string[] = [];
  const params: Record<string, string> = {};

  if (projectKey !== null) {
    clauses.push("(project_key IS NULL OR project_key = @scopedProjectKey)");
    params.scopedProjectKey = projectKey;
  }

  if (repoPaths.length > 0) {
    const placeholders = repoPaths.map((_, index) => `@scopedRepoPath${index}`);
    clauses.push(`(repo_relative_path IS NULL OR repo_relative_path IN (${placeholders.join(", ")}))`);
    repoPaths.forEach((repoPath, index) => {
      params[`scopedRepoPath${index}`] = repoPath;
    });
  }

  return {
    whereClause: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
};
