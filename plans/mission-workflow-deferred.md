# Mission workflow — deferred items

**Parent plans:**
- [mission-workflow-overhaul.md](./mission-workflow-overhaul.md) — phases 0–7, shipped 2026-05-09 / 2026-05-10.
- [mission-workflow-followups.md](./mission-workflow-followups.md) — batches A/B/C/D/E, shipped 2026-05-10.

**Status:** drafted 2026-05-10.

## Goal

The follow-ups plan deliberately deferred a small set of items where the cost of fixing inline outweighed the benefit at the time:

- Some needed a primitive that didn't exist yet (a backend transaction API).
- Some were judgment-call polish that didn't earn its weight against the risk of a wider refactor.
- Some were premature optimisations until production volume hits a threshold.

This plan groups them so they can ship as one PR each when the moment is right. Most items are individually small; the goal is to keep them out of "we'll get to it" purgatory by giving them a home.

## Operating principles

- **No item lands in isolation.** Each batch is a self-contained PR-sized change. If a batch's primitive (e.g. the transaction API) doesn't exist, that primitive lands first as its own PR.
- **Volume thresholds get measured before action.** Items C-flagged "wait for volume" must include a real measurement in the PR description.
- **Visual hygiene is one-pass.** Don't drift mid-batch into general comment / styling cleanup the rest of the codebase doesn't want.

---

## Batch F — Backend transaction API (enables F.2 + future batch writes)

### F.1 `runInTransaction` on `SpiraMemoryDatabase`

`packages/memory-db/src/database.ts` exposes individual mutators but no way for a backend caller to compose several into one atomic write. better-sqlite3's `db.transaction(fn)` wrapper is what the per-module helpers (`seedBuiltinRepoProfiles`, `appendWorkSessionEvents`) already use internally; this batch exposes that pattern at the facade level.

**Action.** Add:

```ts
runInTransaction<T>(fn: () => T): T
```

