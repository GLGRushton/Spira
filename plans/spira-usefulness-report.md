# Spira usefulness report

_Collated from Shinra, Claude Sonnet 4.6, and Claude Opus 4.6._

## Executive summary

Spira already does a great deal. The next usefulness jump comes from making its strongest features easier to recover, easier to trust, and easier to search across longer-running work. Right now conversation continuity is visibly imperfect after reconnects, mission failures do not always explain themselves clearly, key diagnostics sit deeper in the UI than they should, and voice still lacks a few crucial pieces of desktop-grade feedback.

## Highest-priority improvements

| Priority | Improvement | Evidence in repo | Why it matters | Support |
|---|---|---|---|---|
| 1 | Make continuity and retrieval first-class: trim notices, global archive search, deeper recovery context, and better "restore live context" behavior | `chat-store.ts` silently trims at 500 messages; `ConversationArchivePanel.tsx` warns that backend context may not match the visible transcript; `copilot\continuity.ts` uses only 8 messages and 3000 characters | Long-running work is exactly where users need Spira most. Continuity should feel dependable, not politely approximate | Shinra / Sonnet / Opus |
| 2 | Add explicit mission recovery UX for error states | `MissionDetailsRoom.tsx` handles blocked, ready, working, and awaiting-review states, but there is no equally clear recovery section for generic `error` runs; mission controllers and `ProjectsPanel.tsx` still fall back to many console-only errors | When automation fails, the product should immediately answer "what broke, what can I retry, and where are the logs?" | Shinra / Sonnet / Opus |
| 3 | Surface operator diagnostics where users actually look | `McpRoomDetail.tsx` already has remediation hints, but they are buried one room deep; `McpClusterDetail.tsx` overview does not foreground failure guidance; subagent rooms track live text and tool history but little structured progress | Spira already computes useful diagnostics. The next step is surfacing them before operators have to hunt | Shinra / Opus |
| 4 | Improve voice feedback so it feels trustworthy in real desktop use | `backend\src\index.ts` uses a short fixed acknowledgement pool; `voice\pipeline.ts` has no user-facing listen-timeout signal; the UI does not show a partial transcript before processing starts | Voice is only as useful as the user's confidence that Spira heard the right thing | Shinra / Sonnet / Opus |
| 5 | Expand the YouTrack/project surface beyond a narrow "assigned to me" slice | `ProjectsPanel.tsx` loads only `listYouTrackTickets(20)`; `ProjectTypeahead.tsx` searches just 8 projects at a time; configuration and workflow editing are split across multiple concepts | Mission setup becomes much more useful once Spira can browse, filter, and recover project context more flexibly | Shinra / Opus |

## Recommended sequence

1. **Immediate:** add trim notices, stronger archive search/discoverability, and clearer mission error recovery.
2. **Next:** expose cluster-level diagnostics, add voice timeout/transcript feedback, and expand project/ticket discovery.
3. **Strategic:** improve restore-live-context behavior and deepen recovered context without bloating prompts.

## Notes

- Several of the best usefulness wins do not require new backend capability; most are presentation, continuity, and recovery improvements.
- The conversation archive is close to being a true knowledge surface. It mainly needs prominence and better continuity semantics.
- A handful of continuity, diagnostics, and voice changes would make Spira feel much more like a dependable desktop operator and less like an impressive internal prototype.
