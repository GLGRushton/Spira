# Proof Decisioning Plan

## Goal

Reduce mission duration by choosing proportionate proof, checking proof readiness early, and using validation evidence more intelligently.

## Why this matters

The LH-402 postmortem showed that proof overhead was the single largest source of avoidable mission delay.

## Dependencies

Before Proof Decisioning ships meaningfully, Spira needs:

- the shared SQLite substrate
- seeded repo proof rules
- seeded validation profiles
- thin mission telemetry

## Scope

### Phase 1: advisory proof decisioning

Ship first:

- deterministic proof levels:
  - `none`
  - `light`
  - `targeted-screenshot`
  - `full-ui-proof`
  - `manual-review-only`
- proof preflight with explicit outcomes:
  - `runnable`
  - `blocked`
  - `degraded`
- recorded proof decisions and rationale
- advisory proof metadata added to the mission record

### Phase 2: repo-informed and validation-informed decisioning

Ship after the first phase is measured:

- repo-specific rule overrides
- stronger validation influence on proof recommendation
- explicit waiver or downgrade logic
- richer preflight reasoning tied to proof profiles and prerequisites

## Key design decisions

1. **No new lifecycle phase.**  
   Proof Decisioning should plug into the existing lifecycle, not create a second workflow.

2. **Advisory-first rollout.**  
   The current binary `proofRequired` gate remains authoritative at first.

3. **Explicit tables over bundled storage.**  
   Keep proof rules, preflight results, and decisions queryable in their own tables.

4. **Do not claim certainty from preflight.**  
   Preflight can reduce wasted time but cannot guarantee proof success.

## Planned deliverables

- proof-level taxonomy and decision policy
- `proof_rules` table
- `proof_decisions` table
- `proof_preflights` table or equivalent explicit result storage
- deterministic decision engine
- lightweight preflight tool
- advisory proof metadata in mission context and review surfaces

## Workflow compatibility strategy

### Step 1

Add proof level as advisory metadata while preserving current binary gating.

### Step 2

Measure recommendation quality using telemetry and actual mission outcomes.

### Step 3

Only after confidence is established, consider graduating proof levels into workflow guard semantics.

## Risks

- false proof waivers reduce trust quickly
- generic rules look arbitrary if repo seed data is weak
- preflight scope expands into expensive environment probing
- changing workflow gating too early destabilizes mission closeout

## Success criteria

- low-risk missions reach an appropriate proof path faster
- blocked proof paths fail fast instead of late
- proof recommendations are explainable and auditable
- proof overhead drops without increasing risky false waivers
