# Mission Workflow Review — 2026-05-09

**Reviewer:** end-to-end audit of the mission pickup → review handoff loop.
**Scope:** [packages/backend/src/missions](../packages/backend/src/missions), [packages/memory-db/src/database](../packages/memory-db/src/database) (mission tables), [packages/renderer/src/components/missions](../packages/renderer/src/components/missions), and the supporting WorkSession/StationRegistry plumbing.
**Companion plan:** [mission-workflow-overhaul.md](../plans/mission-workflow-overhaul.md).
**Anchored in:** the LH-201 and LH-402 post-mortems ([reports/LH-201-mission-run-postmortem.md](LH-201-mission-run-postmortem.md), [reports/LH-402-mission-duration-postmortem-2026-04-27.md](LH-402-mission-duration-postmortem-2026-04-27.md)) and the model-escalation slice plan ([plans/model-escalation-architecture.md](../plans/model-escalation-architecture.md)).

---

## 1. Executive verdict

The mission idea is sound. The state machine (`classification → plan → implement → validate → proof → summarize`) is the right shape, the workflow guard is doing real work, and the persistence layer is rich enough to support far more than it currently exposes. The friction is concentrated in three places:

1. **Visibility is thin in the middle.** We can see *what phase* a mission is in, and we can see the timeline of phase transitions, but we cannot see *what the agent is doing right now* — the active tool call, the current prompt, the current cost burn, the in-flight validation command, the proof's stdout. When a pass takes 19 minutes, the user has nothing to look at except a spinner.
2. **The system has no proof preflight, no proportionality controller, and only one concrete proof recipe.** [proof-registry.ts:79](../packages/backend/src/missions/proof-registry.ts:79) hardcodes the LegApp Admin Playwright/NUnit profile — every other repo silently returns zero profiles. Combined with the absence of a "can this run *now*" check, this is the single largest time-leak in the workflow (LH-402 lost 54 of its 91 minutes here).
3. **Intelligence is write-once, human-gated, and unindexed.** [intelligence.ts:50](../packages/memory-db/src/database/intelligence.ts:50) does a `SELECT *` then filters in JS for every read. Learning only fires on clean wins ([mission-intelligence.ts:264](../packages/backend/src/missions/mission-intelligence.ts:264)) — failures, retries, and partial successes contribute nothing. There is no per-repo `CLAUDE.md` / playbook, so each fresh pickup re-derives knowledge the system has already paid to learn.

The good news is that the bones of the fix already exist: `mission_events` is an append-only timeline, `repo_intelligence_entries` has the right schema, the WorkSession state machine carries durable phase state, and the EventBus is the clean place to hang real-time visibility on. The work is mostly *exposing* and *enriching* what we already capture, plus building the proof- and dependency-side infrastructure that's currently missing entirely.

The plan in [mission-workflow-overhaul.md](../plans/mission-workflow-overhaul.md) ships this in **seven independent phases**, each leaving the system shippable. Phases 1 (telemetry + visibility) and 2 (proof proportionality + preflight) cover ~70% of the felt improvement.

---

## 2. The workflow as it stands today

### 2.1 Lifecycle entry

A run begins at [`startRun()` in ticket-runs.ts:263](../packages/backend/src/missions/ticket-runs.ts:263) (creates the run row, sets `status="starting" → "ready"`, validates worktrees), is launched by [`startWork()` at ticket-runs.ts:546](../packages/backend/src/missions/ticket-runs.ts:546) (transitions to `status="working"`, `missionPhase="classification"`, fires the first mission pass), and on each subsequent user-driven continuation goes through [`continueWork()` at ticket-runs.ts:563](../packages/backend/src/missions/ticket-runs.ts:563).

A pass delegates to a subagent station via the injected `options.launchMissionPass` callback, which builds prompts via `buildInitialPrompt()` / `buildContinuationPrompt()` ([ticket-runs.ts:1731](../packages/backend/src/missions/ticket-runs.ts:1731)) and bundles the mission station instructions from [`buildMissionStationInstructions` in index.ts:220](../packages/backend/src/index.ts:220).

