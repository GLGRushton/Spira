# Mission Workflow — Next Horizon Review (2026-05-10)

**Reviewer:** end-to-end audit for the *next* horizon of mission-workflow improvements, after the seven-phase overhaul + five follow-up batches landed.
**Scope:** [packages/backend/src/missions](../packages/backend/src/missions), [packages/backend/src/youtrack](../packages/backend/src/youtrack), [packages/memory-db/src/database](../packages/memory-db/src/database), [packages/renderer/src/components/missions](../packages/renderer/src/components/missions), [packages/renderer/src/components/projects/ProjectsPanel](../packages/renderer/src/components/projects/ProjectsPanel).
**Companion plan:** [mission-workflow-next-horizon.md](../plans/mission-workflow-next-horizon.md).
**Anchored in:** the seven-phase overhaul ([plans/mission-workflow-overhaul.md](../plans/mission-workflow-overhaul.md)) and its follow-ups ([plans/mission-workflow-followups.md](../plans/mission-workflow-followups.md), [plans/mission-workflow-deferred.md](../plans/mission-workflow-deferred.md)). The original "review → overhaul" pair sits at [reports/mission-workflow-review-2026-05-09.md](mission-workflow-review-2026-05-09.md).

---

## 1. Executive verdict

The mission system has been transformed. **Visibility, observability, learning, and post-mortems are real.** The state machine is correct, telemetry is typed, proof is gated by preflight, intelligence compounds across runs, post-mortems land automatically, and the primary station now shares the same primitives. The 91-minute LH-402 era is over.

What remains is not a fix list. It is a **next-horizon expansion** along the five lines the user actually cares about:

1. **Ticket pickup from YouTrack** — currently the operator copy-pastes a ticket id. There is no queue, no proactive prioritisation, no duplicate detection, no readiness gate. The system *receives* tickets; it does not *pull* them.
2. **Workspace creation** — `startRun()` creates worktrees in a `for` loop (sequential), warms dependencies after the fact, and offers no template, snapshot, port-reservation, or env-file convention. A multi-repo cold start that should take 30 s takes 3-5 min.
3. **Heavy proof of work** — the proof system is preflighted and proportional but the *evidence* it produces is a directory of files. There is no video, no before/after pair, no network trace, no signed bundle, no acceptance-criteria cross-check. The human reviewer downstream still has to *believe* the proof rather than *see* it end-to-end.
4. **Constant automatic improvement of the AI** — the learning loop promotes briefings, pitfalls, examples, validation profiles. It does not yet *evolve the prompt itself*, *select the right model per ticket class*, *replay old missions against new prompts*, *track per-mission cost*, or *feed failures back into next runs as named pitfalls*. The primary lever (the system prompt) is unversioned.
5. **Manual commit → automated PR** — `commitRun()` exists, `createPullRequest()` exists, `generateCommitDraft()` exists. What's missing is the **ceremony around the human checkpoint**: a diff-review gate, an auto-generated PR description that bundles classification + validation + proof + confidence, and a confidence band on the commit trailer that tells the reviewer how much the AI vouches for the change.

The fix is not a rewrite. It is to **promote the operator from typist to commander, treat the workspace as a first-class artefact, turn proof from receipts into an evidence chain, evolve the prompt as code, and turn the commit checkpoint into a confidence handover.** Six themes, each shippable in one or two PRs, none requiring a destructive migration.

