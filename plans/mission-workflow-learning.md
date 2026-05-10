# Mission workflow — visible learning

**Parent plans:**
- [mission-workflow-overhaul.md](./mission-workflow-overhaul.md) — phases 0–7, shipped 2026-05-09 / 2026-05-10.
- [mission-workflow-followups.md](./mission-workflow-followups.md) — batches A/B/C/D/E, shipped 2026-05-10.
- [mission-workflow-deferred.md](./mission-workflow-deferred.md) — batches F/G/H/I, drafted 2026-05-10.

**Status:** drafted 2026-05-10 after operator-side review of mission LA-2692. **All four batches (J/K/L/M) shipped 2026-05-10.**

## Goal

The learning loop ships and works, but is invisible to the operator at early-corpus scale. LA-2692 produced zero promotions because the auto-promotion thresholds (3 briefings / 4 examples / 6 pitfalls / 5 distinct missions per validation_profile) require a corpus the project doesn't have yet. The operator sees nothing learned and nothing applied.

The fix is a model shift: **always surface, sometimes auto-accept.** Every closed mission's observations get surfaced for one-click review at the moment of close; thresholds only gate the *silent* auto-promotion path. Per-repo profiles handle the multi-build-target reality (e.g. LA's admin repo is .NET + Angular). A per-mission "guidance applied" surface closes the loop by showing which learned entries actually shaped the prompt.

## Operating principles

- **Surface every observation. Auto-accept the safe ones.** Threshold logic stays unchanged for the auto path; it stops gating the visibility path entirely.
- **Close-screen surfaces are non-blocking.** The mission closes regardless of whether the operator engages with the learning panel. Blocking turns the panel into a quasi-stage we argued against.
- **The operator can opt into automation per-project.** A "trust the learner" toggle skips the close-screen panel for projects where review fatigue outweighs review value.
- **Per-repo, not just per-project.** The data model already keys validation profiles on `(project_key, repo_relative_path)`. Repo profiles get the same treatment.

---

## Batch J — Schema fixes

### J.1 Dedup the orphaned `Spira` repo profile row

The E.4 rename of `BUILTIN_REPO_PROFILES` from `"Spira"` to `"SPI"` left the original `"Spira"` row in the live DB because the seeder only inserts new builtins; it doesn't remove orphans. Two rows now represent the same workspace, and any join on `projectKey` silently drops one.

**Action.**
- One-line addition to `seedBuiltinRepoProfiles`: at the start of the transaction, delete every `repo_profiles` row where `source = 'builtin'` and `project_key NOT IN (currently-seeded keys)`.
- v34 migration runs a one-time `DELETE FROM repo_profiles WHERE source = 'builtin' AND project_key NOT IN (SELECT ...)` for safety in case operators don't re-seed promptly.
- Test: seed twice with different builtin sets; assert orphans are gone.

**Definition of done:** the live DB has exactly one builtin row per `BUILTIN_REPO_PROFILES` entry; user-edited rows are untouched.

### J.2 Repo profiles keyed on `(project_key, repo_relative_path)`

`repo_profiles` is currently keyed on `project_key` alone. Multi-repo projects (LA → admin + services, BILLS → website + services) need per-repo defaults: admin needs node + .NET SDKs, services needs .NET only. Today both inherit one profile row.

**Action.**
- v35 migration: rebuild `repo_profiles` with composite primary key `(project_key, repo_relative_path)` where `repo_relative_path = ''` (empty string, not NULL) means "project-wide default."
- `getRepoProfile(projectKey, repoRelativePath)` looks up exact match first, falls back to project-wide default.
- Repo-guidance prompt section composes from both: project-wide defaults first, per-repo overrides appended.
- `RepoProfilesEditor` lists rows grouped by project, with project-wide on top and per-repo entries indented underneath.
- JSON export/import round-trips both rows.

**Definition of done:** LA can have one project-wide row plus a per-repo row for `legapp_legapp-admin` carrying the Angular+.NET SDK list, and the prompt's Repo guidance section reflects both.

### J.3 Validation profiles for "any project, this repo"

`validation_profiles(project_key, repo_relative_path)` currently treats `project_key = NULL` as "applies to every project globally." That's too broad. Shared repos (legapp_legapp-services participates in LA, BILLS, LH) need a third state: "applies to any project that includes this repo, regardless of which one triggered the mission."

**Action.**
- Introduce a new column `validation_profiles.scope` with values `"global"` (current null), `"project"` (current key set), `"shared-repo"` (any project mapping this repo).
- v36 migration backfills `scope` from the existing nullability: NULL → `"global"`, non-NULL → `"project"`.
- New `scope = "shared-repo"` rows match a mission's `(projectKey, repoRelativePath)` only if the repo appears in `project_repo_mappings` for that project.
- `ValidationProfilesEditor` exposes the scope as a 3-way select.

**Definition of done:** one `dotnet test` validation profile registered as `shared-repo` against `legapp_legapp-services` matches missions in LA, BILLS, and LH without three duplicated rows.