The state machine is enforced by `MissionWorkflowState` and `assertMissionWorkflowActionAllowed` ([mission-workflow-guard.ts:24](../packages/backend/src/missions/mission-workflow-guard.ts:24)). The phase order is fixed in [shared/src/ticket-run-types.ts:24](../packages/shared/src/ticket-run-types.ts:24).

### 2.2 Persistence (already strong)

Mission persistence is far better than most of the workflow uses. The schema covers:

| Table | Role |
| --- | --- |
| `ticket_runs` | One row per mission. Carries `mission_phase`, `classification_json`, `plan_json`, `summary_json`, `proof_status`, `last_proof_run_id`, `last_proof_summary`. |
| `mission_events` | Append-only timeline keyed by `runId` + `attemptId` with `stage`, `eventType`, `metadata_json`, `occurred_at`. |
| `ticket_run_attempts` | Per-pass row. `prompt`, `summary`, `started_at`, `completed_at`, `sequence`, `status`. |
| `ticket_run_validations` | `kind` (`build` / `unit-test` / `lint` / `typecheck`), `status`, `attempted_at`, `completed_at`. |
| `ticket_run_proof_runs` | `profile_id`, `status`, `exit_code`, `artifacts`. |
| `validation_profiles` | Per-repo command catalog (currently only seeded with builtin pnpm/lint/test/typecheck). |
| `proof_rules` | Per-repo rule for advisory proof level. |
| `proof_decisions` | Per-run persisted advisory decision. |
| `repo_intelligence_entries` | Per-repo briefings / pitfalls / examples (`source` ∈ `builtin` / `user` / `learned`). |

Everything you'd want to display, audit, or learn from is already being recorded. The problem is the read path and the surfacing.

### 2.3 What surfaces to the user today

- Phase chip + subtitle in [`MissionDetailsRoom.tsx` (PHASE_DETAILS at line 24)](../packages/renderer/src/components/missions/rooms/MissionDetailsRoom.tsx).
- Timeline (one line per `mission_event`) via `describeTimelineEvent` at line 66.
- Validation/proof job status in `MissionProcessesRoom`.
- Diff + untracked files in `MissionChangesRoom`.
- Manual approval buttons in `MissionActionsRoom`.

Live updates are pushed by `emitSnapshot()` ([ticket-runs.ts:3097](../packages/backend/src/missions/ticket-runs.ts:3097)) → `bus.emit("missions:runs-changed", { runs })`. The renderer subscribes and rerenders. There is no per-event push — every update is a full snapshot replay.

---

## 3. Visibility — what's it doing when?

### 3.1 The "current action" gap

The mission UI knows the *phase* but not the *action*. Inside the implement phase a pass can take 18-25 minutes (LH-402 stage 3); during that window the only feedback is a phase chip. We do not show:

- The active tool call (what file is being read, what command is being spawned).
- The current cost / token burn / model variant.
- The pass's running stdout (the agent's own scratch reasoning, when available).
- The number of files touched so far in this attempt.
- The number of validations attempted vs. passed in this pass.
- The "permission requested" overlay (we have it for the prompt, but no overall mission-level "this run is paused on permission").

Because the pass runs in a separate station and emits its own provider events, those signals are *technically available* — but the mission UI doesn't subscribe to them and the timeline only records phase-grain events.

### 3.2 The proof/validation black box

`runMissionProof` ([proof-runner.ts:142](../packages/backend/src/missions/proof-runner.ts:142)) writes `stdout.log` and `stderr.log` to disk, plus a `summary.json`, and returns artifacts. But the UI never opens those — it only displays the summary string. When a proof fails, the user has to find the artifact path on disk to see why.

Validation is worse: validation runs are recorded as outcomes but the *command* and the *output* are not. We know "build failed" but not which command failed, where, or what stderr said. The post-mortems both note this ("the workflow treated proof as mandatory and blocking" — LH-402 §4).

### 3.3 Post-mortems are 100% manual

[reports/LH-201](LH-201-mission-run-postmortem.md), [reports/LH-402](LH-402-mission-duration-postmortem-2026-04-27.md), and the UI redesign audit are all handwritten markdown. The data needed to seed an automated post-mortem is already in `mission_events`: phase enter/exit timestamps, attempt count, validation pass/fail history, proof run outcome, total elapsed time. We are not extracting any of it.

