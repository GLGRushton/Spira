# Mission Observability and Workflow Polish Plan

## Goal

Make mission delays measurable and ensure visible mission state matches lifecycle facts.

## Why this matters

Without reliable telemetry, improvement work is hard to validate. Without clean reconciliation, operators hesitate even when the mission is effectively complete.

## Dependencies

- thin telemetry should begin with the shared substrate
- richer observability becomes more valuable once Proof Decisioning and Repo Intelligence Foundation are in use

## Scope

### Thin telemetry skeleton

This should arrive early:

- stage enter/exit timestamps
- validation start/finish
- proof recommendation and preflight outcome
- blocked/wait reasons
- permission and user-decision waits

### Richer observability

After early rollout:

- per-stage duration analysis
- proof recommendation effectiveness review
- postmortem-friendly run timelines
- clearer operator-facing mission status

### Workflow reconciliation

Normalize visible mission state when lifecycle facts already satisfy completion conditions.

Examples:

- summary saved
- required proof satisfied
- required validation satisfied
- no blocking condition remains

Then the visible status should report completion cleanly.

## Key design decisions

1. **Use append-friendly mission events.**  
   Keep event capture simple and queryable.

2. **Do not wait for a big analytics dashboard.**  
   Local operational observability is enough to start.

3. **Be conservative with reconciliation.**  
   Reconcile only when completion facts are unambiguous.

## Planned deliverables

- `mission_events` table
- event emission at lifecycle transitions
- wait-reason taxonomy
- proof/validation timing capture
- reconciliation logic for mission end state
- postmortem queries or derived timeline views

## Risks

- telemetry volume grows without retention or summarization
- operator-visible status and lifecycle facts drift apart again
- event capture becomes noisy without good derived views
- reconciliation becomes too aggressive and hides real blockers

## Success criteria

- future postmortems rely on stored facts rather than reconstruction
- operators can see why a mission is waiting or blocked
- visible mission completion state matches actual lifecycle data
- proof and validation delays become measurable enough to guide further tuning
