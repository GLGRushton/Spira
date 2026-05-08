# Proposed Model Escalation Architecture for an Agentic Coding Orchestrator

## Goal

Design an economical and reliable coding-agent workflow using a model escalation ladder:

```text
GPT-5.4 nano -> GPT-5.4 mini -> GPT-5.4 -> GPT-5.5
```

The system should assume it is already operating inside the correct repository, but initially has no further pre-built repo knowledge. Future improvements may add repo maps, semantic search, cached summaries, known test commands, project graphs, and other context-reduction helpers.

The main objective is to avoid sending huge amounts of code to expensive models, while still getting high-quality coding output when required.

## Current implementation status (audited 2026-05-08)

This document started as a target architecture. The repository now contains a meaningful first slice of it around the **provider layer, runtime plumbing, and the early WorkSession orchestration spine**. The app-owned coding workflow described below is still only partially implemented end-to-end.

### Implemented now

- [x] Provider-local escalation variants exist: `openai-escalation` and `azure-openai-escalation`.
- [x] Shared config, runtime config normalization, provider labels, and persistence accept the escalation provider IDs.
- [x] Experimental OpenAI and Azure sessions can escalate one-way and stay latched to the escalation target for the rest of the session.
- [x] Manual station-session escalation exists via `spira_escalate_session` for escalation-capable providers.
- [x] Runtime persistence already records provider binding, requested model, observed model/usage-derived model, checkpoints, recovery data, and permission state.
- [x] Subagent runs already persist requested and observed model metadata, tool-call history, and pending permission request state.
- [x] Runtime session contracts and checkpoint payloads now carry a durable workflow-state spine: phase/status, phase history, blocked-state metadata, handoff records, and review state.
- [x] Runtime lifecycle now emits `workflow.updated`, and legacy persisted runtime sessions/checkpoints backfill a default workflow state on read.
- [x] Manual escalation now writes durable `model-escalation` handoffs into workflow state, preserves or derives the active phase, and survives legacy partial workflow payloads.
- [x] Escalation-driven workflow blocking now distinguishes approval overlays from non-approval blockers, clears approval blocks when permission requests resolve, and preserves durably pending approval blocks across restart-time sync.
- [x] Code-review subagent launches now persist explicit review lifecycle state in workflow state, including `running`, `completed`, `failed`, `missing`, `relaunching`, and `stalled`.
- [x] Managed review state now carries durable origin metadata so restart reconciliation can repair or persist missing/stalled review state without relying on summary text.
- [x] Station sessions now have an app-owned **WorkSession entry gate** with a default-conversational safety catch: mission stations stay mission-scoped, explicit coding/planning/repo-review prompts can activate WorkSession mode, and non-work follow-ups can fall back to conversational mode.
- [x] A lightweight persisted WorkSession scaffold now exists for coding-task activation, including shared summary types, station-summary transport, minimal snapshot persistence, and reset/shutdown cleanup.
- [x] WorkSession now owns a deterministic pre-implementation spine for `classify -> discover -> summarise -> plan`, persists that phase history across restart, syncs it into runtime workflow state, and avoids clobbering later review/implementation workflow on recovery.
- [x] WorkSession state and runtime workflow sync now extend through `implement` and `validate`, including durable execution artifact fields, stalled execution mapping, restart restore for execution phases, and teardown/restart cleanup that removes stale downstream `review` / `complete` state.
- [x] Restart-time approval reconciliation no longer downgrades restored validate-complete state or re-apply stale approval blocks from open execution phase history.
- [x] Bridge-safe observability now surfaces the active station WorkSession mode/phase/summary in the renderer and Spira UI control snapshot without leaking mission-style workflow chrome into ordinary chat surfaces.
- [x] Approval-flow resilience: pending permission requests now survive renderer reload and reconnect, the boot-time orphan sweep emits `permission:complete` so stale prompts clear, late `permission:respond` against a missing in-memory entry is idempotent, the previous silent 60-second timeout is replaced with a 30-minute durable `expired` outcome, and an active `implement` / `validate` WorkSession phase stalls explicitly with `stalledReason` when an approval is denied or expired.
- [x] User-controlled `autoApprovePermissions` setting (off by default) bypasses prompting for trusted, monitored sessions while still recording every request and resolution in the runtime ledger and DB.

### Not implemented yet

- [x] WorkSession now owns a deterministic application-managed execution loop for `plan -> implement -> validate`, including persisted patch/validation artifacts, bounded retries, repeat-failure detection, long-running PowerShell validation tracking, and ready-for-review vs stalled outcomes.
- [x] Review/finish orchestration after execution now includes the `review -> complete` closure path for WorkSession-owned coding tasks, with thin WorkSession closure semantics, managed-review completion sealing, restart reconciliation for crash windows, late-event suppression after seal, explicit reopen clearing stale review state, and deduplicated terminal `complete` history on restore.
- [x] Approval-flow resilience across UI refreshes or renderer churn (see `plans/permission-lifecycle-resilience.md`).
- [ ] Dedicated coding agents such as `TaskClassifierAgent`, `SearchTermAgent`, `FileRankerAgent`, `PlanningAgent`, and `BuildFailureAgent`.
- [ ] Phase-aware budget enforcement and routing policy across the full workflow.
- [ ] Context packaging rules enforced by the app rather than left to the active model.
- [ ] Full explicit **escalate-and-continue** execution semantics so a stronger lane resumes the active implementation/validation phase instead of pausing to restate the plan.
- [ ] Full user-visible per-phase observability for active work, blocking conditions, and handoff history beyond the current Bridge-safe WorkSession summary.

