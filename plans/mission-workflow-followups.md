# Mission workflow follow-ups

**Parent plan:** [mission-workflow-overhaul.md](./mission-workflow-overhaul.md) — phases 0–7 shipped 2026-05-09 / 2026-05-10.
**Status:** all five batches (E, A, C, B, D) shipped 2026-05-10. See per-batch headings below for shipped notes.

## Goal

The seven-phase overhaul shipped end-to-end in two days. Each phase deferred a small set of items because they (a) needed a later phase's primitives to land first, (b) were a wider refactor than the phase wanted to absorb, or (c) were judgment-call polish that didn't earn its weight in isolation. Now that all the primitives exist, this plan groups those items into coherent batches and ships them together. Goal: leave the workflow surface a notch cleaner than the phases left it, and pick up the user-visible polish that was deliberately held back.

## Operating principles

- **One pass over each cross-cutting concern.** If five sites duplicate a pattern, fix all five in the same PR; partial dedup is worse than no dedup.
- **Test coverage before extraction.** Every shared util that absorbs N call sites needs a single test that pins the contract — the call sites collapse to thin wrappers.
- **No new feature work.** Items here are dedup, polish, deferred wiring, and small UX completions. Anything that needs a fresh design discussion goes to a separate plan.
- **One PR per batch.** Each batch below is a self-contained PR-sized change with a clear definition-of-done.

---

## Batch A — Shared utilities (cross-phase dedup) **— shipped 2026-05-10**

**Goal:** consolidate the duplicated patterns that landed across phases 2, 4, 5, 6, 7. Source of most of the "skipped reuse" findings in the per-phase reviews.

### A.1 Shared spawn-with-timeout util

The `spawn(binary, args).then(timeout-or-exit)` pattern landed in four places:
- [proof-runner.ts:158](../packages/backend/src/missions/proof-runner.ts) (the original; runs validation harnesses)
- [proof-preflight.ts:62](../packages/backend/src/missions/proof-preflight.ts) (`binaryAvailableDefault` for `dotnet --version`)
- [dependency-warmer.ts](../packages/backend/src/missions/dependency-warmer.ts) (richer variant with stderr capture)
- [work-session-preflight.ts:58](../packages/backend/src/runtime/session-manager/work-session-preflight.ts) (`defaultBinaryAvailable`)

**Action.** Extract `packages/backend/src/util/spawn.ts` exposing:

- `binaryAvailable(binary, options?: { timeoutMs? }): Promise<boolean>` — the simple `--version` probe shared by Phase 2 + Phase 7.
- `spawnWithTimeout(command, args, options): Promise<{ exitCode, signal, stderrTail, timedOut }>` — the rich variant for proof-runner + dependency-warmer.

Migrate all four call sites. Each shrinks to a single import + one call. The `child as unknown as NodeJS.EventEmitter` cast (currently in 4 places) collapses to one place where it belongs.

**Definition of done:** every spawn-with-timeout call in `packages/backend/src/missions/` and `packages/backend/src/runtime/session-manager/` flows through the new util; no `child as unknown as NodeJS.EventEmitter` outside it.

### A.2 Shared `OutcomeKind` + `outcomeLearningWeight`

`MissionOutcomeKind` (Phase 5) and `WorkSessionOutcomeKind` (Phase 7) are byte-identical:

```ts
type X = "clean-pass" | "pass-with-friction" | "fail-with-recovery" | "fail-final"
```

`outcomeLearningWeight` is also identical (clean=1, friction=0.5, recovery=0.25, final=−2).

**Action.** Move both to `packages/shared/src/outcome.ts` (or `packages/backend/src/missions/outcome-shared.ts`). Both classifiers re-export the kind, return their per-domain extras on top of the shared shape.

**Definition of done:** one `OutcomeKind` definition; both `mission-outcome.ts` and `work-session-outcome.ts` import it; tests reference the shared name.

### A.3 Shared atomic-write postmortem helper

