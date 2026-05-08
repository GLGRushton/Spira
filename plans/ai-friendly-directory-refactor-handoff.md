# Refactor handoff plan

## Problem and approach

This refactor is aimed at making the repo more readable and AI-friendly by breaking large files into responsibility-based folders while keeping stable import surfaces and avoiding regressions in active UI work.

The code changes are largely in place. The main remaining work is validation and, if needed, one more `session-manager` extraction pass after the machine restart.

## Current state

### Refactor progress completed

- `packages\memory-db\src\database.ts` is now down to **400** lines.
- Extracted persistence-domain modules under `packages\memory-db\src\database\`:
  - `context.ts`
  - `conversations.ts`
  - `intelligence.ts`
  - `memories.ts`
  - `missions.ts`
  - `runtime.ts`
  - `tooling.ts`
- `packages\backend\src\copilot\session-manager.ts` is currently **2826** lines.
- Extracted helper modules under `packages\backend\src\copilot\session-manager\`:
  - `delegation-helpers.ts`
  - `shared.ts`
  - `tool-refresh-helpers.ts`
  - `work-session-helpers.ts`
  - `workflow-helpers.ts`
- `packages\backend\src\copilot\session-manager.test.ts` is now a thin entrypoint and the suites were split into:
  - `session-manager.work-session-storage.suite.ts`
  - `session-manager.tool-refresh.suite.ts`
  - `session-manager.workflow-review.suite.ts`
  - `session-manager.provider-config.suite.ts`
  - `session-manager.work-session-flow.suite.ts`
  - `session-manager.work-session-stall-recovery.suite.ts`
  - `session-manager.work-session-persistence.suite.ts`
  - `session-manager.provider-session.suite.ts`
  - `session-manager.provider-continuity.suite.ts`
  - `session-manager.subagent-timeout-recovery.suite.ts`
  - `session-manager.test-support.ts`
- `packages\backend\src\missions\ticket-runs.ts` is **2876** lines with helper modules extracted under `packages\backend\src\missions\ticket-runs\`.
- `packages\renderer\src\components\projects\ProjectsPanel.tsx` is now a **1-line facade**:
  - `export { ProjectsPanel } from "./ProjectsPanel/ProjectsPanel.js";`
- The `ProjectsPanel` component family now lives under `packages\renderer\src\components\projects\ProjectsPanel\`.

### Worktree context to preserve

These renderer files are still live user work and should not be treated as collateral cleanup:

- `packages\renderer\src\components\missions\rooms\MissionActionsRoom.tsx`
- `packages\renderer\src\components\missions\rooms\MissionChangesRoom.tsx`
- `packages\renderer\src\components\missions\rooms\MissionDetailsRoom.tsx`
- `packages\renderer\src\components\missions\rooms\MissionProcessesRoom.tsx`

## Validation status before restart

### Confirmed green

- `pnpm typecheck` passed.
- `pnpm lint` passed after normalizing formatting in the refactor-owned files.
- `pnpm build` passed.
- `pnpm vitest run --project=@spira/shared --reporter=basic --no-file-parallelism` passed.
- `pnpm vitest run --project=@spira/memory-db --reporter=basic --no-file-parallelism` passed.

### Current blocker

The remaining test validation is blocked by **Vitest memory/worker instability on this machine**, not by a clear assertion failure from the refactor.

Observed behavior:

- Workspace-wide `pnpm test` fanout would hang or wedge in this shared Windows environment.
- Serial project execution got through `@spira/shared` and `@spira/memory-db`.
- `@spira/backend` ran real tests successfully for a long stretch, then failed with:
  - `Error: Worker exited unexpectedly`
  - underlying cause: **Node heap out of memory**
- The backend run had already reached:
  - **39 passed test files out of 40**
  - **352 passed tests out of 483**
- The huge memory blow-up came from repeated capability-tool logging being buffered into the Vitest output.

Important interpretation:

- This does **not** currently point to a specific failing assertion caused by the refactor.
- It **does** mean AC #3 is not yet fully closed because a clean full test pass was not captured before restart.

### `pnpm dev`

- I did **not** relaunch a fresh `pnpm dev` because the machine already had lingering dev/watcher processes from the prior frozen session and I did not want to interfere with them.
- `pnpm build` succeeding is a good sign that the renderer regrouping and facade imports are wired correctly, but AC #4 still needs a fresh post-restart smoke run.

## Recommended next steps after restart

1. Start from this branch/worktree state without reverting anything.
2. Re-run:
   - `pnpm typecheck`
   - `pnpm lint`
   - `pnpm build`
3. Re-run tests in the clean session. Preferred order:
   - `pnpm test`
   - if workspace fanout misbehaves again, fall back to per-project runs
4. For backend tests, reduce log pressure before concluding there is a code regression:
   - either give Node more heap
   - or suppress noisy capability-tool logging during tests
5. Run a clean `pnpm dev` smoke start after restart, when ports/processes are no longer polluted by the frozen session.

## Notes and cautions

- The repo changes already satisfy most of AC #1: the directory structure is substantially more domain-oriented and facade imports were preserved.
- The remaining uncertainty is validation, not the structural refactor itself.
- Do not fold the mission room edits into this refactor unless a direct import-path repair requires it.
- If another agent resumes this, the highest-value next action is **finishing validation in a clean machine state**, not more structural churn.
