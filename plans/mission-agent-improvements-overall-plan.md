# Mission Agent Improvements Overall Plan

## Purpose

Plan the next major improvements to Spira's mission agents as one coherent system rather than four disconnected features.

The four planned passes are:

1. Proof Decisioning
2. Repo Intelligence Foundation
3. Mission Observability and Workflow Polish
4. Repo Intelligence Enrichment

## Consensus design principles

1. **Keep the existing lifecycle backbone.**  
   The mission flow remains lifecycle-driven: context -> classification -> plan -> validation -> proof when required -> summary/closeout.

2. **Use one shared SQLite-backed substrate.**  
   Extend the existing memory database approach rather than creating a second storage system.

3. **Do not overload generic `memory_entries`.**  
   Repo-safe operational guidance needs dedicated typed tables with repo scope, approval state, provenance, and freshness.

4. **Use explicit tables, not a persisted decision-bundle abstraction.**  
   A decision bundle may exist as a service/read model, but storage should stay queryable and flat.

5. **Introduce proof levels advisory-first.**  
   The current binary `proofRequired` workflow gate should remain authoritative at first. Graduated proof levels should influence recommendations before they become gating logic.

6. **Ship thin telemetry early.**  
   Minimal observability is a prerequisite for judging whether decisioning and repo intelligence are helping.

7. **Enrichment comes last.**  
   Learned patterns and repo indexing should extend a trusted foundation, not invent one.

## Shared substrate (Stage 0)

Before the first major feature rollout, add the shared groundwork:

- typed SQLite tables for repo intelligence, proof rules, validation profiles, proof decisions, and mission events
- retrieval plumbing keyed by repo/project identity
- a thin lifecycle telemetry skeleton

This is prerequisite groundwork, not a separate planning pass.

## Recommended delivery order

### Stage 1: Repo Intelligence Foundation + Proof Decisioning Phase 1

These should be treated as co-deliverables.

**Repo Intelligence Foundation** provides:

- curated repo briefings
- validation profile seeds
- proof rule seeds
- controlled mission-context injection

**Proof Decisioning Phase 1** provides:

- deterministic proof level recommendations
- proof preflight
- recorded proof decisions
- advisory proof metadata without changing workflow gating

### Stage 2: Mission Observability and Workflow Polish + Proof Decisioning Phase 2

This stage deepens the system after the first rollout has generated real runs to measure.

It adds:

- richer timing and wait diagnostics
- proof recommendation effectiveness analysis
- workflow-state reconciliation
- validation-informed proof downgrades or waivers
- repo-rule overrides with stronger confidence

### Stage 3: Repo Intelligence Enrichment

After foundation and telemetry are stable:

- narrow repo indexing
- learned pattern candidates from clean missions
- operator approval workflow
- promotion into the same repo-intelligence store

## Shared data model direction

At a planning level, the substrate should include explicit typed tables such as:

- `repo_intelligence`
- `proof_rules`
- `validation_profiles`
- `proof_decisions`
- `proof_preflights`
- `mission_events`

The exact schema can evolve during implementation, but the core rule is stable:

- **mission facts stay with the mission snapshot model**
- **shared intelligence and telemetry live in sibling typed tables**

## Cross-pass dependencies

- Proof Decisioning depends on at least a seeded Repo Intelligence Foundation.
- Observability needs to start thin early, but its richer form becomes most valuable after Decisioning begins shipping.
- Enrichment depends on both Foundation and Observability to avoid learning from bad or ambiguous missions.
- Workflow guard changes should lag behind advisory proof-level rollout.

## Major planning decisions

### Mission-context injection budget

Repo intelligence should be injected in strict priority order and small quantities:

1. current workflow state and user/task context
2. concise repo briefing essentials
3. relevant validation defaults and proof rule
4. at most one high-signal example or pitfall

Do not inject full catalogs or unreviewed learned patterns.

### Proof-level migration

Use a staged migration:

1. add proof level as advisory metadata
2. record outcomes and measure quality
3. only later expand workflow gating to use proof levels directly

## Main risks

- weak repo seed data makes proof recommendations look arbitrary
- too much injected context reduces clarity instead of improving it
- premature workflow-guard changes create lifecycle regressions
- low-quality learned patterns pollute future missions
- telemetry volume grows without clear derived reporting

## Success criteria

- smaller missions spend less time in proof selection and proof failure paths
- mission kickoff becomes faster and more consistent
- postmortems rely on recorded facts rather than reconstruction
- end-state mission status matches lifecycle facts cleanly
- learned repo guidance improves retrieval quality without contaminating trusted defaults