`ticket-runs.ts:writePostmortemStub` (Phase 1.5) and `work-session-postmortem.ts:writeWorkSessionPostmortem` (Phase 7.4) repeat the same `mkdir → writeFile { flag: "wx" } → swallow EEXIST` flow.

**Action.** Extract `packages/backend/src/missions/postmortem-writer.ts` with:

```ts
export const atomicWritePostmortem = async (input: {
  workspaceRoot: string;
  filename: string;
  markdown: string;
}): Promise<{ status: "written"; path: string } | { status: "exists"; path: string }>
```

Both call sites compose `filename + markdown` and hand off the I/O. Returns a discriminated result so callers can distinguish "no workspace" from "EEXIST" from "written" — fixes the silent-skip ambiguity flagged in the Phase 7 quality review.

**Definition of done:** both post-mortem writers route through the shared helper; renderer / future viewer can find the actual on-disk path via the discriminated return.

### A.4 Consolidate the five duration formatters

Pre-existing pattern flagged across multiple phases. Sites with their own `formatDuration*` / `formatRuntime` / `formatElapsed`:
- `packages/backend/src/missions/post-mortem-generator.ts` (`formatDurationMs` — exported in Phase 6)
- `packages/renderer/src/components/missions/rooms/NowPlayingStrip.tsx` (`formatElapsed` + `formatBudgetWindow`)
- `packages/renderer/src/components/missions/rooms/ProofRunsViewer.tsx`
- `packages/renderer/src/components/settings/ValidationProfilesEditor.tsx` (`formatRuntime`)
- `packages/renderer/src/components/missions/AuxDeck.tsx` (per the Phase 6 reviewer note)

**Action.** Add `packages/shared/src/duration-format.ts` with `formatDuration(ms, { style: "long" | "short" | "minutes-only" | "elapsed" })`. Output styles match the existing per-site formats so call-site rendering doesn't change. Migrate all five sites.

**Definition of done:** one formatter; five-call-site sweep; every existing format string is preserved verbatim in some style.

### A.5 Tag-prefix scanning helper for learned candidates

`learned-candidate-promoter.ts` and `learned-candidates-service.ts` re-implement `tags.filter(t => t.startsWith(TAG_PREFIXES.revokedRun)).map(t => t.slice(...))` patterns multiple times.

**Action.** Add `packages/backend/src/missions/learned-tag-state.ts` exposing `parseLearnedTagState(record): { revoked, archived, promotedRunIds, revokedRunIds, classification, sourceRunId }`. Both modules consume it instead of re-deriving. Also migrate the inline `run:`/`ticket:`/`classification:`/`outcome:`/`learned` literals in `mission-intelligence.ts` to `TAG_PREFIXES`.

**Definition of done:** one tag-scan helper; no re-grep of `startsWith("revoked-run:")` etc anywhere outside it.

### A.6 Shared `getSupersedableValidationKinds`

Phase 6.1 added the predicate "kinds with a passing winner AND an effective older failure" twice — once in [MissionDetailsRoom.tsx:563](../packages/renderer/src/components/missions/rooms/MissionDetailsRoom.tsx) (renderer derivation), once in [mission-lifecycle.ts:supersedeValidationsByKind](../packages/backend/src/missions/mission-lifecycle.ts) (backend assertion).

**Action.** Add to `packages/shared/src/ticket-run-workflow.ts`:

```ts
export const getSupersedableValidationKinds = (
  validations: readonly TicketRunMissionValidationRecord[],
): Set<string>
```

Both sites consume it.

**Definition of done:** one predicate; renderer + backend agree by import.

### A.7 Sort-helper for validations newest-first

The sort key `(left, right) => right.startedAt - left.startedAt || right.createdAt - left.createdAt` appears in:
- `mission-lifecycle.ts:supersedeValidationsByKind`
- `MissionDetailsRoom.tsx` (validate-phase rendering)
- `shared/src/ticket-run-workflow.ts:getEffectiveValidations`

**Action.** Export `sortValidationsNewestFirst` from `shared/src/ticket-run-workflow.ts`; reuse in all three places.

### A.8 Shared `percentile` / fold `median` into it

