# SPI-12: Coding Run Execution — Revised Implementation Plan (Multi-Pass)

## Revised Product Constraint

A Missions ticket run is a **long-lived workflow record** for the ticket. It may require multiple coding passes and follow-up prompts before the work is satisfactory. A single subagent completion does **not** make a mission done. Only explicit user action completes a mission.

## Current State

After pickup, a ticket run has:
- A **managed git worktree** at `.spira-worktrees/<ticket>-<repo>` with a `feat/<ticket>-<summary>` branch (`ticket-runs.ts:84-99`)
- A **persisted `TicketRunSummary`** in the memory DB with status `"ready"` (`database.ts:1423-1554`)
- **YouTrack moved to In Progress** via `syncRunState` (`ticket-runs.ts:308-354`)
- **Real-time push** to the renderer via the `missions:runs-changed` event bus event → `missions:runs:updated` WebSocket message (`event-bus.ts:45`, `index.ts:1131-1136`)

**Nothing happens after `"ready"`.** The user sees "Ready" and worktree details, but there's no execution pipeline and no iterative workflow.

---

## 1. Product Model: Mission Run vs. Execution Attempt

### 1.1 Two Tiers

**Mission Run** (`TicketRunSummary` in `ticket-run-types.ts`) — the long-lived record, one per ticket:
- Persisted in the memory DB.
- Lives until the user explicitly marks it complete (or it errors out fatally).
- Owns the git worktree and the YouTrack state.
- Has a human-meaningful lifecycle that maps to "is there outstanding work on this ticket?".

**Execution Attempt** (`TicketRunAttempt`) — a single coding pass, one per "Start work" / "Continue work" invocation:
- Created for each call to `SubagentRunner.launch()`.
- Carries the prompt, the subagent run ID, and the resulting envelope.
- Terminal when the SubagentRunner call settles (completed / failed).
- Does **not** own the mission status — it informs it, but does not drive it.

### 1.2 Mission-Level Statuses

```typescript
// ticket-run-types.ts
export const TICKET_RUN_STATUSES = [
  "starting",          // worktree setup in flight
  "ready",             // worktree exists, YouTrack synced, no active pass
  "working",           // a coding pass is actively running
  "awaiting-review",   // a pass completed; human has not reviewed / continued / closed
  "blocked",           // YouTrack state sync failed (retryable)
  "error",             // fatal — worktree failed, or pass failed after retries
  "done",              // explicit human-confirmed completion
] as const;
```

**Transitions (updated):**

```
         [starting] ──► [ready] ──► [working] ──► [awaiting-review]
              │           │            │                │
              ▼           ▼            ▼                ├──► [working]   (Continue work)
           [error]    [blocked]     [error]             │
              │           │                             └──► [done]      (Mark complete)
              └── retry ──┘
```

- `starting → ready`: worktree created + YouTrack synced (unchanged, `ticket-runs.ts:257-276`)
- `starting → error`: git worktree failed (unchanged, `ticket-runs.ts:219-240`)
- `ready → working`: user clicks "Start work"
- `working → awaiting-review`: SubagentRunner first pass settled with status "completed"
- `working → error`: **infrastructure** failure only (no Copilot session, DB unavailable, git worktree corrupt)
- `working → awaiting-review` (with failed attempt): SubagentRunner pass failed (timeout, SDK error, exhausted retries) — the user decides whether to retry, not the system
- `awaiting-review → working`: user clicks "Continue work" (optionally with a follow-up prompt)
- `awaiting-review → done`: user clicks "Mark complete"
- `blocked → ready`: retry sync succeeds (unchanged, `ticket-runs.ts:286-306`)

`"done"` is **only reachable via user action**, never automatically from a pass completing.

### 1.3 Execution Attempt Statuses

```typescript
export const TICKET_RUN_ATTEMPT_STATUSES = [
  "running",    // SubagentRunner has been launched, first turn in flight
  "completed",  // SubagentRunner emitted envelope.status === "completed"
  "failed",     // SubagentRunner emitted error / partial / timeout
  "cancelled",  // User cancelled mid-attempt via SubagentRunLaunch.stop()
] as const;
```

Include `"cancelled"` from Phase 1a even though the cancel button ships in Phase 1c, to avoid a schema migration later.

---

## 2. UX in Missions

### 2.1 State Labels and Primary Actions

