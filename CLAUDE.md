# Spira — agent notes

Pragmatic notes from working in this repo. Add to it when you find something non-obvious that would have saved you time.

## Runtime data (live app state)

When the dev app has been running, the live SQLite memory DB sits at:

```
%APPDATA%\Electron\spira.db          (dev / unpackaged)
%APPDATA%\Spira\spira.db             (packaged build)
```

Resolved via `app.getPath("userData")` in [packages/main/src/index.ts](packages/main/src/index.ts) and exposed to the backend through `SPIRA_MEMORY_DB_PATH` ([packages/memory-db/src/path.ts](packages/memory-db/src/path.ts)). It is the source of truth for what *actually happened* during a recent session — far richer than the Electron stdout log.

**Always copy the DB before reading** (it's open by the running app). PowerShell:

```powershell
Copy-Item "$env:APPDATA\Electron\spira.db"     "$env:TEMP\spira-readonly.db"     -Force
Copy-Item "$env:APPDATA\Electron\spira.db-wal" "$env:TEMP\spira-readonly.db-wal" -Force
Copy-Item "$env:APPDATA\Electron\spira.db-shm" "$env:TEMP\spira-readonly.db-shm" -Force
```

There's no `sqlite3` CLI on this machine. Use `better-sqlite3` from node — pnpm hoists it to a versioned path, so a `.cjs` script with an absolute require works:

```js
const Database = require("C:/GitHub/Spira/node_modules/.pnpm/better-sqlite3@<ver>/node_modules/better-sqlite3");
```

Tables most useful for incident triage:

| table | what it tells you |
|---|---|
| `ticket_runs` | run status, mission_phase, status_message |
| `ticket_run_attempts` | per-attempt `status`, `summary`, started/completed |
| `mission_events` | full action timeline: `stage`, `event_type`, `metadata_json`, `occurred_at` |

`mission_events` rows like `attempt-action`, `attempt-awaiting-permission`, `attempt-permission-resolved`, `attempt-finished` give a turn-by-turn view of what the assistant did and when. This is how you confirm whether a "turn timeout" was a stalled tool, an actively-working assistant, or a race.

Schema lives in [packages/memory-db/src/database/migrations.ts](packages/memory-db/src/database/migrations.ts).

## Running tests

Always go through pnpm filters; don't try `yarn` or `npm`:

```powershell
pnpm -F @spira/backend exec vitest run <relative/path/to.test.ts>
pnpm -F @spira/renderer exec vitest run <...>
```

`*.suite.ts` files are *imported* by sibling `*.test.ts` files, not run directly — vitest will say "No test files found" if you target a `.suite.ts`.

## Shell quirks

- The Bash tool's stdout sometimes gets clobbered (output file ENOENT). When that happens, fall back to PowerShell with `| Out-File -FilePath ... -Encoding utf8 -Width 400` then Read the file.
- `pnpm` is on PATH; raw `vitest`, `tsc` etc. are not — always go through `pnpm exec` or a workspace script.

## Where things live (quick map)

- Backend runtime / session manager: [packages/backend/src/runtime](packages/backend/src/runtime)
  - Turn watchdog timeouts: [session-manager/shared.ts](packages/backend/src/runtime/session-manager/shared.ts) (`TURN_HARD_TIMEOUT_MS`, `TURN_ACTIVITY_TIMEOUT_MS`, `TURN_FIRST_ACTIVITY_TIMEOUT_MS`)
  - `sendMessageAndAwaitResponse` (mission/repair entry point): [station-registry.ts](packages/backend/src/runtime/station-registry.ts)
- Mission lifecycle / attempts / repair logic: [packages/backend/src/missions/ticket-runs.ts](packages/backend/src/missions/ticket-runs.ts)
- Mission-pass dispatch wiring: [packages/backend/src/index.ts](packages/backend/src/index.ts) (`repairMissionPass`, `MISSION_WORKFLOW_RESPONSE_TIMEOUT_MS`)
- Claude Agent provider adapter: [packages/backend/src/provider/claude-agent/adapter.ts](packages/backend/src/provider/claude-agent/adapter.ts)
