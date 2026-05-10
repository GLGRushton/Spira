# Mission Workflow — Next Horizon Phased Plan

**Parent report:** [mission-workflow-next-horizon-2026-05-10.md](../reports/mission-workflow-next-horizon-2026-05-10.md).
**Sister plans:** [mission-workflow-overhaul.md](./mission-workflow-overhaul.md) (phases 0–7 shipped), [mission-workflow-followups.md](./mission-workflow-followups.md) (batches A–E shipped), [mission-workflow-deferred.md](./mission-workflow-deferred.md) (batches F–I queued), [mission-startup-recovery.md](./mission-startup-recovery.md) (in-flight), [model-escalation-architecture.md](./model-escalation-architecture.md) (separate concern).
**Status:** drafted 2026-05-10. Phase numbering continues the overhaul's sequence (phases 8–14).

## Goal

The seven-phase overhaul made the mission system *correct, observable, and learning*. This plan takes it to *proactive, evidential, and self-evolving*, organised around the user's five explicit goals:

1. **Ticket pickup from YouTrack** → Phase 8 (Mission inbox).
2. **Workspace creation** → Phase 9 (Workspace 2.0).
3. **Heavy proof of work** → Phase 10 (Evidence chain).
4. **Constant automatic AI improvement** → Phase 11 (Prompt + model evolution).
5. **Manual commit, then automated PR** → Phase 12 (Commit & PR ceremony) and Phase 13 (Reviewer agent).

Phase 14 is an opportunistic catch-all (scheduler, fleet view, templates) that fills as items become felt.

## Operating principles

- **Build on the typed event taxonomy.** Every new surface emits new typed events; nothing rolls its own telemetry.
- **Repo-keyed everything, again.** New tables key on `projectKey` (and `repoRelativePath` where applicable) so they coexist with the seven-phase intelligence stores.
- **Don't break the workflow guard.** New phases or actions are members of `MissionWorkflowState`, not bypasses.
- **Failures must learn, again.** Every new write path that records on success also records on failure.
- **Cheap probes before expensive runs.** Every new gate answers "can this run *now*?" in seconds, not minutes — same rule as proof preflight.
- **Operator-felt benefit per phase.** Each phase ships at least one user-visible affordance and one test that would have caught its absence.
- **Each phase is independent.** Sequence can flex; the recommendation in §15 is the order of fastest-felt-benefit.

---

## Phase 8 — Mission inbox (the "stop typing ticket ids" phase)

**Goal:** the operator picks the next mission from a sorted, classified, deduped inbox surface inside Spira. No more YouTrack tab-switch.

### 8.1 YouTrack inbox poller

- New `MissionInboxPoller` service in `packages/backend/src/youtrack/inbox-poller.ts`. Polls YouTrack on a configurable interval (default 5 min) for tickets matching configured saved-queries (default: "open + assigned to me", per repo profile).
- Persists results to a new `mission_inbox` table keyed on `(ticketId, projectKey)` with: ticket summary, description excerpt, priority, status, assignee, due date, created/updated timestamps, classification cache (Phase 8.3), readiness (Phase 8.4), `lastSyncedAt`, `dismissed: bool`.
- Emits `mission-inbox-synced` system events with sync count + duration; rolls into the weekly digest.
- Saved-queries configurable per `repo_profile` (new column `inboxSavedQueries: JSON`).

### 8.2 Inbox renderer surface (`MissionInboxRoom`)

- New room under `packages/renderer/src/components/missions/rooms/MissionInboxRoom.tsx`. Sortable / filterable list of inbox entries with: ticket id, summary, priority chip, classification chip (Phase 8.3), readiness chip (Phase 8.4), duplicate badge (Phase 8.5).
- Per-row actions: **Start mission** (one-click `startRun`), **Open in YouTrack**, **Dismiss** (sets `dismissed=true`; reappears on next sync if YouTrack-side updated).
- Empty state: "No tickets in the inbox. Configure saved queries in repo profiles."
- Protocol messages: `missions:inbox:list`, `missions:inbox:dismiss`, `missions:inbox:refresh-now`.