### Interpretation

The current codebase proves that **provider escalation and runtime continuity are viable**. It does **not** yet prove the broader orchestrator described in the rest of this file. The next iterations should build on the existing persistence and runtime ledger rather than inventing a second state system.

The current codebase now also proves the **entry semantics, early state machine, execution-state foundation, execution loop, review closure, first observability surface, and durable approval lifecycle** for app-owned orchestration: the application, not the active model, decides when a station remains conversational and when it enters a coding-oriented WorkSession, it owns the deterministic `classify -> discover -> summarise -> plan -> implement -> validate -> review -> complete` flow across WorkSession and runtime workflow state, it persists execution-oriented state and closure outcomes across restart, it exposes the active WorkSession summary through Bridge-safe UI and semantic control state, and it now keeps permission gating durable across renderer refresh, transport reconnect, and backend restart with an opt-in auto-approve mode for trusted loops. The next missing pieces are to make that workflow **more policy-driven and budget-aware**: phase-aware routing, dedicated coding sub-agents (classifier / search / ranker / planner / build-failure), stronger budget/context packaging rules, full escalate-and-continue execution semantics, and broader observability for blockers and handoffs.

### Completed slice (2026-05-08): Approval-flow resilience

Implemented in [permission-lifecycle-resilience.md](./permission-lifecycle-resilience.md). Highlights:

- Renderer reload no longer expires pending approvals — `handleClientDisconnected` is now a no-op for permissions; only genuine session teardown clears them.
- On `transport:client-connected`, `StationRegistry.replayPendingPermissionRequests()` re-emits `permission:request` for every persisted pending row so the reconnected renderer re-prompts.
- Boot-time orphan sweep (already in `recoverInterruptedRuntimeState`) is now visible to the UI: `permission:complete` with `result: "expired"` is emitted on first reconnect after restart.
- `resolvePermissionRequest` is idempotent against a missing in-memory entry: a late approve/deny still updates the DB row, records a `permission.resolved` ledger event, emits `permission:complete`, and reconciles workflow state.
- 60-second silent timeout replaced with a 30-minute durable `expired` outcome surfaced to both DB and UI.
- WorkSession reacts explicitly to non-approved outcomes: an active `implement` / `validate` phase transitions to a stalled snapshot with a concrete `stalledReason` of "permission was denied" or "permission expired before approval".
- New user-visible setting `autoApprovePermissions` (off by default, surfaced in Settings → Permissions) short-circuits prompting while preserving the full audit trail.

Detailed review lifecycle remains a runtime-workflow concern (`running`, `completed`, `failed`, `missing`, `relaunching`, `stalled`).

### Likely next slice

With approval gating durable, the next operational slice is the **first concrete bounded coding agent** that the orchestrator owns. The plan recommends `TaskClassifierAgent` as the smallest useful starting point: it lives in WorkSession's `classify` phase, takes a task string, returns the structured classification JSON described later in this document, and uses GPT-5.4 nano with explicit budget accounting. Shipping it forces us to commit to: (1) a concrete agent abstraction the app drives rather than the model, (2) the first per-phase budget counter, and (3) the first end-to-end test of "structured output, validated by the host." That foundation pays dividends for every later agent.

---

## Core Principle

The main orchestrator should be the application itself, not a model.

```text
C# Orchestrator = owns control flow, budgets, state, file access, tool execution, patch application, build/test loops

Models = bounded workers that perform specific tasks and return structured outputs
```

Avoid letting one model freestyle the entire workflow. That usually causes:

- Too many unnecessary tool calls
- Repeated searches
- Excessive token churn
- Poor auditability
- Accidental use of expensive models
- Hard-to-reproduce behaviour

Instead, use a deterministic state machine:

```text
Classify
Discover
Summarise
Plan
Implement
Build/Test
Review
Finish
```

Models can recommend actions, but the application decides what actually happens.

---

## Model Roles

### GPT-5.4 nano

Use nano as the cheap utility model.

Good uses:

- Task classification
- Search term extraction
- File ranking
- File summarisation
- Diff summarisation
- Cheap review
- Obvious issue detection
- Context compression
- Routing recommendations

Avoid using nano as the final implementation model for anything non-trivial.

Nano should answer questions like:

```text
What kind of task is this?
Which files look relevant?
What does this file do?
What tests probably cover this?
What is the likely entry point?
Does this patch obviously violate the task?
```

