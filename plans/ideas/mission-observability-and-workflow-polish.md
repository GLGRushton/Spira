# Mission Observability and Workflow Polish

## Goal

Make mission delays measurable and ensure visible mission state matches actual lifecycle state.

## Combines

- mission telemetry and postmortems
- mission end-state reconciliation

## Recommendation

Treat telemetry and workflow-state cleanup as one pass. Good observability explains where missions are slow, and good reconciliation prevents the UI from contradicting the mission facts.

## Scope

### 1. Mission telemetry

Capture:

- stage enter and exit timestamps
- per-command durations
- wait reasons
- proof preflight outcomes
- validation start and finish times
- blocked-by-permission events
- waiting-for-user-decision events

This should make postmortems precise rather than interpretive.

### 2. Workflow-state reconciliation

Add a reconciliation step that normalizes final visible mission state when lifecycle facts already satisfy completion conditions.

Example:

If:

- proof passed when required
- summary was saved
- at least one validation passed
- no blocking lifecycle condition remains

Then the visible station status should report completion cleanly.

## Storage recommendation

Store telemetry and status diagnostics in **SQLite** with the rest of the local mission data.

## Crossovers

- Measures the effect of **Proof Decisioning** and shows whether proof remains the main bottleneck.
- Measures whether **Repo Intelligence Foundation** is reducing orientation and validation selection time.
- Supports **Repo Intelligence Enrichment** by identifying successful missions worth learning from.

## Initial recommendation

Add lifecycle timing and explicit wait-reason events first, then implement reconciliation rules so operators see a clean and trustworthy end state.
