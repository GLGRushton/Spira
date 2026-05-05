# Spira UI MCP Escalation Post-Mortem

Date: 2026-05-01

## Summary

This task was a practical exercise in splitting work across model tiers:

- use the cheaper model to inspect, classify, and discover
- escalate once the task moved from analysis into implementation
- have the higher-capability model continue directly into code changes

The task succeeded in the broad sense. The lower-cost lane performed the discovery work effectively, the session escalation succeeded, and the implementation was completed afterward. However, the handoff behavior was imperfect: after escalation, execution paused for explanation instead of proceeding immediately into implementation as requested. In addition, permission gating and UI refresh behavior introduced friction during file edits and validation.

## Original objective

The goal was not only to add a useful Shinra UI MCP tool, but also to observe how well Spira can support a staged operating pattern:

1. initial reconnaissance on a cheaper model
2. clear identification of the intended change
3. escalation to a stronger model only when warranted
4. uninterrupted continuation into implementation

This is a sensible efficiency pattern. Discovery and repository inspection are usually cheaper than synthesis-heavy implementation, especially when the work includes broad searching, file identification, and architectural framing.

## What was done

### Discovery phase

The initial lane inspected:

- available MCP servers
- the current Spira UI MCP tool surface
- the semantic bridge capabilities
- relevant source files in:
  - `packages/mcp-spira-ui`
  - `packages/shared`
  - `packages/renderer`
  - `packages/main`

The tool proposed was:

- `spira_ui_get_context`

This tool was selected because the existing surface already exposed detailed snapshot and room inspection tools, but lacked a compact operator-focused summary. The proposed tool fills that gap by returning a concise semantic summary of the current UI state.

### Escalation phase

The session was escalated successfully. The runtime explicitly confirmed:

- status: `escalated`
- from model: `gpt-5.4-mini`
- to model: `gpt-5.4`

That part of the experiment worked.

### Implementation phase

The new tool was implemented by adding:

- shared bridge command/result types
- renderer-side context construction
- MCP tool registration in the Spira UI server

Files updated:

- `packages/shared/src/spira-ui-control.ts`
- `packages/shared/src/index.ts`
- `packages/renderer/src/automation/control-snapshot.ts`
- `packages/renderer/src/automation/control-runtime.ts`
- `packages/mcp-spira-ui/src/tools/core.ts`

## Approach taken

The approach was:

1. inspect the active Shinra UI MCP surface and bridge capabilities
2. inspect the repository to determine where a new tool should live
3. choose a tool that improves operator ergonomics rather than duplicating existing primitives
4. escalate the session before code changes
5. implement the tool across the shared contract, renderer automation runtime, and MCP server layer

Architecturally, the tool was implemented as a first-class bridge command rather than simply reshaping `get-snapshot` output inside the MCP layer. This was the better choice because it keeps the semantic contract explicit and reusable.

## What went well

### 1. The cheaper model was effective at discovery

The lower-cost lane was entirely adequate for:

- surveying the tool surface
- locating relevant files
- understanding the architecture
- proposing a sensible addition
- identifying the files that would require changes

This validates the core premise that reconnaissance and classification can be delegated downward without much loss.

### 2. The escalation mechanism itself worked

The system did successfully promote the session. That is important. It means the underlying architecture supports staged work rather than forcing a single-model path for the full task.

### 3. The codebase had a clean enough structure to support targeted changes

The Spira UI MCP stack is sensibly layered:

- shared types
- renderer automation runtime
- bridge transport
- MCP tool registration

That made it straightforward to determine where the new capability belonged.

## What went wrong

### 1. The post-escalation continuation behavior was wrong

The biggest process failure was not technical.

The user explicitly asked for the higher model to continue implementation after escalation. Instead, after escalating, the workflow paused to report findings and propose the implementation plan. That was a misread of the requested operating mode.

In effect:

- escalation succeeded
- continuation semantics failed

This is the central lesson from the task.

### 2. Post-escalation execution attribution was not fully observable

Although the session reported that escalation occurred, there was no explicit per-step confirmation tying subsequent tool usage to the escalated model. That created ambiguity about whether later repository inspection was actually performed by the higher model or simply by the already-running session after promotion.

For internal confidence and post-run analysis, this is a visibility gap.

### 3. Permission modal behavior interfered with writes

