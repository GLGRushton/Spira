# LH-402 Mission Duration Postmortem

**Ticket:** LH-402  
**Summary:** Standardise UI terminology from request to submission  
**Mission run:** `44b4ae1a-81b7-4b8b-9ac0-c24079b98485`  
**Date:** 2026-04-27  
**Total elapsed time:** **91.66 minutes**

## Executive summary

This mission took longer than it should have.

The underlying implementation was modest: user-facing copy updates across a bounded set of entry-app UI surfaces, with care taken not to rename technical identifiers. That kind of mission should usually be a **short discovery + edit + validate** cycle.

Instead, the elapsed time was dominated by the **proof and late-stage workflow overhead**, not the code change itself.

The clearest evidence is the mission timeline:

| Stage | Timestamp | Minutes from start |
| --- | --- | ---: |
| Mission start | 2026-04-27 09:59:56 | 0.00 |
| Attempt opened | 2026-04-27 10:07:11 | 7.24 |
| Classification saved | 2026-04-27 10:07:53 | 7.94 |
| Plan saved | 2026-04-27 10:08:38 | 8.69 |
| Proof strategy saved | 2026-04-27 10:27:36 | 27.67 |
| Proof blocked/failed | 2026-04-27 11:21:35 | 81.64 |
| Validations recorded | 2026-04-27 11:28:48 | 88.87 |
| Proof waived | 2026-04-27 11:30:35 | 90.65 |
| Summary saved | 2026-04-27 11:31:36 | 91.66 |

The key intervals:

- **Start -> classification:** 7.94 min
- **Classification -> plan:** 0.75 min
- **Plan -> proof strategy:** 18.97 min
- **Proof strategy -> proof blocked:** 53.97 min
- **Proof blocked -> validations recorded:** 7.23 min
- **Validations recorded -> proof waived:** 1.79 min
- **Proof waived -> summary saved:** 1.01 min

### Bottom line

Your instinct was right, with one refinement:

- **Proof was the main time sink by a wide margin.**
- **Validation was slower than ideal, but not the primary culprit.**
- The true drag was the combined **validation/proof phase mechanics**, especially the proof requirement, proof orchestration, and the blocked proof run.

If this mission had been treated as a low-risk UI-copy change with streamlined validation and a lighter proof gate, it likely would have felt dramatically faster.

---

## Stage-by-stage analysis

## 1. Kickoff and orientation

**Window:** Mission start -> classification saved  
**Elapsed:** **7.94 min**  
**Did it take longer than it should?** **A little, yes.**

For a familiar repo and a narrowly scoped copy-change ticket, this stage should ideally be very short. Nearly eight minutes is not terrible, but it is more than ideal for a mission that ultimately touched one repo and a small set of UI strings.

### What happened here

- Mission context had to be loaded and interpreted.
- The repo scope had to be inferred correctly.
- The ticket required distinguishing **user-facing language** from **internal technical terminology**.
- Classification had to be persisted before planning could proceed.

### Self-scores

| Metric | Score | Notes |
| --- | ---: | --- |
| Problem framing | 8/10 | I identified the right scope: frontend, user-facing wording only. |
| Repo targeting | 8/10 | Correctly focused on `legapp_legapp-entry`. |
| Speed of orientation | 6/10 | Acceptable, but too slow for a bounded terminology change. |
| Risk recognition | 9/10 | Correctly avoided blind renaming of technical `request` usage. |
| Operational momentum | 6/10 | Safe, but not especially brisk. |

### What took long

- I had to establish whether the ticket meant **business copy only** or **broader renaming**, which is an important distinction in this codebase.
- There was no prebuilt repo cheat sheet telling me where user-facing terminology usually lives in this app.
- Mission workflow requires formal classification before moving on.

### What I could have done better

- I could have recognized even faster that this was a **copy-standardization** mission, not a structural refactor.
- I could have used a more aggressive search pattern early on to isolate only user-facing labels and constants.
- I could have framed the likely low-risk nature of the task sooner, which would have helped later decisions around proof proportionality.

### What would make this easier next time

- A **repo cheat sheet** for `legapp_legapp-entry` with:
  - main UI folders,
  - common constants files,
  - nav/view text locations,
  - known test projects for copy assertions.
- A small **“copy-change playbook”** in local memory or MCP describing:
  - what counts as user-facing text,
  - what must never be renamed,
  - standard search targets for this repo.
- A local MCP tool like `repo_guide.get_ui_surfaces(repo, topic)` that returns likely files for wording changes.

