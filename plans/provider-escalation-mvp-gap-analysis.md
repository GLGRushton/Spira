# Provider Escalation MVP Gap Analysis

## What the MVP plan does

The MVP plan in `plans\provider-escalation-mvp-plan.md` intentionally delivers a narrow experiment:

- adds two new experimental provider IDs:
  - `openai-escalation`
  - `azure-openai-escalation`
- keeps `openai` and `azure-openai` as baseline controls
- implements escalation only inside the provider layer
- uses one extra OpenAI model and one extra Azure deployment
- keeps escalation deterministic, one-way, and session-latched
- captures comparison-friendly telemetry so the experiment is measurable

In short, the MVP proves whether **provider-local escalation variants** are worth keeping.

## What the MVP does not attempt from the larger architecture

The larger plan in `plans\model-escalation-architecture.md` describes a much broader orchestrator. The MVP does **not** implement these parts yet.

## Missing orchestration model

The bigger plan wants:

- application-owned multi-phase workflow
- explicit states such as classify, discover, summarise, plan, implement, build/test, review
- models used as bounded workers for each phase

The MVP does not add that. It leaves the current runtime flow in place and only changes provider behavior.

## Missing role-based model routing

The bigger plan assigns different models to different jobs, such as:

- classifier
- search-term extractor
- file ranker
- file summariser
- planner
- implementer
- reviewer
- escalation judge

The MVP does not introduce those roles. It only adds a simple base-target to escalation-target path inside two provider variants.

## Missing session bundle and work-state machine

The bigger plan proposes a rich `WorkSession` record with:

- budget
- changed files
- search terms
- candidate files
- file summaries
- selected files
- plan
- build results
- review results
- cost by phase

The MVP does not add this new session object or a state machine around it.

## Missing discovery pipeline

The bigger plan includes:

- task classification
- repo search term extraction
- deterministic repo search
- file ranking
- targeted file summarisation

The MVP skips all of that. There is no new search, ranking, or summary system.

## Missing planning and review agents

The bigger plan expects distinct planning, implementation, build-fix, and review stages with model-specific routing.

The MVP does not add:

- planning agent
- build-failure agent
- cheap review phase
- serious review escalation
- architecture-judgement routing

## Missing budget policy

The bigger plan includes budget and escalation controls such as:

- maximum estimated cost
- maximum iterations
- maximum full-model calls
- maximum ultra-model calls
- behavior at 50%, 80%, and 100% budget

The MVP does not implement a generalized budget engine.

## Missing advanced escalation policy

The bigger plan defines escalation rules based on:

- confidence thresholds
- file-count thresholds
- risk classes
- repeated failures
- review disagreement
- architecture ambiguity

The MVP deliberately avoids that complexity. Its triggers are narrow operational events, not an end-to-end policy framework.

## Missing context-management framework

The bigger plan is careful about what each phase receives:

- search snippets only for file ranking
- summaries plus selected files for planning
- focused build error context for failure fixing
- diff plus test results for review

The MVP does not add this context-packaging layer.

## Missing later enhancements

The bigger plan also mentions future capabilities such as:

- persistent repo map
- cached file summaries
- known build and test commands
- dependency graph
- git-history hints
- smarter model-driven planning

The MVP does not attempt any of these.

## Why this gap is intentional

The MVP is trying to answer a smaller question first:

> Is it useful to run separate escalation-aware provider variants and compare them against the baseline providers with clean telemetry?

That is a worthwhile experiment on its own, and it avoids building the whole orchestration stack before proving the provider strategy is valuable.

## What would come next if the MVP succeeds

If the experiment produces useful data and better outcomes, the next step would be to move from **provider-local escalation** toward **application-owned orchestration**, likely in this order:

1. introduce a shared experiment/session record
2. add structured escalation decision telemetry and reporting
3. add role-based routing for planning, implementation, and review
4. add budget and iteration policy
5. add discovery and summarisation phases from the larger architecture

## Bottom line

The MVP is **not** the full `model-escalation-architecture` plan.

It is the disciplined first slice:

- provider variants
- minimal deterministic escalation
- clean comparison telemetry
- no grand orchestration yet

That restraint is the point. It keeps the experiment honest.  
