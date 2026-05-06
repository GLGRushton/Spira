# WorkSession Entry Gate — Planning Addendum

**Applies to:** model-escalation-architecture.md — next slice (WorkSession + pre-implementation phase machine)  
**Concern being addressed:** mission-style workflow orchestration must not leak into normal primary-station chat.

---

## 1. Entry Gate: when WorkSession activates vs when we stay conversational

### Governing principle

The **application**, not a model, decides whether to enter a WorkSession. A model may suggest it, but only the application gate commits the session to the phase machine.

### Normal station chat (no WorkSession)

Keep the default conversational path for any message that:

- asks a question or requests an explanation
- requests status, observability, or a summary of current state
- is a short clarifying follow-up (≤ 1 message in a fresh session)
- uses no imperative coding verb in isolation (no "implement", "fix", "refactor", "add", "change", "migrate", "delete")
- contains imperative verbs but clearly targets the assistant rather than the codebase (e.g. "explain this to me", "show me how", "what would happen if")
- is sent in a session that already has a WorkSession active (follow-up is absorbed into the active session, not a new one)

### WorkSession activation (opt-in, never automatic)

Activate a WorkSession only when **all three** of the following conditions are satisfied:

1. **Intent signal** — the message contains a clear coding-task intent directed at the repository (imperative verb + code artifact or area: "fix the failing test", "add DNum filtering to AmendmentFilterService", "refactor the provider binding layer").
2. **Scope signal** — the request is self-contained enough to describe discrete work with a start and end state (not a pure question with no implementation step).
3. **Activation mode** — one of:
   - the user explicitly invokes a `/task`, `/implement`, or similar command surface (preferred), **or**
   - the session provider is an escalation-capable provider (`openai-escalation`, `azure-openai-escalation`) and the gate's heuristic score clears the threshold (see §4), **or**
   - the user confirms activation after a cheap-model suggestion ("This looks like a coding task. Start a WorkSession?").

### What must never trigger WorkSession

- Any message in a non-repo-bound station session (no project root configured).
- Any pure question, even a complex one ("why does the Azure provider do X?").
- Any message in an active mission run — missions have their own lifecycle and must not be wrapped in a second WorkSession.
- Any message that re-enters an already-completed WorkSession — completed sessions are read-only; new work opens a new session.

---

## 2. Allowed middle path: model escalation without WorkSession activation

Model-tier routing can occur at any time, on any station session, without activating the WorkSession phase machine.

### Provider-layer automatic escalation (already implemented)

The `openai-escalation` and `azure-openai-escalation` providers escalate silently on:

- empty assistant response
- max tool-call iteration exhaustion for a turn
- retryable provider failure

This happens inside the provider boundary and is invisible to the WorkSession layer. It requires no WorkSession.

### Manual session escalation (already implemented)

`spira_escalate_session` can be called at any time in a station session. This promotes the session to the escalation model target and stays latched. No WorkSession is created or required.

### Gate-level escalation recommendation (new, no WorkSession)

When the gate evaluates a message and determines:

- intent is complex enough to benefit from a stronger model, but
- does not meet the full WorkSession activation criteria (e.g. it is a question with substantial reasoning burden)

The gate should emit an `EscalationRecommendation` advisory record (provider-layer only) and allow the session to escalate without entering a WorkSession. The user sees no phase chip, no budget panel, no phase transitions — just a slightly stronger model answering their question.

### Summary of middle-path decision

```text
Message arrives
  │
  ├─ Meets WorkSession criteria? ─── Yes ──► WorkSession gate (see §1)
  │
  ├─ Complex enough to warrant stronger model? ─── Yes ──► EscalationRecommendation, no WorkSession
  │
  └─ Otherwise ──► Standard conversational turn, current model, no change
```

---

## 3. Bridge UI rules

### Normal station chat (no WorkSession, no active mission)

- No phase chip.
- No budget panel.
- No workflow status indicator.
- Escalation may happen silently; the provider/model label in the status bar is sufficient indication.
- Manual escalation confirmation toast ("Escalated to GPT-5.4") remains, as it does today.

### Active WorkSession (orchestrated session)

- A persistent phase chip is visible in the chat header: `Classifying › Discovering › Summarising › Planning`.
- A lightweight budget strip shows estimated token spend and iteration count.
- A single "Cancel WorkSession" control is visible; it returns the session to conversational mode without discarding the chat history.
- Phase transitions emit a visible inline event card in the transcript (not a full message — a narrow status row).
- Escalation events within a WorkSession are shown as a compact handoff card: `↑ Promoted to GPT-5.4 — complexity threshold` (already consistent with existing handoff records).
- Blocking conditions render a blocking banner in the chat area (approval, stalled, review-failed).