### 8.3 Pickup-time classification cache

- When a ticket lands in the inbox, run a *cheap* classification probe (no full mission start): summary + description → infer `classification.kind` (`bug` / `feature` / `chore` / `docs` / `security` / `refactor`), complexity band (`small` / `medium` / `large`), blast radius (`single-file` / `single-package` / `cross-package` / `architecture`).
- Cached on the inbox row, refreshed on description change.
- The full classification phase still runs at mission start; this is just the *pre-pickup hint* so operators can prioritise.

### 8.4 Readiness gate

- A ticket is "ready" if it has: a non-empty description, an assignee (or none configured as required), no open blockers in YouTrack's `depends-on` field, no `needs-info` label, an AC block (heuristic: a "## Acceptance criteria" or "AC:" line in the description).
- Inbox renders a readiness chip: `ready` / `needs-info` / `blocked`. Operator can still pick a non-ready ticket; readiness is a hint, not a wall.
- Each missing prerequisite renders as a one-line tooltip: "No assignee · Missing acceptance criteria."

### 8.5 Duplicate detection

- At inbox-render time, cross-reference active runs (status ≠ `done` / `aborted`) and recent-closed runs (within 30 days) for matching `(ticketId, projectKey)`.
- Render a duplicate badge: "Active mission already running (run #1234)" / "Closed 3 days ago — re-pickup?" Click jumps to the existing run's detail view.

### 8.6 Mission templates (preset bundles)

- New `mission_templates` table: `{ id, displayName, classificationKind, defaultProofRules, defaultValidationProfiles, suggestedBriefingIds, suggestedPromptAddendum, source }`.
- Inbox row offers a template picker if more than one matches the classification kind. Operator can click "Start with template: Documentation fix" instead of "Start mission".
- Templates editable in a new `MissionTemplatesEditor` settings tab. Builtin templates seeded for `docs-fix`, `dependency-bump`, `bug-fix-frontend`, `bug-fix-backend`, `security-patch`.

### 8.7 Tests

- Inbox poller test: a fixture YouTrack response produces the expected `mission_inbox` rows; readiness flags are correct; sync events emitted.
- Duplicate-detection test: an active run and a recent-closed run for the same ticket both surface the right badge.
- Classification cache test: a "fix typo on login page" ticket classifies as `docs` / `small` / `single-file`; refreshes on description change.
- Renderer test: clicking "Start mission" fires `startRun` with the inbox row's metadata pre-filled.

**Risk:** YouTrack API rate limits. Mitigation: configurable poll interval; respect `Retry-After`; degrade to "manual refresh only" if rate-limited.

---

## Phase 9 — Workspace 2.0 (the "stop paying for cold starts" phase)

**Goal:** worktree creation is parallel, dependencies are restored from snapshots when possible, env files are templated, and ports are reserved. Cold-start latency drops 5-10× on re-pickups.

### 9.1 Parallel worktree creation