| Mission Status   | Badge         | Primary Action            | Secondary Action     |
|------------------|---------------|---------------------------|----------------------|
| `starting`       | Starting       | —                         | —                    |
| `ready`          | Ready          | **Start work**            | —                    |
| `working`        | Working ⏳     | — (cancel TBD later)      | —                    |
| `awaiting-review`| Review needed  | **Continue work**         | **Mark complete**    |
| `blocked`        | Blocked        | Retry sync                | —                    |
| `error`          | Error          | Retry / Start again       | —                    |
| `done`           | Done ✓         | —                         | —                    |

### 2.2 "Start Work" (ready → working)

User sees "Start work" button. Clicking it opens **no prompt dialog** on first start — the backend builds an initial prompt from the ticket's data. Transition to `"working"` is immediate and optimistic; the button is disabled until the server responds.

### 2.3 "Continue Work" (awaiting-review → working)

User sees:
1. The last attempt's **summary** (from `SubagentEnvelope.summary`) — one to three lines.
2. An optional **follow-up prompt textarea** (placeholder: "Tell the agent what to do next, or leave blank to continue automatically").
3. **"Continue work"** button — sends the follow-up prompt (or a default continuation prompt if blank).
4. **"Mark complete"** button — explicitly closes the mission.

This is the key UX change from the original plan: the user is in control of the loop.

### 2.4 "Mark Complete" (awaiting-review → done)

No confirmation dialog in Phase 1. One click transitions to `"done"`. The statusMessage is set to "Marked complete by user." with the last attempt summary appended. In a later slice this can trigger a YouTrack transition to Done and optionally open a PR.

### 2.5 Progress During Working

Run card shows:
- Animated "Working" badge.
- `statusMessage` as a single throttled activity line (latest delta text snippet or tool call name).
- Elapsed time counter.
- No streaming log pane in Phase 1.

### 2.6 Awaiting Review Card

Run card shows:
- "Review needed" badge (non-animated — work has stopped).
- Attempt summary from last `SubagentEnvelope.summary`.
- Attempt count (e.g., "2 passes completed").
- Continue / Mark complete actions.
- Worktree and branch info.

---

## 3. SubagentRunner: Reuse, and Breaking the Completion→Done Coupling

### 3.1 Strongly Recommend Reusing SubagentRunner

Same rationale as the original plan — do not build a dedicated runner. The SubagentRunner already handles:
- Copilot SDK lifecycle (`session-factory.ts`)
- Streaming and `StreamAssembler` (`stream-handler.ts`)
- Tool call dispatch (`tool-bridge.ts`)
- Retries and timeouts (`subagent-runner.ts:42-46`)
- Write locking (`lock-manager.ts`)
- Typed bus events (`event-bus.ts:47-56`)
- Background mode via `launch()` returning `SubagentRunLaunch` with `{ resultPromise, write, stop }` (`subagent-runner.ts:278-307`)

### 3.2 Try-Write, Then Fresh Launch (Recommended)

On "Continue work", prefer reusing the existing Copilot session via `SubagentRunLaunch.write()`:

1. **Try `write()`**: If `activeLaunches.get(runId)` is still alive (i.e., the `LiveRunState` has `keepAlive: true` and `session` is non-null — see `subagent-runner.ts:454-470`), call `launch.write(followUpPrompt)`. This preserves the full conversation context: prior tool calls, reasoning, and file reads remain in the Copilot session history. This is cheap and high-quality.

2. **Fallback to fresh `launch()`**: If the session is gone (backend restart, SDK timeout, or `writeToLiveRun` throws `"not active"` / `"cannot accept follow-up input"`), catch the error and start a new `SubagentRunner.launch()` with a composite prompt that includes prior attempt summaries as context.

```typescript
async continueWork(runId: string, followUpPrompt?: string): Promise<ContinueWorkResult> {
  const existingLaunch = this.activeLaunches.get(runId);
  const prompt = followUpPrompt?.trim() || "Continue working on the ticket.";
  let newAttemptPromise: Promise<SubagentEnvelope>;

  if (existingLaunch) {
    try {
      newAttemptPromise = existingLaunch.write(prompt);
      // Session reuse succeeded — same launch handle stays in the map.
    } catch {
      // Session expired or unavailable — fall back to fresh launch.
      this.activeLaunches.delete(runId);
      const freshLaunch = this.launchWithContext(runId, prompt);
      this.activeLaunches.set(runId, freshLaunch);
      newAttemptPromise = freshLaunch.resultPromise;
    }
  } else {
    const freshLaunch = this.launchWithContext(runId, prompt);
    this.activeLaunches.set(runId, freshLaunch);
    newAttemptPromise = freshLaunch.resultPromise;
  }
  // ... record attempt, bind promise handler ...
}
```