### Active mission run

- Full mission lifecycle panel (existing behavior, not changed by this addendum).
- Mission panel renders independently of the WorkSession chip — they must never both be visible for the same run.
- No EscalationRecommendation middle-path logic is active during missions; all routing is controlled by the mission lifecycle.

### Rule: exactly one workflow mode per session

A station session is in exactly one of:

```text
conversational | worksession-active | mission-active
```

Transitions:

- `conversational → worksession-active`: gate approval (§1)
- `worksession-active → conversational`: user cancel, or WorkSession completion
- `conversational → mission-active`: mission launch (existing path)
- `mission-active → conversational`: mission completion (existing path)
- `worksession-active ↔ mission-active`: **forbidden** — these modes are mutually exclusive

---

## 4. Recommended architecture shape for the gate

### Location

A new `WorkSessionGate` module inside `packages/backend/src/runtime/` (or a new `worksession/` subdirectory alongside `runtime/`).

It must live at the **session intake layer** — between the message arriving at the backend and the provider turn being dispatched. This is the same layer where `RuntimeSessionKind` is determined.

It must **not** live in:

- the renderer (too late; also stateless across turns)
- the provider layer (below the decision point)
- the mission layer (wrong context)

### Inputs the gate inspects

```typescript
interface WorkSessionGateInput {
  messageText: string;           // raw user message
  sessionKind: RuntimeSessionKind; // "station" | "subagent" | "background"
  activeWorkflowStatus: RuntimeWorkflowStatus; // "idle" | "active" | ...
  activeMissionRunId: string | null; // if a mission is running, block WorkSession
  projectRootConfigured: boolean; // WorkSession requires a repo root
  providerSupportsEscalation: boolean; // only relevant for middle-path
  priorTurnCount: number;        // single-turn conversations are cheaper to keep conversational
}
```

### Gate decision output

```typescript
type WorkSessionGateDecision =
  | { kind: "conversational" }
  | { kind: "escalate-only"; reason: string }
  | { kind: "worksession"; confirmRequired: boolean; intentSummary: string };
```

### Classification logic (cheap, no model call by default)

Phase 1 (pure heuristic, synchronous):

1. If `activeMissionRunId !== null` → `conversational` (hard block).
2. If `activeWorkflowStatus === "active"` → `conversational` (already in WorkSession, absorb).
3. If `!projectRootConfigured` → `conversational`.
4. If `sessionKind !== "station"` → `conversational`.
5. Score the message text against a lightweight keyword/pattern set:
   - Imperative verb set: implement, fix, add, remove, refactor, migrate, update, delete, rename, extract, move, create, write, generate.
   - Qualifier set: "in `<file>`", "the `<TypeName>`", "the `<method>`", a code-fenced block, a file path token.
   - Question patterns: starts with wh-word or "how", ends with "?", contains "explain" or "understand" or "what is".
6. If question score > implementation score → `conversational` or `escalate-only`.
7. If implementation score exceeds threshold and a qualifier is present → `worksession` (with `confirmRequired: true` for the first activation, `false` if user has a confirmed explicit invoke command).

Phase 2 (optional cheap model call, only when score is ambiguous):

- Send the message to the nano-tier model with a strict JSON classification prompt.
- Result feeds back into the gate decision.
- Gate must have a timeout fallback; on timeout, default to `conversational`.

### Threshold recommendation

Start conservative: require both an imperative verb **and** a code-artifact qualifier to reach `worksession`. Relax only after observing false negatives in practice. A false negative (staying conversational when WorkSession would have helped) is much safer than a false positive (entering the phase machine for a question).

---

## 5. Edge cases and failure modes to guard against

### 5a. Gradual escalation across turns ("the boiling frog")

**Risk:** the user asks a question, then a follow-up, then a more specific follow-up that is actually an implementation request. Each message in isolation looks safe, but by turn 3 the session has drifted into implementation territory without explicit gate evaluation.

**Guard:** the gate must re-evaluate on **every new user message**, not just on session start. The `priorTurnCount` input supports this. If the gate changes its decision from `conversational` to `worksession`, it should surface a clear transition prompt rather than silently entering the phase machine mid-conversation.

---

### 5b. WorkSession activation during an active mission

**Risk:** the user has a mission run open, then sends a follow-up message to the primary station that passes the WorkSession heuristic.

