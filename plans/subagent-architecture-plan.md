# Domain-Scoped Stateless Subagents — Implementation Plan

## 1. Executive Summary

Add a subagent orchestration layer between the main Shinra Copilot session and the MCP tool pool so that Shinra can delegate domain-scoped work to stateless, single-turn Copilot sessions. Each subagent is provisioned with a filtered tool set, runs in its own ephemeral Copilot session, and reports results back through a typed envelope contract. The renderer already has agent-room infrastructure; this plan extends it to show first-class subagent activity.

---

## 2. Phased Plan

### Phase 0 — Shared Types & Event Contracts (≈ 1–2 days)

**Goal:** Establish every type, event, and contract before touching runtime code.

**Work items:**
1. Define `SubagentDomain` union and `SubagentDomainConfig` map in `packages/shared/src/subagent-types.ts`.
2. Define `SubagentEnvelope<T>` result contract (shared envelope + domain payload).
3. Define `SubagentIntentDeclaration` / `SubagentLockClaim` for intent-before-write.
4. Define `SubagentStateChange` normalized machine-first mutation type.
5. Add new events to `EventMap` in `packages/backend/src/util/event-bus.ts`:
   - `subagent:launched`, `subagent:intent`, `subagent:lock-claim`, `subagent:tool-call`, `subagent:tool-result`, `subagent:completed`, `subagent:failed`, `subagent:retry`.
6. Extend `ServerMessage` union in `packages/shared/src/protocol.ts` with subagent message types so the renderer can subscribe.

**Why first:** Every subsequent phase imports these types. Getting them wrong early costs exponentially more later.

---

### Phase 1 — Domain Registry & Scoped Tool Filtering (≈ 1–2 days)

**Goal:** A static, config-driven mapping from domain name → set of MCP server IDs, plus a way to build a scoped `McpToolAggregator` for each domain.

**Work items:**

1. **New file: `packages/backend/src/subagent/domain-registry.ts`**
   - Hardcoded initial map (expandable later):
     ```
     windows  → ["windows-system", "windows-ui", "vision"]
     spira    → ["spira-ui"]
     nexus    → ["nexus-mods"]
     ```
   - Expose `getDomainConfig(domain): SubagentDomainConfig`.
   - Expose `getDomainsForTool(toolName): SubagentDomain[]` (reverse lookup, useful for auto-routing).

2. **New file: `packages/backend/src/subagent/scoped-aggregator.ts`**
   - Wraps `McpClientPool` but filters `allTools()` / `listTools()` to only the server IDs for the requested domain.
   - Implements the same `McpToolAggregator` interface (or a duck-type subset) so `getCopilotTools()` works unmodified.
   - Exposes `getScopedAggregator(domain, pool): McpToolAggregator`.

3. **Modification: `packages/backend/src/copilot/tool-bridge.ts`**
   - No changes to the function signature.
   - `getCopilotTools()` already accepts an `McpToolAggregator`; the scoped aggregator plugs in transparently.
   - Confirm that `spira_propose_upgrade` is **not** included in subagent tool sets (controlled by passing `options` without `requestUpgradeProposal`).

**Risk:** If any MCP tool names collide across servers assigned to different domains this is fine today (tool names are globally unique), but the scoped aggregator should still validate uniqueness within its filtered set and log a warning if a tool from an excluded server shares a name.

---

### Phase 2 — Subagent Session Lifecycle (≈ 3–4 days, critical path)

**Goal:** A `SubagentRunner` that creates a throwaway Copilot session, sends one prompt, collects the result, and tears down.

**Work items:**