### GPT-5.4 mini

Use mini as the planner and default lightweight implementer.

Good uses:

- Implementation planning
- Simple code changes
- Compiler error diagnosis
- Test planning
- Summarising build/test failures
- Deciding whether a task needs full GPT-5.4

Mini is probably the default “thinking” model.

Use mini for low or medium complexity tasks where the change is well-contained.

### GPT-5.4

Use full GPT-5.4 as the main serious coding model.

Good uses:

- Complex implementation
- Cross-file reasoning
- Non-trivial refactoring
- Debugging failing tests
- Subtle logic changes
- Security-sensitive code
- Database/data migration logic
- Final review for important changes

This is the model to use when the actual code needs to be high confidence.

### GPT-5.5

Use GPT-5.5 only as an escalation model.

Good uses:

- Repeated failures
- Difficult debugging
- Ambiguous architecture
- Large refactors
- Serious final review
- High-impact changes
- Cases where GPT-5.4 and reviewers disagree

Do not use GPT-5.5 automatically for every task or every final review. It should be budget-controlled and triggered only by clear escalation rules.

---

## High-Level Workflow

```text
User task
  ↓
C# Orchestrator creates session
  ↓
Nano classifies task
  ↓
Nano extracts search terms
  ↓
Application runs deterministic repo search
  ↓
Nano ranks candidate files
  ↓
Nano summarises selected files
  ↓
Mini creates implementation plan
  ↓
Application decides implementation model
  ↓
Application records the phase transition and any escalation handoff
  ↓
Mini or GPT-5.4 creates patch
  ↓
Application applies patch
  ↓
Application runs build/tests
  ↓
Mini or GPT-5.4 fixes failures
  ↓
Nano/mini/GPT-5.4 reviews final diff
  ↓
Application returns final summary
```

Two operational requirements need to be first-class here:

1. **Escalate and continue, not escalate and pause.**  
   If the system promotes a session from mini to GPT-5.4 or GPT-5.4 to GPT-5.5, the escalated lane should resume the current phase immediately unless the user explicitly asked for analysis only.

2. **Every phase transition must be observable.**  
   The application should persist and expose phase changes such as `discovering`, `planning`, `escalating`, `implementing`, `blocked-awaiting-approval`, `validating`, `reviewing`, `stalled`, and `complete`.

---

## Session State

Each coding task should create a `WorkSession`.

Example conceptual structure:

```json
{
  "sessionId": "",
  "repoPath": "",
  "taskText": "",
  "budget": {
    "maxEstimatedCostUsd": 2.0,
    "maxIterations": 5,
    "maxFullModelCalls": 4,
    "maxUltraModelCalls": 1
  },
  "currentBranch": "",
  "changedFiles": [],
  "classification": {},
  "searchTerms": {},
  "candidateFiles": [],
  "fileSummaries": [],
  "selectedFiles": [],
  "currentPhase": "",
  "phaseHistory": [],
  "plan": {},
  "patches": [],
  "buildResults": [],
  "testResults": [],
  "reviews": [],
  "handoffs": [],
  "escalationDecisions": [],
  "approvalState": {
    "pendingRequestIds": [],
    "lastResolvedAt": 0,
    "blockedReason": null
  },
  "reviewState": {
    "status": "idle",
    "attempt": 0,
    "lastFailureReason": null
  },
  "cost": {
    "inputTokens": 0,
    "outputTokens": 0,
    "estimatedCost": 0
  },
  "status": ""
}
```

Every agent should read from and write back to this session bundle.

This gives:

- Auditability
- Resume support
- Cost tracking
- Debuggability
- Better telemetry
- Easier model comparison
- Reduced repeated context generation

The important refinement after the MVP experiments is that this session state must capture **handoff semantics, approval blockers, and review durability**, not just token usage and file lists.

## Cross-cutting operational requirements

These are not optional polish items. The MVP work showed they belong in the base architecture.

### 1. Explicit escalate-and-continue semantics

Escalation should produce a durable handoff record:

```json
{
  "fromModel": "gpt-5.4-mini",
  "toModel": "gpt-5.4",
  "phase": "implement",
  "reason": "complexity-threshold",
  "continuationMode": "continue-current-phase",
  "occurredAt": 0
}
```

Rules:

- escalation should preserve the current phase unless the application explicitly changes it
- the promoted lane should continue execution without an explanatory pause
- if the handoff cannot continue, the session should move to `stalled` or `blocked` with a concrete reason

### 2. Observability and audit trail

The runtime already has useful provider/session persistence. The full orchestrator should extend that into a phase ledger that records:

- phase entered
- active provider and model
- escalation decisions and reasons
- approval-request lifecycle
- review launch, timeout, retry, and completion state
- user-visible summary text for the current step

### 3. Approval resilience

Permission gating should survive UI churn. The architecture should assume approval prompts can be disrupted and should therefore support:

- durable pending permission requests outside transient renderer state
- replay or reattachment after refresh
- explicit detection that approval was invalidated
- a visible blocked state instead of silent waiting

### 4. Review durability

Final review cannot be treated as a vague background hope. The review stage should expose one of:

- `running`
- `completed`
- `failed`
- `missing`
- `relaunching`
- `stalled`

If a review agent disappears, the application should treat that as a hard state transition and report it immediately.

---

## Phase 0: Task Intake

The user provides a coding task, for example:

```text
Add support for filtering amendments by DNum, excluding motions unless DNum comparison matches.
```

The orchestrator creates a new session and sends the task to a `TaskClassifierAgent`.

### TaskClassifierAgent

Default model: `GPT-5.4 nano`

Prompt shape:

```text
Classify this coding task.

Return JSON only:
{
  "taskType": "bugfix | feature | refactor | test | investigation | unknown",
  "likelyAreas": ["api", "ui", "database", "tests", "configuration", "domain", "application"],
  "riskLevel": "low | medium | high",
  "needsTests": true,
  "needsBuild": true,
  "needsRuntime": false,
  "confidence": 0.0,
  "reasoningSummary": "short practical explanation"
}
```

Example output:

```json
{
  "taskType": "bugfix",
  "likelyAreas": ["application", "tests"],
  "riskLevel": "medium",
  "needsTests": true,
  "needsBuild": true,
  "needsRuntime": false,
  "confidence": 0.72,
  "reasoningSummary": "The task sounds like domain filtering logic and should have service or mapper tests."
}
```

The app uses this classification to decide:

- Whether tests are required
- Whether build should be run
- Which search strategy to use
- Initial risk level
- Maximum allowed budget
- Whether mini or full GPT-5.4 is likely needed later

---

## Phase 1: Repo Discovery

The model only knows it is in the right repo. The first job is finding relevant files without sending the whole repository to a model.

The application should run deterministic searches locally using tools such as:

```text
rg
find
git ls-files
dotnet sln list
directory scanning
project file parsing
```

But first, use nano to extract search terms from the task.

### SearchTermAgent

Default model: `GPT-5.4 nano`

Prompt shape:

```text
Extract likely search terms from this coding task.

Return JSON only:
{
  "domainTerms": [],
  "codeTerms": [],
  "testTerms": [],
  "fileNameHints": [],
  "negativeTerms": []
}
```

Example output:

```json
{
  "domainTerms": ["amendment", "motion", "DNum", "discrepancy"],
  "codeTerms": ["DNum", "Amendment", "Motion", "Filter"],
  "testTerms": ["Amendment", "DNum", "Motion"],
  "fileNameHints": ["Amendment", "Motion", "Discrepancy"],
  "negativeTerms": []
}
```

The application then runs searches such as:

```bash
rg "DNum|Amendment|Motion|Filter"
rg "amendment|motion|discrepancy" --glob "*.cs"
find . -name "*Amendment*"
find . -name "*Motion*"
find . -name "*Tests.cs"
```

The app should gather:

- Matching files
- Matching lines/snippets
- Number of hits per file
- Project/test project location
- File paths
- Possibly recent git history later

---

## Phase 2: File Ranking

After deterministic search, use nano to rank the candidate files.

### FileRankerAgent

Default model: `GPT-5.4 nano`

Input:

- User task
- Search terms
- Candidate file paths
- Matching snippets
- Hit counts

Prompt shape:

```text
Given this coding task and these search results, rank the files by likely relevance.

Return JSON only:
{
  "files": [
    {
      "path": "",
      "relevance": 0.0,
      "reason": "",
      "readFirst": true
    }
  ],
  "missingSearches": []
}
```

Example output:

```json
{
  "files": [
    {
      "path": "LegApp.Application/Services/AmendmentFilterService.cs",
      "relevance": 0.94,
      "reason": "Likely contains the core filtering logic mentioned by the task.",
      "readFirst": true
    },
    {
      "path": "LegApp.Tests/Services/AmendmentFilterServiceTests.cs",
      "relevance": 0.9,
      "reason": "Likely contains existing tests for amendment filtering.",
      "readFirst": true
    }
  ],
  "missingSearches": ["DNum comparison", "Motion filter"]
}
```

The app should then decide which files to read first.

Suggested initial limit:

```text
Read top 5 to 10 files initially.
Avoid reading more unless the planner asks for more context.
```

---

## Phase 3: File Summarisation

For selected files, the application reads the file content and sends it to nano for summarisation.

### FileSummariserAgent

Default model: `GPT-5.4 nano`

Prompt shape:

```text
Summarise this file for a coding agent.

Return JSON only:
{
  "path": "",
  "purpose": "",
  "importantTypes": [],
  "importantMethods": [
    {
      "name": "",
      "signature": "",
      "purpose": "",
      "relevanceToTask": ""
    }
  ],
  "dependencies": [],
  "likelyChangePoints": [],
  "testCoverageHints": [],
  "risks": []
}
```

