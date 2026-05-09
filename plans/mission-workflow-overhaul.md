# Mission Workflow Overhaul — Phased Implementation Plan

**Parent report:** [mission-workflow-review-2026-05-09.md](../reports/mission-workflow-review-2026-05-09.md).
**Sister plans:** [model-escalation-architecture.md](./model-escalation-architecture.md) (provider-side), [permission-lifecycle-resilience.md](./permission-lifecycle-resilience.md) (already shipped).
**Status:** drafted 2026-05-09. **Phases 0, 1, and 2 shipped 2026-05-09 — see [Progress log](#progress-log) at the end of this document.**

## Goal

Take the mission workflow from "correct but quiet and slow" to "trustworthy, observable, and compounding." Specifically:

1. **Visibility** — at any moment the operator can see what the mission is doing, why, and how long it has taken; every closed mission produces an auto post-mortem stub.
2. **Quality** — every mission has access to per-repo playbooks, validation profiles, and proof rules; every closed mission (success *or* failure) feeds those stores.
3. **Performance** — proof has a preflight gate, dependencies are warmed before validation, snapshots emit deltas not full re-renders, hot DB reads are indexed.
4. **Spira-side reuse** — the same primitives (telemetry, playbooks, preflight, validation catalog) drive the primary station's WorkSession upgrade flow.

The plan ships in **seven independent phases**. Each phase is small enough to merge in a few PRs and leaves the system shippable. Phases 1 and 2 deliver the largest perceived improvement; phases 4 and 5 unlock everything else.

## Operating principles

- **Build on `mission_events`, don't replace it.** The append-only event log is the right substrate. We add a typed taxonomy and richer metadata; we do not introduce a parallel telemetry system.
- **Repo-keyed everything.** Anything new is keyed by `projectKey` + `repoRelativePath` so it works for target repos, the Spira monorepo, and per-package within Spira.
- **Don't break the workflow guard.** All changes go *through* `MissionWorkflowState` / `assertMissionWorkflowActionAllowed`. New phases or actions are added as members, not as bypasses.
- **Failures must learn.** Every recipe in this plan that records intelligence on success also records on failure (with `outcome: "failed"` rather than skipping the write).
- **Cheap, runnable preflight before expensive proof.** Any new gate must answer "can this run *now*?" in seconds, not minutes.
- **One delivery rule:** each phase ships at least one user-visible improvement and one test that would have caught its absence.

---

## Phase 0 — Foundations (small, low-risk, do first) ✅ shipped 2026-05-09

**Goal:** put the structural primitives in place that every later phase depends on.

### 0.1 Typed event taxonomy

- Move the event-type string literals scattered across [ticket-runs.ts](../packages/backend/src/missions/ticket-runs.ts) into a typed enum in `packages/shared/src/mission-events.ts`. Cover every existing call site of `appendMissionEvent`.
- Define a discriminated-union `MissionEventMetadata` per event type so renderer code can `switch` on `event.type` and get strongly-typed metadata.
- Validate at write time (zod or hand-rolled) so a typo at a call site is a build error, not a corrupted event row.

### 0.2 DB indices

- Add covering indices on:
  - `repo_intelligence_entries (project_key, repo_relative_path)` and `... (approved, updated_at)`.
  - `validation_profiles (project_key, repo_relative_path)`.
  - `proof_rules (project_key, repo_relative_path)`.
  - `mission_events (run_id, occurred_at)` (for timeline queries).
- Convert the three "scan-then-filter-in-JS" reads in [intelligence.ts:50](../packages/memory-db/src/database/intelligence.ts:50), [intelligence.ts:231](../packages/memory-db/src/database/intelligence.ts:231), [intelligence.ts:398](../packages/memory-db/src/database/intelligence.ts:398) to `WHERE` queries.

### 0.3 Snapshot delta channel

- Keep the existing `missions:runs-changed` full-snapshot event as the *cold* path (initial subscription, after backend restart).
- Add `missions:run-updated { runId, patch }` for in-flight changes, where `patch` is a JSON Patch (RFC 6902) or a minimal `{ field, value }` array.
- Rendererside: maintain the run table from the cold snapshot, apply patches in place. Add a 30s "trust drift" sanity check that reissues a cold snapshot if patch sequence numbers go missing.
- All `emitSnapshot()` callers in [ticket-runs.ts](../packages/backend/src/missions/ticket-runs.ts) move to a thin helper that picks delta or full based on caller intent.

### 0.4 Tests

- Migration test: every existing `appendMissionEvent` call resolves to a known taxonomy entry.
- Index test: `EXPLAIN QUERY PLAN` confirms each new index is used by the corresponding read.
- Delta test: a series of events produces the same final snapshot whether replayed from cold or applied as patches.

**Risk:** SQLite migration. Mitigation: indices are pure additions; the taxonomy is additive types with runtime validation only.

---

## Phase 1 — Visibility (the "what's it doing" phase) ✅ shipped 2026-05-09

**Goal:** at any second of any pass, the operator can see what the mission is doing, what it just did, and how long the active phase has been running.

### 1.1 Live-action telemetry from inside the pass

- Inside the mission subagent station, forward every tool-call event into the mission timeline as an `attempt-action` event with metadata `{ tool, target, durationMs?, status }`. Truncate target to ~80 chars; full payload stays in the runtime ledger.
- Forward every spawned shell command (validation, proof, ad-hoc) as `attempt-shell-command` with `{ command, cwd, durationMs, exitCode }`.
- Forward permission requests as `attempt-awaiting-permission` open / `attempt-permission-resolved` close so timeline can show "paused for approval" segments.

### 1.2 "Now playing" strip in MissionDetailsRoom

- New row directly under the phase chip: a single line summarising the most recent in-flight `attempt-action` or `attempt-shell-command` with a relative timestamp ("Reading `…component.ts` · 4s ago", "Running `npm run build` · 2m 12s elapsed").
- Drives off the delta channel from §0.3; no polling.
- When the pass resolves a permission, the strip flips to "Paused · awaiting approval (Shinra · pyrefly relay)" with a click-through to the prompt overlay.

### 1.3 Phase-grouped timeline view

- Re-render `describeTimelineEvent` ([MissionDetailsRoom.tsx:66](../packages/renderer/src/components/missions/rooms/MissionDetailsRoom.tsx)) to group events by phase, with a header row per phase showing total duration, attempt count, validation count, and final status icon.
- Each phase header is collapsible; default-collapsed for completed phases of long missions.

### 1.4 First-class proof viewer

- New `MissionProofRoom` (or a tab inside `MissionProcessesRoom`): for each proof run, list status, exit code, command, duration, artifact tree.
- Inline `stdout.log` / `stderr.log` viewer (lazy-loaded; first 500 KB, with a "open in editor" affordance).
- "Re-run with preflight" button (Phase 2 wires the actual preflight; until then it just re-invokes the existing proof).

### 1.5 Auto post-mortem stub on close

- On `mission-closed` (or `summary-saved`, depending on which we want as the trigger), generate a markdown stub at `reports/{ticketId}-mission-postmortem-{date}.md`.
- Sections, all auto-fillable from `mission_events` + `ticket_runs`:
  - Header (ticket id, summary, run id, date, total elapsed)
  - Per-stage timing table (the LH-402 §1 table is the template)
  - Validation outcomes (one row per validation, kind/status/duration/command)
  - Proof outcomes (one row per proof run, profile/status/duration/exit/command)
  - Files changed (from final commit message draft + git diff stats)
  - "Open observations" — a prompted free-text area the user fills in
- The file is a *stub*, not a full report. The point is to never lose the data; the operator can elaborate or delete.

### 1.6 Tests

- Snapshot test of the phase-grouped timeline rendering for a representative completed mission.
- Replay test: a synthetic mission's events produce a post-mortem stub identical to a golden file.
- E2E: a mission start → implement → validate → close pass produces visible "now playing" updates in the rendered DOM (Playwright on the renderer).

**Risk:** event volume. Mitigation: `attempt-action` events are rate-limited at the source (1 per tool call regardless of inner streaming) and the renderer keeps only the last N=200 per attempt in its store; older are loaded on demand from DB.

---

## Phase 2 — Proof proportionality + preflight (the "stop wasting an hour" phase) ✅ shipped 2026-05-09

**Goal:** kill LH-402's root cause. Match proof effort to ticket risk; never spawn a heavy proof that has no chance of succeeding.

### 2.1 Manual-review-only as a first-class proof level

- It already exists as a `TicketRunMissionProofLevel` enum value but isn't a real terminal state in the workflow. Make it one:
  - Picking `manual-review-only` is a one-click action from the proof recommendation panel.
  - The workflow guard treats it as a satisfied proof gate (with an audit-trail event `proof-set-manual-review-only` and a required free-text justification).
  - Future re-opens of the mission preserve the choice unless explicitly cleared.

### 2.2 Proof preflight controller

- New `runProofPreflight(profile)` in `packages/backend/src/missions/proof-preflight.ts`. Returns a structured result `{ ok: boolean, blockers: PreflightBlocker[], warnings: PreflightWarning[], elapsedMs }`.
- Built-in checks (cheap, parallel, time-budgeted to ≤10s total):
  - Binary-on-PATH check (`dotnet --version`, `pnpm --version`, etc., per profile kind).
  - Project restored / dependencies present (e.g., `node_modules` exists, `obj/project.assets.json` exists for .NET).
  - Required env vars present (per profile manifest).
  - Required services reachable (per profile manifest; e.g., a localhost port probe).
  - Required test fixtures present (per profile manifest; e.g., the bypass-auth file in LegApp Admin).
  - Disk space minimum.
- Each check returns a typed blocker with a suggested remediation.
- New `proof-preflight-started` / `proof-preflight-finished` mission events with structured metadata.

### 2.3 Wire preflight into proof launch

- `runProof()` ([ticket-runs.ts:734](../packages/backend/src/missions/ticket-runs.ts:734)) calls `runProofPreflight()` first. If preflight fails:
  - The proof does not spawn.
  - The blockers are surfaced in `MissionProofRoom` with explicit remediations.
  - The proof status is `preflight-blocked` (new), which the workflow guard treats as a transient blocker, not a failure.
- If preflight passes, the proof runs as today.

### 2.4 Proportionality controller

- Extend `computeAdvisoryProofDecision` ([mission-intelligence.ts:145](../packages/backend/src/missions/mission-intelligence.ts:145)) with two new inputs:
  - **Diff signal** — file count, line count, file types, presence of test edits. From the in-flight worktree git status; cached per-attempt.
  - **Historical outcomes** — last N proof outcomes for this `(projectKey, repoRelativePath, classificationKind)` triple from `ticket_run_proof_runs`. Time-decayed.
- New rule defaults shipped as builtin proof rules:
  - "Copy-only diff (only string literals / constants / templates touched)" → recommend `light` or `manual-review-only`.
  - "Test files only changed" → recommend `none`.
  - "≤3 lines changed in non-template files" → recommend `light`.
  - "Diff touches a registered UI surface (per repo intelligence)" → recommend `targeted-screenshot`.
- The existing rule scoring layer continues to apply on top of these.

### 2.5 Proof rule editor in the UI

- A small admin pane (under Settings or a new "Mission" section) that lists `proof_rules` and lets the operator add/edit/delete rules, set priority via tag, and dry-run a rule against a recent ticket.
- Rules created here are `source: "user"`; learned rules from Phase 5 are `source: "learned"`.

### 2.6 Tests

- Preflight unit tests per blocker (binary missing, deps missing, env var missing).
- Integration test: a proof that today would burn 20 minutes returns `preflight-blocked` in <10s.
- Proportionality test: a ticket with a 4-line diff in a `*.html.cshtml` file resolves to `light` recommendation; a ticket with a 200-line change in a controller resolves to `targeted-screenshot` minimum.
- Workflow test: `manual-review-only` selection satisfies the gate and is preserved across mission close + reopen.

**Risk:** preflight false positives blocking valid proofs. Mitigation: every blocker is overridable from the UI ("run anyway"), and the override is itself a logged event.

---

## Phase 3 — Repo intelligence v2 (the "stop discovering the same things" phase)

**Goal:** the system has cheap, accurate, per-repo knowledge that survives across missions and compounds over time. Spira itself owns this knowledge — target repos do not need to know that Spira exists.

> **Design decision (2026-05-09):** intelligence is stored DB-side only. We deliberately reject a `.spira/mission.md`-style file convention in target repos. Spira is a system that *operates on* repos; those repos should not have to know about it. The cost is that intelligence is per-Spira-instance and not auto-discoverable from the repo itself; we accept that cost in exchange for zero target-repo pollution.

### 3.1 First-class repo profile record

- Add a `repo_profiles` table (or extend the existing intelligence persistence — pick at implementation time based on what's cleaner) keyed by `projectKey`. Columns at minimum:
  - `displayName`, `description`
  - `defaultBuildWorkingDirectory`
  - `defaultRegistry` (and a list of any other registry hints)
  - `defaultBranch`
  - `requiredEnvVars` (JSON array)
  - `requiredSdks` (JSON array, e.g. `[".net 8", "node 20"]`)
  - `userFacingCopyGlobs` (JSON array)
  - `uiTestGlobs` (JSON array)
  - `notes` (free-text)
  - timestamps + `source` (`builtin` / `user` / `learned`)
- Reads are indexed on `projectKey` (Phase 0).
- Existing `validation_profiles`, `proof_rules`, and `repo_intelligence_entries` continue to live alongside, all keyed on the same `projectKey`. The repo profile is the "what is this repo" record; the others are the "how do we work here" records.

### 3.2 Repo onboarding wizard (DB-only)

- First time a worktree is created for a previously-unknown `projectKey`, the mission UI shows a "We don't know much about this repo yet — want to capture some basics?" prompt.
- Captures the same fields as the `repo_profiles` row above, plus an opportunity to register one or two starter validation profiles inline.
- Form persists to the DB only. No files written into the target repo. No commits offered.
- Skippable; a partially-filled profile is better than none, and the operator can return to the form any time from a "Repo intelligence" admin pane.
- This is the single highest-leverage input the system gets — one filled-in form per repo.

### 3.3 "Repo intelligence" admin pane

- Lists every known `projectKey` with its profile, validation profiles, proof rules, and intelligence entries (briefings / pitfalls / examples).
- Per-row actions: edit, archive, force-revoke (Phase 5), promote-from-candidate.
- Export / import as JSON for backup and for moving intelligence between Spira instances. Filebacked transport via export, never via convention in the target repo.

### 3.4 Validation profile catalog enrichment

- Today `validation_profiles` carries `expectedRuntimeMs`, `prerequisites_json`, `confidence`. Surface those in the admin pane; let the operator hand-edit them.
- New profile kinds: `restore`, `format`, `e2e-smoke`. The mission can now pick the *right* kind for the change rather than blanket `build` + `unit-test`.
- New column `lastObservedRuntimeMs` (rolling average over last 10 runs). Fed by Phase 5's learning loop.

### 3.5 Repo-aware prompt context for the mission pass

- `buildInitialPrompt` ([ticket-runs.ts:1731](../packages/backend/src/missions/ticket-runs.ts:1731)) already concatenates a worktree list. Extend it to:
  - Inject the repo profile summary (display name, default build dir, registry, required env vars).
  - Inject the top 3 approved `briefing` entries for the impacted repos.
  - Inject the top 3 approved `pitfall` entries for the impacted repos.
  - Inject the registered default validation commands.
- These additions go in a single labelled `## Repo guidance` section so the model can ignore or rely on them as it sees fit. Stable wording so the prefix is prompt-cacheable.

### 3.6 Tests

- Onboarding wizard test: the captured form produces the expected `repo_profiles` row and any inline-registered validation profiles. No files written.
- Override precedence test: a `user`-source intelligence entry beats `learned` beats `builtin`.
- Prompt test: a mission with two impacted repos has both repos' profile summary, top guidance entries, and default validations in its initial prompt.
- Export / import test: round-tripping the admin pane's JSON export reproduces an identical intelligence state.

**Risk:** intelligence is per-Spira-instance and lost on data loss. Mitigation: the JSON export from §3.3 is the supported backup path; document it clearly in onboarding. Future work could add a "shared intelligence" sync mechanism, explicitly out of scope here.

---

## Phase 4 — Performance (the "make it fast" phase)

**Goal:** the things that take time today take less time, and the things that pay no dividend stop happening.

### 4.1 Dependency warming after worktree setup

- After a worktree is created (or revalidated) and before the first mission pass starts, kick off background dependency warming based on the registered validation profiles for that repo:
  - Node: `pnpm install --prefer-offline` or `npm ci` with the registered registry.
  - .NET: `dotnet restore`.
  - Tracked as a `workspace-dependencies-warmed` mission event with `{ profile, durationMs, exitCode }`.
- Warming is best-effort: if it fails, the mission proceeds, the failure is recorded, and the first validation pays the cold cost (today's behaviour).
- A "warming" indicator appears in the mission UI ("Bridge preparing — `pnpm install` in flight, 24s elapsed") so the operator knows what the silence is.

### 4.2 Worktree validation cache

- Cache `git rev-parse --git-dir` results per worktree per mission run. Re-validate only on explicit teardown / restart.

### 4.3 Snapshot delta channel adoption

- Convert the high-frequency `emitSnapshot()` callers in [ticket-runs.ts](../packages/backend/src/missions/ticket-runs.ts) (attempt-finished, validation-recorded, proof-progress) to use the delta channel from §0.3.
- Keep the cold-snapshot full emit only on `run-created`, `run-closed`, and on explicit subscriber sync.

### 4.4 Proof discovery cache

- Cache `discoverMissionProofProfiles` results per worktree-content-hash. Invalidate on git HEAD change or worktree path change.
- Discovery walks become "is the cache fresh?" lookups in the steady state.

### 4.5 Provider prompt caching

- Reorder `buildInitialPrompt` and `buildContinuationPrompt` so the stable sections (mission station instructions, repo guidance from Phase 3, workflow contract) come first; ticket-specific sections come last.
- Mark the stable prefix as cacheable through the provider client (Anthropic + OpenAI both support this).
- This is the cheapest token-cost reduction we can ship; it does not change semantics.

### 4.6 Mission events pagination

- The renderer today reads the full event timeline via the snapshot. After Phase 1 introduces `attempt-action` events, the volume per mission grows. Add a paged read API (`listMissionEvents(runId, { afterId, limit })`) and let `MissionDetailsRoom` lazy-load older events.

### 4.7 Tests

- Warming test: a fresh worktree fixture with a `node_modules` deletion is restored to `node_modules`-present state by the warm step.
- Delta test: 100 simulated events apply correctly with patches; renderer state matches a cold snapshot.
- Cache test: `discoverMissionProofProfiles` returns from cache when worktree HEAD is unchanged; recomputes when HEAD changes.
- Bench: a mission with 500 events takes <100ms to render the timeline (replaces the current full re-render pattern).

**Risk:** dependency warming can be very slow (LH-201 saw 5+ minute installs). Mitigation: it runs in parallel with classification + planning, so its cost is hidden under work the operator is already waiting on. If warming hasn't finished by the time validation needs it, the operator is shown the warming progress in the same panel.

---

## Phase 5 — Learning loop (the "every mission makes the next one easier" phase)

**Goal:** every closed mission — pass *or* fail — feeds the intelligence stores, and the system's recommendations get better over time without human curation.

### 5.1 Always-on learning, not clean-win-only

- Replace `isCleanMissionForLearning` ([mission-intelligence.ts:264](../packages/backend/src/missions/mission-intelligence.ts:264)) with a richer outcome classifier:
  - `clean-pass` — current behaviour (all validations + proof passed).
  - `pass-with-friction` — validations passed but ≥1 retry, or proof was waived/manual-review.
  - `fail-with-recovery` — earlier failures eventually succeeded.
  - `fail-final` — mission closed without success.
- Each outcome has its own learning rule:
  - `clean-pass` → upgrade approved validation profiles' confidence, record positive proof rule outcome.
  - `pass-with-friction` → record the retry pattern (e.g. "first validation kind X failed with substring Y, second kind Z passed").
  - `fail-with-recovery` → same as friction, plus capture the *recovery action* as a learned pitfall ("if you see error X, do Y").
  - `fail-final` → record the failure mode as a pitfall and a *negative* proof rule ("for this ticket pattern, recommended level X did not yield a passing proof").

### 5.2 Per-attempt-shell-command learning

- The `attempt-shell-command` events from §1.1 become a derived per-repo command catalog. Once any spawned command has been observed succeeding ≥3 times for a `(projectKey, repoRelativePath, kind)` triple, propose it as a `validation_profile` candidate.
- Surfaced in the UI as "We've noticed `npm run lint` succeeding repeatedly in `ClientApp` — add it as a registered validation profile?"

### 5.3 Cross-mission post-mortem digest

- A weekly job (cron on the backend) that reads the per-mission post-mortem stubs from §1.5 and produces a roll-up: top-N longest phases, top-N most common preflight blockers, top-N proof recipes that failed, top-N learned candidates pending approval.
- Output saved as `reports/weekly-mission-digest-{yyyy-mm-dd}.md`.

### 5.4 Confidence-based auto-promotion of learned candidates

A candidate is only auto-promoted when a computed **confidence score** clears a per-type threshold. Every promotion writes an audit-trail event and remains one-click revocable.

#### Confidence inputs

For each candidate, compute a single confidence score from these signals:

- **Positive evidence** — count of distinct mission outcomes that corroborated this candidate (clean-pass or pass-with-friction). +1 each.
- **Negative evidence** — count of contradictions: outcomes where this candidate's prediction (e.g., "this validation command works in this dir") was observed to be wrong. ×−2 each (a contradiction outweighs a corroboration).
- **Diversity** — distinct ticket kinds and distinct attempt operators across the corroborating runs. ×1.0 baseline; ×1.2 if ≥3 distinct kinds.
- **Recency decay** — exponential decay with a 90-day half-life on per-run contributions. Old corroborations matter less than fresh ones.
- **Outcome quality** — corroborations from `clean-pass` count fully; corroborations from `pass-with-friction` count at 0.5 weight.

#### Type-tiered thresholds (defaults — settings-tunable)

| Candidate type | Threshold | Rationale |
| --- | ---: | --- |
| `briefing` | 3 | Low blast radius: at worst the prompt gets a useless paragraph. |
| `example` | 4 | Slight risk of a misleading recipe; small extra bar. |
| `validation_profile` candidate | 5 | Wrong validation poisons the gate; wants stronger evidence. |
| `pitfall` | 6 | Highest blast radius — a wrong pitfall tells the model not to do something it should. Holds out longest. |
| `proof_rule` | 6 | Same logic; proof recommendations affect the longest pole of mission time. |

#### Audit trail (always)

- Every promotion event records `learned-candidate-promoted` in `mission_events` (or `system_events` for cross-mission jobs) with:
  - candidate id, type, computed confidence at time of promotion
  - the IDs of every contributing run (positive *and* negative)
  - the threshold and formula version (so we can replay a decision later)
- Every revocation records `learned-candidate-revoked` with the operator (if any), reason, and the candidate state at the moment of revocation.
- Both event types are surfaced in a dedicated "Intelligence audit" tab on the admin pane (§3.3) — no clicking through `mission_events` to reconstruct what happened.

#### Revertability (always)

- One-click revoke from the admin pane. Revoking a promoted entry:
  - Demotes it back to candidate state.
  - Records the contributing-run set as "must not auto-re-promote on the same evidence" — so a flapping candidate doesn't keep coming back. Re-promotion requires *new* corroborating runs beyond the snapshot at revocation time.
  - Optionally archives the candidate entirely if the operator picks "this is wrong, not just stale."
- A "rollback last N promotions" action in the admin pane for fast recovery if the auto-promote logic itself is found to be misbehaving.

#### Trust signal in the prompt

- Auto-promoted entries are surfaced in the mission prompt with a confidence-banded label: "high-confidence" (≥2× threshold), "promoted" (≥threshold), "provisional" (within 25% of threshold). Operators can read what they're trusting; the model can choose how strongly to weigh it.

#### Failsafe

- A global setting `missionLearnedCandidateAutoPromote: boolean` (default `true`) — flipping off pauses all auto-promotion immediately without losing the audit trail or the candidate corpus.

### 5.5 Tests

- Outcome classifier tests, one per outcome kind, against synthetic mission-event traces.
- Per-attempt-shell learning test: 3 successes of the same command produce a profile candidate.
- Auto-promotion test: an entry observed N+1 times across distinct runs flips to approved.

**Risk:** learning the wrong thing (e.g., a flaky proof). Mitigation: every learned entry shows its evidence count and recent outcomes in the UI; auto-promoted entries can be revoked with one click and revocations are themselves remembered.

---

## Phase 6 — Polish and the operator-facing extras

**Goal:** close the long tail of papercuts the post-mortems flagged.

### 6.1 Validation result supersession

- LH-201 §6 friction: an early failed validation poisons the run state even after a later successful retry of the same kind.
- Add `supersedesValidationIds` already exists in the schema; surface a one-click "supersede earlier failed validations of this kind" affordance from the UI when a later run of the same kind passes.

### 6.2 Mission state reconciliation step

- LH-402 §G: stale status text after `proof.status === passed` and `summarySaved === true`.
- Add a small `reconcileMissionDisplayState` pass that runs on every status mutation and resolves contradictory states deterministically; emit a `mission-state-reconciled` event when it fires so we can detect drift.

### 6.3 Permission-on-mission-thread overlay

- When a permission request is in flight from an active mission pass, surface it both in its current location *and* as a banner on the mission detail view ("Pass paused · awaiting approval"). Today the user has to be on the right view to see the prompt at all.

### 6.4 Per-phase budget hint

- For each repo, capture per-phase typical durations (rolling median over last 10 missions) and surface in the now-playing strip ("Implement · 14:32 elapsed · typical for this repo: 12-25 min"). Soft signal only; never blocks.

### 6.5 Mission-level "abort and write off" action

- Today aborting late in a mission is awkward. Add a first-class `abort-and-postmortem` action that closes the run with a distinguished `aborted` status, generates the auto post-mortem, and prompts the operator for an abort reason that becomes part of the post-mortem stub.

### 6.6 Tests

- Each above with a focused unit + UI test as appropriate.

**Risk:** low. These are independent.

---

## Phase 7 — Spira-side application (the "this helps the primary station too" phase)

**Goal:** the primitives built in Phases 0-6 drive the primary station's WorkSession upgrade flow when Spira is upgrading itself.

### 7.1 Same telemetry surface for the primary station

- Map WorkSession's per-phase events into the same typed taxonomy from §0.1 (or a parallel `worksession_events` table with the same shape).
- The primary station's chat panel gets the same "now playing" strip from §1.2 (rendered subtly so it doesn't fight with the chat surface).

### 7.2 Spira's own repo profile and intelligence seed

- Add a builtin `repo_profiles` row for Spira itself (display name, default build dir = repo root, `pnpm` registry, required SDKs `node 22+ / pnpm 9+`, UI test globs under `packages/renderer`).
- The existing `seedBuiltinRepoIntelligence` and `seedBuiltinValidationProfiles` calls at [mission-intelligence.ts:326](../packages/backend/src/missions/mission-intelligence.ts:326) and [mission-intelligence.ts:374](../packages/backend/src/missions/mission-intelligence.ts:374) already cover Spira-side briefings, pitfalls, and validation commands. Confirm coverage and extend if needed; nothing new gets written into the Spira repo itself.
- Per the Phase 3 design decision, the file convention is rejected for Spira too — even though it would be technically harmless here. Keeping intelligence DB-side everywhere means one persistence path, one admin pane, one audit trail.

### 7.3 WorkSession preflight

- The same preflight controller from §2.2 runs before WorkSession's `validate` phase: dependency presence, dev server reachable if needed, port 9720 free, etc.
- Stalls the phase with a concrete, actionable blocker rather than letting the model burn cycles guessing.

### 7.4 WorkSession auto post-mortem on close

- The same generator from §1.5, scoped to WorkSession completions. Filed as `reports/spira-worksession-{date}-{branch}.md`.
- Same outcome classifier from §5.1 feeds Spira's own learning loop into Spira's intelligence entries (i.e., Spira learns about Spira).

### 7.5 Tests

- A WorkSession run on a synthetic Spira-side task produces telemetry, a post-mortem stub, and (on close) a learned-intelligence write.

**Risk:** scope creep into the primary station's UX. Mitigation: every Spira-side surface is *opt-in* and rendered minimally; the primary station chat doesn't change semantics, only gains optional informational rows.

---

## Cross-cutting concerns

### Migration safety

- All new DB tables / columns are additive; existing reads continue to work.
- All new event types are additive; legacy event readers ignore unknown types.
- The `.spira/mission.md` loader treats a missing file as "no override"; behaviour for repos that never adopt the convention is unchanged.

### Settings

- New `UserSettings` keys (all default-safe):
  - `missionAutoPostmortem: boolean` (default `true`)
  - `missionWarmDependencies: boolean` (default `true`)
  - `missionLearnedCandidateAutoPromote: boolean` (default `true`) — global kill switch for §5.4.
  - `missionLearnedCandidatePromotionThresholds: { briefing: number; example: number; validationProfile: number; pitfall: number; proofRule: number }` (defaults `{3,4,5,6,6}`) — per-type thresholds, advanced setting.
  - `missionProofPreflightOverrideAllowed: boolean` (default `true`)

### Observability of the system itself

- Every new background job (warming, weekly digest, auto-promote sweep) emits a `system_events` row with start/end/duration/outcome. Reuses the same shape as `mission_events`.

### Out of scope

- Any change to the provider escalation ladder (covered by [model-escalation-architecture.md](./model-escalation-architecture.md)).
- Any change to the renderer's visual identity (covered by [ui-living-airship-redesign.md](./ui-living-airship-redesign.md)).
- A new MCP server unless absolutely required; prefer to extend `mcp-spira-data-entry` or surface new functionality through existing channels.

---

## Sequencing recommendation

If we do nothing else, ship in this order:

1. **Phase 0** (low-risk foundations) — 2-4 PRs. Unlocks everything else.
2. **Phase 2** (proof preflight + proportionality + first-class manual-review-only) — biggest user-felt win. Closes LH-402's root cause.
3. **Phase 1** (visibility + auto post-mortem) — turns silence into a story; produces the data Phases 5 and 6 feed on.
4. **Phase 4** (performance) — can land in parallel with 1 and 2; pays for itself within a few missions.
5. **Phase 3** (repo intelligence v2) — turns the system from "knows Spira" to "knows your repos." Highest leverage *per mission* once landed.
6. **Phase 5** (learning loop) — depends on Phase 1's typed events and Phase 3's intelligence schema.
7. **Phase 7** (Spira-side application) — recombines everything into the primary station.
8. **Phase 6** (polish) — opportunistic; pick items as they come up.

If only three phases ship, do **0 + 2 + 1**. That alone takes the LH-402-shaped mission from 91 minutes to comfortably under 30, gives the operator a real-time view into long passes, and produces the data needed to build the rest later.

---

## Definition of done (per phase)

A phase is done when:

1. All listed acceptance items have shipped behind feature flags where applicable, are off-by-default if risky, are on-by-default if safe.
2. The listed tests are passing in CI.
3. The phase has produced at least one user-visible change documented in the changelog.
4. The mission running this work has produced its own auto post-mortem under §1.5 (so the system is dogfooding itself).

---

## Progress log

### 2026-05-09 — Phases 0 + 1 shipped

#### Phase 0 deliverables

- **§0.1 typed event taxonomy** — [packages/shared/src/mission-events.ts](../packages/shared/src/mission-events.ts) with `MISSION_EVENT_TYPES`, `MissionEventType`, `MissionEventMetadataMap`, `isMissionEventType`, `validateMissionEventType`. Both `recordMissionEvent` helpers in [ticket-runs.ts](../packages/backend/src/missions/ticket-runs.ts) and [mission-lifecycle.ts](../packages/backend/src/missions/mission-lifecycle.ts) now take a typed `eventType: T` and a metadata payload typed by `MissionEventMetadataMap[T]`. The DB-side `appendMissionEvent` in [missions.ts](../packages/memory-db/src/database/missions.ts:480) validates at write time so a typo bypassing TS still fails loudly. 22 event types catalogued (the 18 existing types plus 4 new live-telemetry types from §1.1).
- **§0.2 DB indices + WHERE-clause conversion** — Audited migrations and confirmed the v20 indices `idx_repo_intelligence_scope_v20`, `idx_validation_profiles_scope_v20`, `idx_proof_rules_scope_v20`, `idx_mission_events_run_v20` already exist and cover the access patterns. New helper `buildScopedRecordFilter` in [context.ts](../packages/memory-db/src/database/context.ts) builds parameterised WHERE clauses honouring the "repo-agnostic entries match every project" semantics. The three reads in [intelligence.ts](../packages/memory-db/src/database/intelligence.ts) (`listRepoIntelligence`, `listValidationProfiles`, `listProofRules`) now filter at SQL level instead of `SELECT * → .filter()` in JS. Approval filter pushed down too.
- **§0.3 snapshot delta channel** — Added `missions:run-updated { runId, run }` (per-run delta) alongside the existing `missions:runs-changed` (full snapshot). Wired through the event bus, station registry relay, protocol, and renderer. New `setRun` action on the mission-runs store applies the patch in place. Five high-frequency `emitSnapshot` calls converted to `emitRunUpdate` (attempt-started, attempt-finished, attempt-repair-requested, proof-started, proof-finished); cold-snapshot path retained for run-created / run-closed / approve / restart-recovery / workspace-prepared (structural changes that benefit from a full replay).
- **§0.4 tests** — `mission-events.test.ts` (4 tests): full-taxonomy contract, `isMissionEventType` rejection, narrowing, error message. `database.test.ts` (3 new tests): unknown-event-type rejection, project-scoping at SQL level, EXPLAIN-QUERY-PLAN sanity check confirming the index is used. `mission-runs-store.test.ts` (4 tests): cold setSnapshot, in-place setRun, append-when-missing, delta-replay convergence with cold snapshot.

#### Phase 1 deliverables

- **§1.1 live-action telemetry** — Four new typed event types (`attempt-action`, `attempt-shell-command`, `attempt-awaiting-permission`, `attempt-permission-resolved`) emitted from inside the mission subagent station. Hook points in [session-manager.ts](../packages/backend/src/runtime/session-manager.ts): `onToolExecutionStart` (shell-like only, status="running"), `onToolExecutionComplete` (all tools, status + duration), `onRequested` permission gate, `onResolved` permission gate. Resolver helper `getLatestMissionAttempt` centralises the lookup; `summariseToolTarget` extracts a path/url/command/pattern hint truncated to 80 chars. New bus event `missions:run-event-recorded` relays each event from the station bus to the transport via [station-registry.ts](../packages/backend/src/runtime/station-registry.ts). Renderer-side: `pushLiveEvent` action on the mission-runs store maintains a per-run rolling buffer (cap 20).
- **§1.2 Now Playing strip** — [NowPlayingStrip.tsx](../packages/renderer/src/components/missions/rooms/NowPlayingStrip.tsx) under the phase chip in `MissionDetailsRoom`. Three variants: idle (no live activity), active (latest tool/shell/proof event), awaiting (open permission gate, lavender accent). Pulses for live-running events; ticks once a second to keep the elapsed/relative-time label fresh.
- **§1.3 phase-grouped timeline** — New [mission-timeline-grouping.ts](../packages/renderer/src/components/missions/rooms/mission-timeline-grouping.ts) helper groups events by phase preserving workflow order. Renderer merges the cold-fetched timeline with the live event buffer (Phase 1.1) and groups them; each phase renders as a collapsible `<details>` block with event count and computed duration in the summary. The active phase and the system bucket open by default; completed phases collapse.
- **§1.4 first-class proof viewer** — [ProofRunsViewer.tsx](../packages/renderer/src/components/missions/rooms/ProofRunsViewer.tsx) replaces the single-latest-run sub-card. Shows every proof run sorted newest first with command, exit code, duration, and grouped artifact chips (Reports + logs / Captures / Other). New backend method `readProofArtifactText` in [ticket-runs.ts](../packages/backend/src/missions/ticket-runs.ts) reads up to 256 KB of a text artifact (binary detection via NUL-byte probe in the first 4 KB) with path-traversal containment check against the proof run's `.spira-proof/<proofRunId>/` directory. New protocol message `missions:ticket-run:proof-artifact:read` and IPC channel `missions:ticket-run:proof-artifact:read` plumbed through `client-message-validation.ts`, `electron-api.ts`, `ipc-bridge.ts`, `channels.ts`, `missions-handlers.ts`, and `preload.ts`. Inline log viewer panel renders the content in a scrollable `<pre>`; "Open externally" fallback for binary or missing artifacts.
- **§1.5 auto post-mortem stub** — New [post-mortem-generator.ts](../packages/backend/src/missions/post-mortem-generator.ts) with pure `generateMissionPostmortem(run, events)` that produces markdown with header, per-stage timing table, validations, proof runs, files-changed, and an open-observations placeholder. `writePostmortemStub` fires from the close path in [ticket-runs.ts](../packages/backend/src/missions/ticket-runs.ts) and writes to `<workspaceRoot>/reports/{ticketId}-mission-postmortem-{date}.md` using `writeFile(..., { flag: "wx" })` so a handwritten post-mortem for the same ticket is never clobbered. Best-effort: failures log but do not fault the close path; if no workspace root is configured the stub is skipped.
- **§1.6 tests** — `mission-timeline-grouping.test.ts` (11 tests): workflow ordering, dedup by id, duration computation, edge cases, duration formatter table. `post-mortem-generator.test.ts` (5 tests): full-stub render, per-phase duration computation, empty-section handling, filename normalisation, ticket-id sanitisation. Total new tests across phases 0+1: 27. All pass; full suite (704 → 720 tests) green.

#### Self-review fixes

After spawning three review agents (reuse, quality, efficiency) the following were applied: hoisted `getLatestMissionAttempt` helper in `session-manager.ts` (eliminating 4 inline duplicate lookups), promoted `node:fs/promises` calls to top-level imports in `ticket-runs.ts`, replaced the `access`-then-`writeFile` TOCTOU in `writePostmortemStub` with atomic exclusive create (`flag: "wx"`), and removed a spurious `<span>` wrapper in `ProofRunsViewer` that was breaking the artifact-group flexbox layout. Skipped: consolidating four duration formatters into one (deliberately different output styles per surface — premature abstraction).

#### Out-of-scope work flagged

- A pre-existing TypeScript error in [session-manager.permission-lifecycle.suite.ts](../packages/backend/src/runtime/session-manager.permission-lifecycle.suite.ts) lines 161 and 217 (`confidence: 0.9` vs `WorkSessionClassification.confidence: "heuristic"`) was confirmed via `git stash` to predate this work; flagged as a separate task.

#### What's still on hold for Phase 2+

- Inline log viewer is bounded at 256 KB; pagination + larger reads can land alongside Phase 2 if needed.
- High-frequency live events have no batching yet — fine at expected volumes; revisit if mission attempts produce > ~100 events / second.
- Five `emitSnapshot` calls remain on the cold path (run-created, run-closed, intel-approve, restart-recover, workspace-prepared) — intentional; structural changes the renderer benefits from re-rendering wholesale.

---

### 2026-05-09 — Phase 2 shipped

#### Phase 2 deliverables

- **§2.1 manual-review-only as a first-class gate state** — `TicketRunProofStatus` extended with `manual-review` and `preflight-blocked` ([ticket-run-types.ts:18](../packages/shared/src/ticket-run-types.ts:18)). `proofPassed` derivation in [ticket-run-workflow.ts:105](../packages/shared/src/ticket-run-workflow.ts:105) now treats `manual-review` as a satisfied gate alongside `passed`. `TicketRunProofSummary` carries `manualReviewJustification` + `manualReviewAt` for the audit trail in the snapshot. New lifecycle methods `setProofManualReviewOnly(runId, justification)` and `clearProofManualReview(runId)` in [mission-lifecycle.ts:248](../packages/backend/src/missions/mission-lifecycle.ts:248) — both go through the same workflow guard as `record-proof-result`. New mission events `proof-set-manual-review-only` and `proof-manual-review-cleared` in the typed taxonomy. Renderer: new `ManualReviewPanel` component slotted into the proof phase of `MissionDetailsRoom`, with two states (active / inactive) and a required free-text justification field. Protocol messages `missions:ticket-run:proof:manual-review:set` / `:clear` plumbed through `client-message-validation.ts`, `electron-api.ts`, `ipc-bridge.ts`, `channels.ts`, `missions-handlers.ts`, `preload.ts`, and `useMissionRunController.ts`.

- **§2.2 proof preflight controller** — New [proof-preflight.ts](../packages/backend/src/missions/proof-preflight.ts) with parallel cheap checks per profile kind. For the `playwright-dotnet-nunit` profile: `dotnet --version` on PATH, `obj/project.assets.json` present, runsettings present, bypass-auth fixture present, disk space ≥1 GB. Returns `{ ok, blockers, warnings, elapsedMs, summary }`. Each check has a typed remediation hint. Default per-check timeout 5 s; checks run in parallel via `Promise.allSettled` (no outer race — the per-check timeout *is* the wall-clock cap, and binary checks kill their child processes on timeout, so there are no orphans). Hooks for `binaryAvailable`, `pathExists`, `freeDiskBytes` are injectable for tests.

- **§2.3 wired preflight into runProof + new `preflight-blocked` status** — Inside `runProof` in [ticket-runs.ts:902-960](../packages/backend/src/missions/ticket-runs.ts:902), the preflight runs *before* the harness spawns. Failed preflight short-circuits to a `preflight-blocked` per-run audit row with command + summary + the blocker list joined for the renderer; no harness spawn, no exit code, no artifacts. New `proof-preflight-started` and `proof-preflight-finished` mission events bookend the preflight pass. Preflight delegate is injectable on `TicketRunService` so tests can stub it (the existing `runMissionProof`, `discoverMissionProofProfiles` pattern).

- **§2.4 proportionality controller** — Two new optional inputs on `AdvisoryProofDecisionInput`: `diffSignal` (filesChanged / linesAdded / linesRemoved / copyOnly / testsOnly / touchesUiSurface) and `historicalOutcomes` (last N proof statuses + ages). New `applyProportionalityOverrides` helper in [mission-intelligence.ts:191](../packages/backend/src/missions/mission-intelligence.ts:191) downgrades to `none` for tests-only diffs, downgrades to `light` for ≤10-line copy-only diffs, escalates to `targeted-screenshot` when a registered UI surface is touched, and surfaces "recent failures" as evidence (advisory only — no level change yet). Three new builtin proof rules added: `global-frontend-copy-manual-review` (typo/casing → manual review), `global-tests-only-none` (tests-only → no proof), `global-mixed-default-targeted` (mixed UI changes → targeted screenshot).

- **§2.5 proof rule editor** — New backend service [proof-rules-service.ts](../packages/backend/src/missions/proof-rules-service.ts) with list / upsert / delete; source (`builtin` vs `user`) is derived from id prefix `global-` so we avoid another schema migration. User rules get auto-minted `user-{uuid}` ids when no id is provided. Builtin rules are read-only (upsert and delete reject `global-*` ids). New `deleteProofRule` on the memory-db API. New protocol messages `missions:proof-rules:list / :upsert / :delete`. Renderer: new `ProofRulesEditor` component lives in a new "Proof rules" tab in `SettingsPanel`. Lists every rule with source / level badges, shows scope and keywords inline, and offers an inline form for adding user rules. Builtin rules show no delete button; user rules can be deleted with one click.

- **§2.6 tests** — `proof-preflight.test.ts` (5 tests): all-pass, missing dotnet → blocker with remediation, missing project.assets.json → "project not restored" blocker, low disk → warning (not blocker), summary string contents. `proof-rules-service.test.ts` (5 tests): builtin/user source derivation, uuid id minting, refusal to upsert into builtin id, refusal to delete builtin, delete returns fresh snapshot. Manual-review tests appended to `mission-lifecycle.test.ts` (4 tests): empty-justification rejection, status + audit event on set, gate satisfaction via `proofPassed`, clearing reverts to `not-run` and emits the cleared event. Proportionality tests appended to `mission-intelligence.test.ts` (5 tests): tests-only downgrade, copy-only-small downgrade, ui-surface escalation gated by classification, historical-failures surfaced as evidence, matching-rule level wins. Total new Phase 2 tests: 19. Full suite: 720 → 739 tests; all pass.

#### Self-review fixes

After the three review agents (reuse, quality, efficiency) the following landed:

- **Removed the orphan-prone preflight budget timer** — the original `Promise.race` against an outer `budgetMs` timeout would resolve while inner checks (and their spawned children) kept running. Per-check timeouts already bound execution and properly kill their children, so the outer race was redundant *and* leaky. Now `runProofPreflight` is just `Promise.allSettled(checks)` with each check enforcing its own deadline.
- **Extracted shared `pathExists` util** to [packages/backend/src/util/fs.ts](../packages/backend/src/util/fs.ts); both `proof-preflight.ts` and `proof-runner.ts` now import it instead of carrying near-identical local copies.
- **Extracted `sendProofRulesUnavailable` helper** in `index.ts` to dedupe the three-time copy of the unavailable-service guard across the proof-rules handlers.
- **Confirmed migration runner overhead is already short-circuited** at `pending.length === 0` before any pragma touches; added a clarifying comment to keep that obvious.

Skipped (premature DRY): consolidating the four duration formatters in the renderer (different output styles per surface), extracting a `withTimeout` util (single use), extracting an `EventEmitter` cast helper (two-line workaround used in two places).

#### What's still on hold for Phase 3+

- **Diff signal isn't auto-computed yet.** `applyProportionalityOverrides` accepts the signal but no caller computes it — it's wired ready for a future PR that hooks into the validate-phase git status. Today the system's behaviour is identical to before unless callers explicitly pass the signal.
- **Historical outcomes feed evidence only**, not level changes — leaving room to demote levels that consistently fail in operationally-consistent ways without making the heuristic too eager.
- **Proof rule "dry-run against a recent ticket" affordance** isn't wired (plan §2.5 mentioned it as a nice-to-have).
- **Auto-promote learned rules** is Phase 5, not Phase 2.