1. **New file: `packages/backend/src/subagent/subagent-runner.ts`**
   - Class: `SubagentRunner`
   - Constructor: `(bus, env, pool, domain, runId)`
   - Core method: `async run(prompt: string, options?: SubagentRunOptions): Promise<SubagentEnvelope>`
   - Lifecycle:
     1. Build scoped aggregator for `domain`.
     2. Create throwaway `CopilotClient` + `CopilotSession` (no persistence, no resume).
        - **Important:** Reuse the existing `CopilotClient` from the main session manager rather than spawning a second `copilot.exe`. The `CopilotClient.createSession()` can create multiple sessions on one client.
     3. Inject a subagent-specific system prompt (domain-aware, stateless instructions, no Shinra persona).
     4. `session.send({ prompt })`, collect streaming events.
     5. On completion: package result into `SubagentEnvelope`, emit `subagent:completed`, disconnect session.
     6. On error: emit `subagent:failed`. If `retryable && retryCount < 1`, re-run once (Phase 0 contract says 1 auto retry).
   - All tool-call / tool-result events forwarded to bus as `subagent:tool-call` / `subagent:tool-result` (tagged with `runId` + `domain`).

2. **New file: `packages/backend/src/subagent/subagent-orchestrator.ts`**
   - Class: `SubagentOrchestrator`
   - Singleton-ish lifecycle, owned by `index.ts`.
   - Exposes: `async dispatch(domain, prompt, options): Promise<SubagentEnvelope>`.
   - Manages concurrency: at most one active runner **per domain** (serial within a domain, parallel across disjoint domains).
   - Manages the intent/lock protocol (Phase 3).
   - Shares the `CopilotClient` instance from `CopilotSessionManager` — requires a small accessor (`getClient()`) added to `session-manager.ts`.

3. **Modification: `packages/backend/src/copilot/session-manager.ts`**
   - Add `getClient(): CopilotClient | null` public accessor.
   - No other changes in Phase 2; Shinra's own session is untouched.

4. **New delegation tools registered with Shinra's session (via tool-bridge):**

   **New file: `packages/backend/src/subagent/delegation-tools.ts`**
   - `defineTool("delegate_to_windows", { ... })` — Calls `orchestrator.dispatch("windows", prompt)`.
   - `defineTool("delegate_to_spira", { ... })` — Calls `orchestrator.dispatch("spira", prompt)`.
   - `defineTool("delegate_to_nexus", { ... })` — Calls `orchestrator.dispatch("nexus", prompt)`.
   - Each tool returns the `SubagentEnvelope` serialized as `textResultForLlm`.
   - These tools are **always** added to Shinra's tool set (via `getCopilotTools` modification or a new `getDelegationTools()` exported from delegation-tools.ts and merged in `getSessionConfig()`).

5. **Modification: `packages/backend/src/copilot/tool-bridge.ts`**
   - Import and append delegation tools alongside the existing MCP tools + upgrade tool.
   - Alternatively, keep `getCopilotTools()` clean and have `session-manager.ts` concat the delegation tools itself in `getSessionConfig()`. (Prefer this — keeps tool-bridge focused on MCP mapping.)

6. **Modification: `packages/backend/src/index.ts`**
   - Instantiate `SubagentOrchestrator` after `CopilotSessionManager`.
   - Wire `orchestrator` into the delegation tools / session manager.

**Key design decision — Client sharing:**
The `CopilotClient` represents a running `copilot.exe` process. Spawning one per subagent is wasteful and fragile. The client supports multiple concurrent sessions. The orchestrator should borrow the client from the session manager (or maintain a shared client factory). A `getOrCreateClient()` extracted to a small `CopilotClientFactory` would be cleanest, but for v1 a simple `getClient()` accessor is sufficient.

**Risk:** The Copilot SDK may not gracefully handle many concurrent sessions on one client. Mitigate by starting with serial execution per domain and monitoring for SDK errors. The 1-subagent-per-domain concurrency cap is safe.

---

### Phase 3 — Intent Declaration & Lock Arbitration (≈ 2 days)

**Goal:** Before a subagent performs a stateful/destructive action, it must declare intent and obtain a lock from the orchestrator. This prevents two subagents from writing conflicting state.

**Work items:**