`phase-budget.ts:percentile` (Phase 6) is a strict superset of `validation-candidate-learner.ts:median` (Phase 5).

**Action.** Promote `percentile` to `packages/backend/src/util/stats.ts` and rewrite `median` as `percentile(sorted, 0.5)`.

---

## Batch B — Promised UX surfaces (deferred per-phase) **— shipped 2026-05-10**

**Goal:** ship the operator-facing affordances each phase explicitly deferred.

### B.1 Onboarding wizard prompt for unknown projectKey

Phase 3.2 deferred this. The admin pane covers the same ground but isn't auto-prompted on demand.

**Action.** When a worktree is created for a `projectKey` with no `repo_profiles` row, the mission UI shows a dismissable "We don't know much about this repo yet — capture the basics?" toast that links into the new RepoProfilesEditor pre-filled with the projectKey. Skippable; no commits offered; nothing written into the target repo.

### B.2 Edit existing validation profiles

Phase 3.4 shipped add + delete only. Editing meant delete + re-add.

**Action.** Edit-existing on the validation-profiles editor (mirrors the repo-profiles pattern). Same locked-projectKey-on-edit constraint.

### B.3 JSON export / import for repo profiles

Phase 3.3 mentioned this as nice-to-have. Skipped at the time because the DB is the source of truth and operators can re-edit.

**Action.** Add an export-as-JSON button on the RepoProfilesEditor (downloads a single file). Add an import-JSON button on the same editor (round-trips the export). Useful for moving intelligence between Spira instances.

### B.4 Weekly-digest cron + on-disk write

Phase 5.3 shipped the pure generator but no scheduler invokes it.

**Action.** Add a scheduled job in the backend that runs the digest at a configurable cron (default Monday 09:00 local) and writes the result to `<workspaceRoot>/reports/weekly-mission-digest-{date}.md`. Last-run timestamp persists in `runtime_session_state`. Add a manual "Generate digest now" button on the admin pane.

### B.5 "Trust signal" labels in the prompt

Phase 5.4 deferred this. Auto-promoted entries should annotate themselves with a confidence band in the repo-guidance section.

**Action.** Extend `repo-guidance.ts:formatIntelligenceGroup` to emit a confidence-banded label per entry: "high-confidence" (≥2× threshold), "promoted" (≥threshold), "provisional" (within 25% of threshold). Banding is recomputed at prompt-build time from the entry's tags + scoring formula.

### B.6 Rollback last N promotions

Phase 5.4 wired single revoke; bulk rollback was deferred.

**Action.** Add a "Rollback last N promotions" button on the LearnedCandidatesEditor that lists the most recent N `learned-candidate-promoted` events with checkboxes; ticking + confirm fires `revokeMissionLearnedCandidate` for each with `reason: "Bulk rollback YYYY-MM-DD"`.

### B.7 Auto-promotion for `validation_profile` candidates

Phase 5.4 covers `briefing` / `example` / `pitfall` repo-intelligence types. Validation-profile candidates currently surface as `validation-profile-candidate-observed` events but never promote automatically.