The plan in [mission-workflow-next-horizon.md](../plans/mission-workflow-next-horizon.md) ships this in **six phases** (numbered 8–13 to continue the overhaul's sequence). Phases 8 and 11 cover the largest chunk of operator-felt time. Phase 10 is the most ambitious — an evidence-chain reframing of proof — and is the single most defensible quality investment.

---

## 2. The mission workflow as it stands today

### 2.1 What's gone right

The post-overhaul system has these durable strengths:

- **Telemetry is typed and dense.** Every action emits a strongly-typed event; the renderer streams deltas not full snapshots; the timeline groups by phase with collapsible blocks; the now-playing strip never lies. ([packages/shared/src/mission-events.ts](../packages/shared/src/mission-events.ts))
- **Proof is gated.** Preflight blocks unrunnable harnesses in seconds rather than minutes; proportionality downgrades trivial diffs; manual-review-only is a first-class terminal state. ([packages/backend/src/missions/proof-preflight.ts](../packages/backend/src/missions/proof-preflight.ts))
- **Intelligence compounds.** Repo profiles, validation profiles, proof rules, and four kinds of intelligence entry all key on `(projectKey, repoRelativePath)`; learned candidates auto-promote on a confidence formula with revoke-and-quarantine semantics. ([packages/backend/src/missions/learned-candidate-promoter.ts](../packages/backend/src/missions/learned-candidate-promoter.ts))
- **Post-mortems land for free.** Every closed mission writes a stub; weekly digests aggregate the longest phases and the top blockers; the same generator now serves the primary station. ([packages/backend/src/missions/post-mortem-generator.ts](../packages/backend/src/missions/post-mortem-generator.ts))
- **Workflow guard is honest.** `assertMissionWorkflowActionAllowed` is the only door; new states are members not bypasses; the abort-and-postmortem path closes the long tail. ([packages/backend/src/missions/mission-workflow-guard.ts](../packages/backend/src/missions/mission-workflow-guard.ts))

### 2.2 What's still pinched

Three friction shapes remain — none are bugs in what shipped, all are limits of *what was scoped*:

1. **The operator is still a typist.** Picking a ticket means copying an id from YouTrack into a dialog. There is no inbox, no priority lens, no "what is ready to be picked up", no "you already have a run for this", no template, no preset. The system is reactive.
2. **The workspace is a side-effect, not an artefact.** Worktrees are created sequentially, ports are not reserved, env files are not templated, dependency caches are not snapshotted, and a successful workspace is not preserved on close — a re-pickup pays the cold cost again.
3. **Proof is a directory, not an evidence chain.** A passing proof leaves logs and screenshots in `.spira-proof/<id>/`. A reviewer downstream — operator, peer, or auditor — sees an artifact list, not a story. There is no video, no before/after pair, no AC checklist tick-off, no signed bundle, no replayable trace.

### 2.3 What's planned but uninspected

The deferred plan ([mission-workflow-deferred.md](../plans/mission-workflow-deferred.md)) covers the transaction API, schema completions, renderer polish, and volume-driven perf. It does **not** cover anything in the next-horizon buckets above. This report and the companion plan extend the runway.

---

## 3. Theme A — Ticket pickup as a first-class surface

### 3.1 Today's pickup flow

`TicketRunService.startRun()` ([packages/backend/src/missions/ticket-runs.ts:283](../packages/backend/src/missions/ticket-runs.ts:283)) accepts `{ ticketId, ticketSummary, ticketUrl, projectKey, ... }` from an operator-driven dialog. The YouTrack service ([packages/backend/src/youtrack/service.ts](../packages/backend/src/youtrack/service.ts)) wraps API calls but is consumed only on demand, never to *populate* the pickup surface.

There is no:

- **Inbox** — a list of tickets the operator could start.
- **Priority lens** — urgent vs backlog vs stale.
- **Readiness gate** — does the ticket have an owner, a description, a project, an assignee, AC?
- **Duplicate guard** — is there already a run for this ticket?
- **Suggested classification at pickup** — only happens *after* startRun, inside the classification phase.
- **Mission template** — every pickup re-derives proof level, validation kinds, and prompt context from scratch.

### 3.2 Why this hurts

The post-mortems' biggest *unmeasured* time leak is the operator-side latency between "I should pick up a ticket" and "Spira is doing useful work." If the operator has to switch to YouTrack, scan the open list, copy an id, paste it into a dialog, and remember the project key — that's 2-5 minutes of human time per pickup, every time. Multiply by N missions per day.

A first-class pickup surface inside Spira:

- Shows the operator *what is ready* to be picked up, sorted by priority.
- Pre-classifies (priority, complexity, blast radius) before the user clicks.
- Detects duplicates against active and recent-closed runs.
- Detects ticket-side blockers (no description, no AC, blocked by another ticket).
- Pre-loads a mission template appropriate to the kind.

### 3.3 Bold restructure: the Mission Inbox

Convert the YouTrack integration from a passive lookup to an active sync. Add a `mission_inbox` table that holds the polled-and-classified ticket pool. A new `MissionInboxRoom` in the renderer surfaces the inbox; "start mission" is one click. Phase 8 of the plan ships this.

---

## 4. Theme B — Workspace as code, not as side-effect

### 4.1 Today's workspace creation

`startRun()` loops through `worktreesToCreate` ([ticket-runs.ts:481](../packages/backend/src/missions/ticket-runs.ts:481)) sequentially. Each iteration:

1. Calls `git worktree add <path> <branch>` (potentially 30-90 s on a big repo).
2. Optionally hydrates submodules (potentially several minutes).
3. Persists the worktree row.

For a 3-repo mission this is 3× the single-repo cost — strictly serial. After the worktrees exist, `dependency-warmer.ts` warms `node_modules` in parallel, but that pays the cold cost on every fresh checkout.

There is no:

- **Parallelism** in worktree creation.
- **Snapshot / restore** of a previously-built workspace.
- **Env-file templating** — operator writes `.env.local` by hand.
- **Port reservation** — two concurrent missions can race for `localhost:9720`.
- **Workspace identity** — a workspace is the sum of its worktrees; there is no "workspace v3" you could restore wholesale.

### 4.2 Why this hurts

Cold-start latency is the second-largest unmeasured time leak. A re-pickup of a previously-completed ticket (common when a PR review surfaces a needed change) re-pays the full cost. A second concurrent mission that needs a UI port collides with the first.

### 4.3 Bold restructure: workspace templates + snapshot/restore

- **Workspace template** = `{ branchNamingRule, requiredEnvVars, suggestedPortMap, bootstrapCommands, postCreateValidations }`. Tied to a `projectKey` or a mission template.
- **Snapshot** = a tarball of `node_modules` (and optionally `.next`, `dist`, `obj`, `bin`) keyed on `(projectKey, lockfileHash, sdkVersionTuple)`. On cold start, restore if present; warm in background otherwise.
- **Port reservation** = a SQLite-backed reservation table; `MissionPortBroker` issues sticky ports and revokes them on close.

Phase 9 of the plan ships this. Targets a 5-10× cold-start improvement for re-pickups.

---

## 5. Theme C — Proof as an evidence chain

### 5.1 Today's proof artefacts

`runMissionProof` ([packages/backend/src/missions/proof-runner.ts](../packages/backend/src/missions/proof-runner.ts)) spawns a configured harness, captures stdout/stderr to disk, and globs the result directory for `*.png`, `*.webm`, `*.html` etc. The renderer's `ProofRunsViewer` lists them with download links. The auto post-mortem links to the directory.

Missing from the evidence chain:

- **Screen recording during the mission's own implement phase.** Today the only video is what the proof harness produces; there's no record of what the agent *did* to get there.
- **Before/after pair generation.** UI changes don't auto-mint a baseline-vs-current screenshot pair, even when proof rules detect a UI surface was touched.
- **Network capture (.har).** Tests that pass while a backend call silently fails leave no trace of the call.
- **Acceptance-criteria cross-check.** YouTrack tickets have AC text; the proof system never compares the AC against the diff or the test output.
- **Signed proof bundle.** A reviewer downstream gets a directory path inside Spira; they can't take the evidence with them in one file.
- **Replayable trace.** The mission is a sequence of typed events; there is no tool that says "show me, second by second, what happened."

### 5.2 Why this matters

Heavy proof is the user's #3 explicit goal. Today the system *runs* proof; it does not *produce evidence*. The reviewer at the PR stage — and the auditor at the post-mortem stage — both have to *believe* the green tick rather than *see* the chain.

### 5.3 Bold restructure: the Evidence Chain

A proof run produces a `proof-bundle-{runId}.zip` containing:

1. The harness output (existing).
2. `before.png` + `after.png` if a UI surface was touched (auto-detected from repo profile globs).
3. `network.har` if the harness supports request capture.
4. `screencast.webm` of the implement phase (rate-limited, lossy, optional).
5. `acceptance-criteria.md` — a copy of the YouTrack AC with each line ticked, queried, or unticked based on diff + test grep.
6. `manifest.json` with run id, ticket id, classification, validation summary, proof summary, files-changed, commit hash.
7. A SHA-256 of the bundle, recorded as a `mission-proof-bundle-signed` event.

The bundle becomes the artefact that travels with the PR. Phase 10 of the plan ships this. Highest leverage of any single change in this report.

---

## 6. Theme D — The AI evolving the AI

### 6.1 Today's learning loop

[learned-candidate-promoter.ts](../packages/backend/src/missions/learned-candidate-promoter.ts) auto-promotes briefings, examples, and pitfalls based on a confidence formula. [validation-candidate-learner.ts](../packages/backend/src/missions/validation-candidate-learner.ts) proposes validation profile candidates from observed shell commands. [weekly-digest-generator.ts](../packages/backend/src/missions/weekly-digest-generator.ts) rolls up.

What does **not** happen:

- **The system prompt is unversioned.** [packages/backend/src/missions/index.ts:220](../packages/backend/src/index.ts:220) builds it from a fixed string template; there is no record of which prompt produced which outcome.
- **There is no model selection per classification.** Every pass uses whatever provider is configured; the system never asks "which model has a higher pass rate for `bug-fix-frontend`?"
- **Failed missions feed only candidate pitfalls.** They do not contribute to a per-classification *failure pattern catalog* that future runs can read.
- **There is no shadow replay.** A new prompt or model variant cannot be tested against the last 50 closed missions to see if it would have done better.
- **There is no cost telemetry.** Token counts and provider spend are not per-mission attributed; weekly cost-per-classification is unknowable.
- **There is no A/B harness.** Prompt or model variants cannot be split across live runs and compared.

### 6.2 Why this matters

The user's #4 goal is *constant automatic improvement.* The current loop improves the *intelligence library*, not *the agent itself*. The lever the agent actually pulls — the prompt + the model + the cost budget — is static. Every improvement to those today is a code edit.

### 6.3 Bold restructure: prompt-and-model evolution as a first-class loop

- **Versioned prompts**, identified by hash, recorded on every pass via a `mission-prompt-version-used` event.
- **Per-classification model selection**, driven by historical pass rate per `(classification, modelId)` triple, with a "force model X" override.
- **Cost telemetry** — `mission-cost-recorded` events with token counts, provider, modelId; rolled into the weekly digest as $/ticket.
- **Failed-mission knowledge ingestion** — on `fail-final`, distil a one-line "Known failure mode for {classification}: …" into the repo guidance section.
- **Shadow replay** — a `MissionReplayHarness` that takes a closed mission's events + diff and re-runs the implement-prompt against a candidate prompt/model variant in a sandbox; reports the win/loss without touching production state.
- **A/B router** — a setting that splits new pickups N% / (1-N)% across two prompt variants; a digest at the end of the experiment names a winner.

Phase 11 of the plan ships this. Cost telemetry is the cheapest single piece and pays for itself in the first week.

---

## 7. Theme E — The commit & PR ceremony

### 7.1 Today's commit + PR flow

`generateCommitDraft()` builds a message; `commitRun()` executes the git commit; `createPullRequest()` opens the PR. The operator clicks through. The PR title is the commit subject; the PR body is the commit body.

Missing from the ceremony:

- **A diff-review gate.** The operator can commit without ever scrolling the diff.
- **A proof summary in the PR body.** Reviewers have to ask "was this proved?" rather than read it on the PR.
- **A confidence trailer in the commit.** The reviewer has no signal of whether the change was driven by a high-confidence promoted intelligence entry or a first-time guess.
- **Validation summary in the PR body.** Build / lint / test outcomes don't ride along.
- **Acceptance-criteria block in the PR body.** The YouTrack AC is not echoed back so the reviewer can scan it inline.
- **Multi-repo coordination.** A multi-worktree mission opens N independent PRs without cross-linking; reviewers have no way to see the PRs are siblings.

### 7.2 Why this matters

The user's #5 explicit goal: *we always end with manual commit and PR (PR can be automated after manual commit).* The manual step is the trust handover. Today the handover is one click after a brief diff review. Strengthening the handover is cheap and pays back every PR.

### 7.3 Bold restructure: the PR as evidence package

- **Diff-review gate** — `commitRun()` is locked behind an explicit "I have reviewed the diff" affordance in `MissionDetailsRoom`, with a side-by-side diff viewer that scrolls through the changes file-by-file.
- **PR description = ticket summary + classification + validation summary + proof summary + AC checklist + confidence trailer + link to proof bundle.** All auto-generated; operator can edit before submit.
- **Confidence trailer in the commit** — `Spira-Confidence: high | promoted | provisional` based on the intelligence used; `Spira-Mission: {runId}` for traceability.
- **Multi-repo PR coordination** — when a mission opens N PRs, each carries a `Sibling-PRs:` block in the body and a `mission-{runId}` label so reviewers can find the set.

Phase 12 of the plan ships this.

---

## 8. Theme F — Reviewer agent (the second pair of eyes)

### 8.1 Today's pre-handover review

There is no automated review pass between the implementer's "I'm done" and the operator's "I'll commit it." The operator is the first and only reviewer.

### 8.2 Why this matters

The implementer agent is optimised for *making the change pass validation*. It is not optimised for *spotting subtle regressions, dead code introduced, security holes, or poor naming*. A second agent — instructed to critique rather than implement — catches a different class of issue. This is the same pattern the existing review skill applies (`/review`), but applied automatically pre-commit to every mission.

### 8.3 Bold restructure: the Reviewer pass

- After the implementer's last successful validation, before the operator can commit, run a `MissionReviewerPass` station.
- The reviewer agent gets the diff, the validation summary, the proof artifacts, and the YouTrack AC.
- It produces a structured review: `{ blockers: [], suggestions: [], approvals: [] }`.
- Blockers gate the commit (operator can override with a free-text justification, recorded as an event).
- Suggestions surface inline in the diff view; operator can accept or reject each.
- Reviewer outcomes feed the learning loop: "the reviewer flagged X, the operator agreed N/M times" tunes the reviewer's pickiness over time.

Phase 13 of the plan ships this. Adds one model call per mission; saves one human-noticed bug per N missions.

---

## 9. Cross-cutting: scheduler, fleet view, templates, knowledge sharing

A handful of items don't fit in any one theme but matter:

- **Mission scheduler with concurrency cap** — today there is no global limit on in-flight missions; resource exhaustion is real on a busy day.
- **Fleet view** — the renderer shows one mission at a time; there is no at-a-glance dashboard of all active missions and their phase + health.
- **Mission templates** — pre-baked `(classification, proofRules, validationProfiles, briefings)` bundles, one-click pickup.
- **Cross-instance intelligence sharing** — JSON export/import is queued (deferred plan B.3); a sync surface to a shared store would let multiple Spira instances pool learning. Out of scope for this plan; flagged here.

Phase 14 (an opportunistic catch-all, not in the main sequence) covers these.

---

## 10. What this report does **not** propose

To keep scope honest:

- **Not a state-machine rewrite.** The phase model is right.
- **Not a persistence-schema overhaul.** Additive tables (`mission_inbox`, `workspace_snapshots`, `mission_port_reservations`, `prompt_versions`, `model_outcomes`, `mission_costs`, `reviewer_decisions`) are all additive.
- **Not a renderer redesign.** Mission Inbox and Fleet View land as new rooms inside the existing Mission surface; the [ui-living-airship-redesign.md](../plans/ui-living-airship-redesign.md) handles aesthetics independently.
- **Not a change to the provider escalation ladder.** Covered by [model-escalation-architecture.md](../plans/model-escalation-architecture.md). Phase 11's model-selection-per-classification *complements* but does not replace it.
- **Not new MCP servers** unless a single new one is the cleanest delivery path for the YouTrack inbox sync.

---

## 11. Recommended priority — top three

If only three changes ship from this report, do these:

1. **Phase 10 — Evidence chain proof.** Highest single quality investment. Turns proof from receipts into a chain of evidence the PR carries with it. Composes best with the existing proof preflight + proportionality. (Targets: video, before/after, network capture, AC cross-check, signed bundle.)
2. **Phase 11 — Prompt + model evolution + cost telemetry.** Closes the only loop the system *can't* close today. Prompts get versioned, models get auto-selected per classification, costs get tracked, failures get fed back. Cost telemetry alone pays for itself in the first week.
3. **Phase 8 — Mission inbox.** Shortest operator path from "I should work on this" to "Spira is working on it." Removes the YouTrack tab-switch tax and the "did I already start this?" doubt.

If only **one** ships, do **Phase 10**. The PR-carries-evidence story is the single highest-leverage upgrade to the trust handover.

---

## 12. Sequencing

The companion plan ships these in independent phases, in the order the user-felt benefit accrues fastest:

| Phase | Theme | Headline win |
| --- | --- | --- |
| 8 | Mission inbox | Operator picks tickets one click instead of a tab-switch |
| 9 | Workspace 2.0 | Cold-start 5-10× faster on re-pickups |
| 10 | Evidence-chain proof | PRs carry signed proof bundles |
| 11 | Prompt + model evolution + cost | The agent improves itself, with a budget |
| 12 | Commit & PR ceremony | Trust handover reads as a confidence statement |
| 13 | Reviewer agent | Second-pair review every mission, automatically |
| 14 | Scheduler + fleet view + templates | Opportunistic; bundle as items become felt |

Phases 8 and 11 are independent of everything else and can ship in parallel. Phase 9 enables Phase 10's video capture (snapshot space). Phase 12 is best after Phase 10 (so the PR has a bundle to link). Phase 13 is best after Phase 12 (so the reviewer can read the operator-facing context).

---

## 13. Final assessment

The mission system today is **correct, observable, learning, and proportional**. The seven-phase overhaul did the hard structural work; the follow-ups closed the dedup tail; the deferred plan parks the volume-driven work behind real measurements.

What's left is a different category of upgrade: **promote the operator from typist to commander, the workspace from side-effect to artefact, proof from receipts to evidence, the agent from caller to evolver, the commit from click to handover, and the implementer from sole author to first author with a built-in reviewer.**

Six themes, six phases, none destructive. Pick the three that resonate and ship. The fourth and fifth will follow naturally once the first three change what the operator notices each day.

The report under [reports/mission-workflow-review-2026-05-09.md](mission-workflow-review-2026-05-09.md) closed by saying the system was *correct, slow, and quiet*. Today it is *correct, fast, and articulate*. The next horizon makes it **proactive, evidential, and self-evolving** — and at that point the assistant that was helping the user becomes the assistant that is teaching itself to help better.