1. **New file: `packages/backend/src/subagent/lock-manager.ts`**
   - `SubagentLockManager`
   - `claimLock(runId, domain, resource: string): boolean`
   - `releaseLock(runId): void`
   - `releaseAllForRun(runId): void`
   - Resources are string identifiers like `"system:volume"`, `"ui:spira-navigation"`, `"nexus:download"`.
   - Simple in-memory map; no need for distributed locks in a single-process Electron app.

2. **Intent-aware tool wrappers in scoped aggregator:**
   - For tools annotated with `destructiveHint: true` or `readOnlyHint: false`, the scoped aggregator wraps the handler:
     1. Emit `subagent:intent` event with `{ runId, domain, toolName, args }`.
     2. Attempt `lockManager.claimLock(runId, domain, inferredResource(toolName))`.
     3. If lock acquired → execute tool → release lock.
     4. If lock denied → return failure result explaining contention.
   - Read-only tools execute without locking.

3. **Modification: `packages/backend/src/subagent/subagent-runner.ts`**
   - Accept `lockManager` in constructor.
   - Pass it to the scoped aggregator wrapper.

**Risk:** Inferring the "resource" from a tool name is heuristic. For v1, use `domain:toolName` as the resource key (coarse but safe). Finer-grained resource keys can be added per-tool later.

---

### Phase 4 — Renderer Integration & Agent Rooms (≈ 2–3 days)

**Goal:** Subagent work appears in dedicated agent rooms in the renderer. The main chat shows a compact delegation summary, not full tool-by-tool output.

**Work items:**

1. **Modification: `packages/shared/src/protocol.ts`**
   - Add `ServerMessage` variants:
     ```
     | { type: "subagent:launched"; runId; domain; prompt }
     | { type: "subagent:tool-call"; runId; domain; callId; toolName; args }
     | { type: "subagent:tool-result"; runId; domain; callId; result }
     | { type: "subagent:completed"; runId; domain; envelope: SubagentEnvelope }
     | { type: "subagent:failed"; runId; domain; error: string }
     | { type: "subagent:retry"; runId; domain; attempt: number; reason: string }
     ```

2. **Modification: `packages/backend/src/server.ts` (WsServer)**
   - Register bus handlers for each new `subagent:*` event → forward as corresponding `ServerMessage`.

3. **Modification: `packages/renderer/src/stores/room-store.ts`**
   - On `subagent:launched`: create a new `AgentRoom` with `roomId: "agent:subagent-${runId}"`, status `"launching"`, label = domain display name.
   - On `subagent:tool-call` / `subagent:tool-result`: create/update `ToolFlight` entries routed to the subagent room.
   - On `subagent:completed`: transition room to `"idle"`, attach envelope summary.
   - On `subagent:failed`: transition room to `"error"`.
   - On `subagent:retry`: update room caption to indicate retry.
   - Existing pruning logic (5 min idle → remove) applies.

4. **Modification: `packages/shared/src/spira-ui-control.ts`**
   - Extend `SpiraUiAgentRoomSummary` with optional `domain?: SubagentDomain` field.
   - No breaking changes; the external MCP tool bridge gets richer agent-room data.

5. **Renderer UI (minimal for v1):**
   - Existing agent room detail view should work as-is since it renders `ToolFlight` entries.
   - Add a small domain icon/badge to the agent room card (domain-aware).
   - In main chat: when `delegate_to_*` tool completes, the tool result bubble shows a compact summary ("Windows agent: set volume to 50%, brightness to 70%") rather than raw JSON.

**Risk:** The existing `resolveTargetRoomId()` in room-store routes based on tool names like `task`, `read_agent`. The new `delegate_to_*` tools won't match those patterns. Need a new detection branch: if tool name starts with `delegate_to_`, create a subagent room. Alternatively, emit the `subagent:launched` event and let the room store react to that rather than tool-call heuristics.

**Recommended approach:** Decouple room creation from tool-name sniffing. React to `subagent:launched` ServerMessage directly. This is cleaner and forward-compatible.

---

### Phase 5 — Logging, Traceability & Observability (≈ 1–2 days)

**Goal:** Heavy structured logging for every subagent lifecycle event, with trace IDs that connect Shinra's delegation call → subagent session → individual tool executions.

