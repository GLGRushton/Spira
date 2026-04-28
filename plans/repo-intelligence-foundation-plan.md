# Repo Intelligence Foundation Plan

## Goal

Give mission agents a reliable repo-specific briefing layer that improves kickoff, classification, planning, and validation selection.

## Why this matters

The postmortem showed that orientation cost and validation-command selection overhead are meaningful mission delays, especially for bounded tickets.

## Dependencies

This pass depends on the shared substrate, but should be one of the earliest feature deliveries.

## Scope

### Repo briefings

Each active repo should have a curated briefing covering:

- repo purpose and major surfaces
- important directories and entry points
- where UI strings, constants, views, routes, and tests usually live
- risky terms and directories
- key navigation hints and pitfalls

### Validation profiles

Each active repo should have a small validation catalog containing:

- exact command
- working directory
- validation kind
- expected runtime
- confidence contributed by a pass
- prerequisites
- common failure causes

### Proof rule seeds

Seed repo-aware proof guidance that Proof Decisioning can consume later.

### Retrieval and injection

Retrieve repo guidance deterministically at mission kickoff and inject only the highest-signal content.

## Key design decisions

1. **Do not use generic `memory_entries` as the primary store.**  
   Repo-safe operational guidance needs repo scoping, approval state, and better structure.

2. **Prefer typed tables and controlled curation.**  
   The first version should be curated, not auto-learned.

3. **Use a small context budget.**  
   Inject concise repo knowledge, not a wall of operational lore.

## Planned deliverables

- repo identity and lookup model
- `repo_intelligence` table
- `validation_profiles` table
- authoring/curation path for repo briefings and profiles
- retrieval layer for mission kickoff
- initial content for the most active repos

## Injection budget and priority

Inject in this order:

1. current workflow and user/task context
2. essential repo briefing bullets
3. relevant validation defaults and proof rule
4. one high-value pitfall or example if strongly relevant

Avoid full catalogs, stale entries, and low-confidence learned patterns.

## Risks

- curation burden slows coverage
- stale repo guidance becomes misleading
- too much injected content dilutes the current task context
- weak repo identity or mapping makes retrieval unreliable

## Success criteria

- agents orient faster in active repos
- validation choice becomes more consistent and explainable
- proof decisioning has enough repo-aware input to avoid purely generic behavior
- injected repo guidance feels concise and relevant rather than noisy