**Why this works**: The `SubagentRunLaunch` handle returned by `launch()` holds the live `CopilotSession` directly. When `keepAlive: true` (`subagent-runner.ts:289`) and a turn completes, the cleanup guard at `subagent-runner.ts:444` skips session teardown. The session stays alive for subsequent `write()` calls until either:
- Backend restart (in-memory `LiveRunState` lost)
- Copilot SDK session timeout (server-side, duration varies)
- Explicit `stop()` call

The `SubagentRunRegistry` idle timeout (`run-registry.ts:14`) does **not** apply here — `TicketRunService` holds the launch handle directly, bypassing the registry.

**Risk**: If the Copilot SDK session times out silently between attempts, `write()` may throw mid-turn. The catch-and-fallback handles this. Loss of conversation context on fallback is mitigated by including prior summaries in the fresh prompt.

### 3.3 Breaking the Coupling

In `TicketRunService.startWork()` / `continueWork()`:

```typescript
const launch = this.options.launchCodingRun({ task: prompt, allowWrites: true, mode: "background" });
this.activeLaunches.set(runId, launch);

launch.resultPromise
  .then((envelope) => {
    this.activeLaunches.delete(runId);
    // ⚠ Do NOT transition to "done" here
    this.recordAttempt(runId, launch.runId, "completed", envelope);
    this.transitionRun(runId, "awaiting-review", `Pass ${attemptCount} complete: ${envelope.summary}`);
    this.emitSnapshot();
  })
  .catch((error) => {
    this.activeLaunches.delete(runId);
    this.recordAttempt(runId, launch.runId, "failed", null);
    // Route to awaiting-review, NOT error — let the user decide next steps.
    // Only infrastructure failures (no DB, no session possible) warrant "error".
    this.transitionRun(runId, "awaiting-review",
      `Pass ${attemptCount} failed: ${error instanceof Error ? error.message : "Coding pass failed."}`);
    this.emitSnapshot();
  });
```

The `completeMission(runId)` method (called by the new `missions:ticket-run:complete` IPC message) is the only place that transitions to `"done"`.

### 3.4 On Backend Restart

On startup, scan all persisted runs with status `"working"` and transition them to `"awaiting-review"` with message: "Pass interrupted by backend restart. Review any partial changes and continue when ready." This is more honest and useful than forcing `"error"` — the worktree may contain partial work worth inspecting.

---

## 4. Data Model Changes

### 4.1 New `TICKET_RUN_STATUSES` Entries

```diff
// packages/shared/src/ticket-run-types.ts:1
- export const TICKET_RUN_STATUSES = ["starting", "ready", "blocked", "error", "done"] as const;
+ export const TICKET_RUN_STATUSES = [
+   "starting", "ready", "working", "awaiting-review", "blocked", "error", "done"
+ ] as const;
```

**Important — SQLite CHECK constraint**: The `ticket_runs` table at `database.ts:530` has:
```sql
CHECK(status IN ('starting', 'ready', 'blocked', 'error', 'done'))
```
SQLite does not support `ALTER TABLE ... ALTER COLUMN`. The migration v10 must:
1. `ALTER TABLE ticket_runs RENAME TO ticket_runs_old`
2. `CREATE TABLE ticket_runs (...)` with the updated CHECK including `'working'` and `'awaiting-review'`
3. `INSERT INTO ticket_runs SELECT * FROM ticket_runs_old`
4. `DROP TABLE ticket_runs_old`
5. Recreate indexes (`idx_ticket_runs_ticket_id`, `idx_ticket_runs_status`)
6. Point foreign keys from `ticket_run_worktrees` and `mission_attempts` at the new table

Wrap in a single transaction (the existing migration runner already does this).

### 4.2 New `TicketRunAttempt` Type

Add to `ticket-run-types.ts`:

```typescript
export const TICKET_RUN_ATTEMPT_STATUSES = ["running", "completed", "failed", "cancelled"] as const;
export type TicketRunAttemptStatus = (typeof TICKET_RUN_ATTEMPT_STATUSES)[number];

export interface TicketRunAttempt {
  attemptId: string;
  runId: string;
  subagentRunId: string;           // the SubagentRunner's runId (for tracing bus events)
  attemptNumber: number;           // 1-indexed; increments each pass
  prompt: string;                  // the prompt sent to the agent for this pass
  status: TicketRunAttemptStatus;
  summary: string | null;          // SubagentEnvelope.summary when completed
  followupNeeded: boolean;         // SubagentEnvelope.followupNeeded
  startedAt: number;
  completedAt: number | null;
}
```

### 4.3 Updated `TicketRunSummary`

Add to the existing summary type:

```typescript
export interface TicketRunSummary {
  // ... existing fields ...
  attemptCount: number;            // how many passes have run; 0 before first start
  lastAttemptSummary: string | null;  // SubagentEnvelope.summary from most recent settled pass
}
```

### 4.4 New IPC Messages

```typescript
// protocol.ts — ClientMessage additions
| { type: "missions:ticket-run:work";     requestId: string; runId: string }
| { type: "missions:ticket-run:continue"; requestId: string; runId: string; prompt?: string }
| { type: "missions:ticket-run:complete"; requestId: string; runId: string }
| { type: "missions:ticket-run:cancel";   requestId: string; runId: string }

// protocol.ts — ServerMessage additions
| { type: "missions:ticket-run:work:result";     requestId: string; result: StartWorkResult }
| { type: "missions:ticket-run:continue:result"; requestId: string; result: ContinueWorkResult }
| { type: "missions:ticket-run:complete:result"; requestId: string; result: CompleteRunResult }
| { type: "missions:ticket-run:cancel:result";   requestId: string; result: CancelAttemptResult }
```

### 4.5 Memory DB: New `ticket_run_attempts` Table

New table in `database.ts`:
```sql
CREATE TABLE IF NOT EXISTS ticket_run_attempts (
  attempt_id     TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES ticket_runs(run_id) ON DELETE CASCADE,
  subagent_run_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  prompt         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed','cancelled')),
  summary        TEXT,
  followup_needed INTEGER NOT NULL DEFAULT 0,
  started_at     INTEGER NOT NULL,
  completed_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ticket_run_attempts_run_id ON ticket_run_attempts(run_id, attempt_number);
```

Methods needed on `SpiraMemoryDatabase`:
- `insertTicketRunAttempt(attempt: TicketRunAttempt): TicketRunAttempt`
- `updateTicketRunAttempt(attemptId: string, patch: Partial<TicketRunAttempt>): TicketRunAttempt`
- `getTicketRunAttempts(runId: string): TicketRunAttempt[]`
- `getLatestAttempt(runId: string): TicketRunAttempt | null`

`TicketRunSummary.attemptCount` and `lastAttemptSummary` are derived from this table at read time — they are not stored redundantly on the run record.

### 4.6 `TicketRunServiceOptions`: New Dependencies

```typescript
export interface TicketRunServiceOptions {
  // ... existing ...
  launchCodingRun?: (args: SubagentDelegationArgs) => SubagentRunLaunch;  // injected in prod
}
```

In production (`index.ts`), wire this to a closure over `SubagentRunner.launch.bind(subagentRunner)` for the `"missions-coder"` domain. In tests, inject a mock that returns a `SubagentRunLaunch`-shaped fake.

---

## 5. Phase-by-Phase Implementation Plan

### Phase 1a: Status Model (lowest risk, do first)

| Step | File | Change |
|------|------|--------|
| Extend status enum | `ticket-run-types.ts:1` | Add `"working"` and `"awaiting-review"` |
| Add `TicketRunAttempt` type | `ticket-run-types.ts` | New interface + attempt status enum |
| Add `attemptCount` / `lastAttemptSummary` to `TicketRunSummary` | `ticket-run-types.ts` | Two new fields |
| Update `assertTicketRunStatus` | `database.ts` | Accept new statuses |
| Create `ticket_run_attempts` table | `database.ts` | New table + 4 new methods |
| Add `describeRunStatus` cases | `ProjectsPanel.tsx:65-78` | `"working"` and `"awaiting-review"` display strings |

No logic change in execution path. Pure schema/type extension.

### Phase 1b: "Start Work" (single-pass, no follow-up yet)