**Work items:**

1. **Trace ID propagation:**
   - `runId` (UUID) generated by the orchestrator at dispatch time.
   - Every log line from `SubagentRunner`, `SubagentOrchestrator`, scoped aggregator, and lock manager includes `{ runId, domain }`.
   - Every event bus emission includes `runId`.

2. **New logger instances:**
   - `createLogger("subagent-orchestrator")`
   - `createLogger("subagent-runner")`
   - `createLogger("subagent-lock")`
   - `createLogger("subagent-domain")`

3. **Structured log points (all at `info` level minimum):**
   - Dispatch received: `{ runId, domain, promptLength }`
   - Session created: `{ runId, domain, sessionId, toolCount }`
   - Tool execution start: `{ runId, domain, toolName, callId }`
   - Tool execution complete: `{ runId, domain, toolName, callId, durationMs, success }`
   - Intent declared: `{ runId, domain, toolName, resource }`
   - Lock claimed/denied/released: `{ runId, domain, resource, outcome }`
   - Subagent completed: `{ runId, domain, durationMs, toolCallCount, retryCount, envelopeSize }`
   - Subagent failed: `{ runId, domain, durationMs, error, willRetry }`
   - Retry started: `{ runId, domain, attempt, reason }`

4. **Timing:**
   - `SubagentRunner.run()` records `startedAt` and `completedAt` on the envelope.
   - Individual tool durations tracked in `subagent:tool-result` event payload.

5. **Pino child loggers:**
   - Use `logger.child({ runId, domain })` inside `SubagentRunner` so every log line from that run is automatically tagged.

**Risk:** Over-logging in production. Mitigate by using `debug` level for tool args/results payloads and `info` for lifecycle events. The existing `logger.ts` already respects `NODE_ENV` for level selection.

---

## 3. Key Code Surfaces Affected

| File | Change Type | Description |
|------|------------|-------------|
| `packages/shared/src/subagent-types.ts` | **New** | All shared subagent types |
| `packages/shared/src/protocol.ts` | Modify | Add `ServerMessage` variants for subagent events |
| `packages/shared/src/spira-ui-control.ts` | Modify | Add `domain` field to `SpiraUiAgentRoomSummary` |
| `packages/shared/src/index.ts` | Modify | Re-export new types |
| `packages/backend/src/util/event-bus.ts` | Modify | Add `subagent:*` events to `EventMap` |
| `packages/backend/src/subagent/domain-registry.ts` | **New** | Domain → server ID mapping |
| `packages/backend/src/subagent/scoped-aggregator.ts` | **New** | Filtered `McpToolAggregator` per domain |
| `packages/backend/src/subagent/subagent-runner.ts` | **New** | Ephemeral Copilot session per delegation |
| `packages/backend/src/subagent/subagent-orchestrator.ts` | **New** | Concurrency, dispatch, client sharing |
| `packages/backend/src/subagent/delegation-tools.ts` | **New** | `delegate_to_*` tools for Shinra |
| `packages/backend/src/subagent/lock-manager.ts` | **New** | Intent/lock arbitration |
| `packages/backend/src/copilot/session-manager.ts` | Modify | Expose `getClient()` accessor |
| `packages/backend/src/copilot/tool-bridge.ts` | Modify (minor) | Possibly concat delegation tools |
| `packages/backend/src/server.ts` | Modify | Forward `subagent:*` events to renderer |
| `packages/backend/src/index.ts` | Modify | Wire orchestrator into backend lifecycle |
| `packages/renderer/src/stores/room-store.ts` | Modify | Handle `subagent:*` messages, create subagent rooms |
| `packages/renderer/src/hooks/useIpc.ts` | Modify | Register handlers for new `ServerMessage` types |

---

## 4. Suggested Data Contracts / Types

### `packages/shared/src/subagent-types.ts`