### J.4 Prompt-injection provenance event

The prompt builder injects the `## Repo guidance` section but doesn't record which entries it pulled. Without this, surface L.1 (in-mission guidance-applied panel) has nothing to show.

**Action.**
- New `MissionEventType`: `repo-guidance-injected` with metadata `{ repoIntelligenceEntryIds: string[]; validationProfileIds: string[]; repoProfileKeys: { projectKey: string; repoRelativePath: string }[]; sectionLength: number }`.
- `buildRepoGuidanceSection` returns the rendered string AND the provenance object; caller emits the event once per attempt.
- Test: assert the event fires once per attempt with the actual entry ids.

**Definition of done:** every mission that gets a Repo guidance section has exactly one `repo-guidance-injected` event per attempt with the full provenance.

---

## Batch K — Close-screen learning panel (visible learning)

### K.1 Backend: assemble a per-mission learning summary at close

After the existing close-path observers run (`observeValidationProfileCandidates`, `runLearnedCandidatePromotionSweep`), assemble a single summary object describing what was *proposed* this run, what was *auto-promoted* this run, and what remains *pending review* for this project.

**Action.**
- New method on `TicketRunService`: `getMissionLearningSummary(runId): MissionLearningSummary`.
- Shape:
  ```ts
  interface MissionLearningSummary {
    runId: string;
    autoPromoted: PromotionRecord[];
    proposed: ProposalRecord[]; // below threshold; awaiting manual accept
    bootstrapProfile: RepoProfileDraft | null; // when projectKey has no profile yet
    bootstrapValidationProfiles: ValidationProfileDraft[]; // first-mission seeds
  }
  ```
- New protocol message `missions:ticket-run:learning-summary:get` returning the summary.
- Cached on the run record so repeated reads don't re-query.

**Definition of done:** for any closed run, the summary returns ≥0 proposed entries (everything `observeValidationProfileCandidates` would have skipped due to sub-threshold count) and ≥0 auto-promoted entries (everything that *did* clear threshold).

### K.2 Backend: one-click promote endpoint

The operator's "accept" button needs to bypass the auto-promotion threshold and promote a candidate immediately, with provenance attribution that distinguishes *manual* accept from *automatic* accept.

**Action.**
- New protocol message `missions:learning:promote-candidate` with payload `{ candidateId, type: "validation-profile" | "repo-intelligence" | "repo-profile" }`.
- Backend handler reuses the existing `upsertValidationProfile` / `upsertRepoIntelligence` / `upsertRepoProfile` paths but with `source: "learned-manual"` (new enum value) so manual accepts are distinguishable from auto-promotions in the audit feed.
- v37 migration extends the source enum on each table.
- Mission event `learned-candidate-promoted` gains `metadata.acceptanceMode: "automatic" | "manual"` so the IntelligenceAuditEditor can render the distinction.

**Definition of done:** an operator click on a sub-threshold candidate promotes it without changing the threshold, and the audit feed shows the manual provenance.

### K.3 Renderer: close-screen learning panel

When the operator clicks Complete on a clean-pass / pass-with-friction mission, render an inline panel below the close confirmation. Layout:

> **Spira learned from this mission**
> - ✅ **Auto-promoted (3)** — `dotnet build LegApp.Admin.sln` (validation, 5/5 confirming missions)
> - 📋 **Awaiting your nod (4)** — each with a one-click `Accept` and `Skip for now`
> - 🆕 **No profile for project LA yet** — proposed defaults [Accept all] [Review individually]
>
> *[Accept all proposals] [Review individually] [Skip — review later in Settings]*

The panel is non-blocking: the mission closes regardless. Skipped items remain pending in the existing LearnedCandidatesEditor for later review.

**Action.**
- New component `MissionCloseLearningPanel.tsx` slotted into the mission close confirmation flow.
- Reads the summary via the new electron-api method.
- Promote button calls `missions:learning:promote-candidate` per item or via a batch variant.
- Skip records `learned-candidate-skipped` so we know the operator looked at it (separate from "haven't seen yet").

**Definition of done:** every clean-pass / pass-with-friction close in a project under-corpus surfaces the panel; the operator's accept flows persist; the mission closes whether or not the operator engages.

### K.4 First-mission profile bootstrap

Folded into K.1 / K.3: when a closed mission runs in a project with no `repo_profiles` row, the summary includes a `bootstrapProfile` draft assembled from observed shell commands + impacted repo paths. The close panel renders it as a "🆕 No profile for project X yet" section.

**Action.**
- Draft assembly logic in a new `bootstrap-profile-draft.ts` module: takes the closed run + its mission events, returns a `RepoProfileDraft` with best-guess `defaultBranch` (from git), `defaultBuildWorkingDirectory` (from successful shell command cwds), `requiredSdks` (inferred from `dotnet --version`, `node --version`, `pnpm --version` observations the warming step records).
- Same module assembles `bootstrapValidationProfiles` from the run's `attempt-shell-command` events that exited with `status: passed`.
- One-click accept persists both the profile draft and the validation profiles in a single transaction (depends on F.1 from the deferred plan).