LH-402 is itself a worked example of what an auto post-mortem should produce: a per-stage timing table, a "what took long" interpretation, and a "what would make this easier next time" punch list. Every closed mission should produce a stub of this format automatically.

### 3.4 Telemetry schema is impressionistic

The `mission_events.metadata_json` payloads vary per call site (`proofRunId`, `profileId`, `exitCode`, `artifacts`, `repoGuidanceCount`, etc.). There is no schema, no validator, and no enum of `eventType` values — they are string literals at the call site (`"attempt-started"`, `"proof-finished"`, `"workspace-prepared"`, `"repo-intelligence-candidate-approved"`, etc.). This makes any analytics or post-mortem generator brittle from the outset.

---

## 4. Quality — does the system know enough?

### 4.1 Repo understanding is shallow and write-only

The system carries [`repo_intelligence_entries`](../packages/memory-db/src/database/intelligence.ts:50) but:

- It is seeded with only the **Spira repo's own** briefings ([mission-intelligence.ts:326](../packages/backend/src/missions/mission-intelligence.ts:326)). Target repos (LegApp Entry, LegApp Admin, the various LH-* services) have no builtin entries.
- Learned candidates only fire on **clean wins** ([`isCleanMissionForLearning` at mission-intelligence.ts:264](../packages/backend/src/missions/mission-intelligence.ts:264)). Failed runs, recovered runs, partial validations, and waived proofs all contribute zero learning.
- Candidates are auto-tagged `approved=false` and require a human to approve them through the UI before they're used. There is no "shadow" or "auto-promote-after-N-uses" path.
- There is no negative learning — if a proof recipe burns 50 minutes and fails, there is no record that says "don't try this again for this ticket pattern."
- There is no per-repo profile record at all — no display name, no default working directory, no registry hint, no required-SDK metadata. Every mission re-derives that context from scratch. (We deliberately *don't* want to ship per-repo files into target repos — those repos shouldn't have to know Spira exists. The fix lives DB-side; see Phase 3 of the companion plan.)

### 4.2 Validation profile catalog is sparse

The `validation_profiles` table is the right shape but only seeded for Spira itself ([mission-intelligence.ts:374](../packages/backend/src/missions/mission-intelligence.ts:374)). LH-201 spent measurable time discovering that LegApp Entry is `npm ci --registry https://npm.parliament.uk` from `LegApp.Entry.UI/ClientApp` — a fact the system could and should have known.

There is no notion of *prerequisites* (does the registry need to be configured? does the repo need a specific .NET SDK? is there an env var the harness needs?). LH-402's recommendation §C ("validation profile registry per repo") is the right shape.

### 4.3 Proof selection is a hardcoded recipe + scoring on too little data

[`discoverMissionProofProfiles` at proof-registry.ts:79](../packages/backend/src/missions/proof-registry.ts:79) only knows how to detect the LegApp Admin UI Playwright/NUnit harness — every other repo gets an empty profile list, which forces the advisory decision into `"blocked"` for any UI ticket outside Admin.

`computeAdvisoryProofDecision` ([mission-intelligence.ts:145](../packages/backend/src/missions/mission-intelligence.ts:145)) is the right idea, but the inputs it scores against are: classification kind, repo path, ui-change/proof-required booleans, and summary keywords. It does not consider:

- Diff size or shape (a 5-line copy-only diff has very different proof needs than a 200-line refactor).
- Test coverage in the touched files.
- Historical proof outcomes for this repo / this ticket pattern.
- Whether the proof harness is *currently runnable* (no preflight — see §5.2).

There is no proof level "auto-waive-if-trivial" path. There is no manual-review-only first-class state that can satisfy the gate without trying to spin up Playwright.

### 4.4 No learning from this run, ever

A mission generates an enormous amount of decision-relevant data — what files were touched, which validation commands worked, which keyword/path combinations corresponded to which proof needs, how long each phase took. The schema captures most of it. Nothing reads it back. There is no batch job, no end-of-mission learning step, no cross-mission summarisation. Every mission starts from the same builtin seeds.

---

## 5. Performance — where time goes