| Step | File | Change |
|------|------|--------|
| Add `"missions-coder"` domain | `subagent-types.ts` + backend domain registry | New domain with coding system prompt, appropriate tool scoping |
| Add `launchCodingRun` option + `activeLaunches` map | `ticket-runs.ts:47-56` | Dependency injection point |
| Add `startWork(runId)` | `ticket-runs.ts` | Validates `ready`, creates attempt record, launches, binds promise → `awaiting-review` |
| Add restart recovery | `ticket-runs.ts` / `index.ts` startup path | Scan `"working"` runs → `"awaiting-review"` on init |
| Wire `missions:ticket-run:work` | `protocol.ts`, `electron-api.ts`, `ipc-bridge.ts`, both `index.ts` | Follows `:sync` pattern exactly |
| Add "Start work" button | `ProjectsPanel.tsx` | Visible when `status === "ready"` |
| Wire `missions:runs:updated` throttle | `index.ts:1131-1136` | Debounce to max 1/2s during `"working"` |
| Add tests | `ticket-runs.test.ts` | Mock `launchCodingRun`; test `ready → working → awaiting-review`, `ready → working → error` |

Risk: `launchCodingRun` injection in tests is the key new design point. Keep the injected function type narrow: `(args: SubagentDelegationArgs) => SubagentRunLaunch` is sufficient.

### Phase 1c: "Continue Work", "Cancel", and "Mark Complete"

| Step | File | Change |
|------|------|--------|
| Add `continueWork(runId, prompt?)` | `ticket-runs.ts` | Validates `awaiting-review`, tries `launch.write()` for session reuse, falls back to fresh launch with prior summary context |
| Add `completeMission(runId)` | `ticket-runs.ts` | Validates `awaiting-review`, transitions to `"done"` |
| Add `cancelAttempt(runId)` | `ticket-runs.ts` | Validates `working`, calls `launch.stop()`, records attempt as `cancelled`, transitions to `awaiting-review` |
| Wire `missions:ticket-run:continue` | protocol + API + bridge + index | Same pattern as `:work` |
| Wire `missions:ticket-run:complete` | protocol + API + bridge + index | Same pattern as `:work` |
| Wire `missions:ticket-run:cancel` | protocol + API + bridge + index | Same pattern as `:work` |
| Add `"awaiting-review"` card UI | `ProjectsPanel.tsx` | Show last attempt summary, attempt count, Continue and Mark complete buttons |
| Add follow-up prompt textarea | `ProjectsPanel.tsx` | Local state `followUpPrompt`, shown when user expands "Continue" section |
| Add "Cancel" button on `working` cards | `ProjectsPanel.tsx` | Calls cancel IPC, disabled until server responds |
| Add tests | `ticket-runs.test.ts` | `awaiting-review → working → awaiting-review`, `awaiting-review → done`, `working → cancelled → awaiting-review`, session reuse vs fallback |

### Phase 2: Activity Log and Observability

- Persist the last N tool call records per attempt in `ticket_run_attempts` (JSON column or separate events table).
- Expandable "Activity" section in run card showing tool calls and results.
- YouTrack comment on `completeMission()`.
- Attempt history browsing: show all N attempts with prompt + summary per attempt.

### Phase 3: Automation and Polish

- Auto-start option after pickup.
- "Open diff" / "Create PR" on `"done"`.
- Run history browsing (archived missions).
- Multi-repo worktree support.

---

## 6. Tradeoffs and Risks

### 6.1 New `"awaiting-review"` Status vs. Reusing `"ready"`

**Option considered:** Reuse `"ready"` for "has had a pass, waiting for next action" to minimize new statuses.

**Rejected:** `"ready"` currently means "never had an execution pass" — the UX (button label "Start work") is different from "had at least one pass" (button labels "Continue work" / "Mark complete"). Overloading the status creates confusing conditionals in `ProjectsPanel.tsx` and `TicketRunService` that reference `attemptCount` to disambiguate. Separate status is cleaner.

**Risk:** One more case to handle in `describeRunStatus` and `upsertTicketRun` validation. Low risk.

### 6.2 Attempt Persistence vs. In-Memory Only

**Option considered:** Keep attempt state in-memory only (no DB table), just store `attemptCount` and `lastAttemptSummary` on `TicketRunSummary`.

**Rejected:** Without persisted attempts, backend restart loses which pass produced which output. The user can't audit "what did pass 2 actually do?" and you can't build a useful review UI later. The DB table is small (one row per pass, a handful of text columns) and the migration is straightforward.

