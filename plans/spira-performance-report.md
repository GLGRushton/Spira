# Spira performance report

_Collated from Shinra, Claude Sonnet 4.6, and Claude Opus 4.6. Updated after implementation audit; completed items have been removed._

## Executive summary

The worst renderer hot path is healthier than when this report was first written: chat deltas are now batched, streaming markdown work is deferred, disconnected IPC requests are capped instead of growing forever, `audio:level` is throttled, `FlightLayer` no longer polls layout on an interval, and mission-service polling is less aggressive. The remaining work is narrower now: finish the chat path all the way through long histories, complete the voice/backpressure story, and tackle the heavyweight renderer surfaces that still mount too much at once.

## Remaining improvements

| Status | Improvement | Current state | What still needs doing | Support |
|---|---|---|---|---|
| Partial | Finish the streaming chat path | `register-chat-handlers.ts` now batches deltas, `StreamingText.tsx` renders plain text while streaming, and `ChatPanel.tsx` surfaces trim notices. | Long histories are still rendered directly in `ChatPanel.tsx`; there is no virtualization/windowing yet, and final render work still scales with the full visible message list. | Shinra / Sonnet / Opus |
| Partial | Finish voice telemetry shaping and transport backpressure | `voice/pipeline.ts` now throttles `audio:level` to 100 ms, and `ipc-bridge.ts` caps disconnected pending messages at 200 with explicit overflow / generation-change failures. | `tts:amplitude` and other non-critical telemetry still flow immediately, and there is still no explicit end-to-end backpressure policy across backend, WebSocket, Electron, and renderer. | Shinra / Sonnet / Opus |
| Partial | Reduce mission-service polling and workspace rescans | `service-pool.ts` now polls process trees every 5 seconds instead of every 2. | Workspace rescans and expensive project/mission derivations are still in place; this slice is only started, not solved. | Shinra / Opus |
| Not started | Lazy-load and isolate heavyweight mission/project UI | No meaningful split or lazy-loading landed for `ProjectsPanel.tsx`, `useMissionRunController.ts`, or other heavyweight renderer surfaces. | Break the big project/mission surfaces into room/tab-level chunks so startup and incidental rerenders stop paying for the whole deck. | Shinra / Sonnet / Opus |
| Not started | Stop tearing down the Copilot session on every MCP inventory change | No relevant changes landed in `copilot/session-manager.ts`. | Replace the current "disconnect and refresh" behavior with a cheaper migration or incremental tool refresh path. | Shinra / Sonnet |
| Not started | Pool voice buffers instead of allocating per captured frame | `voice/pipeline.ts` still appends copied `Int16Array` frames and later concatenates them. | Move to a ring buffer or pooled-frame strategy to cut GC churn in the capture path. | Shinra / Sonnet / Opus |

## Updated sequence

1. **Immediate:** finish long-history chat virtualization/windowing and complete the rest of the voice/backpressure shaping.
2. **Next:** take the cheap system-facing wins by making mission/workspace refresh paths more event-driven.
3. **Then:** split and lazy-load the heavyweight renderer surfaces and make Copilot tool refresh non-disruptive.

## Notes

- This report now tracks only unfinished performance work.
- Completed items were intentionally removed during this audit.