The summariser should produce compact, structured summaries that can be reused by later agents.

Important rule:

```text
Do not repeatedly send full files to every model.
Send summaries first.
Send full files only when needed.
```

The session now has temporary repo memory for the task.

---

## Phase 4: Planning

The planning stage should normally use GPT-5.4 mini.

### PlanningAgent

Default model: `GPT-5.4 mini`  
Escalate to: `GPT-5.4`

Input:

- User task
- Classification
- Search terms
- Ranked candidate files
- File summaries
- Full content of the top few likely files where needed
- Known test files
- Known build/test commands, if available

Prompt shape:

```text
Create an implementation plan.

You are not editing files yet.

Return JSON only:
{
  "understanding": "",
  "assumptions": [],
  "filesToReadMore": [],
  "filesToChange": [
    {
      "path": "",
      "changeType": "modify | create | delete",
      "reason": ""
    }
  ],
  "testsToAddOrUpdate": [],
  "implementationSteps": [],
  "risks": [],
  "requiresEscalationToFullModel": true,
  "confidence": 0.0
}
```

Example output:

```json
{
  "understanding": "Add validation so development tickets assigned to a sprint must have points.",
  "assumptions": [
    "A sprint is considered set when the Sprint field is non-null.",
    "Only tickets with TicketType = Development require points."
  ],
  "filesToReadMore": [],
  "filesToChange": [
    {
      "path": "Application/Validators/TicketValidator.cs",
      "changeType": "modify",
      "reason": "Add conditional validation rule."
    },
    {
      "path": "Application.Tests/Validators/TicketValidatorTests.cs",
      "changeType": "modify",
      "reason": "Add tests for the new validation behaviour."
    }
  ],
  "testsToAddOrUpdate": [
    "Development ticket in sprint with null points should fail.",
    "Development ticket not in sprint with null points should pass.",
    "Non-development ticket in sprint with null points should pass."
  ],
  "implementationSteps": [
    "Add conditional validation rule.",
    "Add focused unit tests.",
    "Run relevant validator test project."
  ],
  "risks": [
    "Need to confirm exact enum/property names before editing."
  ],
  "requiresEscalationToFullModel": false,
  "confidence": 0.91
}
```

The application then decides:

```text
If confidence is high and risk is low/medium -> mini can implement.
If confidence is low or risk is high -> escalate implementation to GPT-5.4.
If the plan asks for more files -> return to discovery/summarisation.
```

---

## Phase 5: Implementation

The implementation agent should receive a focused context packet.

### ImplementationAgent

Default model:

```text
GPT-5.4 mini for low-risk/simple changes
GPT-5.4 for normal or high-risk changes
```

Input:

- User task
- Approved plan
- Relevant file summaries
- Full content of files to modify
- Full content of nearby tests
- Coding conventions
- Expected output format
- Any constraints, such as “do not modify unrelated files”

Output should be structured, preferably JSON.

Suggested output shape:

```json
{
  "summary": "",
  "changes": [
    {
      "path": "",
      "changeType": "modify | create | delete",
      "contentMode": "replace_file | unified_diff",
      "content": ""
    }
  ],
  "tests": [
    {
      "command": "",
      "reason": ""
    }
  ],
  "riskNotes": [],
  "requiresFollowUp": false
}
```

### Patch Strategy

Use a hybrid strategy:

```text
If file is small, allow full-file replacement.
If file is large, require unified diff.
```

Suggested initial rule:

```text
If file < 300 lines: allow full replacement.
If file >= 300 lines: require unified diff.
```

Full-file replacement is easier to apply but burns more output tokens.

Unified diffs are cheaper and more precise but require robust patch handling.

The application must validate:

- JSON parses
- File paths are allowed
- Files exist if being modified
- New files are in acceptable locations
- Patch applies cleanly
- No forbidden files are touched
- No secrets are printed
- No binary files are unexpectedly changed
- No unrelated broad rewrites are attempted

If patch validation fails:

```text
Return the validation error to the same model once.
If it fails twice, escalate to the next model.
```

---

## Phase 6: Build and Test

After patch application, the orchestrator runs deterministic checks.

Possible checks:

```text
dotnet build
dotnet test relevant test project
dotnet test wider solution if needed
npm test / npm run build if frontend is touched
format/lint checks if configured
```

The model should not decide whether basic checks are run. The orchestrator should decide using task classification and touched files.

### If Build/Test Passes

Proceed to review.

### If Build/Test Fails

Do not send the whole repo back to the model.

Send only:

- User task
- Plan
- Patch summary
- Changed files
- Exact build/test error
- Relevant failing file
- Relevant failing test
- Relevant project file if needed

---

## Phase 7: Failure Fixing

### BuildFailureAgent

Default model:

```text
GPT-5.4 mini for simple compiler errors
GPT-5.4 for failing tests, logic errors, or repeated failures
GPT-5.5 only after repeated GPT-5.4 failure or high-risk ambiguity
```

Prompt shape:

```text
The build or test run failed after applying this patch.

Diagnose the failure and return a corrective patch.

Return JSON only:
{
  "diagnosis": "",
  "isLikelySimpleCompilerError": true,
  "requiresMoreContext": false,
  "filesToReadMore": [],
  "changes": [
    {
      "path": "",
      "changeType": "modify | create | delete",
      "contentMode": "replace_file | unified_diff",
      "content": ""
    }
  ],
  "testsToRun": [],
  "confidence": 0.0
}
```

Suggested rules:

```text
Compiler error -> mini first
Simple missing using/type mismatch -> mini
Failing unit test -> GPT-5.4
Repeated failure -> GPT-5.4 or GPT-5.5
Ambiguous architecture issue -> GPT-5.5
```

Limit the loop.

Example:

```text
Maximum 5 total implementation/fix iterations.
Maximum 2 attempts on the same failure before escalation.
Maximum 1 GPT-5.5 call unless user has explicitly allowed more.
```

---

## Phase 8: Review

Review should be staged.

### Cheap Review

First review with nano.

### ReviewAgent

Default model: `GPT-5.4 nano`  
Escalate to: `GPT-5.4 mini` or `GPT-5.4`

Input:

- User task
- Plan
- Final diff
- Changed file summaries
- Build/test results

Prompt shape:

```text
Review this patch against the task.

Return JSON only:
{
  "passesTask": true,
  "obviousBugs": [],
  "styleIssues": [],
  "missingTests": [],
  "unrelatedChanges": [],
  "riskLevel": "low | medium | high",
  "requiresFullReview": false,
  "summary": ""
}
```

Escalate review to GPT-5.4 if:

- Nano flags medium/high risk
- The patch touches important domain logic
- The patch touches auth/security/database/public API code
- Tests were not available
- The task was high risk
- The diff is large
- There were previous failed attempts

Use GPT-5.5 review only for:

- Important/high-risk work
- Large architectural changes
- Persistent uncertainty
- Cases where GPT-5.4 and reviewer disagree
- User explicitly requests strongest review

Operational rules:

- final review must persist a concrete review status, not just "waiting"
- if a background review disappears or cannot be read back, mark it as `missing` and either relaunch explicitly or fail the phase
- prefer blocking or otherwise durable execution for the last review step until background review reliability is proven
- retries must record that the previous review attempt was lost, failed, or timed out

---

## Escalation Rules

The system should use explicit escalation rules rather than vibes.

### Nano to Mini

Escalate from nano to mini when:

- Nano confidence is below `0.75`
- More than a configured number of candidate files are relevant
- Task involves code changes, not just summarisation
- Task is medium/high risk
- Nano output fails schema validation twice
- Nano says more context is needed and cannot identify it clearly

### Mini to GPT-5.4

Escalate from mini to full GPT-5.4 when:

- Mini confidence is below `0.80`
- Plan touches more than 3 production files
- Task involves database, auth, security, public APIs, data migrations, payments, or destructive behaviour
- Task requires architecture judgement
- First implementation fails build/test in a non-trivial way
- Mini requests full-model escalation
- Review finds non-trivial risk
- The same compiler/test error appears twice

### GPT-5.4 to GPT-5.5

Escalate from GPT-5.4 to GPT-5.5 when:

- GPT-5.4 fails the same issue twice
- GPT-5.4 and reviewer disagree
- Task involves broad architecture
- Patch is large and high-impact
- There is a subtle production bug
- A final high-confidence review is needed for important work
- The user explicitly asks for the strongest model

---

## When to Ask the User

The system should not ask the user constantly.

Ask the user only when:

- The requirement is genuinely ambiguous
- There are two or more valid product behaviours
- The patch would delete, rename, migrate, or restructure significant things
- The change affects auth, security, data loss, public APIs, or irreversible behaviour
- The system has hit max iterations or max budget
- Required external information is unavailable

Do not ask the user:

- Which file to inspect
- Whether to run tests
- Whether to fix a compiler error
- Whether to add obvious tests
- Whether to inspect a clearly relevant file

The orchestrator should decide those.

---

## Budget Policy

Each session should have a budget.

Example:

```json
{
  "maxEstimatedCostUsd": 2.0,
  "maxIterations": 5,
  "maxFullModelCalls": 4,
  "maxUltraModelCalls": 1,
  "maxFilesToReadInitially": 20,
  "maxFilesToSendToImplementer": 8
}
```

Suggested behaviour:

```text
At 50% budget:
  Prefer nano/mini unless full GPT-5.4 is clearly needed.

At 80% budget:
  Stop broad discovery.
  Restrict to focused fixes and reviews.

At 100% budget:
  Stop and report partial progress, current patch state, failing checks, and recommended next step.
```

Track:

- Input tokens
- Cached input tokens
- Output tokens
- Estimated cost
- Model calls by type
- Cost per phase
- Number of files read
- Number of files sent to each model
- Build/test attempts

This telemetry is essential for later optimisation.