### 5.1 Snapshot emission is O(all-runs) per event

`emitSnapshot()` calls `getTicketRunSnapshot()` ([missions.ts:1218](../packages/memory-db/src/database/missions.ts:1218)), which calls `listTicketRuns()` (every run, every attempt, every worktree). This is invoked at least 30+ times per mission (search `getTicketRunSnapshot` in [ticket-runs.ts](../packages/backend/src/missions/ticket-runs.ts)). After a few months of mission history this becomes the dominant per-event cost on the renderer side. There is no delta encoding and no per-run subscription.

### 5.2 No proof preflight — the LH-402 root cause

`runMissionProof` ([proof-runner.ts:170](../packages/backend/src/missions/proof-runner.ts:170)) spawns the proof command directly with a 20-minute timeout and waits. There is no:

- Check that the harness binary (`dotnet`, `pnpm`) is on the PATH.
- Check that the project is restored / dependencies installed.
- Check that the bypass auth or test fixtures exist.
- Check that a UI server is up if the harness needs one.
- Check that the renderer or backend isn't currently using port 9720 / etc.
- Permission preflight for any tool the harness needs.

The result is what LH-402 documented: a 54-minute proof attempt that never had any chance of succeeding. The smallest useful preflight is a 5-15 second readiness probe; the cost of *not* having it is unbounded.

### 5.3 No dependency warming

Search across [packages/backend/src/missions](../packages/backend/src/missions) for `pnpm install`, `npm ci`, `dotnet restore` returns no hits — these run only as a side-effect of validation/proof commands. Worktrees are created cold, and the first validation pays the full restore cost. For a Node + .NET monorepo this is 2-5 minutes per worktree per fresh checkout, on top of every actual build.

### 5.4 DB hot paths are full table scans

Three intelligence reads — `listRepoIntelligence` ([intelligence.ts:50](../packages/memory-db/src/database/intelligence.ts:50)), `listValidationProfiles` ([intelligence.ts:231](../packages/memory-db/src/database/intelligence.ts:231)), `listProofRules` ([intelligence.ts:398](../packages/memory-db/src/database/intelligence.ts:398)) — all do `SELECT *` then `.filter()` in JS. Today's volumes make this fast; six months from now with thousands of learned entries it will not be. There are no indices on `project_key`, `repo_relative_path`, or `tags`.

### 5.5 Worktree validation isn't cached across attempts

Each call into `continueWork()` re-runs `git rev-parse --git-dir` against existing worktrees ([ticket-runs.ts:1802](../packages/backend/src/missions/ticket-runs.ts:1802)). For a multi-repo mission this is a few seconds per attempt — not catastrophic, but representative of the pattern.

### 5.6 Proof discovery walks every worktree on every run

`discoverMissionProofProfiles` runs at every run-snapshot rebuild and walks every worktree, doing `access` and `readFile` calls per profile guess ([proof-registry.ts:79](../packages/backend/src/missions/proof-registry.ts:79)). Today that's bounded because there's only one recipe; the moment we add more (we will), this cost grows linearly without caching.

### 5.7 Mission station instructions are static and per-pass

`buildMissionStationInstructions` ([index.ts:220](../packages/backend/src/index.ts:220)) re-emits the same ~9-line guidance block on every pass. Not large, not expensive, but it bypasses any provider prompt-cache opportunity because the worktree paths embedded in the prompt vary per ticket. With Anthropic / OpenAI prompt caching, a stable prefix ordering would matter.

---

## 6. The UI side of the story

The mission UI in [MissionDetailsRoom.tsx](../packages/renderer/src/components/missions/rooms/MissionDetailsRoom.tsx) is correct but quiet. It tells the user what's happening at the *phase* grain. Three concrete adds would close most of the visibility gap:

1. **A live "current action" strip** under the phase chip: "Reading `LegApp.Entry.UI/ClientApp/src/app/...component.ts`" / "Running `npm run build`" / "Awaiting permission · pyrefly relay" / "Proof step 4 of 12 · login". This needs the implement-phase station to forward its tool-call events into `mission_events` (or a new transient channel).
2. **A first-class proof viewer** that opens stdout/stderr and the artifact tree inline, with a re-run button and a "show preflight" button. Today the proof artifacts live on disk and the UI just shows a status string.
3. **A timeline that groups by phase and shows duration** rather than a flat event list. Same data, different rendering — and the same surface that backs auto post-mortem generation.