**Risk:** New table means schema migration in `database.ts`. If the migration fails on an existing install, existing ticket runs are unreadable. Mitigation: wrap table creation in `IF NOT EXISTS` (already the pattern) and default the new `attemptCount` field to 0 so old run rows still hydrate cleanly.

### 6.3 Session Reuse via `write()` — Try-Then-Fallback

**Strategy:** On "Continue work", attempt `SubagentRunLaunch.write(prompt)` first. If the session is still alive, this preserves full conversation context. If it throws, fall back to fresh launch with summary-based context reconstruction.

**Why this is safe for Phase 1c:**
- `writeToLiveRun` (`subagent-runner.ts:454-470`) has three explicit guards: `liveRun.closed`, `liveRun.activeTurnPromise` (prevents concurrent turns), and `liveRun.keepAlive && liveRun.session`. All three throw `CopilotError` which is catchable.
- The fallback path (fresh launch) is the same code path as `startWork()`, so it's already tested.
- The session-alive happy path avoids re-reading the codebase, which saves significant agent time on follow-ups.

**When session reuse fails:**
- Backend restart → `activeLaunches` map is empty → fallback
- Copilot SDK timeout → `write()` throws → fallback
- User took too long reviewing → same as SDK timeout → fallback

**Tradeoff:** Fresh launch loses conversational memory (tool call history, intermediate reasoning). Summarized context is a lossy but sufficient proxy for coding tasks where the diffs on disk are the real state.

### 6.4 Coupling to SubagentRunner Events for Progress Updates

The `subagent:delta` bus events are identified by `runId` (the SubagentRunner run ID, not the mission run ID). `TicketRunService` must map `subagentRunId → missionRunId` to route deltas to the right mission. The `activeLaunches` map provides this:

```typescript
// In TicketRunService constructor or startWork():
this.options.bus?.on("subagent:delta", (event) => {
  for (const [missionRunId, launch] of this.activeLaunches) {
    if (launch.runId === event.runId) {
      this.throttledProgressUpdate(missionRunId, event.delta);
      break;
    }
  }
});
```

This listener must be registered once and remain active. Risk: if `bus.on` is called multiple times (e.g., startWork called twice on same run), duplicate listeners accumulate. Mitigation: track whether the listener is already registered, or move the listener to the constructor.

### 6.5 `"missions-coder"` Domain System Prompt

The agent needs accurate instructions for coding in a worktree, committing changes, and summarizing work. A weak prompt leads to the agent doing nothing, asking clarifying questions, or writing code outside the worktree. This is a quality risk, not an architecture risk. Mitigation: start with a detailed system prompt in Phase 1b and iterate before Phase 2 based on observed behavior.

---

## Appendix: Key File References

| File | Key Lines | What |
|------|-----------|------|
| `packages/shared/src/ticket-run-types.ts` | 1-51 | Status enum, run data model — primary change target |
| `packages/backend/src/missions/ticket-runs.ts` | 47-56, 120-284, 308-354 | Service options, startRun, syncRunState — add startWork/continueWork/completeMission |
| `packages/backend/src/subagent/subagent-runner.ts` | 113-120, 278-307 | SubagentRunLaunch type, launch() method — reuse unchanged |
| `packages/backend/src/subagent/run-registry.ts` | 14, 123-142, 188-196 | Idle timeout, write(), completed→idle transition — explains session lifetime risk |
| `packages/backend/src/util/event-bus.ts` | 45-53 | `missions:runs-changed`, `subagent:delta`, `subagent:completed` — event wiring |
| `packages/shared/src/protocol.ts` | 94-96, 149-160 | IPC message types — add 4 new `:work`, `:continue`, `:complete`, `:cancel` pairs |
| `packages/renderer/src/components/projects/ProjectsPanel.tsx` | 65-78, 385-434, 654-701 | Status display, action handlers, run cards — add awaiting-review card |
| `packages/memory-db/src/database.ts` | 1423-1554 | `upsertTicketRun` — add attempts table + methods |
| `packages/backend/src/index.ts` | 640-740, 1064-1070, 1131-1136 | IPC handlers, service init, bus→WS bridge |
| `packages/main/src/ipc-bridge.ts` | 64-72, 105-107, 482-507 | Bridge types and IPC handle registration |
