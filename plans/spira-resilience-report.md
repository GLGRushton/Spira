# Spira resilience report

_Collated from Shinra, Claude Sonnet 4.6, and Claude Opus 4.6._

## Executive summary

Spira already has good bones: typed errors, timeouts in key places, and real restart logic. The trouble is at the seams. Fatal process failures are still under-captured, inbound payloads are trusted too early, backend lifecycle recovery stays narrow in critical moments, and several degraded states are silent when they should be obvious. The fastest resilience gains come from making failures attributable first, then recoverable.

## Highest-priority improvements

| Priority | Improvement | Evidence in repo | Why it matters | Support |
|---|---|---|---|---|
| 1 | Add global fatal handlers in backend and main, and always shut down through one path | `packages\backend\src\index.ts` handles `message`, `SIGINT`, and `SIGTERM` but not `unhandledRejection` or `uncaughtException`; `packages\main\src\index.ts` is similarly missing process-level fatal capture | Right now a bad async edge can still kill the backend quietly and leave the UI explaining very little | Shinra / Sonnet / Opus |
| 2 | Validate every inbound transport and IPC boundary at runtime | `packages\backend\src\server.ts` does `JSON.parse(raw) as ClientMessage`; `packages\main\src\preload.ts` still carries a TODO about replay cache correctness for multi-station flows; several config/discovery loads still rely on trusted shapes | Type safety at compile time is excellent; type safety at runtime is not yet equally disciplined | Shinra / Sonnet / Opus |
| 3 | Harden backend lifecycle and upgrade recovery paths | `packages\main\src\backend-lifecycle.ts` retries only three times and mostly reports through stderr; `packages\main\src\upgrade-orchestrator.ts` still has narrow recovery paths around restart and refresh state | When restart logic is under-specified, the system survives normal work and then folds at exactly the moment users need it most | Shinra / Sonnet / Opus |
| 4 | Make voice and capture failures explicit instead of silent | `packages\backend\src\voice\audio-capture.ts` logs read-loop failure and stops capture; `packages\backend\src\voice\stt.ts` swallows temp-file cleanup failures; `packages\mcp-util\src\temp-files.ts` has several `catch(() => {})` cleanup paths | Degraded voice and capture modes should show up as first-class state, not as missing behavior and accumulating temp files | Shinra / Sonnet / Opus |
| 5 | Add section-level renderer error boundaries and stabilize streaming-state edge cases | `packages\renderer\src\main.tsx` wraps the whole app in a top-level boot/runtime boundary, but `ProjectsPanel`, mission rooms, and detail panes do not have local isolation; `packages\renderer\src\stores\chat-store.ts` and multi-station replay paths remain race-prone | A single broken panel should not take down the whole renderer, and reconnect/replay logic should not be station-agnostic | Shinra / Sonnet / Opus |
| 6 | Treat multi-station replay correctness as a release-blocking issue before concurrency grows | `packages\main\src\preload.ts` explicitly notes that replay cache is keyed only by message type, not station; the app already has multi-station UI and state | This is the sort of bug that starts small and later looks like haunted state corruption | Shinra / Opus |

## Recommended sequence

1. **Immediate:** add fatal-process handlers, boundary validation, and explicit degraded-state reporting for voice/capture failures.
2. **Next:** widen backend-lifecycle diagnostics and fix the multi-station replay contract.
3. **Then:** add section-level renderer boundaries and clean up silent cleanup/error-swallowing patterns.

## Notes

- There is already a useful reliability document in `plans\06-reliability-hardening-plan.md`; this report largely agrees with it and narrows the first implementation slice.
- The best resilience pattern for Spira is "attribute first, recover deliberately". Blind retries create louder mysteries.
- Silent cleanup failures are not harmless. They become disk leaks, stale captures, and future support tickets.
