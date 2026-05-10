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

| table | primary key | what it tells you |
|---|---|---|
| `ticket_runs` | `run_id` | run status, mission_phase, status_message |
| `ticket_run_attempts` | `attempt_id` | per-attempt `status`, `summary`, started/completed |
| `mission_events` | `id` | full action timeline: `stage`, `event_type`, `metadata_json`, `occurred_at` — joins on `run_id` + `attempt_id` |
| `provider_usage_records` | `id` | per-turn `provider`, `model`, `input_tokens`, `output_tokens`, `latency_ms` — the *only* place latency is recorded |

Heads-up: tables generally use domain-prefixed PKs (`run_id`, `attempt_id`, `event_id`) rather than a generic `id` column. `SELECT id FROM ticket_runs` will throw `no such column`.

`mission_events` rows like `attempt-action`, `attempt-awaiting-permission`, `attempt-permission-resolved`, `attempt-finished` give a turn-by-turn view of what the assistant did and when. This is how you confirm whether a "turn timeout" was a stalled tool, an actively-working assistant, or a race. For latency analysis, prefer `provider_usage_records.latency_ms` over diffing `mission_events.occurred_at` — the SDK adapter records the whole-turn latency on the result message.

Schema lives in [packages/memory-db/src/database/migrations.ts](packages/memory-db/src/database/migrations.ts).

## Running tests

Always go through pnpm filters; don't try `yarn` or `npm`:

```powershell
pnpm -F @spira/backend exec vitest run <relative/path/to.test.ts>
pnpm -F @spira/renderer exec vitest run <...>
```

`*.suite.ts` files are *imported* by sibling `*.test.ts` files, not run directly — vitest will say "No test files found" if you target a `.suite.ts`. The aggregator file is usually `<name>.test.ts` next to the suites (e.g. `session-manager.test.ts` pulls in `session-manager.*.suite.ts`).

Paths passed via `-F <pkg> exec vitest run …` must be relative to the *package* (`src/runtime/…`), not the repo root. The `pnpm -F` form sometimes resolves "No test files found" for repo-root paths — when in doubt `cd packages/<pkg>` first.

For a quick "did I break the world" sweep after touching the backend, type-check with `cd packages/backend && pnpm exec tsc --noEmit` (silent exit-0 means clean; output is buffered).

## Shell quirks

- The Bash tool's stdout sometimes gets clobbered (output file ENOENT). When that happens, fall back to PowerShell with `| Out-File -FilePath ... -Encoding utf8 -Width 400` then Read the file.
- `pnpm` is on PATH; raw `vitest`, `tsc` etc. are not — always go through `pnpm exec` or a workspace script.

## Where things live (quick map)

- Backend runtime / session manager: [packages/backend/src/runtime](packages/backend/src/runtime)
  - Turn watchdog timeouts: [session-manager/shared.ts](packages/backend/src/runtime/session-manager/shared.ts) (`TURN_HARD_TIMEOUT_MS`, `TURN_ACTIVITY_TIMEOUT_MS`, `TURN_FIRST_ACTIVITY_TIMEOUT_MS`)
  - `sendMessageAndAwaitResponse` (mission/repair entry point): [station-registry.ts](packages/backend/src/runtime/station-registry.ts)
- Mission lifecycle / attempts / repair logic: [packages/backend/src/missions/ticket-runs.ts](packages/backend/src/missions/ticket-runs.ts)
- Mission-pass dispatch wiring: [packages/backend/src/index.ts](packages/backend/src/index.ts) (`repairMissionPass`, `MISSION_WORKFLOW_RESPONSE_TIMEOUT_MS`)

### Provider / tool plumbing

Six providers ship in this repo: `copilot`, `claude-agent`, `azure-openai`, `openai`, plus the `-escalation` variants. The canonical list lives in [packages/shared/src/model-provider.ts](packages/shared/src/model-provider.ts); each adapter lives at `packages/backend/src/provider/<id>/adapter.ts`. They all implement the `ProviderClient` interface from [provider/types.ts](packages/backend/src/provider/types.ts).

- **Tool surface assembly:** [runtime/capability-tools.ts](packages/backend/src/runtime/capability-tools.ts) builds the full `RuntimeCapabilityDefinition[]` for a session (host tools + MCP tools + synthetic mission/delegation tools). Each definition carries `suppressForProviders: ProviderId[]`. The projection happens in [runtime/capability-registry.ts](packages/backend/src/runtime/capability-registry.ts) via `getProviderToolManifest({ providerId })`. To hide a tool from one provider only, add the provider id to its `suppressForProviders`.
- **Host-tool re-implementations** (Spira's own `view` / `glob` / `rg` / `write_file` / `apply_patch` / PowerShell-session tools): [runtime/host-tools.ts](packages/backend/src/runtime/host-tools.ts). The `NATIVE_HOST_TOOL_OVERLAP_NAMES` set in `capability-tools.ts` is what suppresses these for providers that bring their own native equivalents (currently `copilot` and `claude-agent`).
- **System prompt assembly:** [runtime/session-config.ts](packages/backend/src/runtime/session-config.ts) builds `ProviderSystemMessage` as named sections (`identity`, `tone`, `custom_instructions`, `last_instructions`, optional `runtime_recovery`) with per-section `action: "replace" | "append"`. `providerId` is in scope here — branch on it when a section only applies to certain providers (e.g. `HOST_EDITING_TOOL_INSTRUCTIONS` is skipped for `claude-agent`).
- **Claude Agent adapter:** [packages/backend/src/provider/claude-agent/adapter.ts](packages/backend/src/provider/claude-agent/adapter.ts). Uses Claude Code's SDK presets (`tools: { preset: "claude_code" }`, `systemPrompt: { preset: "claude_code", append }`) — do NOT regress to custom replacements; see memory `feedback_claude_provider_presets`. Spira's mission/delegation tools still ride alongside via an in-process MCP server (`mcp__spira-tools__*`). Tool names without that prefix are Claude Code built-ins and `buildCanUseTool` auto-allows them.
- **SDK location:** `@anthropic-ai/claude-agent-sdk` resolves under `node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@<ver>_zod@<ver>/…` — useful when you need to read its `.d.ts` for option shapes (`Options`, `Query`, `SDKMessage`, etc.).