The aux deck (`FlightLayer`) already visualises tool calls between rooms but is unused for missions; the same primitive could carry per-attempt activity into the mission view.

---

## 7. Crossover with Spira upgrades

You don't drive Spira itself through the mission system, but most of the proposed improvements transfer directly:

- **Repo intelligence + per-repo playbooks** — Spira has its own `CLAUDE.md`-shaped knowledge requirements (the WorkSession spine, the EventBus contract, the runtime config rules). Same loader, same surface.
- **Validation profile catalog** — Spira's pnpm scripts are the simplest possible profile set; making them first-class means the primary station can read them too.
- **Telemetry / event taxonomy** — WorkSession already emits phase events; a typed event taxonomy and a per-station timeline would give the primary station the same "what's it doing now" surface.
- **Auto post-mortem** — A Spira upgrade run that hits a stall can produce its own post-mortem stub (commit message draft, validation history, files touched). Same generator.
- **Dependency warming** — A Spira `pnpm install` is the same "warm me up" pattern as a mission-side warm.
- **Proof preflight** — Spira's "is the dev server up?" check and "are there pending permissions?" check are preflights of the same shape.

Building these as repo-agnostic primitives (everything keyed on `projectKey` + `repoRelativePath`) is what makes them dual-use. The plan structures them that way deliberately.

---

## 8. What this report **does not** propose

To keep scope honest:

- **Not a rewrite of the WorkSession state machine.** The phase model is correct.
- **Not a rewrite of the persistence schema.** Indices, a few tables, some new columns — but nothing destructive.
- **Not a change to the provider escalation ladder.** That's covered by [model-escalation-architecture.md](../plans/model-escalation-architecture.md).
- **Not a renderer redesign.** Visibility wins should land inside the existing Mission rooms; the Cloister Above redesign in [ui-living-airship-redesign.md](../plans/ui-living-airship-redesign.md) handles the aesthetic side independently.
- **Not new MCP servers** beyond what's needed for repo intelligence and proof preflight (one each, possibly bundled).

---

## 9. Recommended priority — top three

If only three changes ship, do these:

1. **Proof proportionality + preflight + first-class manual-review-only.** Closes LH-402's root cause; saves the largest single block of mission time; turns proof from a binary gate into a graded conversation. (Plan phases 2 + 5 ship the biggest pieces.)
2. **Live "current action" telemetry surface in the mission UI** + a typed `mission_events` taxonomy + auto post-mortem stub on close. Closes the visibility gap and produces the data needed for everything else. (Plan phase 1.)
3. **Per-repo intelligence v2 — DB-side repo profiles + a learning loop that fires on every mission close (success or failure).** Stops paying the discovery tax LH-201 documented; turns the mission system into something that gets faster the more it is used. Spira owns the knowledge; target repos are not asked to host it. (Plan phases 3 + 6.)

Phase 4 (DB indices, snapshot deltas, dependency warming) is the cheapest and least risky — it can ship in parallel with 1-3 and pays for itself within a few missions. Phase 7 is the Spira-side application of all of the above.

---

## 10. Final assessment

Today the mission system is **correct, slow, and quiet.** The state machine is right, the persistence is rich, and the UI is reliable. But it is more *ceremony* than *companion* — the user pickups a ticket, watches a phase chip, and gets an artifact-path string at the end. Every long-running pass feels like a black box, every retry pays the same discovery tax, and every closed mission's hard-won data evaporates instead of feeding the next one.

The fix is not a rewrite. It is to **light up what we already capture, gate what we currently bulldoze through, and feed back what we already throw away.** Proof preflight kills the biggest time-sink. A typed event timeline + auto post-mortem turns silence into a story. A per-repo playbook + a learning loop turns the system into something that compounds.

Do those three and the mission workflow stops feeling like a procedure and starts feeling like a partner. Then the same primitives become the foundation for Spira's own primary-station upgrade flow — at which point the assistant is improving the assistant.
