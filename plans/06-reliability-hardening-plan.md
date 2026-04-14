# Reliability hardening plan

## Problem
Spira already passes its current baseline (`test`, `typecheck`, `lint`), but the codebase still has several reliability gaps at process boundaries and failure seams. The main risk is not obvious breakage; it is silent degradation, incomplete recovery, and logs that stop short of naming the exact cause.

The most important findings from the sweep:
- Cross-process faults are unevenly logged. `packages\main\src\ipc-bridge.ts` drops socket error details, and `packages\main\src\backend-lifecycle.ts` discards backend exit codes.
- The backend has local error helpers, but global fatal capture is incomplete. `packages\backend\src\index.ts` handles shutdown signals, not `uncaughtException` / `unhandledRejection`.
- Several boundaries trust casts instead of runtime validation, especially `packages\backend\src\server.ts` and JSON-backed discovery/config paths.
- Recovery behavior exists in concept more than execution. MCP config exposes `autoRestart` / `maxRestarts`, but `packages\backend\src\mcp\registry.ts` does not wire those settings into crash recovery.
- Renderer and UI code often logs directly with `console.error`, which gives fragments, not correlated traces. Post-boot unhandled rejections are especially underreported.
- Networked integrations and delegated agents use timeouts in some places, but budgets, retries, and diagnostic context are inconsistent across YouTrack, Nexus, IPC, subagents, and voice.
- Opus also confirmed a few concrete priority defects: upgrade state can become permanently wedged after a failed relaunch path in `packages\main\src\upgrade-orchestrator.ts`, streaming state in `packages\renderer\src\stores\chat-store.ts` is vulnerable to abort/delta races, most MCP server entry points do not shut down gracefully, and `packages\backend\src\voice\stt.ts` needs an enforced timeout around Whisper execution rather than trusting the subprocess to behave.

## Approach
Make the system harder to kill in two layers:
1. **Failure attribution first**: every crash, timeout, protocol mismatch, rejected promise, and degraded mode must emit a structured, correlated log with the exact failing boundary and context.
2. **Recovery second**: once cause visibility is reliable, add bounded retries, restart supervision, circuit breakers, partial-result strategies, and failure-oriented tests so transient faults self-heal instead of sticking.

## Phases

### Phase 0 - Define the failure spine
Build a common reliability contract across main, backend, renderer, subagents, MCP, and external integrations.

Work:
- Standardize structured logging fields: `requestId`, `runId`, `stationId`, `serverId`, `conversationId`, `proposalId`, `process`, `component`, `operation`.
- Fix logger configuration so production honors production log levels instead of forcing debug.
- Add global fatal handlers in backend and main for uncaught exceptions and unhandled rejections.
- Route renderer post-boot unhandled rejections into the same reporting path as renderer fatal capture, but distinguish fatal vs degraded events.
- Replace ad hoc `console.error` in key runtime paths with shared structured logging or explicit renderer-to-main reporting.
- Add structured logging coverage in the current blind spots, especially MCP server entry points and `memory-db`, so process, DB, and tool failures stop disappearing into stderr or silence.
- Decide on persistent production log storage, retention, and redaction rules.

Primary file areas:
- `packages\backend\src\util\logger.ts`
- `packages\backend\src\index.ts`
- `packages\main\src\index.ts`
- `packages\main\src\backend-lifecycle.ts`
- `packages\main\src\ipc-bridge.ts`
- `packages\renderer\src\main.tsx`
- `packages\renderer\src\stores\settings-store.ts`
- `packages\renderer\src\components\projects\ProjectsPanel.tsx`

Acceptance shape:
- A single failed user action can be traced across process boundaries.
- A backend crash log includes exit code, signal, last known phase, and correlation identifiers.
- Renderer fatal and non-fatal async failures are visible instead of disappearing after boot.

### Phase 1 - Seal runtime boundaries
Stop trusting ambient types at runtime. Every external or cross-process boundary should reject malformed input loudly and precisely.

Work:
- Add runtime validation for inbound `ClientMessage` payloads in `packages\backend\src\server.ts`.
- Validate JSON-backed discovery/config files instead of casting parsed content.
- Tighten runtime config and auth validation so empty-but-present secrets fail cleanly.
- Validate MCP tool outputs against declared schemas where available.
- Audit upgrade, IPC, and MCP transport messages for typed boundary checks instead of loose casts.

Primary file areas:
- `packages\backend\src\server.ts`
- `packages\shared\src\config-schema.ts`
- `packages\mcp-util\src\spira-ui-bridge-client.ts`
- `packages\backend\src\mcp\client-pool.ts`
- `packages\main\src\ipc-bridge.ts`

Acceptance shape:
- Invalid payloads fail with explicit codes and boundary-specific messages.
- Corrupt discovery/config state is detected on load, not later as vague transport errors.
- Protocol drift becomes diagnosable within one log chain.

### Phase 2 - Make recovery real
Wire the restart and retry surfaces that already exist on paper into actual supervision behavior.

