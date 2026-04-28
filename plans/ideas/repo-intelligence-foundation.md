# Repo Intelligence Foundation

## Goal

Reduce mission orientation time by giving agents reliable repo-specific guidance at kickoff and during classification and planning.

## Combines

- repo briefings and cheat sheets
- repo memory architecture
- initial validation profile catalog

## Recommendation

Build a stable repo-knowledge layer first, then retrieve it automatically at mission start.

## Scope

### 1. Repo briefings and cheat sheets

Each active repo should have a short, curated briefing that includes:

- repo purpose and major surfaces
- main entry points and important directories
- where UI strings, constants, routes, views, and tests usually live
- risky directories and terms that should not be renamed casually
- preferred validation commands
- proof guidance by change type
- examples of common ticket shapes

### 2. Repo memory architecture

Repo memory should be typed, searchable, and scoped deliberately. Suggested structure:

- `repo_key`
- `memory_type` (`cheat-sheet`, `pattern`, `validation-profile`, `proof-rule`, `pitfall`, `example`)
- `tags`
- `scope` (`repo`, `project`, `global`)
- `confidence`
- `source_run_id`
- `source_ticket_id`
- `last_used_at`
- operator approval state

Retrieval should be hybrid:

1. deterministic bootstrap from project key and mapped repos
2. repo-filtered search by ticket summary, tags, and changed areas
3. policy retrieval for validation and proof rules
4. a very small number of similar successful examples

### 3. Validation profile foundations

Each repo should start with a small validation catalog containing:

- exact command
- working directory
- kind of validation
- expected runtime
- confidence contributed by a pass
- prerequisites
- common failure causes

## Storage recommendation

Use **SQLite** as the operational source of truth. It fits Spira's local runtime model and is the right first step before considering a shared SQL Server model.

## Crossovers

- Supplies repo risk rules and validation defaults to **Proof Decisioning**.
- Provides the base knowledge model later enriched by **Repo Intelligence Enrichment**.
- Should emit usage and effectiveness signals into **Mission Observability and Workflow Polish**.

## Initial recommendation

Start with manually curated cheat sheets and validation profiles for the most active repos, store them in SQLite, and inject them into mission context at kickoff.