```typescript
// ── Domain Configuration ──

export type SubagentDomain = "windows" | "spira" | "nexus";

export interface SubagentDomainConfig {
  domain: SubagentDomain;
  displayName: string;            // "Windows Agent", "Spira Agent", "Nexus Agent"
  serverIds: string[];            // MCP server IDs in this domain
  systemPromptOverride?: string;  // Domain-specific instructions
  maxConcurrent: number;          // 1 for v1
}

// ── Result Envelope ──

export interface SubagentEnvelope<T = unknown> {
  runId: string;                  // UUID, trace correlation key
  domain: SubagentDomain;
  status: "success" | "failure" | "timeout";
  summary: string;                // LLM-generated human summary
  stateChanges: SubagentStateChange[];  // Machine-readable mutations
  payload: T;                     // Domain-specific structured data
  toolCallCount: number;
  retryCount: number;
  startedAt: number;              // epoch ms
  completedAt: number;            // epoch ms
  durationMs: number;
  error?: string;                 // Present when status !== "success"
}

// ── Normalized State Changes ──

export interface SubagentStateChange {
  domain: SubagentDomain;
  resource: string;               // e.g. "system:volume", "nexus:download"
  action: "read" | "write" | "create" | "delete";
  before?: unknown;               // Snapshot before (if available)
  after?: unknown;                // Snapshot after (if available)
  toolName: string;               // Which tool performed this
  callId: string;
}

// ── Intent & Locking ──

export interface SubagentIntentDeclaration {
  runId: string;
  domain: SubagentDomain;
  toolName: string;
  resource: string;
  action: "read" | "write" | "create" | "delete";
  args?: Record<string, unknown>;
}

export interface SubagentLockClaim {
  runId: string;
  domain: SubagentDomain;
  resource: string;
  granted: boolean;
  heldBy?: string;                // runId of holder if denied
}

// ── Run Options ──

export interface SubagentRunOptions {
  maxRetries?: number;            // Default 1
  timeoutMs?: number;             // Per-run timeout
  parentCallId?: string;          // Shinra's tool-call ID that triggered this
}
```

### Event Bus Additions (`EventMap`)

```typescript
"subagent:launched":   [runId: string, domain: SubagentDomain, prompt: string, parentCallId?: string];
"subagent:intent":     [declaration: SubagentIntentDeclaration];
"subagent:lock-claim": [claim: SubagentLockClaim];
"subagent:tool-call":  [runId: string, domain: SubagentDomain, callId: string, toolName: string, args: Record<string, unknown>];
"subagent:tool-result":[runId: string, domain: SubagentDomain, callId: string, result: unknown, durationMs: number];
"subagent:completed":  [envelope: SubagentEnvelope];
"subagent:failed":     [runId: string, domain: SubagentDomain, error: string, willRetry: boolean];
"subagent:retry":      [runId: string, domain: SubagentDomain, attempt: number, reason: string];
```

### Protocol Additions (`ServerMessage`)

```typescript
| { type: "subagent:launched"; runId: string; domain: SubagentDomain; prompt: string }
| { type: "subagent:tool-call"; runId: string; domain: SubagentDomain; callId: string; toolName: string; args: Record<string, unknown> }
| { type: "subagent:tool-result"; runId: string; domain: SubagentDomain; callId: string; result: unknown; durationMs: number }
| { type: "subagent:completed"; runId: string; domain: SubagentDomain; envelope: SubagentEnvelope }
| { type: "subagent:failed"; runId: string; domain: SubagentDomain; error: string }
| { type: "subagent:retry"; runId: string; domain: SubagentDomain; attempt: number; reason: string }
```

---

## 5. Logging / Observability Plan

### Structured Fields (always present in subagent logs)

| Field | Source | Description |
|-------|--------|-------------|
| `runId` | Orchestrator | Correlation ID for the entire subagent run |
| `domain` | Domain registry | Which domain this run belongs to |
| `parentCallId` | Delegation tool | Shinra's tool-call ID that initiated delegation |
| `sessionId` | Runner | The ephemeral Copilot session ID |

### Log Levels