- Convert the `for (const worktree of worktreesToCreate)` loop in [`startRun()` ticket-runs.ts:481](../packages/backend/src/missions/ticket-runs.ts:481) to `Promise.allSettled` with coordinated rollback.
- Per-worktree timeout from the startup-recovery plan applies independently.
- A failed worktree triggers rollback of all *successful* peers in the same `startRun` (today's behaviour for a sequential failure).
- Emits `workspace-worktrees-created-parallel` event with per-worktree timing.

### 9.2 Workspace snapshot store

- New `workspace_snapshots` table: `{ id, projectKey, repoRelativePath, lockfileHash, sdkVersionTuple, snapshotPath, sizeBytes, createdAt, lastUsedAt, ticketRunIds: JSON }`.
- New `WorkspaceSnapshotService` in `packages/backend/src/missions/workspace-snapshot.ts`:
  - `createSnapshot({ worktreePath, projectKey, lockfileHash, sdkVersionTuple })` — tarballs `node_modules`, `obj`, `bin` (configurable per repo profile) into `<workspaceRoot>/.spira/snapshots/`. Best-effort.
  - `restoreSnapshot({ worktreePath, projectKey, lockfileHash, sdkVersionTuple })` — finds a matching snapshot (exact lockfile hash + matching SDK tuple), extracts into the worktree.
  - `pruneSnapshots({ maxAgeDays = 30, maxTotalBytes = 10 GB })` — runs nightly; LRU.
- On worktree create, `restoreSnapshot` runs *before* `dependency-warmer.ts` warms. If restore succeeds, warming is a no-op for that worktree.
- On mission close (success only), `createSnapshot` runs in the background.

### 9.3 Workspace env-file templating

- Extend `repo_profiles` with `envFileTemplate: string | null` (Mustache or simple `{{var}}` substitution; vars resolved from `requiredEnvVars` in the same row, with operator-prompt fallback).
- After worktree create + snapshot restore, write `<worktreePath>/.env.local` from the template. Skip if the file already exists.
- Emits `workspace-env-templated` event with `{ template, varsResolved, varsMissing }`.

### 9.4 Mission port broker

- New `mission_port_reservations` table: `{ port, runId, repoRelativePath, purpose, reservedAt, releasedAt: nullable }`.
- New `MissionPortBroker` in `packages/backend/src/missions/port-broker.ts`:
  - `reserve({ runId, purpose, preferredPort?, range = [9700, 9800] })` — finds a free port in the range, persists, returns it.
  - `release({ runId })` — bulk release on mission close (success, fail, or abort).
  - `listReservations()` — for the fleet view in Phase 14.
- The dev-server / proof-runner / preflight checks consult the broker instead of hardcoding `9720`. Existing constants migrate to `broker.reserve({ purpose: "dev-server" })` calls.

### 9.5 Workspace identity hash

- Compute a `workspaceFingerprint = hash({ projectKey, branch, lockfileHash, sdkVersionTuple })` per worktree on creation.
- Persist on the `worktrees` row. Used by snapshot restore (Phase 9.2) and by the fleet view (Phase 14) to detect environment drift.

### 9.6 Tests

- Parallel-creation test: two worktrees create concurrently; one fails and the other rolls back; total elapsed ≤ slowest single creation + rollback overhead.
- Snapshot round-trip test: create → snapshot → delete worktree → restore → run validation → passes.
- Env-template test: `{{REGISTRY_TOKEN}}` is substituted from the repo profile's resolved env vars.
- Port-broker concurrency test: 100 simultaneous reservations issue 100 distinct ports; release returns them to the pool.

**Risk:** snapshot disk usage. Mitigation: configurable cap (default 10 GB total, 30-day max age, LRU eviction); operator can disable snapshots in repo profile.

---

## Phase 10 — Evidence chain (the "proof becomes a story" phase)

**Goal:** every passing proof produces a single signed bundle that contains video, before/after pair, network capture, AC cross-check, and a manifest. The bundle travels with the PR.

### 10.1 Implement-phase screencast

- New `MissionScreencastRecorder` in `packages/backend/src/missions/screencast.ts`. Wraps the implement phase: starts a low-frame-rate (5 fps) screen capture of the renderer + agent's terminal output; stops on phase exit.
- Output: `<workspaceRoot>/.spira-proof/<runId>/screencast.webm`. Capped at 50 MB; older frames dropped if exceeded.
- Toggleable per mission template (default: on for `bug-fix-*` and `feature-*`, off for `docs-*` and `chore-*`).
- Emits `mission-screencast-recorded` event with `{ duration, sizeBytes, fps }`.

### 10.2 Before/after screenshot pair

- When repo guidance flags a touched file under `userFacingCopyGlobs` or `uiTestGlobs`, auto-mint a screenshot pair: baseline (worktree at `git stash` of changes) and current.
- Driven by the proof-runner; uses the existing screenshot harness if present, otherwise spawns a Playwright snapshot at the configured dev-server URL.
- Pair persisted as `before-{screenName}.png` + `after-{screenName}.png` under the proof artifact dir.
- Surfaced in `ProofRunsViewer` as a side-by-side pair with a slider toggle.

### 10.3 Network capture (.har)

- Extend supported proof harnesses (Playwright, Cypress) with a `--har=<path>` flag in the registered profile.
- The proof-runner enforces the flag at spawn time; the resulting `.har` is added to the artifact list with a `kind: "network-trace"` chip.
- A new `HarViewer` renderer component (lazy-loaded) shows request count, status-code distribution, and the slowest 5 requests.

### 10.4 Acceptance-criteria cross-check

- New `AcceptanceCriteriaMatcher` in `packages/backend/src/missions/ac-matcher.ts`.
- Pulls AC text from the YouTrack ticket (heuristic: lines starting with `- [ ]`, `* [ ]`, `1.`, etc., under an "Acceptance criteria" or "AC" heading).
- For each AC line, attempts:
  1. **Diff grep** — does the diff include text matching the AC keywords?
  2. **Test grep** — does any new/changed test reference the AC keywords?
  3. **Proof artifact grep** — does any proof log/screenshot filename match?
- Produces an `acceptance-criteria.md` artifact with each line marked `✓ matched` / `? unverified` / `✗ untouched`.
- Operator can hand-tick remaining lines in the renderer; ticks persist as `mission-ac-ticked` events.

### 10.5 Proof bundle

- New `MissionProofBundler` in `packages/backend/src/missions/proof-bundler.ts`.
- On a passing proof run (or on `manual-review-only` set), zips:
  - All artifacts under `.spira-proof/<runId>/`.
  - The screencast, before/after pair, .har, and AC cross-check from §10.1–10.4.
  - `manifest.json`: `{ runId, ticketId, ticketUrl, classification, validationSummary, proofSummary, filesChanged, commitHash, builtAt }`.
- Output: `<workspaceRoot>/.spira-proof/<runId>/proof-bundle-<runId>.zip`.
- SHA-256 of the bundle recorded as `mission-proof-bundle-signed { runId, sha256, sizeBytes }`.

### 10.6 Bundle viewer + share affordance

- `ProofRunsViewer` gains a "Download proof bundle" button; copy-link copies a `file://` path or, if a configured upload target exists, an https URL.
- Bundle path also persisted to the run summary so the PR description (Phase 12) can link it.

### 10.7 Tests

- Bundle round-trip test: synthetic proof run produces a bundle; manifest matches; SHA-256 stable.
- AC matcher test: a fixture ticket with three AC lines + a fixture diff produces the expected `✓ / ? / ✗` markings.
- Screencast lifecycle test: recorder starts on phase enter, stops on phase exit, never exceeds the configured size cap.
- Network capture test: a Playwright proof with `--har` produces a non-empty `.har` artifact.

**Risk:** disk + CPU cost of screencast. Mitigation: 5 fps cap, 50 MB cap, opt-out per template, skipped entirely if the operator's settings have `missionScreencastEnabled: false`.

---

## Phase 11 — Prompt + model evolution + cost telemetry (the "the AI improves itself" phase)

**Goal:** prompts are versioned, models are selected per classification based on outcomes, costs are tracked per mission, failed missions feed next runs as named pitfalls, and a shadow-replay harness validates prompt/model variants against historical missions.

### 11.1 Versioned prompts

- New `prompt_versions` table: `{ id, kind ('initial' | 'continuation' | 'reviewer'), versionTag (semver-ish), templateHash, templateBody, source ('builtin' | 'experiment' | 'rollback'), createdAt, retiredAt: nullable }`.
- `buildInitialPrompt` / `buildContinuationPrompt` ([ticket-runs.ts:1731](../packages/backend/src/missions/ticket-runs.ts:1731)) becomes a thin wrapper that resolves the active version via `PromptResolver`.
- Every pass emits `mission-prompt-version-used { kind, versionTag, templateHash }`.
- Builtin versions seeded from the current templates as `1.0.0`.

### 11.2 Per-classification model selection

- New `model_outcomes` table: rolling per-`(classification.kind, modelId)` pass-rate over the last N=20 closed missions.
- New `ModelSelector` service: at pass start, reads the table; if a model has ≥ 70% pass rate over the last N for this classification, selects it; otherwise falls back to the global default.
- Operator can pin a model via repo profile or mission template (`forcedModelId`).
- Emits `mission-model-selected { classification, modelId, reason ('historical' | 'forced' | 'fallback'), passRateUsed }`.

### 11.3 Mission cost telemetry

- New `mission_costs` table: `{ runId, attemptId, modelId, promptTokens, completionTokens, costEstimate, recordedAt }`.
- Hook into the provider client wrapper (the same place token counts are already observable). Each completion writes one row.
- New `mission-cost-recorded` event surfaces in the timeline ("Implement pass · Sonnet 4.6 · 18k in / 4k out · ~$0.42").
- Run summary aggregates `totalCostEstimate`; weekly digest adds a `Cost per classification` table.
- Settings: `missionCostBudgetUsd: number | null` — when set, a mission that exceeds the budget mid-run pauses with a "Continue / Abort" prompt.

### 11.4 Failed-mission knowledge ingestion

- On `fail-final` outcome, run `FailureSummariser` against the run's events + final pass output: produces a one-line distillation ("Type error in `users.repository.ts`: missing `Promise<>` wrapper") plus a 2-line context.
- Persists as a `repo_intelligence_entries` row with `kind: 'pitfall'`, `source: 'learned'`, `tags: ['failure-mode', classification.kind]`, with a low-but-non-zero confidence score (so the auto-promoter from Phase 5 picks it up only with corroborating evidence).
- Surfaced in the next run's repo guidance as a "Recent failure modes" subsection of `## Repo guidance`.

### 11.5 Shadow replay harness

- New `MissionReplayHarness` in `packages/backend/src/missions/replay-harness.ts`.
- Inputs: a closed mission's run id + a *candidate* `{ promptVersion?, modelId? }` override.
- Fetches the mission's events, classification, diff, validation history.
- Spawns a sandbox station with the override; replays the implement-phase prompt; collects the resulting tool calls + diff.
- Compares the replay's outcome against the historical baseline along: validation pass/fail, diff similarity, time, cost. Reports a `ReplayDelta`.
- Operator surface: a new `ReplayHarnessRoom` in the renderer where the operator picks N closed missions and a candidate override; sees the deltas in a table.

### 11.6 A/B prompt router

- Setting: `missionPromptABExperiment: { name, variantA: versionTag, variantB: versionTag, splitPercent: 0.5, startedAt, endsAt? } | null`.
- When set, `PromptResolver` picks a variant per pickup based on a hash of the run id (deterministic but split).
- After `endsAt` (or operator-trigger), an experiment digest produces `reports/prompt-experiment-{name}.md` with pass-rate, cost, and outcome distribution per variant.
- Renderer: a small "Active experiment" indicator in `MissionInboxRoom`.

### 11.7 Tests

- Prompt resolver test: builtin version 1.0.0 resolves; an experiment override returns the variant; the version-used event is emitted.
- Model selector test: a fixture model_outcomes table produces the expected selection per classification.
- Cost telemetry test: a fake completion records the row; total aggregates correctly; budget breach pauses the run.
- Failure summariser test: a known failure trace produces a known pitfall row.
- Replay harness test: replaying a synthetic mission with the same prompt version produces an identical-shape delta (zero divergence).
- A/B router test: 1000 deterministic pickups split within ±2% of the configured percent.

**Risk:** shadow replay correctness. Mitigation: replay runs in a sandbox station with read-only worktree; never writes to mission tables; explicitly marked `replay-only` in events.

---

## Phase 12 — Commit & PR ceremony (the "trust handover" phase)

**Goal:** the manual commit step is a real review checkpoint; the PR description is a complete evidence package; multi-repo PRs are cross-linked.

### 12.1 Diff-review gate

- `commitRun()` is locked behind a UI affordance: the operator must click "I have reviewed the diff" in `MissionDetailsRoom` before the commit button enables.
- New "Diff review" panel: a side-by-side diff viewer with file-by-file navigation, a per-file "✓ reviewed" tick, and a "review all" affordance.
- Operator can override the gate (e.g., for a one-line typo) with a checkbox + reason; recorded as `mission-diff-review-overridden`.
- Setting: `missionRequireDiffReview: boolean` (default `true`).

### 12.2 PR description as evidence package

- Extend `createPullRequest()` (and the commit-draft generator) with a richer body builder. Sections:
  1. **Summary** — ticket id + summary + classification chips.
  2. **Changes** — files changed grouped by package; line counts.
  3. **Validation** — table of validation runs (kind / status / duration / command).
  4. **Proof** — link to proof bundle (Phase 10.5); inline before/after pair if available; AC checklist (Phase 10.4).
  5. **Confidence** — band (`high` / `promoted` / `provisional`) based on intelligence used; link to learned-candidate audit.
  6. **Sibling PRs** — for multi-repo missions (Phase 12.4).
  7. **Footer** — `Spira-Run: {runId}` and a link to the run detail view.
- Operator can edit before submission; default is "auto-fill, allow edit."

### 12.3 Confidence trailer in the commit

- Commit message footer auto-extended with:
  - `Spira-Run: {runId}`
  - `Spira-Confidence: high | promoted | provisional`
  - `Spira-Prompt-Version: {versionTag}` (from Phase 11.1)
  - `Spira-Model: {modelId}` (from Phase 11.2)
- Trailers parseable by `git interpret-trailers`; show up cleanly in `git log`.

### 12.4 Multi-repo PR coordination

- When a mission opens N PRs (one per worktree), each PR body carries a `Sibling-PRs:` block listing the others.
- All sibling PRs get a label `mission/{runId}` for filtering on GitHub.
- Mission detail view shows the PR set with a "Open all" button.

### 12.5 Auto-PR after manual commit

- `commitRun()` already exists; chain `createPullRequest()` to fire automatically *after* a successful commit by default.
- Setting: `missionAutoOpenPrAfterCommit: boolean` (default `true`).
- Operator can disable per-mission via a checkbox in the commit dialog.

### 12.6 Tests

- Diff-review gate test: commit button stays disabled until "reviewed" tick or explicit override; override emits the event.
- PR body generator test: a fixture mission with all components produces a golden-file body.
- Confidence trailer test: a `learned`-source intelligence entry produces a `promoted` trailer; a `builtin`-source produces a `high` trailer.
- Multi-repo coordination test: a 3-worktree mission opens 3 PRs each linking to the other 2.

**Risk:** verbose PR bodies. Mitigation: each section is collapsible (GitHub-flavoured `<details>` blocks); operator can edit / trim before submit.

---

## Phase 13 — Reviewer agent (the "second pair of eyes" phase)

**Goal:** between the implementer's last passing validation and the operator's commit, an automated reviewer agent critiques the diff. Blockers gate the commit; suggestions surface inline.

### 13.1 Reviewer station

- New `mission-reviewer` station kind. Triggered automatically after the validate phase passes (and proof passes / is waived).
- Input bundle: diff, validation summary, proof artifacts, AC matcher output, ticket description.
- Prompt: a critical reviewer system prompt focused on *spotting regressions, dead code, security risks, naming, missing tests*. Explicitly *not* asked to suggest the change be reimplemented — only to flag concerns.
- Output: structured JSON `{ blockers: [{ file, line?, severity, message }], suggestions: [...], approvals: [...] }`.

### 13.2 Reviewer outcomes table

- New `reviewer_decisions` table: `{ runId, attemptId, blockers: JSON, suggestions: JSON, approvals: JSON, completedAt, modelId, costEstimate }`.
- Persisted on every reviewer pass; surfaced in the timeline as `mission-reviewer-completed`.

### 13.3 Reviewer panel in `MissionDetailsRoom`

- New panel: lists blockers (red), suggestions (amber), approvals (green).
- Each blocker has a per-row "override with reason" button; overrides recorded as events.
- Each suggestion has accept / reject buttons; accepted suggestions become inline edit-task hints in the next implement pass (if reopened).
- Commit gate: the diff-review gate from Phase 12.1 *also* requires zero unresolved blockers (or all overridden).

### 13.4 Reviewer self-tuning

- Operator overrides feed back to the learning loop: a blocker that was overridden 3+ times in a row tunes the reviewer's prompt to deprioritise that pattern.
- Implemented as a `reviewer_tuning_entries` table + a contribution to the prompt-version system from Phase 11.1.

### 13.5 Setting + opt-out

- `missionReviewerEnabled: boolean` (default `true`).
- Per-template opt-out (e.g., `docs-fix` template skips the reviewer by default).

### 13.6 Tests

- Reviewer pass test: a fixture diff with a hardcoded credential produces a blocker; a fixture diff with no concerns produces an approval.
- Override-feedback test: 3 overrides of the same blocker pattern tune the reviewer's prompt.
- Commit gate integration test: an unresolved blocker keeps the commit button disabled even after diff-review tick.

**Risk:** reviewer false positives. Mitigation: every blocker is overridable; auto-tuning kicks in after 3 overrides; operator can disable the reviewer per mission template.

---

## Phase 14 — Scheduler, fleet view, knowledge sharing (the catch-all)

**Goal:** opportunistic items that don't fit a single theme but matter as the fleet of missions grows.

### 14.1 Mission scheduler

- New `MissionScheduler` service with a global concurrency cap (default 3, settings-tunable).
- New states on the workflow: `queued` (cap reached), `pending-resources` (port broker / snapshot store contention).
- A `startRun` call when the cap is reached enqueues with priority (urgency from inbox classification).
- Dequeue fires when any in-flight mission closes.

### 14.2 Fleet view dashboard

- New `MissionFleetRoom`: at-a-glance grid of all in-flight missions with phase chip, now-playing strip, elapsed, last activity, alert chip (preflight-blocked / awaiting-permission / cost-budget-exceeded).
- Per-row: jump to detail, abort, pause.
- Filters by status, repo, classification, priority.

### 14.3 Cross-instance intelligence sharing (optional)

- Extends the JSON export/import (deferred plan B.3) with a `MissionIntelligenceSync` service that can pull from / push to a configured shared store (S3, GitHub repo, etc.).
- Records sync events; conflicts resolved by `source` priority (`user` > `learned` > `builtin`).
- Out of scope unless multi-operator deployments emerge.

### 14.4 Tests

- Scheduler concurrency test: 5 startRun calls with cap=3 produce 3 in-flight + 2 queued; closure of one promotes one queued.
- Fleet view test: a fixture state with 4 missions renders 4 rows with the right chips.
- Sync round-trip test (if shipped): export from instance A → import to instance B → identical intelligence state.

**Risk:** low. Independent items.

---

## Cross-cutting concerns

### Migration safety

- All new tables (`mission_inbox`, `mission_templates`, `workspace_snapshots`, `mission_port_reservations`, `prompt_versions`, `model_outcomes`, `mission_costs`, `reviewer_decisions`, `reviewer_tuning_entries`) are additive.
- All new event types extend the typed taxonomy from Phase 0.1; legacy readers ignore unknown types.
- All new settings are off-by-default if risky (cost budget, A/B experiment, sync), on-by-default if safe (inbox poller, snapshots, diff-review gate, auto-PR, reviewer).

### Settings (defaults)

- `missionInboxPollIntervalMs: number` (default 300000 = 5 min)
- `missionInboxPollerEnabled: boolean` (default `true` once configured saved-queries exist)
- `missionWorkspaceSnapshotsEnabled: boolean` (default `true`)
- `missionWorkspaceSnapshotMaxBytes: number` (default 10 GB)
- `missionScreencastEnabled: boolean` (default `true`)
- `missionScreencastFps: number` (default 5)
- `missionAcceptanceCriteriaCheckEnabled: boolean` (default `true`)
- `missionCostBudgetUsd: number | null` (default `null` — no budget)
- `missionAutoOpenPrAfterCommit: boolean` (default `true`)
- `missionRequireDiffReview: boolean` (default `true`)
- `missionReviewerEnabled: boolean` (default `true`)
- `missionConcurrencyCap: number` (default 3)
- `missionPromptABExperiment: object | null` (default `null`)

### Observability of the new surfaces

- Every new background job (inbox poller, snapshot pruner, weekly digest, reviewer tuning sweep) emits `system_events` with start/end/duration/outcome.
- Every new operator-visible action emits a typed mission event so the timeline carries it.

### Out of scope

- Any change to the provider escalation ladder ([model-escalation-architecture.md](./model-escalation-architecture.md)).
- Any change to the renderer's visual identity ([ui-living-airship-redesign.md](./ui-living-airship-redesign.md)).
- A new MCP server, unless the YouTrack inbox poller's scope grows enough to warrant one.
- Anything that requires a destructive schema migration; if the design needs one, it goes to its own plan.

---

## Sequencing recommendation

If we ship in this order, each phase delivers operator-felt benefit independently:

1. **Phase 8** (mission inbox) — shortest path from "I want to work on this" to "Spira is working on it." Ship first; touches no existing run state.
2. **Phase 11** (prompt + model evolution + cost telemetry) — the only loop the system *can't* close today. Cost telemetry alone pays for itself in week one.
3. **Phase 9** (workspace 2.0) — biggest cold-start win; enables the screencast disk space for Phase 10.
4. **Phase 10** (evidence chain) — highest single quality investment; turns proof from receipts into a story the PR carries.
5. **Phase 12** (commit & PR ceremony) — best after Phase 10 (so the PR has a bundle to link).
6. **Phase 13** (reviewer agent) — best after Phase 12 (so the reviewer has the operator-facing context).
7. **Phase 14** (scheduler + fleet + sharing) — opportunistic; pick items as the fleet grows.

If only **three** phases ship, do **8 + 11 + 10**: the inbox removes the operator's biggest tax, cost+prompt telemetry closes the only un-closed loop, evidence chain transforms the trust handover.

If only **one** phase ships, do **Phase 10**. The PR-carries-evidence story is the single highest-leverage upgrade for downstream trust.

---

## Definition of done (per phase)

A phase is done when:

1. All listed deliverables have shipped behind feature flags where the default is risky.
2. The listed tests pass in CI.
3. The phase has produced at least one user-visible change documented in the changelog.
4. The mission running this work has produced its own auto post-mortem under §1.5 of the overhaul plan (so the system is dogfooding itself).
5. A note added to the **Progress log** at the foot of this document with what shipped, self-review fixes, and what's still on hold.

---

## Progress log

*(Empty — populated as phases ship, mirroring the overhaul plan's pattern.)*
