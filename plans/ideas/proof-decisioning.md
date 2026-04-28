# Proof Decisioning

## Goal

Reduce mission time by making proof decisions proportionate, fast to validate, and grounded in repo-specific rules.

## Combines

- proof proportionality
- proof preflight
- validation profile foundations that influence proof choice

## Recommendation

Treat proof selection and proof readiness as one planning pass. The system should decide:

1. what level of proof is appropriate
2. whether that proof path is runnable now
3. whether existing validation is sufficient to lighten or waive proof

## Scope

### 1. Proof proportionality

Classify missions into proof levels such as:

- `none`
- `light`
- `targeted-screenshot`
- `full-ui-proof`
- `manual-review-only`

Use inputs such as:

- file types changed
- repo areas changed
- whether logic changed
- whether visuals changed
- whether contracts changed
- validation results
- repo-specific risk rules

### 2. Proof preflight

Before committing to proof execution, check:

- whether the proof profile exists
- whether required permissions are available
- whether services are running
- whether artifacts can be written
- whether browser or session prerequisites are satisfied
- whether environment dependencies are ready

The result should be explicit:

- runnable
- blocked
- degraded

### 3. Validation influence

Validation should contribute directly to proof choice. For example:

- copy-only UI changes with passing validation should usually recommend light proof
- low-risk changes with strong validation may allow waivable proof
- contract or logic changes should escalate proof expectations automatically

## Storage recommendation

Use **SQLite** for repo-scoped proof rules, proof profiles, validation profiles, and preflight prerequisites.

## Crossovers

- Depends on **Repo Intelligence Foundation** for repo-specific risk guidance and validation defaults.
- Benefits from **Mission Observability and Workflow Polish** to measure where proof time is lost.
- Can later learn from **Repo Intelligence Enrichment** when successful missions reveal better defaults.

## Initial recommendation

Implement deterministic rules first, with repo overrides stored in SQLite and a lightweight preflight tool that can answer whether a proposed proof path is runnable.