| Level | What |
|-------|------|
| `info` | Lifecycle events: launched, completed, failed, retry, lock claim/release |
| `debug` | Tool call args, tool result payloads, prompt text, envelope contents |
| `warn` | Lock contention, retry triggers, session creation failures |
| `error` | Unrecoverable failures, SDK errors, timeout |

### Event Flow for a Typical Delegation

```
1. [info]  subagent-orchestrator  dispatch received     { runId, domain, promptLength, parentCallId }
2. [info]  subagent-runner        session created        { runId, domain, sessionId, toolCount }
3. [debug] subagent-runner        prompt sent            { runId, domain, promptLength }
4. [info]  subagent-runner        tool execution start   { runId, domain, toolName, callId }
5. [debug] subagent-runner        tool args              { runId, domain, toolName, callId, args }
6. [info]  subagent-lock          lock claimed           { runId, domain, resource, granted: true }
7. [info]  subagent-runner        tool execution end     { runId, domain, toolName, callId, durationMs, success }
8. [info]  subagent-lock          lock released          { runId, domain, resource }
9. [info]  subagent-runner        subagent completed     { runId, domain, durationMs, toolCallCount, retryCount }
10.[debug] subagent-runner        envelope               { runId, domain, envelope }
```

### Renderer Observability

- Agent rooms already show `activeToolCount` and `lastToolName`.
- `SubagentEnvelope.durationMs` surfaced in room detail view as run duration.
- `stateChanges` array surfaced as a compact change log in the agent room.

### Future (not v1)

- Metrics aggregation (p50/p95 subagent durations per domain).
- Persistent subagent run log in `SpiraMemoryDatabase`.

---

## 6. Testing Plan

### Unit Tests

| Test File | What It Covers |
|-----------|---------------|
| `packages/backend/src/subagent/domain-registry.test.ts` | Domain → server ID mapping, reverse lookup, unknown domain handling |
| `packages/backend/src/subagent/scoped-aggregator.test.ts` | Tool filtering by server ID, uniqueness validation, executeTool routing |
| `packages/backend/src/subagent/lock-manager.test.ts` | Claim/release semantics, contention, releaseAllForRun cleanup |
| `packages/backend/src/subagent/subagent-runner.test.ts` | Session lifecycle (mock CopilotClient), retry logic, timeout, envelope construction, event emissions |
| `packages/backend/src/subagent/subagent-orchestrator.test.ts` | Dispatch routing, per-domain concurrency cap, client sharing, error propagation |
| `packages/backend/src/subagent/delegation-tools.test.ts` | Tool definitions, arg validation, result serialization |
| `packages/shared/src/subagent-types.test.ts` | Type guards, envelope validation (if Zod schemas added) |

### Integration-Level Tests

| Scenario | How to Test |
|----------|-------------|
| Scoped aggregator + real McpClientPool (mocked servers) | Create pool with fake server entries, verify scoped aggregator only exposes correct tools |
| Delegation tool → orchestrator → runner → scoped aggregator | End-to-end with mocked CopilotClient; verify envelope returned to Shinra |
| Lock contention between two concurrent dispatches | Dispatch two different domains in parallel, verify no lock collision; dispatch same domain, verify serial execution |
| Retry on transient failure | Mock CopilotSession.send() to fail once then succeed; verify retry count = 1 in envelope |

### Renderer Tests

| Test File | What It Covers |
|-----------|---------------|
| `packages/renderer/src/stores/room-store.test.ts` (extend existing) | Subagent room creation from `subagent:launched`, status transitions, tool flight routing, pruning |

### Manual Testing Checklist

- [ ] Ask Shinra "set volume to 50%" → verify delegation to Windows agent, result in main chat, detail in agent room.
- [ ] Ask Shinra "navigate to MCP view" → verify delegation to Spira agent.
- [ ] Ask Shinra "search Nexus for Skyrim mods" → verify delegation to Nexus agent.
- [ ] Ask two disjoint tasks simultaneously ("set volume to 50% and search Nexus for Skyrim") → verify parallel execution.
- [ ] Force a tool failure → verify single retry, then failure envelope.
- [ ] Force lock contention → verify denial message in subagent result.
- [ ] Verify main chat shows compact delegation summary, not raw tool logs.
- [ ] Verify agent room shows full tool-by-tool detail.