---

## 2. Planning and scope lock

**Window:** Classification saved -> plan saved  
**Elapsed:** **0.75 min**  
**Did it take longer than it should?** **No.**

This stage was efficient. Once the scope was clear, the plan was produced quickly and in the right shape.

### What happened here

- The plan established the correct sequence:
  1. audit visible wording,
  2. update UI text,
  3. update affected tests,
  4. validate and gather proof.

### Self-scores

| Metric | Score | Notes |
| --- | ---: | --- |
| Plan quality | 9/10 | The plan was sound and aligned to the ticket. |
| Scope discipline | 9/10 | Kept technical identifiers out of scope. |
| Speed | 9/10 | This moved promptly. |
| Practicality | 8/10 | Good structure, though proof was assumed rather than questioned. |

### What took long

- Very little. This was not a problem stage.

### What I could have done better

- I could have challenged the expected proof path earlier by noting that this looked like a low-risk terminology update.
- I treated the proof requirement as fixed rather than immediately exploring whether it should be scaled to the risk of the change.

### What would make this easier next time

- A **mission classification rule** that can flag tickets like this as:
  - `ui-copy-only`,
  - `low regression risk`,
  - `proof-light candidate`.
- A workflow hint such as: **“For copy-only UI changes, allow lighter proof or pre-approved waiver paths.”**

---

## 3. Discovery, editing, and implementation

**Window:** Plan saved -> proof strategy saved  
**Elapsed:** **18.97 min**  
**Did it take longer than it should?** **Slightly, but still reasonable.**

This was the core engineering stage: finding the relevant files, making precise edits, and updating affected assertions. Given the need to avoid renaming technical concepts accidentally, about nineteen minutes is defensible. It is not especially fast, but it is not the major source of delay.

### What happened here

- User-facing `request` terminology had to be separated from technical and route-level `request` usage.
- Multiple surfaces were updated:
  - Angular components and templates,
  - constants,
  - Razor views,
  - navigation,
  - at least one spec file.
- The implementation preserved technical identifiers while updating visible wording.

### Self-scores

| Metric | Score | Notes |
| --- | ---: | --- |
| Search precision | 8/10 | Good enough to avoid reckless renaming. |
| Edit accuracy | 8/10 | The final change set was coherent and targeted. |
| Cross-surface completeness | 8/10 | Covered multiple visible entry points, not just one string. |
| Speed | 7/10 | Reasonable, but a repo map could have made this faster. |
| Confidence management | 8/10 | Cautious in the right places. |

### What took long

- The repo contains multiple UI technologies and layers, so visible wording can live in more than one place.
- The word `request` is overloaded: some instances are business copy, some are technical semantics.
- I had to be careful not to turn a copy change into a noisy refactor.

### What I could have done better

- I could have used a more structured “visible text only” sweep from the start.
- I could have captured the changed surfaces into a quick scratch map earlier so the final pass was more mechanical.
- I could have parallelized some repo reading more aggressively at the very beginning of implementation.

### What would make this easier next time

- A **local searchable knowledge base** per repo containing:
  - high-value UI string locations,
  - common terminology files,
  - component-to-view mappings,
  - known tests coupled to labels.
- A small **code-intelligence MCP** that answers:
  - “where is this text shown to the user?”
  - “what tests assert this string?”
- A **UI copy inventory database** built from repo indexing.

---

## 4. Proof setup and proof attempt

**Window:** Proof strategy saved -> proof blocked/failed  
**Elapsed:** **53.97 min**  
**Did it take longer than it should?** **Yes. Massively.**

This was the stage that made the mission feel slow.

Almost **54 minutes** elapsed between proof strategy creation and the blocked proof outcome. That is the single largest contributor to the total mission duration by far. For this ticket, that is wildly out of proportion to the risk and complexity of the code change.

### What happened here

- A targeted UI proof strategy was prepared.
- The mission remained gated by proof expectations.
- Proof execution did not complete cleanly because **permission was denied before the proof profile could execute**.
- Time was therefore spent around a process that did not even yield the intended artifact.

### Self-scores

| Metric | Score | Notes |
| --- | ---: | --- |
| Proof strategy selection | 7/10 | The chosen proof path was defensible, but expensive for the ticket. |
| Proof execution efficiency | 2/10 | This was the weakest stage by far. |
| Friction handling | 4/10 | I eventually adapted, but too late. |
| User-time awareness | 5/10 | I should have recognized the disproportionate cost sooner. |
| Workflow pragmatism | 4/10 | I let the mission process dominate the mission. |