Work:
- Implement MCP auto-restart with exponential backoff, restart budgets, sticky-failure diagnostics, and surfaced remediation hints.
- Upgrade backend child supervision to record restart history, last crash metadata, and bounded retry exhaustion.
- Rework IPC request timeout layering so slow-but-valid flows do not self-desynchronize.
- Give subagent runs richer timeout diagnostics, better retry policy, and precise in-flight tool context on failure.
- Normalize retry and timeout helpers so YouTrack, Nexus, voice, and subagent code do not each improvise their own failure semantics.
- Add periodic backend health checks after startup, fix upgrade-orchestrator state reset paths, enforce STT timeouts, and make all MCP child processes participate in graceful shutdown so recovery is not left to luck.

Primary file areas:
- `packages\backend\src\mcp\registry.ts`
- `packages\backend\src\subagent\subagent-runner.ts`
- `packages\backend\src\util\timers.ts`
- `packages\main\src\backend-lifecycle.ts`
- `packages\main\src\ipc-bridge.ts`
- `packages\backend\src\youtrack\service.ts`
- `packages\mcp-nexus-mods\src\util\nexus-client.ts`

Acceptance shape:
- Transient MCP and backend faults self-recover when policy allows.
- Permanent faults stop retrying noisily and surface exact exhaustion reasons.
- Timeout failures name the operation, budget, attempt, and active dependency.

### Phase 3 - Harden integration and state integrity
Make persistence, startup, and external services degrade predictably instead of drifting into half-alive states.

Work:
- Audit persistence open/load paths for concurrency and corruption handling, especially memory database access and runtime config stores.
- Add atomic write/read validation where config or discovery files can be partially written.
- Improve YouTrack pagination and external fetch behavior with page caps, partial-result strategies, and operation-specific error reporting.
- Verify rollback paths for settings, runtime config application, MCP config mutation, and upgrade orchestration.
- Surface degraded-mode state clearly when optional capabilities are unavailable.

Primary file areas:
- `packages\memory-db\src\database.ts`
- `packages\mcp-memories\src\util\database.ts`
- `packages\main\src\index.ts`
- `packages\backend\src\youtrack\service.ts`
- `packages\main\src\upgrade-orchestrator.ts`
- `packages\backend\src\projects\registry.ts`

Acceptance shape:
- Corrupt or unavailable persisted state enters an explicit degraded mode with cause and recovery hint.
- External integrations can fail partially without erasing already-valid work.
- State rollback paths are deterministic and logged.

### Phase 4 - Expand failure-oriented test coverage
The current suite is healthy, but most of its value is in correctness, not destructive-path confidence.

Work:
- Add tests for backend crash handling, restart exhaustion, and fatal signal capture.
- Add tests for invalid IPC / WebSocket payloads and protocol mismatch behavior.
- Add tests for MCP crash-restart loops, stderr diagnostics, and output schema violations.
- Add tests for subagent session timeout, retry exhaustion, permission interruptions, and cleanup failures.
- Add tests for renderer boot vs runtime errors, post-boot unhandled rejections, and degraded UI states.
- Add tests for external integration timeout, partial-result, and cancellation behavior.

Primary file areas:
- `packages\main\src\ipc-bridge.test.ts`
- `packages\main\src\upgrade-orchestrator.test.ts`
- `packages\backend\src\mcp\registry.test.ts`
- `packages\backend\src\subagent\subagent-runner.test.ts`
- `packages\backend\src\youtrack\service.test.ts`
- `packages\backend\src\voice\pipeline.test.ts`
- `packages\renderer\src\renderer-fatal.test.ts`

Acceptance shape:
- Every major failure mode has a reproducible test.
- Retry, timeout, and degraded-mode behavior stop being “best effort” and become contractually verified.

### Phase 5 - Add operational diagnostics
Give Spira an explicit way to explain its condition while alive, not only after it falls over.

Work:
- Add a backend health/diagnostics payload covering uptime, restart count, last crash metadata, MCP states, subagent health, and degraded capabilities.
- Add a lightweight diagnostics/export surface so the relevant logs can be attached to investigations.
- Expose failure counters and sticky warnings in the UI for backend restart loops, MCP crash loops, and repeated integration failures.
- Define release gates for reliability-critical paths before future feature merges.

Primary file areas:
- `packages\backend\src\index.ts`
- `packages\shared\src\protocol.ts`
- `packages\renderer\src\components\*`
- `packages\main\src\index.ts`

Acceptance shape:
- Operators can inspect live health without guessing from incidental logs.
- Users see actionable degraded-state messaging instead of generic “something broke”.

## Execution notes
- Do **Phase 0 before broad retry work**. Recovery without attribution just creates louder mysteries.
- Start implementation in the runtime seams with the highest leverage: backend lifecycle, IPC bridge, renderer fatal capture, MCP registry, subagent runner.
- Keep `upgrade-orchestrator`, `chat-store`, MCP server entry points, and Whisper STT near the top of the first implementation slice; Opus turned those from suspicions into named defects.
- Preserve the current green baseline while expanding destructive-path coverage.
- Treat `console.error`, empty `catch {}`, and cast-only boundary parsing as explicit audit targets.
- Opus remained in long-running deep audit while this plan was assembled; Sonnet’s completed sweep materially reinforced the same priorities rather than changing direction.