**Action.** Reuse the same scoring formula (with a higher threshold, e.g. 5) targeting `validation_profiles` instead of `repo_intelligence_entries`. Promotion = `upsertValidationProfile` with `source: "user"` (since the validation-profile schema doesn't have a `source: "learned"` enum value yet — adding one would be its own migration). Audit-trail event mirrors the existing `learned-candidate-promoted` shape.

### B.8 WorkSession "now playing" surface for the primary station

Phase 7.1 wrote the events but didn't surface them in the renderer.

**Action.** Add a small `WorkSessionNowPlayingStrip` component that reads `listWorkSessionEventsByStation(stationId)` for the primary station and renders the latest non-system event with a relative timestamp. Slot it into the chat panel above the input as a single optional row (off by default; togglable in settings).

---

## Batch C — Performance follow-ups (deferred per-phase) **— shipped 2026-05-10**

**Goal:** the efficiency reviews flagged a handful of "real but not blocking" issues. Knock them out together.

### C.1 SQL pushdown for cross-mission validation-candidate query

Phase 5.2 reviewer #1: `observeValidationProfileCandidates` does N+1 against `mission_events` (one query per peer run). The `setImmediate` deferral kept it off the hot path; Phase 5's `source` filter pushdown helped the related promotion sweep. The validation-candidate query still iterates per-peer.

**Action.** Push the filter into a single SQL: `SELECT ... FROM mission_events e JOIN ticket_runs r ON e.run_id = r.run_id WHERE r.project_key = ? AND r.status = 'done' AND e.event_type = 'attempt-shell-command'`. Index `(run_id, event_type)` if EXPLAIN QUERY PLAN shows a residual scan.

Also raise / page the 500-event-per-run cap noted in the review (silent correctness bug for very long missions).

### C.2 Cache + collapse the seed's repo-profile SELECTs

Phase 7.2 reviewer #3: `seedBuiltinRepoProfiles` does 3 SELECTs per item (existing-check + upsert's pre-check + upsert's post-fetch). For one entry today, fine. For 5–10 entries when more builtin profiles land, worth fixing.

**Action.** Single `INSERT ... ON CONFLICT(project_key) DO UPDATE ... WHERE source = 'builtin'` enforces the "don't trample user rows" rule in one statement. Update `seedBuiltinValidationProfiles` and `seedBuiltinProofRules` if they have the same shape.

### C.3 Drop post-insert SELECT in `appendMissionEvent` too

Phase 7.2 fixed this for `appendWorkSessionEvent`. The pre-existing `appendMissionEvent` in `missions.ts` has the same redundant SELECT-by-id.

**Action.** Construct the record from `result.lastInsertRowid` + the inputs, the same way `appendWorkSessionEvent` does now.

### C.4 LRU caps on TicketRunService caches

Phase 4 reviewer flagged unbounded growth on `usableWorktreeCache`, `proofDiscoveryCache`, `phaseBudgetCache`. Per-process bound is "one entry per worktree path" but if the backend runs across hundreds of missions a process lifetime, it leaks.

**Action.** Wrap each with `lru-cache` (cap ~256). Or sweep entries whose `worktreePath` no longer exists when the snapshot rebuilds.

### C.5 Retention policy for events tables

Both `mission_events` and `work_session_events` have no retention. Long-running deployments accumulate events indefinitely.

**Action.** Add a configurable retention window (default 90 days) and a periodic delete job (run at startup + once per day). Mirror whatever the existing conversation-events retention does, if any.

---

## Batch D — Observability + audit completeness **— shipped 2026-05-10**

**Goal:** finish the audit-trail surfaces that landed partially in Phase 5 and 7.

### D.1 "Intelligence audit" tab on the admin pane

Phase 5.4 said: "Both event types are surfaced in a dedicated 'Intelligence audit' tab on the admin pane (§3.3) — no clicking through `mission_events` to reconstruct what happened." That tab doesn't exist yet — promotions and revocations only show up via the timeline.

**Action.** New `IntelligenceAuditEditor` settings tab. Lists the most recent `learned-candidate-promoted` and `learned-candidate-revoked` events with: timestamp, candidate id (clickable into the LearnedCandidatesEditor row), confidence score, formula version, contributing-run snapshot, contradicting-run snapshot. Read-only.

### D.2 Mission-events admin filter

Phase 0.1's typed taxonomy has 30+ event types now. Operators have no way to filter the timeline view by event type.

**Action.** Add a small chip-bar above the timeline section in `MissionDetailsRoom` that toggles event-type filters. Stateless (no persistence); URL-paramless.

### D.3 WorkSession close event includes `postmortemPath`

Phase 7 quality reviewer #2: `writeWorkSessionPostmortem` returns the path on success but the close event metadata doesn't carry it. A future post-mortem viewer would have to re-derive the filename.

**Action.** Make `writeWorkSessionPostmortem` (already returns `string | null`) feed the `worksession-closed` event's metadata with `postmortemPath: string | null`. Same for the mission post-mortem if the mission close event payload doesn't already.

---

## Batch E — Pre-existing fix-ups **— shipped 2026-05-10**

**Goal:** clean the long-standing bugs that the per-phase reviews surfaced as "not introduced by this work" but are in the same neighbourhood.

### E.1 Pre-existing typecheck errors in `session-manager.permission-lifecycle.suite.ts`

Lines 161 and 217: `confidence: 0.9` vs the actual `WorkSessionClassification.confidence: "heuristic"` literal type. Flagged from Phase 1 onward; never fixed because it was out of scope for each phase.

**Action.** Update both fixtures to use `confidence: "heuristic"`. Single-line fix.

### E.2 Pre-existing `pathExists` duplicate on `TicketRunService`

`ticket-runs.ts:2110` has a class-method `private async pathExists` that swallows all errors (returns `false` even on EPERM). Pre-dates the canonical `util/fs.ts:pathExists` (added in Phase 2). Phase 4 reviewer flagged it.

**Action.** Drop the class method; use the shared util.

### E.3 Comment-prefix sweep

Phases 4–7 reviewers all flagged the same pattern: "Phase X.Y —" comment prefixes narrate the change rather than the code. Each phase deferred the cleanup; doing it as a single sweep is cheaper and safer than per-file.

**Action.** One-pass repo sweep removing the "Phase X.Y —" lead-in from JSDoc + inline comments. Keep the substantive body of each comment; drop the version tag. Touch only files that already have `Phase` prefixes — don't drift into general comment hygiene.

### E.4 `projectKey: "Spira"` casing convention

Phase 7 quality reviewer #5: every other `projectKey` in the codebase is a YouTrack short-name (uppercase). The `BUILTIN_REPO_PROFILES` row uses `"Spira"`.

**Action.** Decide the convention for self-targeting (Spira-on-Spira) profiles:
- Option A: use `"SPI"` (matches test-fixture convention). Implies Spira-side WorkSessions look up `repo_profiles` by their YouTrack project key.
- Option B: keep `"Spira"` and document a separate "self-target" key namespace; renderer guidance lookup learns to fall back from YouTrack key → self-target name.

Pick one; update the seed accordingly; add a test that covers the lookup path actually used.

### E.5 `isBackendResponseMessage` audit

Phase 5 caught that Phase 2/3's admin-handler results were missing from the runtime check. Sweep the rest:

**Action.** Walk every `:result` message type in `protocol.ts` and ensure each appears in `ipc-bridge.ts:isBackendResponseMessage`. Add a test that asserts the runtime check covers every server message that has `requestId`.

---

## Sequencing recommendation

If we ship in this order, each batch leaves the repo a notch cleaner:

1. **Batch E (pre-existing fix-ups)** — cheapest, smallest blast radius. Land first to clear noise.
2. **Batch A (shared utilities)** — biggest dedup; everything else benefits.
3. **Batch C (perf follow-ups)** — once A.1 (shared spawn) lands, the perf sites get easier to touch.
4. **Batch B (promised UX)** — net-new operator-facing surfaces.
5. **Batch D (audit completeness)** — wraps up the Phase 5 promises.

If only one batch ships, do **A**: it removes the most code and sets every other batch up for an easier landing.

---

## Definition of done (whole plan)

A batch is done when:

1. Every action item in the batch has shipped behind a feature flag where applicable.
2. The shared utilities listed in Batch A have ≥ 1 test each, and the migrated call sites still pass their existing tests.
3. The Batch C performance items each show a measurable improvement (one numeric in the PR description — e.g. "before: 12 DB queries per timeline refresh; after: 1").
4. The "Phase X.Y —" comment-prefix sweep (E.3) has touched every previously-flagged file.

---

## Out of scope

- New mission-workflow phases (the seven shipped phases are it).
- Any change to the renderer's visual identity.
- Any change to the provider escalation ladder.
- A new MCP server.
- Anything that needs a fresh design discussion (e.g. moving WorkSession into the same `mission_events` table — that's a schema decision, not a follow-up).