**Guard:** `activeMissionRunId !== null` is a hard block in the gate (step 1 in §4). No further scoring. Missions and WorkSessions are mutually exclusive per session.

---

### 5c. Short, low-scope requests that are technically implementation ("add a log line")

**Risk:** tiny tasks enter the full classify → discover → summarise → plan pipeline and waste time and money on overhead that exceeds the actual work.

**Guard:** the WorkSession phase machine should have a `trivial` fast-path exit after classify. If the `TaskClassifierAgent` returns `riskLevel: "low"` and `confidence > 0.85` and the estimated change is a single file, the WorkSession should skip discover/summarise and go straight to plan with the current context window. The gate itself should not try to distinguish trivial vs non-trivial — let classify do that inside the session.

---

### 5d. Gate nano model call failure or timeout

**Risk:** if the gate relies on a cheap model call to resolve ambiguous messages, a model timeout introduces latency into every message.

**Guard:** the model call is optional and must have a short timeout (≤ 2 seconds). On any failure or timeout, the gate defaults to `conversational`. The phase-1 heuristic alone is sufficient to handle the unambiguous majority.

---

### 5e. Provider mismatch (non-escalation provider + WorkSession)

**Risk:** a WorkSession starts on a non-escalation provider. As the phase machine runs and complexity increases, there is no escalation path available, so the session is stuck on the base model.

**Guard:** the gate should include a `providerCapabilityWarning` in the `worksession` decision output when `providerSupportsEscalation === false`. The UI should surface this as a soft advisory ("WorkSession is active, but this provider cannot escalate if needed"). The session should still proceed — don't block it — but the user should know.

---

### 5f. WorkSession leaked into a subagent or background session

**Risk:** a subagent receives a message that happens to pass the WorkSession gate heuristic and inadvertently enters the phase machine.

**Guard:** `sessionKind !== "station"` is a hard block in the gate (step 4 in §4). WorkSessions are exclusively primary-station constructs.

---

### 5g. Re-entry into a completed WorkSession

**Risk:** the user sends a new message after a WorkSession completes. The workflow status is `complete`, which could be misread as `idle` and trigger a new WorkSession.

**Guard:** treat `complete` the same as `active` for gate purposes (absorbed into conversational). A new WorkSession always starts from `idle`. A session reset is required before a new WorkSession can open, or a new session is created.

---

### 5h. User intent drift after WorkSession confirmation

**Risk:** the user confirms WorkSession activation ("yes, start"), but their next message is actually a clarifying question that should not advance the phase machine.

**Guard:** once WorkSession is `active`, follow-up questions in the same session are answered by the active phase's model without advancing to the next phase. Only the application advances phases — models cannot self-advance. A question during `classify` is answered and the session remains in `classify`.

---

## 6. Concise recommendation (merge-ready)

> **Add a `WorkSessionGate` module at the session intake layer in `packages/backend/src/runtime/` (or a peer `worksession/` directory). The gate is the single decision point that separates conversational station chat from WorkSession-orchestrated execution. It inspects the message, the session kind, any active mission run, the project configuration, and a lightweight heuristic score. WorkSession activation requires an explicit imperative verb AND a code-artifact qualifier; questions default to conversational. A middle path (`escalate-only`) allows provider-layer model escalation without entering the phase machine. Bridge UI renders a phase chip and budget strip only when WorkSession is active; normal chat has no phase indicators. WorkSessions and mission runs are mutually exclusive per session. The gate defaults to `conversational` on any ambiguity, timeout, or error — a false negative is always safer than a false positive.**

### Key constraints to carry into implementation

| Constraint | Where enforced |
|---|---|
| WorkSession never activates in subagent/background sessions | Gate: `sessionKind` check (hard block) |
| WorkSession never activates during an active mission | Gate: `activeMissionRunId` check (hard block) |
| Follow-up messages in an active WorkSession are absorbed, not re-gated | Gate: `activeWorkflowStatus === "active"` check |
| Phase advancement is application-owned, not model-owned | Phase machine design (existing principle) |
| Gate defaults to `conversational` on ambiguity | Gate: conservative threshold + timeout fallback |
| Escalation can occur without WorkSession | Provider layer + EscalationRecommendation advisory |
| Exactly one workflow mode per session | Gate + UI mode enum |

---

*This addendum is intended to be appended or linked from `model-escalation-architecture.md` under the "Not implemented yet" section as a prerequisite constraint on the WorkSession slice.*