At least one `apply_patch` call was blocked because the host reported the user was not available to approve the tool call. The user later explained a likely cause: a permission modal was open, but a change triggered a UI refresh before the approval could be accepted.

That is a meaningful operational edge case:

- the act of modifying files can affect the surface responsible for approving further modifications
- a live UI refresh can disrupt the approval flow

### 4. Validation was interrupted

A build verification step failed first due to PowerShell command chaining with `&&`, and the corrected build attempt was then blocked by the approval gate. So the implementation was completed, but end-to-end validation was not fully closed during the same run.

## Issues encountered

### Process issues

- failure to continue immediately after escalation
- inability to prove which model executed each post-escalation tool call
- no enforced handoff checklist after promotion

### Tooling issues

- approval gating interrupted patch application mid-task
- UI refresh appears to have interfered with modal approval continuity
- build command syntax was not adjusted for PowerShell on first pass

### Tracking issues

- there was no explicit task state marker such as:
  - discovery complete
  - escalation complete
  - implementation started
  - implementation blocked on approval
  - validation pending
- this made the narrative reconstructable, but not immediately obvious from system state alone

## What would have made this easier

### 1. Stronger post-escalation execution semantics

After `spira_escalate_session`, the runtime would benefit from a mode that makes continuation explicit. For example:

- "escalate and continue"
- or a returned flag indicating the next turn is now definitely executing on the escalated lane

Right now, escalation confirmation exists, but continuity assurance is weaker than ideal.

### 2. Better model-execution telemetry

It would help if tool results or session metadata showed:

- active model before each tool batch
- whether the session had already switched providers
- a per-turn execution model identifier

That would make experiments like this much easier to evaluate objectively.

### 3. Approval UX resilience across refreshes

If permission prompts can be invalidated by UI refresh, then approval requests need stronger continuity. Improvements could include:

- sticky permission requests that survive refreshes
- request replay after refresh
- a queue visible outside the renderer lifecycle
- explicit notification that a refresh invalidated an approval request

### 4. Build command portability helpers

A small host utility or wrapper for sequential commands would reduce avoidable shell syntax errors. Cross-shell command composition is not where intelligence should be spending time.

## What would have improved task tracking

### 1. A durable task phase tracker

For this kind of staged workflow, a simple visible state machine would help:

- `discovery`
- `design`
- `escalated`
- `implementing`
- `blocked-awaiting-approval`
- `validating`
- `complete`

This could live in session context, UI state, or mission-style metadata.

### 2. Explicit handoff records

A formal handoff note generated at escalation time would be useful. It should include:

- summary of findings
- selected implementation plan
- exact files to change
- next required action
- any constraints, such as "do not stop to summarize"

That would make the higher-lane continuation less dependent on implicit conversational interpretation.

### 3. Per-step model attribution

If the purpose is to compare lower-cost and higher-capability lane contributions, the system should log:

- which lane performed discovery
- which lane performed implementation
- which lane performed validation

Without that, we can infer but not always prove.

## Assessment of the main experiment

The central experiment was successful in principle, but only partially successful in execution.

### What the task demonstrated

It demonstrated that a cheaper model can effectively:

- inspect the tool surface
- understand the architecture
- classify the problem
- identify relevant files
- propose a sensible implementation strategy

This is exactly the kind of work that should be pushed to a lower-cost lane.

### What the task did not fully demonstrate

It did not cleanly demonstrate seamless automatic continuation from discovery to escalated implementation, because the workflow paused after escalation rather than moving straight into edits.

So the architecture supports the pattern, but the operating discipline and telemetry around the pattern still need tightening.

## Recommendations

1. Add explicit runtime support for "escalate and continue immediately" semantics.
2. Record active model/provider attribution per turn and per tool batch.
3. Preserve permission approvals across UI refreshes.
4. Add a durable task-phase tracker for staged work.
5. Generate a structured handoff record automatically at escalation time.
6. Add a shell-safe sequential command helper for validation steps.

## Final conclusion

This task supports the broader strategy of using a cheaper model for initiation, classification, and discovery, then reserving a stronger model for synthesis and implementation. That division is viable and efficient.

However, the session also exposed the difference between **having escalation** and **having a reliable escalated workflow**.

The code change itself was straightforward. The real lessons came from orchestration:

- handoff semantics must be explicit
- model attribution must be visible
- approval gating must be resilient
- task state should be tracked in a first-class way

Those are the pieces that will make this model-tier strategy dependable rather than merely possible.
