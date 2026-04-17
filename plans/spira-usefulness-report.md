# Spira usefulness report

_Collated from Shinra, Claude Sonnet 4.6, and Claude Opus 4.6. Updated after implementation audit._

## Executive summary

Useful recovery work has landed, but it is still uneven. Trimmed live history is now visible instead of silent, errored mission runs can be retried from the mission detail room, and YouTrack discovery is less cramped than before. The remaining usefulness work is to turn those isolated wins into a broader continuity, recovery, and diagnostics experience that feels dependable instead of merely promising.

## Remaining improvements

| Status | Improvement | Current state | What still needs doing | Support |
|---|---|---|---|---|
| Partial | Finish continuity and retrieval first-class | `chat-store.ts` and `ChatPanel.tsx` now preserve and surface `historyWasTrimmed` instead of trimming silently. | Stronger archive discoverability, broader retrieval flows, deeper recovery context than the current narrow continuity preamble, and better "restore live context" behavior are still open. | Shinra / Sonnet / Opus |
| Partial | Finish explicit mission recovery UX for error states | `MissionDetailsRoom.tsx`, `useMissionRunController.ts`, and `ticket-runs.ts` now support retrying errored continuation runs, and `ProjectsPanel.tsx` labels them as recovery work. | The UI still needs clearer error diagnostics, log/recovery affordances, and better treatment for runs that fail before a recoverable attempt exists. | Shinra / Sonnet / Opus |
| Not started | Surface operator diagnostics where users actually look | The report's targeted MCP cluster/subagent diagnostic surfaces are untouched in this branch. | Expose failure guidance, live summaries, and remediation hints before users have to drill into deep detail rooms. | Shinra / Opus |
| Not started | Improve voice feedback so it feels trustworthy in real desktop use | No user-facing partial transcript, listen-timeout cue, or richer acknowledgement/voice-confidence feedback landed. | Add visible listening/timeout state and earlier transcript feedback so voice feels dependable rather than optimistic. | Shinra / Sonnet / Opus |
| Partial | Expand the YouTrack/project surface beyond a narrow assigned-to-me slice | `ProjectTypeahead.tsx` now returns up to 20 suggestions and `ProjectsPanel.tsx` loads 50 tickets instead of 20. | The surface is still bound to the same assigned-ticket slice, and the configuration/workflow model is still split across multiple concepts. | Shinra / Opus |

## Updated sequence

1. **Immediate:** finish continuity/retrieval and the rest of mission error recovery.
2. **Next:** surface diagnostics where the user already is, not one room deeper.
3. **Then:** make voice feedback trustworthy and widen project/ticket discovery beyond the current narrow slice.

## Notes

- No usefulness recommendation is fully closed yet; this report now names the remaining work directly.
