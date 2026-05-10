# Mission Startup Recovery

## The bug

Killing the Spira process during `startRun()` leaves the mission row in `status="starting"`
with a partially-created managed worktree on disk. The user has no way to retry, recover, or
cancel:

- [`applyInterruptedWorkRecovery`](packages/backend/src/missions/ticket-runs.ts:2142) only
  reconciles `status="working"`. It ignores `"starting"`, so a Spira restart leaves the row
  exactly as the kill left it.
- [`ProjectsPanelMissionDetail.tsx`](packages/renderer/src/components/projects/ProjectsPanel/ProjectsPanelMissionDetail.tsx:328)
  only renders Retry/Abort buttons for `error` / `blocked`. For `"starting"`, the UI shows
  nothing actionable.
- `abortRun` already permits `"starting"`
  ([ticket-runs.ts:738](packages/backend/src/missions/ticket-runs.ts:738)), but the action is
  not exposed on the UI for that status.

AC restated: a mission stuck in startup must be retried, recovered, OR cancelled completely
— from the projects panel, without a database edit.

---

## Recommendation: reuse the existing `"error"` status (don't add a new one)

The user's instinct was a new `startup-failed` state with a 5-minute timeout. After reading
the code I'd push back on the new status — the existing `"error"` already does this job:

1. `startRun()` explicitly treats an existing `error`-status row as **recoverable**
   ([ticket-runs.ts:332](packages/backend/src/missions/ticket-runs.ts:332)): it normalizes
   any salvageable worktrees, removes any unusable ones, and restarts the same `runId`. The
   Retry button on the `error` UI branch already calls `onStartTicketRun(...)` and works
   end-to-end today.
2. `abortRun()` is permitted on any non-terminal status, including `error`.
3. The reconciler, post-mortem stub, and dashboards already understand `error`.