The implementation wraps `context.db.transaction(fn)` and runs synchronously. Document that callers must not perform async work inside `fn` (better-sqlite3 transactions are sync — that's the point).

**Definition of done:** the API exists, has a test that proves rollback on throw, and is invoked from at least one caller (F.2).

### F.2 Wrap auto-promotion writes in one transaction

[ticket-runs.ts:observeValidationProfileCandidates](../packages/backend/src/missions/ticket-runs.ts) currently does, per qualifying candidate:

1. `recordMissionEvent` (sync `appendMissionEvent`)
2. `memoryDb.upsertValidationProfile` (sync transaction)
3. `recordMissionEvent` again (sync `appendMissionEvent`)

3N sync DB hits per close-side sweep. The work is already off the close path's user-visible latency via `setImmediate` (so the operator never waits), but each iteration takes a write lock independently. Wrapping the whole `for` loop in `memoryDb.runInTransaction(() => { ... })` collapses it to one lock acquire + commit per sweep.

**Definition of done:** the sweep runs inside one transaction; PR description includes `EXPLAIN QUERY PLAN` or a before/after timing on a 10-candidate sweep.

### F.3 Audit other "loop of mutators" call sites

Once F.1 lands, sweep for callers that loop over `upsertX` / `appendX`. Likely candidates:

- The `seedBuiltinRepoIntelligence` path during initial setup.
- The bulk-rollback flow in [LearnedCandidatesEditor.tsx](../packages/renderer/src/components/settings/LearnedCandidatesEditor.tsx) — currently sequential IPC round-trips; if the backend exposes a `revokeMissionLearnedCandidates(ids[])` it can run as one transaction.
- The JSON import in [RepoProfilesEditor.tsx](../packages/renderer/src/components/settings/RepoProfilesEditor.tsx) — same pattern.

For each, decide: (a) wrap in `runInTransaction` server-side, (b) add a bulk IPC variant, or (c) leave as-is because the per-call overhead doesn't matter.

**Definition of done:** each candidate site is either changed or has a one-line PR comment explaining why it's fine.

---

## Batch G — Schema completions

### G.1 Add `"learned"` source enum to validation_profiles

Phase 5.4's auto-promotion of validation_profiles (shipped in B.7) labels promoted rows as `source: "user"` because the schema's `source` column doesn't include `"learned"`. The enum currently allows `"builtin" | "user"`. Adding `"learned"` lets the renderer render auto-promoted profiles distinctly and lets a future revoke-flow target only learned rows.

**Action.**
- Migration: extend the source CHECK constraint or rebuild via the table-rename pattern (consistent with v29/v30/v31 migrations).
- Update `UpsertValidationProfileInput.source` union in `packages/memory-db/src/database/types.ts`.
- Update the auto-promotion site in `ticket-runs.ts:observeValidationProfileCandidates` to use `source: "learned"`.
- Renderer badges in [ValidationProfilesEditor.tsx](../packages/renderer/src/components/settings/ValidationProfilesEditor.tsx) get a third style class for `learned`.

**Definition of done:** auto-promoted entries display as `learned` in the editor; existing user-edited and builtin entries are unaffected; a migration test asserts no `"user"` row gets retroactively rewritten.

### G.2 Replace magic-string label `"Auto: ${kind} (${command})"`

The auto-promotion path mints a label like `Auto: build (pnpm run build)`. Hand-curated labels could collide with this format. Once G.1 lands, the label can be a stable function of the candidate id (since `source: "learned"` is enough to identify it visually), and the human-readable label can be operator-edited via B.2's edit flow.

**Definition of done:** auto-promoted labels are deterministic and don't pretend to be human-edited copy; operator edits via B.2 persist past the next close-path sweep (sweep must skip rows that already exist regardless of label drift — confirm via test).

---

## Batch H — Renderer polish

### H.1 Inline styles → CSS modules

Several editors land with `style={{ display: "flex", gap, padding, fontSize, opacity }}` rather than reusing the existing CSS module. Sites:

- [LearnedCandidatesEditor.tsx](../packages/renderer/src/components/settings/LearnedCandidatesEditor.tsx) — bulk-rollback panel + button row.
- [MissionDetailsRoom.tsx](../packages/renderer/src/components/missions/rooms/MissionDetailsRoom.tsx) — chip-bar above the timeline.
- [RepoProfilesEditor.tsx](../packages/renderer/src/components/settings/RepoProfilesEditor.tsx) — header button row + import label.

**Action.** Add the relevant classes to the existing `*.module.css` siblings; replace inline `style` with `className`.

**Definition of done:** zero inline `style={{}}` introduced by the follow-ups batches; visuals unchanged.

### H.2 Extract a `<TimelineFilterChip>` component

The chip-bar in `MissionDetailsRoom.tsx` has duplicated `<button>` JSX where the only difference is the toggle payload. Extract one component, loop over `["__all__", ...distinctEventTypes]`.

### H.3 `BoundedMap` doc rename

The class is FIFO, not LRU — `get` doesn't refresh recency. The docstring already admits this. Either:

- Rename the class to `FifoBoundedMap` and the file to match (callers stay typed; rename is mechanical), or
- Implement true LRU recency-on-get (only worth it if a workload appears that benefits).

Pick (a) for clarity; defer (b) until evidence demands it.

### H.4 Backend handler dispatch helper

`backend/src/index.ts` is growing a long if-else cascade of `if (message.type === "...") { /* sendUnavailable; try; send result; catch; toErrorPayload */ }` blocks. The pattern is now ≥ 30 sites. Worth extracting:

```ts
defineRequest({
  type: "missions:weekly-digest:generate",
  available: () => weeklyDigestHandle != null,
  unavailableLabel: "Weekly digest",
  errorCode: "MISSIONS_WEEKLY_DIGEST_FAILED",
  errorMessage: "Failed to generate weekly digest.",
  errorSource: "missions",
  run: async (msg) => ({ path: await weeklyDigestHandle!.runNow() }),
});
```

Keeps the dispatch flat, removes ~15 lines per handler. Not blocking; ship when someone has the appetite for the refactor.

### H.5 Comment capitalization sweep cleanup

The Phase 4–7 cleanup left some JSDoc continuation lines with the wrong capitalization (some now start with a capital where they're mid-sentence; some start lowercase where they're starting a new sentence). Cosmetic only.

**Action.** One pass with human eyes (script-only is unreliable — sentence boundaries don't align with line boundaries). Touch only files already affected by the prior sweeps.

### H.6 `WorkSessionNowPlayingStrip` shared ticker

The strip mounts two `setInterval` timers per station (5s poll + 1s elapsed-tick). With several stations enabled the elapsed-tick is redundant work. Wire it to the same shared "now" tick used by `AuxDeck` (or a new lightweight `useNow` hook).

---

## Batch I — Performance, when volume warrants

These items only matter once production usage crosses a threshold. Ship with measurements, not hunches.

### I.1 Chunked deletes in `events-retention`

Both `mission_events` and `work_session_events` retention sweeps run as one `DELETE WHERE occurred_at < ?`. better-sqlite3 deletes block the event loop. With a 90-day window and heavy event volume (~10k events/day), the sweep may stall WS traffic for hundreds of ms.

**Action.** Add chunked deletes with `LIMIT 5000` in a loop, yielding via `setImmediate` between batches. Only ship when `EXPLAIN QUERY PLAN` shows the unchunked `DELETE` is the actual bottleneck.

**Definition of done:** PR includes a real timing measurement showing the sweep stalls > 50ms before the change and < 50ms after.

### I.2 Indexed `listTicketRuns` window query

[weekly-digest-scheduler.ts:46-52](../packages/backend/src/missions/weekly-digest-scheduler.ts) reads every ticket run and filters in JS. Cheap today; expensive at thousands of historical runs.

**Action.** Add `listTicketRuns({ status, updatedAtSince, updatedAtUntil })` overload backed by an index on `ticket_runs(status, updated_at)`. Migrate the digest scheduler.

### I.3 Shared "reports" directory constant

Both `postmortem-writer.ts` and `weekly-digest-scheduler.ts` hardcode `path.join(workspaceRoot, "reports")`. If a third writer appears, extract:

```ts
export const REPORTS_DIRNAME = "reports" as const;
```

next to `atomicWritePostmortem`. Trivial; only worth doing when the third caller materialises.

---

## Sequencing recommendation

If we ship in this order, each batch leaves the repo a notch cleaner:

1. **Batch G (schema completions)** — small, mechanical, unblocks renderer polish in H.
2. **Batch F (transaction API)** — primitive that opens the door to F.3's sweep.
3. **Batch H (renderer polish)** — visible win for the operator; depends on G.1 for the badge styling.
4. **Batch I (perf when warranted)** — only after a real measurement.

If only one batch ships, do **G**: it has the highest renderer-visible impact for the smallest blast radius.

---

## Definition of done (whole plan)

A batch is done when:

1. Every action item in the batch has shipped.
2. The schema migration in G.1 has a backwards-compatibility test (existing rows survive untouched).
3. The transaction API in F.1 has a test proving rollback on throw.
4. Each Batch I item ships with a numeric measurement in the PR description.

---

## Out of scope

- New mission-workflow phases (the seven shipped phases plus the follow-ups are it).
- Any change to the renderer's visual identity.
- Any change to the provider escalation ladder.
- Anything that needs a fresh design discussion (e.g. moving WorkSession into the same `mission_events` table — that's a schema decision, not a follow-up).
- Performance work without a measurement justifying it.
