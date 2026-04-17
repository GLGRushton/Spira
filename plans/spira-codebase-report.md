# Spira codebase report

_Collated from Shinra, Claude Sonnet 4.6, and Claude Opus 4.6. Updated after implementation audit._

## Executive summary

Very little of the structural report is fully done yet. The current branch added some useful guardrails - a dedicated client-message validator, better tests around risky seams, and a few smaller ownership cleanups - but the large discoverability/refactor items are still ahead. This report is therefore mostly a map of structural work that remains open.

## Remaining improvements

| Status | Improvement | Current state | What still needs doing | Support |
|---|---|---|---|---|
| Not started | Replace monolithic backend and main dispatchers with typed domain handler maps | `backend/index.ts` and `main/index.ts` are still the same ownership chokepoints. | Split by domain so handler ownership is obvious and day-to-day changes stop starting with a 2k-line scavenger hunt. | Shinra / Sonnet / Opus |
| Not started | Finish extracting the Projects/Missions domain into feature modules | Mission recovery UI changed, but `ProjectsPanel.tsx` remains giant and mission flows still span multiple surfaces. | Break the project/mission surface into feature modules with clearer CSS and controller boundaries. | Shinra / Sonnet / Opus |
| Not started | Split `memory-db/database.ts` into domain repositories behind a thin facade | No structural work landed in `memory-db/database.ts`. | Separate conversations, memories, MCP persistence, ticket runs, project mappings, and migration logic into domain repositories. | Shinra / Sonnet / Opus |
| Not started | Extract a shared Copilot session driver from `session-manager.ts` and `subagent-runner.ts` | No shared session-driving extraction landed. | Consolidate the duplicated session orchestration, timeout, and event demultiplexing logic into one reusable driver. | Shinra / Sonnet / Opus |
| Not started | Make the protocol and Electron contract generated or at least centralized by domain | No meaningful contract centralization landed; transport knowledge is still spread across shared, main, preload, and renderer. | Group transport contracts by domain so humans and tools can trace them end to end without spelunking through multiple packages. | Shinra / Sonnet / Opus |
| Partial | Move hidden module-level runtime state and repeated validators into explicit utilities | `client-message-validation.ts` is a useful first extraction, but most hidden runtime maps and repeated `isRecord`/arg parsing patterns remain. | Push more of the repeated validation and hidden state into named shared helpers/utilities instead of file-local folklore. | Shinra / Sonnet / Opus |
| Partial | Refactor with tests in lockstep, especially around Projects, voice, and MCP packages | This branch added tests for chat batching, IPC replay, client-message validation, mission recovery, temp-file cleanup, and voice throttling. | The largest/highest-risk surfaces - especially `ProjectsPanel`, mission UI, and the big MCP/util files - still need much deeper refactor-time coverage. | Shinra / Sonnet / Opus |

## Updated sequence

1. **Foundation:** split backend/main ownership and centralize protocol boundaries by domain.
2. **Renderer clarity:** break up the Projects/Missions surface instead of letting feature growth pile into one component.
3. **Persistence and Copilot clarity:** split `memory-db/database.ts` and extract the shared session-driving path.
4. **Polish:** keep validator extraction and test expansion moving alongside each structural cut.

## Notes

- No codebase recommendation is fully closed yet.
- The current branch improved safety more than structure.