---

## Suggested Agent List

Start with a small set of agents.

### 1. TaskClassifierAgent

Model: `GPT-5.4 nano`

Purpose:

```text
Classify task type, risk, likely areas, and whether tests/build/runtime checks are needed.
```

### 2. SearchTermAgent

Model: `GPT-5.4 nano`

Purpose:

```text
Extract useful search terms from the task.
```

### 3. FileRankerAgent

Model: `GPT-5.4 nano`

Purpose:

```text
Rank search results and suggest which files should be read first.
```

### 4. FileSummariserAgent

Model: `GPT-5.4 nano`

Purpose:

```text
Summarise file contents into compact structured context.
```

### 5. PlanningAgent

Model: `GPT-5.4 mini`  
Escalates to: `GPT-5.4`

Purpose:

```text
Create an implementation plan.
Identify files to change.
Ask for more context if needed.
Decide whether the task needs full GPT-5.4.
```

### 6. ImplementationAgent

Model:

```text
GPT-5.4 mini for simple/low-risk tasks
GPT-5.4 for normal/high-risk tasks
```

Purpose:

```text
Generate the patch.
```

### 7. BuildFailureAgent

Model:

```text
GPT-5.4 mini for compiler errors
GPT-5.4 for test failures or repeated failures
GPT-5.5 only for difficult escalation
```

Purpose:

```text
Diagnose build/test failures and produce corrective patches.
```

### 8. ReviewAgent

Model:

```text
GPT-5.4 nano for cheap review
GPT-5.4 mini or GPT-5.4 for serious review
GPT-5.5 only for high-risk final review
```

Purpose:

```text
Check whether the patch satisfies the task and identify obvious bugs, missing tests, style issues, or unrelated changes.
```

### 9. EscalationJudge

Model: preferably no model initially.

This should mostly be deterministic application code.

Inputs:

- Risk level
- Confidence scores
- Cost spent
- Iterations used
- Files changed
- Test failures
- Review findings
- Model failure count
- Schema validation failures

Outputs:

```text
continue
ask user
escalate
stop as failed
finish
```

---

## Model Routing Table

| Phase | Default Model | Escalate To |
|---|---|---|
| Task classification | GPT-5.4 nano | GPT-5.4 mini |
| Search term extraction | GPT-5.4 nano | GPT-5.4 mini |
| File ranking | GPT-5.4 nano | GPT-5.4 mini |
| File summarisation | GPT-5.4 nano | GPT-5.4 mini |
| Planning | GPT-5.4 mini | GPT-5.4 |
| Simple patch | GPT-5.4 mini | GPT-5.4 |
| Normal patch | GPT-5.4 | GPT-5.5 |
| Compiler error fix | GPT-5.4 mini | GPT-5.4 |
| Test failure fix | GPT-5.4 | GPT-5.5 |
| Cheap review | GPT-5.4 nano | GPT-5.4 mini |
| Serious review | GPT-5.4 | GPT-5.5 |
| Architecture judgement | GPT-5.4 | GPT-5.5 |

---

## Context Management Rules

Bad pattern:

```text
Every agent receives the full conversation, full repo tree, and full file contents.
```

Good pattern:

```text
Each agent receives only:
- The user task
- The current phase
- Relevant session state
- Required output schema
- Specific files/snippets needed for that phase
```

Examples:

### FileRankerAgent receives:

- Task
- Search terms
- File paths
- Search snippets
- Hit counts

It does not need full file contents.

### PlanningAgent receives:

- Task
- Classification
- File summaries
- Selected full files where needed
- Known tests

It does not need every search result.

### ImplementationAgent receives:

- Task
- Approved plan
- Files to modify
- Relevant tests
- Coding conventions

It does not need unrelated file summaries.

### ReviewAgent receives:

- Task
- Plan
- Diff
- Build/test results
- Changed file summaries

It does not need the entire repo.

### BuildFailureAgent receives:

- Task
- Patch summary
- Changed files
- Error output
- Failing test/file
- Relevant project file

It does not need the original search results.

---

## MVP Workflow

For the first implementation, build this simple flow:

```text
1. User enters task.
2. App creates WorkSession.
3. Nano classifies task.
4. Nano extracts search terms.
5. App runs rg-based search.
6. Nano ranks candidate files.
7. App reads top-ranked files.
8. Nano summarises files.
9. Mini creates implementation plan.
10. App decides mini vs GPT-5.4 implementation.
11. If the app escalates, it records the handoff and continues the current phase immediately.
12. Implementer outputs patch.
13. App validates and applies patch.
14. App runs build/test.
15. If failed, send focused failure context to mini or GPT-5.4.
16. Nano reviews final diff.
17. Escalate review if needed, with durable review-state tracking.
18. App returns final result summary.
```

This is enough to prove the architecture before adding more advanced capabilities.

For Spira specifically, there is now a clear prerequisite split:

- **already proven:** provider-local escalation, provider binding persistence, requested/observed model tracking, checkpoints, recovery primitives
- **still to prove:** app-owned phase machine, bounded coding agents, continuation semantics, approval resilience, durable review orchestration

---

## Later Enhancements

After the MVP works, add:

- Persistent repo map
- Cached file summaries
- Known build/test commands
- Project dependency graph
- Git history hints
- Known coding conventions
- Previous successful patches
- Semantic code search
- Roslyn-based analysis
- Test discovery helpers
- Solution/project graph parsing
- Symbol indexing
- MCP/tool adapters
- Runtime/manual test environment support
- PR creation
- Commit message generation
- Branch naming integration
- Cost analytics dashboard

Do not start with all of these. Start with the deterministic workflow and model ladder.

---

## Example End-to-End Flow

User task:

```text
Add validation so development tickets in a sprint must have points.
```

### Step 1: Task classification

Nano returns:

```json
{
  "taskType": "feature",
  "likelyAreas": ["workflow", "validation", "tests"],
  "riskLevel": "medium",
  "needsTests": true,
  "needsBuild": true,
  "needsRuntime": false,
  "confidence": 0.84,
  "reasoningSummary": "This is a validation rule requiring focused tests."
}
```

### Step 2: Search terms

Nano returns:

```json
{
  "domainTerms": ["development", "sprint", "points", "ticket type"],
  "codeTerms": ["TicketType", "Sprint", "Points", "Validation"],
  "testTerms": ["TicketValidator", "Sprint", "Points"],
  "fileNameHints": ["Validator", "Workflow", "Ticket"],
  "negativeTerms": []
}
```

### Step 3: App searches repo

Example:

```bash
rg "TicketType|Sprint|Points|Validation"
```

### Step 4: File ranking

Nano returns:

```json
{
  "files": [
    {
      "path": "Application/Validators/TicketValidator.cs",
      "relevance": 0.94,
      "reason": "Likely contains the validation rules.",
      "readFirst": true
    },
    {
      "path": "Application.Tests/Validators/TicketValidatorTests.cs",
      "relevance": 0.9,
      "reason": "Likely contains existing validator tests.",
      "readFirst": true
    },
    {
      "path": "Domain/Ticket.cs",
      "relevance": 0.75,
      "reason": "Likely contains ticket properties used by the validator.",
      "readFirst": true
    }
  ],
  "missingSearches": []
}
```

### Step 5: File summaries

Nano summarises selected files.

### Step 6: Planning

Mini returns:

```json
{
  "understanding": "Development tickets assigned to a sprint must have points.",
  "assumptions": [
    "Sprint is considered assigned when Sprint or SprintId is non-null.",
    "TicketType has a Development value."
  ],
  "filesToReadMore": [],
  "filesToChange": [
    {
      "path": "Application/Validators/TicketValidator.cs",
      "changeType": "modify",
      "reason": "Add conditional rule requiring Points."
    },
    {
      "path": "Application.Tests/Validators/TicketValidatorTests.cs",
      "changeType": "modify",
      "reason": "Add tests for the new rule."
    }
  ],
  "testsToAddOrUpdate": [
    "Development ticket in sprint with null points fails.",
    "Development ticket not in sprint with null points passes.",
    "Non-development ticket in sprint with null points passes."
  ],
  "implementationSteps": [
    "Add the conditional validation rule.",
    "Add focused unit tests.",
    "Run validator test project."
  ],
  "risks": [
    "Need to verify exact property names for sprint assignment."
  ],
  "requiresEscalationToFullModel": false,
  "confidence": 0.91
}
```

### Step 7: Implementation

Because this is well-contained, mini can implement.

If the task were broader, high-risk, or touched several production files, implementation would escalate to GPT-5.4.

### Step 8: Build/test

App runs relevant tests.

If compiler errors occur, mini attempts fix.

If failing tests show logic problems, GPT-5.4 handles the fix.

### Step 9: Review

Nano reviews final diff.

If nano flags medium/high risk, escalate review to mini or GPT-5.4.

---

## Key Design Warning

Avoid this approach initially:

```text
Let GPT-5.4 mini decide which agents to call, when to call them, and when to escalate.
```

That sounds elegant, but is likely to become expensive and unpredictable.

Prefer this:

```text
Application owns the workflow.
Models perform bounded jobs.
Escalation is rule-based.
Escalation continues the active phase unless blocked.
Approval and review states are explicit.
Every output is structured.
Every phase is auditable.
```

---

## Final Suggested Architecture Summary

```text
C# orchestrator = brain/control loop
GPT-5.4 nano = cheap eyes and summariser
GPT-5.4 mini = planner and junior developer
GPT-5.4 = senior developer
GPT-5.5 = principal engineer escalation
```

The first version should be deliberately boring:

```text
Classify -> Search -> Rank -> Summarise -> Plan -> Implement -> Build/Test -> Review
```

Only once this is reliable should the system add more advanced repo intelligence, semantic search, persistent memory, MCP tools, and smarter model-driven planning.
