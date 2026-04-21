# SQL Server read-only MCP server plan

## Problem

Add a built-in Spira MCP server that gives SQL Server **read-only** access using a **dedicated SQL login**, not Windows authentication. The server should feel native inside Spira, expose a small read-focused tool surface, and keep the blast radius tight with both database permissions and app-side guardrails.

## Agreed approach

1. **V1 requires SQL credentials for a dedicated read-only login.** No Windows auth in the first cut.
2. **Use structured config, not a raw connection string.** Target fields: server (default `"."`), username, password, optional port, encrypt, trustServerCertificate, allowedDatabases, row cap, and timeout cap.
3. **Treat `"."` as a UX alias, not a driver literal.** Normalize local aliases (`"."`, `"(local)"`, possibly `localhost`) to a driver-safe local host value internally.
4. **Register the server as a dynamic built-in**, following the existing YouTrack pattern, so it appears only when SQL Server config is present.
5. **Prefer Spira secure runtime config for user-supplied values**, with `.env` parity for local/dev bootstrapping. Credentials must not live in `mcp-servers.json`.
6. **Rely on least privilege first, then guardrails.** The SQL login should only have `db_datareader` (or equivalent explicit `SELECT`) on the intended databases. The MCP server still rejects anything outside the read-only contract.
7. **Keep writes out of V1.** If write support ever arrives, it should be a separate explicit mode/tool surface, not a quiet expansion of the read-only server.

## Recommended server shape

### Built-in ID

- `sql-server`

### Tool surface

1. `sqlserver_list_databases`
2. `sqlserver_list_schemas`
3. `sqlserver_list_tables`
4. `sqlserver_describe_table`
5. `sqlserver_query`

All tools should be annotated with `readOnlyHint: true` and `idempotentHint: true`.

### Query rules

- Only a **single** statement per call
- Only **SELECT** or **CTE -> SELECT**
- Reject obvious non-read verbs (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `EXEC`, `MERGE`, etc.)
- Enforce a **row cap** and **timeout cap**
- Require an explicit `database` parameter for database-scoped tools
- If `allowedDatabases` is configured, reject any database outside that list

### Connection strategy

- Use a **small lazy pool cache keyed by database name**, not one global pool for the whole server
- Keep a `master` pool for instance discovery
- Open database-specific pools on demand for `list_schemas`, `list_tables`, `describe_table`, and `query`
- Close pools on shutdown

This avoids awkward `USE <db>` gymnastics and keeps the single-statement rule intact.

## Implementation areas

### New package

- `packages/mcp-sql-server/`
  - `src/index.ts`
  - `src/tools/*.ts`
  - `src/util/env.ts`
  - `src/util/connection.ts`
  - `src/util/guard.ts`
  - `src/util/validation.ts`
  - tests alongside the util/tool modules

### Backend / config wiring

- `packages/backend/src/sqlserver/builtin.ts`
- `packages/backend/src/index.ts`
- `packages/shared/src/config-schema.ts`
- `packages/shared/src/runtime-config.ts`
- `packages/main/src/index.ts`
- `packages/renderer/src/components/SettingsPanel.tsx`

### Workspace / packaging

- `tsconfig.json`
- `vitest.workspace.ts`
- `scripts/build.ts`
- `apps/desktop/electron-builder.yml`
- `package.json` (root dev script, if we keep per-server dev helpers consistent)
- `.env.example`

## Todos

1. **scaffold-sqlserver-package**  
   Scaffold `packages/mcp-sql-server`, replace the example tool, add driver dependencies, and wire root workspace/build/package references.

2. **implement-sqlserver-config-and-pools**  
   Add config parsing/validation plus the per-database connection-pool cache. Normalize local server aliases and enforce default caps.

3. **implement-readonly-tool-surface**  
   Add the five tools, their schemas, tool annotations, result formatting, and clear errors for auth/database/query failures.

4. **implement-query-guardrails**  
   Add the read-only query gate: single statement, read-only keywords only, allowlist enforcement, row cap, timeout cap, and tests for evasive edge cases.

5. **wire-dynamic-builtin-server**  
   Add backend logic that publishes the SQL Server MCP server only when valid config exists, mirroring the YouTrack built-in pattern.

6. **extend-secure-runtime-config**  
   Add SQL Server config entries to shared runtime-config types, Electron secure storage metadata, backend env overrides, and the Settings UI group.

7. **document-and-validate**  
   Update `.env.example`, add targeted unit/integration coverage, then run the existing typecheck, test, lint, and build flows.

## Notes and considerations

- **Primary safety boundary:** the SQL login itself. App-side query checks are defense in depth, not the root trust boundary.
- **Local default nuance:** SQL client libraries do not always treat `"."` like native SQL Server tools do. We should accept it in UX, then normalize it internally.
- **Named instances / LocalDB:** not first-class in V1 unless the chosen driver handles them cleanly. V1 should target default-instance or host/port usage first.
- **Driver choice:** start with `mssql` for ergonomics, but confirm NodeNext/ESM interop immediately. If it behaves badly, drop to `tedious` rather than fight the runtime.
- **Settings UX:** secure runtime config currently stores strings; booleans and ports may need string parsing in V1 unless we choose to deepen the settings form.
- **Write support later:** should be a separate explicit feature with separate permissions, tools, and confirmation rules.
- **Planning review status:** this plan incorporates Shinra repo analysis and Sonnet review. Opus could not be consulted in this runtime because the requested model was rejected as unsupported.
