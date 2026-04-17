# Spira codebase report

_Collated from Shinra, Claude Sonnet 4.6, and Claude Opus 4.6._

## Executive summary

Spira's package layout is strong, but several internal files have grown large enough to fight both humans and tools. The main problem is not just size; it is mixed responsibility. A handful of files now contain bootstrap logic, transport handling, domain workflows, UI state machines, and view rendering all at once. That makes the codebase slower to navigate, harder to refactor safely, and much less legible to AI tooling.

## Largest files to split first

| File | Lines | First split direction |
|---|---:|---|
| `packages\renderer\src\components\projects\ProjectsPanel.tsx` | 2693 | Separate mission lanes, repo mapping, git actions, service management, and YouTrack config |
| `packages\memory-db\src\database.ts` | 2613 | Split schema/migrations, conversations, memories, MCP persistence, ticket runs, project mappings |
| `packages\backend\src\index.ts` | 1993 | Separate bootstrap, station/chat handlers, project/YouTrack handlers, mission handlers, voice wiring |
| `packages\backend\src\missions\ticket-runs.ts` | 1691 | Separate git/worktree ops, run state machine, remote sync, commit-draft logic |
| `packages\main\src\index.ts` | 1386 | Separate app lifecycle, settings/runtime-config IPC, conversation IPC, mission IPC, upgrade wiring |
| `packages\mcp-windows-ui\src\util\automation.ts` | 1109 | Extract embedded PowerShell and split wrapper utilities from script content |
| `packages\backend\src\copilot\session-manager.ts` | 882 | Extract reusable Copilot session driver and permission flow helpers |
| `packages\backend\src\subagent\subagent-runner.ts` | 855 | Share session-driving logic with the main Copilot manager |
| `packages\backend\src\copilot\station-registry.ts` | 769 | Separate station lifecycle from persistence and conversation continuity |
| `packages\backend\src\mcp\registry.ts` | 742 | Split config persistence, status publication, and server lifecycle handling |

## Highest-priority improvements

| Priority | Improvement | Evidence in repo | Why it matters | Support |
|---|---|---|---|---|
| 1 | Replace monolithic backend and main dispatchers with typed domain handler maps | `packages\backend\src\index.ts` routes a large set of message types through one file; `packages\main\src\index.ts` registers 40+ IPC handlers in one place; `packages\main\src\preload.ts` mirrors many of the same channel constants | This is the highest-leverage structural change. It makes handler ownership obvious and removes "find the right if block in a 2k-line file" from daily life | Shinra / Sonnet / Opus |
| 2 | Finish extracting the Projects/Missions domain into feature modules instead of one giant component plus shared CSS | `ProjectsPanel.tsx` is 2693 lines; mission rooms import `ProjectsPanel.module.css`; mission actions and process flows now exist both in `ProjectsPanel.tsx` and `useMissionRunController.ts`-backed rooms | This is the biggest current obstacle to AI discoverability in the renderer and the fastest path to smaller, testable UI units | Shinra / Sonnet / Opus |
| 3 | Split `memory-db\database.ts` into domain repositories behind a thin facade | The current file holds conversations, memories, MCP config, subagents, ticket runs, project mappings, and migration logic in one place | Database work should be easy to locate by domain. Right now every change starts with a full-file expedition | Shinra / Sonnet / Opus |
| 4 | Extract a shared Copilot session driver from `session-manager.ts` and `subagent-runner.ts` | Both files use the same session factory, stream assembly, timeouts, recovery patterns, and event demultiplexing with only a few orchestration differences | Fixing session behavior twice is expensive and error-prone; sharing the driver will simplify future Copilot and subagent work | Shinra / Sonnet / Opus |
| 5 | Make the protocol and Electron contract generated or at least centralized by domain | `packages\shared\src\protocol.ts` is growing into one large union; channel constants are duplicated across `main\src\index.ts`, `main\src\preload.ts`, and the shared Electron API contract | AI tools and humans both work better when transport contracts are grouped, named, and easy to trace end to end | Shinra / Sonnet / Opus |
| 6 | Move hidden module-level runtime state and repeated validators into explicit utilities | `packages\renderer\src\stores\room-store.ts` keeps key runtime maps outside the store state; repeated `isRecord` and hand-written arg parsing appear across MCP and backend code | Hidden state makes behavior harder to search, test, and explain. Repeated validation logic makes fixes annoyingly non-universal | Shinra / Sonnet / Opus |
| 7 | Refactor with tests in lockstep, especially around Projects, voice, and MCP packages | There are 41 test files, but key UI surfaces and several MCP packages still have thin or missing coverage; the biggest files are also the riskiest refactor targets | Structural cleanup only pays off if it does not turn into a regression lottery | Shinra / Sonnet / Opus |

## Recommended sequence

1. **Foundation:** split backend/main dispatch and centralize transport contracts.
2. **Renderer clarity:** break up `ProjectsPanel` and formalize the mission controller/view boundary.
3. **Persistence clarity:** split `memory-db\database.ts` by domain and extract shared Copilot session-driving code.
4. **Polish:** remove hidden module state, repeated validators, and oversized embedded scripts while backfilling tests.

## Notes

- The codebase is clean in some important ways: no obvious dependency cycles, very little TODO debt, and strong shared typing.
- The main problem is local concentration of too much responsibility, not overall architectural chaos.
- If the goal is "easier for AI to discover functionality", the highest-yield work is smaller files plus explicit domain entry points.