A new status would duplicate that surface across `shared/ticket-run-types.ts`, the renderer,
the reconciler, the workflow guard, and tests — for behavior that's identical to the existing
`error` path. The semantic distinction the user is after ("failed during startup, not during
work") is better carried by `statusMessage`, e.g. `"Mission startup was interrupted before
the worktree was ready. Retry to try again."`

So: don't add a status. Move stuck-`starting` rows into `error` with a clear message, and the
existing Retry / Abort UX takes over. (If after living with this for a while we decide we
genuinely want to filter `startup-failed` out of error dashboards separately, we can add the
status later — it's an additive change.)

The 5-minute timeout idea is right; it just lives on the transition into `error`, not as a
separate status.

---

## What changes

### 1. Backend startup recovery (handles the currently-stuck mission)

**File:** [`packages/backend/src/missions/ticket-runs.ts`](packages/backend/src/missions/ticket-runs.ts) —
extend `applyInterruptedWorkRecovery` (line 2142).

Add a second pass that finds runs with `status === "starting"` and flips them to
`status = "error"` with:

- `statusMessage`: `"Spira restarted before mission startup finished. Retry to try again, or abort to discard."`
- A `mission-startup-recovered-after-restart` mission event for the timeline.

This runs once per backend boot (the existing `interruptedWorkRecovered` flag already gates
it). It also fires lazily on the next `startRun()` call because that path calls
`recoverInterruptedWork()` first ([ticket-runs.ts:328](packages/backend/src/missions/ticket-runs.ts:328)),
which means the user's currently-stuck mission gets unstuck the moment they touch it.

No worktree cleanup at this point — `startRun()` itself already handles partial-worktree
salvage via `normalizeRecoverableWorktrees` ([ticket-runs.ts:341](packages/backend/src/missions/ticket-runs.ts:341)).
Let the existing path do its job on Retry.

### 2. Mid-flight stall watchdog

For the case where `startRun` is hung *within the live process* (not a restart), add a
watchdog. Two options, in order of preference:

**Option A — bounded `startRun` itself (preferred).** Wrap the `worktreesToCreate` loop
([ticket-runs.ts:439-456](packages/backend/src/missions/ticket-runs.ts:439)) in a per-step
timeout. On timeout, fall into the existing catch block at line 464 — that already rolls
back created worktrees and persists `status = "error"` with the timeout message. No new
state-machine concept needed.

**Timeouts (calibrated for big repos so we never trip on a successful-but-slow startup):**

| Step | Timeout | Reasoning |
|---|---|---|
| `git worktree add` per repo | **10 min** | Big monorepo checkouts can copy a lot of working-tree files; 10 min covers slow disks / antivirus / network drives without giving up on real progress. |
| Submodule hydrate per worktree | **15 min** | Submodule init can pull fresh content over the network — slowest step in the chain. |
| Total `startRun` cap | **30 min** | Safety net across the whole flow. If we're still in `starting` after 30 min, something is genuinely wrong. |

Configure these as constants at the top of `ticket-runs.ts` (e.g. `STARTUP_WORKTREE_TIMEOUT_MS`)
so they're easy to tune later without hunting through the file. If a step times out, the
status message should say which step ("Worktree creation timed out after 10 min for
`<repoRelativePath>`. Retry to try again."), not just a generic timeout — the user needs to
know whether to investigate the network, the disk, or the repo itself.

**Option B — periodic sweep.** A 30-second interval timer that finds rows where
`status === "starting"` and `now - startedAt > STARTUP_TOTAL_TIMEOUT_MS` and aren't in the
in-flight `startRun` set, and flips them to `error`. Requires tracking an in-flight set keyed
by `runId` to avoid racing against a slow-but-progressing startRun.

Pick A. It catches the actual failure mode (git ops hanging) and reuses the existing rollback
path. We add B only if real-world hangs slip past A.

### 3. UI — surface Retry + Abort for `"starting"`

**File:** [`packages/renderer/src/components/projects/ProjectsPanel/ProjectsPanelMissionDetail.tsx`](packages/renderer/src/components/projects/ProjectsPanel/ProjectsPanelMissionDetail.tsx)
around line 328-364.

Render a new branch when `selectedMissionRun?.status === "starting"`:

- If `now - startedAt < 3 min`: spinner + status message only ("Preparing managed
  worktrees…"). Don't flash Retry/Abort buttons during a normal slow-but-progressing startup
  on a big repo.
- If `now - startedAt >= 3 min`: show **"Retry startup"** (calls `onStartTicketRun`) and
  **"Abandon startup"** (calls the existing `abortRun` IPC). Add a status hint: `"Startup is
  taking longer than expected — retry or abandon."`. Always show **"Abandon startup"** as a
  smaller, secondary control — even during the < 3 min window — because the user might know
  immediately they want out (wrong project, fat-fingered the ticket).

The 3-min "looks slow" UI threshold and the 10/15/30-min backend timeouts are different
things on purpose: the UI offers escape hatches earlier than the backend gives up. 3 min is
an estimate — if real-world startups regularly take longer, bump this constant rather than
adding logic.

### 4. Wire abort from the renderer (if not already wired)

`abortRun` is exposed via `missions:ticket-run:abort`
([backend/src/index.ts:1713](packages/backend/src/index.ts:1713)) and surfaced in
[`useMissionRunController.ts`](packages/renderer/src/components/missions/useMissionRunController.ts)
as `abortRun()` (line 1253). Confirm it's available on the controller passed into
`ProjectsPanelMissionDetail` and add a confirm dialog (`"Abandon mission startup? The partial
worktree will be cleaned up."`) before firing it.

### 5. `abortRun` cleanup robustness (small hardening)

When abort is called from `"starting"`, there's no station to close, but there *may* be
partial worktrees. Today `tearDownStationAndServices` only handles station + run services
([ticket-runs.ts:781](packages/backend/src/missions/ticket-runs.ts:781)) — it doesn't remove
worktrees. That's fine for `error` (Retry uses them), but for the abort-from-starting path
we should also remove partial worktrees so the abandoned mission doesn't leave junk in the
workspace.

Add a step in `abortRun` (around line 748): if status was `"starting"`, iterate
`run.worktrees` and call the existing `removeManagedWorktree` + `deleteLocalMissionBranch`
helpers ([ticket-runs.ts:2336](packages/backend/src/missions/ticket-runs.ts:2336),
[ticket-runs.ts:2365](packages/backend/src/missions/ticket-runs.ts:2365)) under
`tolerateFailures: true`. Failures land in the post-mortem stub, not the user's face.

---

## Tests to add

[`packages/backend/src/missions/ticket-runs.test.ts`](packages/backend/src/missions/ticket-runs.test.ts):

- `applyInterruptedWorkRecovery` flips `starting` → `error` with the expected statusMessage
  and emits `mission-startup-recovered-after-restart`.
- `startRun()` on the recovered `error` row finishes successfully (the recovery + retry path
  is end-to-end safe).
- `abortRun()` on a `starting` row removes worktree directories and deletes the mission
  branch.
- (Option A only) `startRun()` aborts cleanly when a synthetic `git worktree add` exceeds
  the timeout and rolls back any prior worktrees.

[`packages/renderer/src/components/projects/ProjectsPanel/ProjectsPanelMissionDetail.test.tsx`](packages/renderer/src/components/projects/ProjectsPanel/ProjectsPanelMissionDetail.tsx):

- Renders Retry + Abandon buttons when `status === "starting"` and `startedAt` is older than
  30s, and the buttons fire the right callbacks.
- Renders the spinner-only view when `startedAt` is recent.

---

## Rollout for the currently-stuck mission

The user has a mission stuck in `starting` *right now*. Once Change #1 ships, it'll resolve
on the next backend boot:

1. Backend starts → `applyInterruptedWorkRecovery` runs → the row flips to `error`.
2. The UI now shows the Retry button (via the existing `error` branch).
3. User clicks Retry → `startRun()` salvages any usable worktrees, removes the broken ones,
   and starts fresh.

If the user wants to drop the mission entirely instead, Change #3 surfaces the Abandon button
and Change #5 cleans up the partial worktrees.

---

## AC checklist

- [x] **Retried** — Change #1 promotes to `error`; existing Retry button + `startRun`
      recovery path handle the rest.
- [x] **Recovered** — Change #1 (on restart) and Change #2 (mid-flight) both move stuck rows
      out of `starting`.
- [x] **Cancelled completely** — Change #4 surfaces Abandon; Change #5 ensures the partial
      worktree is actually removed.