### What took long

- The proof requirement created a hard gate late in the mission.
- The proof path depended on infrastructure/permissions outside the code edit itself.
- The workflow treated proof as mandatory and blocking.
- A failed or blocked proof attempt still consumed mission time without increasing confidence.

### What I could have done better

- I should have escalated the mismatch sooner: **small copy change, large proof overhead**.
- I could have made the “proof cost vs. value” tradeoff explicit earlier.
- I could have presented a fallback path sooner, instead of letting the mission stay in a proof-shaped holding pattern.

### What would make this easier next time

- A **local proof controller MCP** with capabilities like:
  - preflight proof readiness,
  - permission diagnostics,
  - artifact path validation,
  - “can this proof run right now?” checks before committing to the workflow.
- A **proof waiver policy engine** for low-risk missions:
  - copy-only changes,
  - no logic change,
  - strong automated validation already passing.
- A **one-command targeted screenshot harness** that does not require a heavy or permission-fragile path.
- A local DB field for **proof proportionality guidance** by ticket type.

### My judgment

This stage took **far longer than it should have**, and it was the main reason the mission felt slow.

If I had to name one root cause, it would be this:

> **The mission workflow applied heavyweight proof expectations to a lightweight UI-copy change, and the proof path then failed operationally.**

That is an efficiency trap.

---

## 5. Validation and closeout

**Window:** Proof blocked/failed -> summary saved  
**Elapsed:** **10.02 min**  
**Did it take longer than it should?** **Somewhat, but not disastrously.**

This stage includes:

- validation records being captured,
- proof being explicitly waived,
- summary being saved.

The raw timing here is not awful, but it came **after** the expensive proof delay, which made it feel even heavier.

### Important nuance

The evidence suggests that **validation was not the main problem**. The mission records show validations being captured near the end, and they passed. The larger issue was that proof remained a gating concern around them.

So I would phrase it this way:

- **Validation itself:** slower than ideal, but manageable.
- **Validation + proof workflow as a bundle:** too slow.

### Self-scores

| Metric | Score | Notes |
| --- | ---: | --- |
| Validation selection | 8/10 | Build and tests were appropriate. |
| Validation efficiency | 6/10 | Fine, but not elegant in the context of the overall mission. |
| Closeout discipline | 8/10 | The mission was eventually closed correctly. |
| Workflow recovery | 7/10 | I recovered once you explicitly waived proof. |
| State observability | 5/10 | Mission state remained slightly confusing at the end. |

### What took long

- Validation happened in the shadow of the proof problem rather than as a clean, parallelized confirmation path.
- The mission state had a slight observability inconsistency: even after proof and summary were saved, some status text still looked stale while the workflow object said the mission was complete.

### What I could have done better

- I could have separated **confidence gathering** from **mission workflow bookkeeping** more clearly in my own handling.
- I could have driven faster to a practical end-state once the proof route was evidently obstructed.

### What would make this easier next time

- A **validation profile registry** per repo:
  - exact build command,
  - exact test command,
  - typical runtime,
  - confidence level contributed by each check.
- A **mission-state linter** that flags contradictory state such as:
  - `proofPassed = true`,
  - `summarySaved = true`,
  - but stale status text still claiming the workflow is incomplete.
- A simple rule:
  - if code is low risk,
  - if validation passes,
  - and if proof is blocked for operational reasons,
  - then the mission may auto-transition to **awaiting-review with waived proof**.

---

## Overall performance assessment

## What really made this mission long

Ordered from biggest factor to smallest:

1. **Proof gating and proof failure**
2. **Operational friction in late-stage mission workflow**
3. **Normal discovery/edit effort across multiple UI surfaces**
4. **Initial orientation overhead**
5. **Planning overhead** (minimal)

## My overall scores

| Dimension | Score | Notes |
| --- | ---: | --- |
| Scoping correctness | 8/10 | Good. |
| Editing accuracy | 8/10 | Good. |
| Search efficiency | 7/10 | Solid, not exceptional. |
| Validation efficiency | 6/10 | Acceptable, but could be tighter. |
| Proof efficiency | 2/10 | The biggest miss. |
| Workflow pragmatism | 5/10 | Too process-compliant for too long. |
| Time stewardship | 5/10 | I should have pushed harder against disproportional late-stage overhead. |
| Final mission hygiene | 8/10 | Closed out properly once the path was clear. |

