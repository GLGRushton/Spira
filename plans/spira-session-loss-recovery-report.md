# Spira session loss and recovery report

_Investigated by Shinra, Claude Sonnet 4.6, and Claude Opus 4.6._

## Scope

The exact crash that dropped the live coding session happened outside the repository's direct control, so this report cannot name the outer runtime failure with certainty. What it can do - and what all three review passes converged on - is explain why session loss feels severe when it happens, which recovery seams are already present in Spira, and which gaps still turn a crash into archaeology.

## What likely happened

The failure was probably a layered event rather than one single dramatic explosion:

1. A live runtime layer disappeared or restarted (renderer reload, backend child restart, remote Copilot session expiry, or a combination).
2. Durable state survived, but only partially: Spira persists conversation history, station conversation IDs, and Copilot session IDs in SQLite.
3. Live in-flight state did not survive: streaming assistant text, pending tool calls, permission requests, and renderer store state are mostly volatile.
4. Recovery therefore fell back to a lossy continuity path rather than a true resume: a compressed "[Recovered context]" preamble plus whatever conversation/archive state the UI could still load.

That is why the recovered session felt half-there. The bones existed; the connective tissue did not.

## What already helps

Spira is not starting from nothing. The codebase already has a few solid recovery pieces:

- `StationRegistry` persists per-station Copilot session IDs and active conversation IDs into `session_state`.
- `CopilotSessionManager` can call `resumeSession()` with the persisted SDK session ID.
- `SpiraMemoryDatabase` stores full archived conversations and session-state keys.
- `buildContinuityPreamble()` gives the model a fallback summary when session resume is unavailable.
- The renderer can load stored conversations through the archive UI.
- This branch already improved fatal-process capture in backend and main, which makes future incident trails less ghostly.

The problem is that these pieces stop one layer short of a high-fidelity restore.

## Findings

| Priority | Finding | Evidence | Why it matters |
|---|---|---|---|
| P0 | Recovery falls back too easily from live session state to a lossy preamble | `session-manager.ts` persists/resumes only the Copilot session ID; once live state is gone, the recovery path relies on `continuity.ts` and a freshly created session | A resumed conversation can come back with only a summary of the prior thread instead of the real live context |
| P0 | The continuity preamble is narrow and intentionally lossy | `continuity.ts` caps recovery at 6 memory entries, 8 messages, and 3000 total characters | Long technical sessions lose too much detail during fallback recovery |
| P0 | The renderer does not proactively rehydrate the authoritative transcript after reconnect | `register-chat-handlers.ts` clears transient state and requests station summaries on `backend:hello`, but it does not fetch the full conversation transcript from SQLite | Users can reconnect into a warning banner and a thin/stale transcript even though the database still knows more |
| P1 | In-flight assistant and tool state is volatile | `StationRegistry` keeps `pendingToolCalls`, station state, and bus wiring in memory; assistant messages are persisted at response end, not incrementally during streaming | A mid-stream crash loses the assistant half of the turn and what the tools were doing |
| P1 | Replay recovery is only partially station-aware | `preload.ts` now keys replay cache by station, but `ipc-bridge.ts` still caches replayable messages by message type only | Multi-station recovery can still smear one station's last-known state across another |
| P1 | MCP crash recovery is still mostly manual | `autoRestart` / `maxRestarts` exist in config and DB, but the registry does not yet use them to restart crashed servers | A tool capability can silently stay dead until a human re-enables it |
| P2 | There is no durable crash breadcrumb trail | `BackendLifecycle` now emits richer exit info, but restart history and last-crash metadata are not persisted into the archive DB/session state | The next recovery step starts without a trustworthy incident trail |
| P2 | There is no proactive session health check | Copilot session expiry is detected reactively on the next send rather than by heartbeat/TTL awareness | Recovery often starts only after the user has already hit the broken edge |

## How to lose sessions less

### 1. Make live session recovery less fragile

- **Fix the recovery gate in `CopilotSessionManager`.** When a stale live handle forces creation of a fresh Copilot session, always inject continuity context into that first fresh send. The decision should follow the actual resume/create outcome, not merely whether a stale handle existed earlier in process memory.
- **Add a lightweight Copilot session health probe.** A periodic validity check or TTL-aware refresh would let Spira re-establish context before the next user turn discovers the session died.
- **Persist richer station checkpoints.** Today Spira persists session IDs and conversation IDs. It should also checkpoint the current assistant message ID, in-flight tool calls, last known station state, pending permission requests, and last backend generation.

### 2. Make cross-process recovery real instead of polite

- **Persist crash metadata into SQLite/session state.** Keep the last crash time, exit code/signal, retry count, and whether recovery exhausted itself.
- **Wire MCP `autoRestart` / `maxRestarts` into crash handling.** The configuration surface already exists; it needs an actual supervisor path.
- **Finish station-scoped replay in `ipc-bridge.ts`.** `preload.ts` is now safer; the bridge cache should match it so replay is correct across stations.

### 3. Preserve partial work instead of only finished work

- **Persist assistant streaming progress incrementally.** A debounced partial-message write would turn a crash from "assistant reply vanished" into "assistant reply was interrupted here."
- **Persist tool-call progress earlier.** Users should be able to recover not just the conversation text, but what the system was in the middle of doing.

## How to recover better when session loss still happens

### 1. Rehydrate the transcript automatically

- On `backend:hello` plus generation change, fetch the active conversation from the database and hydrate the renderer from durable state instead of only showing a warning.
- Make the warning actionable: add a **Reload from history** / **Restore transcript** action instead of passive text.

### 2. Widen the continuity fallback

- Raise the continuity budget beyond the current 3000-character cap.
- Include more recent turns than the current 8-message limit.
- Consider a second recovery path that can attach a richer archive-derived summary when the conversation is obviously long-running and technical.

### 3. Make the UI explicit about what was recovered

- Distinguish **live session resumed**, **fresh session created from recovered context**, and **transcript restored from archive only**.
- Show interrupted tool calls / partial assistant turns as such, rather than letting them disappear into silence.
- Surface last-crash diagnostics and recovery suggestions where the user already is, not one room deeper.

## Recommended order

1. **P0:** fix the session-recovery gate, widen the continuity budget, and auto-rehydrate the transcript on reconnect.
2. **P1:** persist partial assistant/tool state and finish station-aware replay in the IPC bridge.
3. **P1:** wire MCP auto-restart into the registry so session capability loss is no longer so sticky.
4. **P2:** add durable crash breadcrumbs and a lightweight session-health probe.
5. **P2:** add explicit UI states that tell the user exactly what was resumed, what was reconstructed, and what was lost.

## Bottom line

All three review passes agreed on the same core truth: **Spira has durable context, but not yet durable live state**. When the happy path breaks, the system can usually recover a summary, not the actual moment. Tightening that gap - by persisting more of the in-flight session, rehydrating more aggressively from SQLite, and making recovery states explicit - is the clearest path to losing fewer sessions and making the next inevitable crash feel far less catastrophic.