---

## 7. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **CopilotClient can't handle concurrent sessions** | High | v1 shares client but caps at 1 session per domain. Add circuit breaker: if session creation fails, fall back to serial queue across all domains. |
| **Subagent hallucinates tools it doesn't have** | Medium | Subagent system prompt explicitly lists available tools. Scoped aggregator rejects unknown tool names. |
| **Session creation latency** | Medium | Subagents are ephemeral; each dispatch pays session creation cost. Mitigate with a session pool later (deferred). |
| **Event bus congestion from parallel subagents** | Low | Events are in-process; Node.js EventEmitter is synchronous. No real congestion risk at this scale. |
| **Lock manager doesn't survive backend reload** | Low | Acceptable for v1. Locks are ephemeral like the subagent sessions. A reload clears all in-flight runs anyway. |
| **Subagent prompt engineering** | Medium | Subagent prompts need iteration. Start with minimal instructions; expand based on quality. Separate prompt files per domain for easy tuning. |
| **Breaking the existing tool-call → room-store routing** | Medium | Decouple subagent room creation from tool-name heuristics. Use dedicated `subagent:launched` event, not `copilot:tool-call` for delegation tools. |

---

## 8. What to Defer for v1

| Deferred Item | Reason |
|---------------|--------|
| **Session pooling / warm sessions** | Adds complexity; measure cold-start latency first. |
| **Dynamic domain discovery** | Hardcoded 3 domains is sufficient. Dynamic MCP server → domain mapping can come later. |
| **Subagent ↔ subagent communication** | Out of scope; subagents are independent. |
| **Subagent memory / context carryover** | Subagents are stateless by design. Shinra owns context. |
| **User-configurable domain mapping** | Settings UI not needed yet. |
| **Fine-grained resource locks** | `domain:toolName` granularity is sufficient for v1. Per-argument locks (e.g., "volume" vs "brightness") add complexity. |
| **Persistent subagent run history** | Log to pino for now. Database persistence for historical runs can follow. |
| **Subagent cost/token tracking** | Not available from Copilot SDK today. |
| **Abort/cancel in-flight subagent** | Subagents are short-lived. If needed, add `SubagentRunner.abort()` later. |
| **Streaming subagent text to agent room** | v1 shows tool flights only. Streaming LLM text from subagents to the room UI is a nice-to-have. |
| **Custom subagent models / providers** | All subagents use the same Copilot backend as Shinra for v1. |
| **stateChanges population** | The `stateChanges` field on the envelope is defined but may be empty for v1 tools that don't report before/after snapshots. Populating it requires per-tool cooperation. |

---

## 9. Dependency Graph (Phase Ordering)

```
Phase 0 (types)
    │
    ├──→ Phase 1 (domain registry + scoped aggregator)
    │        │
    │        └──→ Phase 2 (runner + orchestrator + delegation tools) ← critical path
    │                 │
    │                 ├──→ Phase 3 (lock manager + intent)
    │                 │
    │                 └──→ Phase 4 (renderer integration)
    │
    └──→ Phase 5 (logging) ← can be woven into each phase incrementally
```

Phases 3 and 4 can proceed in parallel after Phase 2.

---

## 10. Estimated Timeline

| Phase | Effort | Can Parallelize With |
|-------|--------|---------------------|
| Phase 0 | 1–2 days | Nothing (foundation) |
| Phase 1 | 1–2 days | Nothing (depends on Phase 0) |
| Phase 2 | 3–4 days | Nothing (depends on Phase 1) |
| Phase 3 | 2 days | Phase 4 |
| Phase 4 | 2–3 days | Phase 3 |
| Phase 5 | Incremental | Woven into all phases |

**Total: ~10–13 working days** for a feature-complete v1 with tests.