**Definition of done:** mission #1 in a brand-new project produces a draft profile + draft validations; one click saves them all.

---

## Batch L — Visible usage (guidance-applied panel)

### L.1 Mission detail view: "Guidance applied" collapsible

A collapsible section on `MissionDetailsRoom` titled "Spira used X learned entries to brief this mission." Listed under the section: the actual entries injected into the prompt (title, source, confidence band, link to LearnedCandidatesEditor row).

**Action.**
- Component `MissionGuidanceAppliedPanel.tsx` reads the `repo-guidance-injected` event from the run's mission timeline.
- Lists each `repoIntelligenceEntryId` (resolved to title + type + confidence band) and each `validationProfileId` (resolved to label + kind).
- Empty state: "Spira didn't use any learned guidance for this mission" — informative, not error.
- Slotted between the existing `RepoProfileOnboardingBanner` and `NowPlayingStrip`.

**Definition of done:** the panel renders for every mission attempt that fired `repo-guidance-injected`; entries link to their full record in the audit / learned-candidates surfaces.

### L.2 Audit feed: which missions used each entry

The IntelligenceAuditEditor lists promotion / revocation events. Extend it to also surface, per entry, *which missions consulted it.*

**Action.**
- New method `listRepoIntelligenceUsage(entryId): { runId; ticketId; occurredAt }[]` reading from `mission_events WHERE event_type = 'repo-guidance-injected'` and JSON-extracting `metadata.repoIntelligenceEntryIds`.
- Extend the audit row: a "Used by N missions" badge that expands to the list.

**Definition of done:** clicking an audit entry shows every mission that pulled it into a prompt — closing the loop on "is this learned thing actually doing anything."

---

## Batch M — Operator automation preference

### M.1 Per-project "trust the learner" toggle

Once a project has matured (operator has accepted enough, no recent revocations), the close-screen panel becomes review fatigue. A per-project toggle skips the panel and lets sub-threshold candidates auto-promote without review.

**Action.**
- New column `repo_profiles.trustLearnerMode: "manual-review" | "auto-accept-below-threshold"` (default `"manual-review"`).
- Close-screen panel reads the mode and either renders normally or shows a single-line summary "Spira learned 4 things and auto-applied them — review in Settings."
- When set to `auto-accept-below-threshold`, the close path silently promotes everything that would have been surfaced.

**Definition of done:** flipping the toggle on a project causes subsequent closes to skip the panel and silently apply learnings; operator can flip back at any time.

### M.2 Per-project "pause learning" toggle

Inverse of M.1: when a project is in flux (active refactor, deprecation), the operator may want to stop *all* learning observation entirely so the corpus doesn't get polluted.

**Action.**
- Second mode value `"paused"`. When set, close-path observers skip the project entirely.
- Close-screen panel renders a one-liner banner explaining learning is paused with a flip-back button.

**Definition of done:** flipping to paused stops accumulating candidates for that project; flipping back resumes.

---

## Sequencing recommendation

If we ship in this order, each batch unblocks the next:

1. **Batch J (schema fixes)** — J.1 first (data integrity), then J.2/J.3/J.4 in any order. J.4 is required before L starts.
2. **Batch K (close-screen panel)** — depends on J.4 (provenance event) for the audit-feed link, and on F.1 from the deferred plan for the bootstrap-accept transaction.
3. **Batch L (guidance-applied panel)** — depends on J.4. Can ship in parallel with K once J is in.
4. **Batch M (operator preferences)** — small. Ship last; it's polish on top of K.

If only one batch ships, do **K**: it's the highest-impact visibility win and makes the existing learning loop legible.

---

## Definition of done (whole plan)

A batch is done when:

1. Every action item in the batch has shipped behind the existing `autoPromoteLearnedCandidates` + `autoPromoteValidationProfiles` flags.
2. The duplicate-Spira-profile bug is fixed in the seed AND the migration; live DBs converge to one row per builtin.
3. The close-screen panel renders for every clean-pass / pass-with-friction close in a project where `trustLearnerMode = "manual-review"`.
4. The guidance-applied panel renders for every mission attempt that injected a Repo guidance section.
5. Tests cover: bootstrap draft for empty-project case, manual promotion bypassing threshold, `trustLearnerMode` toggle skipping the panel, `repo-guidance-injected` provenance round-trip.

---

## Out of scope

- Multi-build-target abstraction inside a single repo (Angular-in-.NET case). Already handled by multiple validation_profiles with different `working_directory` values.
- The 24-minute attempt-retry gap observed in LA-2692. That's an attempt-restart latency problem, not a learning problem; needs its own investigation.
- Any change to the auto-promotion confidence formula or threshold values. Threshold semantics shift (auto-accept gate, not visibility gate); the values themselves don't change.
- Any change to the renderer's visual identity.
- A "learning stage" gating the workflow. Learning remains a post-close observer; the close-screen panel surfaces it without gating.
