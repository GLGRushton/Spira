# Spira resilience report

_Collated from Shinra, Claude Sonnet 4.6, and Claude Opus 4.6. Updated after implementation audit; completed items have been removed._

## Executive summary

The resilience foundation is materially better than it was when this report was written. Backend and main now have fatal-process handlers, backend exit details survive into main-process error reporting, invalid client payloads are validated at the transport boundary, multi-station replay is safer, and capture/cleanup failures are no longer swallowed in silence. What remains is broader boundary hardening, richer recovery state, explicit degraded-mode UX, and local renderer isolation.

## Remaining improvements

| Status | Improvement | Current state | What still needs doing | Support |
|---|---|---|---|---|
| Partial | Finish runtime boundary validation | `server.ts` now uses `client-message-validation.ts` for inbound client payloads, and station-scoped replay keys are now used in `preload.ts`. | JSON-backed discovery/config loads, broader IPC/MCP contract validation, and the other cast-heavy boundaries still need runtime checks. | Shinra / Sonnet / Opus |
| Partial | Finish backend lifecycle and upgrade recovery paths | `backend-lifecycle.ts` now emits structured `BackendExitInfo`, and `main/index.ts` surfaces crash/fatal details instead of collapsing everything into vague disconnects. | Restart history is still ephemeral, health checks are absent, and `upgrade-orchestrator.ts` recovery paths were not part of this tranche. | Shinra / Sonnet / Opus |
| Partial | Make voice and capture failures explicit instead of silent | `voice/stt.ts`, `temp-files.ts`, `mcp-vision/index.ts`, and `mcp-windows-ui/index.ts` now log cleanup/prune failures instead of silently discarding them. | Voice/capture degraded modes are still not surfaced as first-class UI state, audio-capture failure remains mostly log-level, and the stronger Whisper timeout/supervision pass is still open. | Shinra / Sonnet / Opus |
| Partial | Add section-level renderer boundaries and finish streaming-state edge hardening | Chat abort/error/reconnect handling is safer, and station-aware replay removes one class of haunted multi-station state. | `ProjectsPanel`, mission rooms, and detail panes still lack local error boundaries; one broken panel can still take the renderer down. | Shinra / Sonnet / Opus |

## Updated sequence

1. **Immediate:** finish the remaining boundary validation and the rest of the backend/upgrade recovery spine.
2. **Next:** surface degraded voice/capture state and add section-level renderer boundaries around the biggest panels.
3. **Then:** persist crash/restart breadcrumbs and expand destructive-path coverage around the remaining recovery seams.

## Notes

- This report now tracks only unfinished resilience work.
- Completed items were intentionally removed during this audit.