## Overall verdict

I performed **well enough on the engineering work** and **poorly on proof efficiency**.

That distinction matters. The code task was under control; the mission process was not under equally good control.

---

## Concrete improvements to make me better next time

You said you have full control of the environment. Good. That means we can remove a lot of this drag on purpose.

## A. Repo intelligence and cheat sheets

Create a local repo knowledge layer for each active repository.

### Recommended contents

- key entry points,
- UI surface maps,
- common test commands,
- typical build commands,
- risky directories,
- where visible strings usually live,
- known route/view/component relationships,
- examples of previous similar tickets.

### Best form

One of:

1. a local SQLite knowledge DB,
2. a read-only MCP server over that DB,
3. a simple indexed JSON corpus with a query tool.

### High-value query examples

- “Where does user-facing navigation text live in `legapp_legapp-entry`?”
- “Which tests usually break when homepage wording changes?”
- “What files commonly control request/submission labels?”

This would materially improve orientation and implementation speed.

## B. Mission telemetry and timing

Right now, the mission state is useful but not perfect as an execution timeline.

### Improve it with

- stage enter/exit timestamps,
- per-command durations,
- wait reasons,
- proof-preflight result logging,
- validation start/finish timestamps that are internally consistent,
- explicit “blocked by permission” and “waiting for user decision” events.

### Why this matters

Without clean telemetry, postmortems become interpretive when they should be precise.

## C. Proof proportionality system

This is the highest-value improvement.

Build a local decision layer that classifies a mission into proof classes such as:

- `none`,
- `light`,
- `targeted-screenshot`,
- `full-ui-proof`,
- `manual-review-only`.

### Inputs

- file types changed,
- test results,
- whether logic changed,
- whether visuals changed,
- whether backend contracts changed,
- repo-specific risk rules.

### Example

For a mission that only changes strings in templates/constants/views and passes existing tests:

- recommend **light proof** or **waivable proof**,
- not a heavyweight proof workflow by default.

## D. Proof preflight MCP

Before committing to proof, I should be able to ask a local tool:

- Can the proof profile run?
- Are permissions available?
- Are required services running?
- Will artifacts be writable?
- Is a browser/session already prepared?

If the answer is no, we should know in **seconds**, not nearly an hour later.

## E. Validation profile catalog

Store a per-repo validation catalog with:

- preferred build command,
- preferred test command,
- expected runtime,
- confidence provided,
- prerequisites,
- common failure causes.

This reduces command selection overhead and helps me explain proportional validation choices.

## F. Reusable ticket-pattern memory

Create a local memory table for recurring mission patterns:

- copy-only UI changes,
- label swaps,
- navigation wording tickets,
- test-only tickets,
- config-only tickets.

For each pattern, record:

- best initial search,
- common files,
- suitable validation,
- default proof level,
- common pitfalls.

This turns repeated mission types into near-routine operations.

## G. Better end-state workflow logic

The final mission state still showed stale status text even though the workflow object indicated completion.

That should be cleaned up.

### Suggested fix

Add a mission-state reconciliation step that guarantees:

- if `proofPassed = true`,
- and `summarySaved = true`,
- and there is at least one passing validation,
- then the visible station status must also report completion cleanly.

That will make closeout less confusing and reduce operator hesitation.

---

## If we want to optimize for future speed, in priority order

1. **Implement proof proportionality rules**
2. **Add proof preflight checks**
3. **Create repo cheat sheets / repo knowledge MCP**
4. **Create validation profile catalogs**
5. **Improve mission telemetry**
6. **Add reusable ticket-pattern memory**
7. **Clean up mission completion state reconciliation**

If you do only the top three, missions like this should get noticeably faster.

---

## Final conclusion

This mission did not run long because the coding problem was especially difficult.

It ran long because a **small, low-risk UI terminology change** got caught in a **high-friction proof and workflow path**. The implementation itself was a normal-sized task. The mission overhead was the real antagonist.

My blunt assessment:

- **Planning:** good
- **Implementation:** good
- **Validation:** acceptable
- **Proof:** poor and too expensive
- **Overall time efficiency:** below the standard we should aim for

The next step is not merely “work faster.” It is to give Shinra a better battlefield:

- repo memory,
- proof proportionality,
- proof preflight,
- validation catalogs,
- cleaner mission telemetry.

Do that, and the next LH-402-shaped mission should feel much more like a precise strike and much less like a ceremonial procession.
