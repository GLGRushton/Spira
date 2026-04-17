# Spira performance report

_Collated from Shinra, Claude Sonnet 4.6, and Claude Opus 4.6._

## Executive summary

Spira's biggest speed losses are in live interaction paths, not in one-off startup work. The worst offenders are token-by-token chat updates, high-frequency voice telemetry crossing backend/WebSocket/Electron/renderer boundaries, and renderer layout polling that forces repeated measurement work. The next tier is heavyweight UI that mounts too much at once and backend refresh logic that tears down more session state than it needs to.

## Highest-priority improvements

| Priority | Improvement | Evidence in repo | Why it matters | Support |
|---|---|---|---|---|
| 1 | Rebuild the streaming chat path so deltas are batched, markdown is deferred, and long histories are virtualized | `packages\renderer\src\hooks\ipc\register-chat-handlers.ts` appends every token; `packages\renderer\src\stores\chat-store.ts` rescans session state on updates; `packages\renderer\src\components\chat\StreamingText.tsx` renders `ReactMarkdown` while streaming; `packages\renderer\src\components\chat\ChatPanel.tsx` renders up to 500 messages directly | This is the hottest user-facing loop. Today it does too much work too often and turns long responses into renderer churn | Shinra / Sonnet / Opus |
| 2 | Throttle non-critical voice telemetry and add transport backpressure | `packages\backend\src\voice\pipeline.ts` emits `audio:level` about every 33ms; `packages\backend\src\server.ts` forwards `audio:level` and `tts:amplitude` immediately; `packages\main\src\ipc-bridge.ts` stores disconnected outbound messages in an unbounded `pending` array | Voice interaction currently sends far more messages than the UI needs, with no pressure relief when the renderer is slow or disconnected | Shinra / Sonnet / Opus |
| 3 | Replace `FlightLayer` layout polling with a render-synced strategy | `packages\renderer\src\components\base\FlightLayer.tsx` calls `getBoundingClientRect()` for the track and room nodes, listens to scroll and resize, and also runs `setInterval(updatePositions, 250)` | This forces repeated layout measurement even when nothing meaningful changed, which is exactly how a deck animation becomes a tax on the whole renderer | Shinra / Opus |
| 4 | Reduce mission-service polling and workspace rescans | `packages\backend\src\missions\service-pool.ts` polls process trees every 2 seconds; `packages\backend\src\projects\registry.ts` rescans the workspace recursively when mappings change; `packages\renderer\src\components\projects\ProjectsPanel.tsx` recomputes large derived collections inside one giant component | These are expensive system-facing operations that should be event-driven, cached, or at least less frequent | Shinra / Opus |
| 5 | Lazy-load and isolate heavyweight mission/project UI | `packages\renderer\src\components\projects\ProjectsPanel.tsx` is 2693 lines; `packages\renderer\src\components\missions\useMissionRunController.ts` is 655 lines; `packages\renderer\src\components\SettingsPanel.tsx` is 405 lines | Large surfaces currently mount and re-evaluate more than they should. Splitting by tab and room reduces both startup work and incidental rerenders | Shinra / Sonnet / Opus |
| 6 | Stop tearing down the Copilot session on every MCP inventory change | `packages\backend\src\copilot\session-manager.ts` refreshes on `mcp:servers-changed`; `getCurrentToolSignature()` rebuilds the tool inventory; idle refreshes disconnect the session instead of applying a cheaper migration path | Changing tool topology should not create a dead zone before the next prompt, especially during active operator setup | Shinra / Sonnet |
| 7 | Pool voice buffers instead of allocating per captured frame | `packages\backend\src\voice\pipeline.ts` stores copied `Int16Array` frames and later concatenates them into a final PCM buffer | This is classic GC bait in an audio hot path and is avoidable with a ring buffer | Shinra / Sonnet / Opus |

## Recommended sequence

1. **Immediate:** batch chat deltas, stop markdown parsing while the message is still streaming, and throttle voice telemetry.
2. **Next:** add WebSocket/IPC backpressure, remove `FlightLayer` interval polling, and make mission-service refreshes more event-driven.
3. **After that:** split and lazy-load the largest renderer surfaces, then make MCP tool-inventory refreshes cheap and non-disruptive.

## Notes

- The single most concentrated performance hotspot is the current chat streaming loop.
- The cleanest near-term win is reducing high-frequency message traffic before it reaches React at all.
- Performance and codebase structure are linked here: the giant project and mission surfaces are both slower and harder to reason about.
