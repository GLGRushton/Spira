# Station-Backed Missions — Architecture Plan

## 1. Problem Statement

Missions currently run inside a synthetic `missions-worker` SubagentRunner, launched
via `stationRegistry.launchManagedSubagent(...)` on the primary station
(`index.ts:1304`). Each attempt is tracked by a `subagentRunId` stored in
`ticket_run_attempts` (`ticket-runs.ts:491`).

This creates three architectural problems:

| Problem | Root cause |
|---|---|
| **60-second completion timeout** | `COMPLETION_TIMEOUT_MS = 60_000` in `subagent-runner.ts:44` applies to every turn. Mission work can easily exceed this, making completion detection fragile and timeout-dependent. |
| **No first-class conversation history** | SubagentRunner uses a private `StreamAssembler` and in-memory `RunContext`. There is no persisted conversation thread — only a flat `summary` string survives in the attempt row. Multi-turn context relies on session reuse, not on durable transcript. |
| **Station semantics are wasted** | The mission piggy-backs on `DEFAULT_STATION_ID`'s `CopilotSessionManager` only to borrow its Copilot client. It never exposes station-level state, streaming, or conversation controls to the renderer. Mission work is invisible in the Operations Roster. |

**Goal:** Missions should own a first-class command station — with its own session,
conversation, event bus, streaming, and persistence — eliminating the SubagentRunner
intermediary entirely.

---

## 2. Target Architecture

### 2.1 One Station Per Mission Run

When a ticket run transitions from `ready → working`, the system creates (or
reclaims) a dedicated `StationContext` via `stationRegistry.createStation()`:

```
StationId  = `mission:${runId}`
Label      = `Mission: ${ticketId}`
```

This station has all the capabilities of any other station:
- Its own `CopilotSessionManager` (with independent Copilot session)
- Its own `SpiraEventBus` instance (station-scoped)
- Its own `activeConversationId` (persisted in `session_state`)
- Standard event listeners attached by `attachStationListeners()`

The station is **not** the primary station. Mission work never competes with or
interrupts the user's interactive session.

### 2.2 Component Diagram

```
┌───────────────────────────────────────────────────────┐
│                    StationRegistry                     │
│  stations: Map<StationId, StationContext>              │
│  ┌────────────┐  ┌─────────────────────┐  ┌────────┐ │
│  │ "primary"  │  │ "mission:{runId-1}" │  │  ...   │ │
│  │ (user UI)  │  │ (ticket ABC-123)    │  │        │ │
│  └────────────┘  └─────────────────────┘  └────────┘ │
└───────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
  CopilotSessionManager  CopilotSessionManager
  (interactive turns)    (mission turns — no SubagentRunner)
         │                    │
         ▼                    ▼
  CopilotSession          CopilotSession
  (resumable)             (resumable, long-lived)
```

### 2.3 No More SubagentRunner for Missions

The `SubagentRunner` path (`launch()`, `startTurn()`, `COMPLETION_TIMEOUT_MS`,
`SubagentRunRegistry.track()`) is **completely bypassed** for missions. Instead,
the mission station's `CopilotSessionManager.sendMessage()` is used directly —
the same path the primary station uses for interactive chat.

This means:
- Completion detection uses the session manager's native idle/response-end flow
  (`copilot:response-end` event), not SubagentRunner's triple-condition check
- No 60-second hard timeout; the session stays open until the model finishes
- Tool calls flow through the session manager's standard MCP tool bridge
- All events (`copilot:delta`, `copilot:tool-call`, `copilot:tool-result`,
  `state:change`) fire naturally on the mission station's bus

---

## 3. Lifecycle Design

### 3.1 State Machine (Unchanged External Shape)

The ticket run status enum stays the same:

```
starting → ready → working → awaiting-review → done
                     ↕              ↕
                   error          working (continue)
                     ↕
                  blocked
```

What changes is how `working` and `awaiting-review` are implemented internally.

### 3.2 Operation: `startWork(runId)`

```
1. Validate run.status === "ready"
2. stationId = `mission:${runId}`
3. station = stationRegistry.createStation({
     stationId,
     label: `Mission: ${run.ticketId}`,
     workingDirectory: worktreePath,   // NEW: station-level cwd
   })
4. conversationId = randomUUID()
5. Persist stationId + conversationId in the ticket_run_attempts row
6. prompt = buildInitialPrompt(run)
7. stationRegistry.sendMessage(prompt, {
     stationId,
     conversationId,
   })
   → This calls station.manager.sendMessage() which:
     - Transitions station state: idle → thinking
     - Sends prompt through Copilot session (with session recovery)
     - Streams deltas on station bus
     - Executes tool calls through standard MCP bridge
     - Transitions station state: thinking → idle on response-end
8. Listen for station idle → applyAttemptCompletion()
   (see §3.6 for details on completion detection)
```

### 3.3 Operation: `continueWork(runId, prompt?)`

```
1. Validate run.status === "awaiting-review"
2. stationId = `mission:${runId}`
3. Reclaim existing station (it persists between attempts):
   station = stationRegistry.ensureStation(stationId)
4. Create new attempt row (incremented sequence, same stationId)
5. prompt = buildContinuationPrompt(run, userPrompt)
6. stationRegistry.sendMessage(prompt, { stationId })
   → Reuses the SAME Copilot session (session is already persisted)
   → The conversation thread grows naturally
7. Listen for station idle → applyAttemptCompletion()
```

**Key advantage:** Continuation is just sending another message to the station.
No `writeManagedSubagent()` / `waitForManagedSubagent()` dance. No session-reuse
heuristic. The conversation is inherently continuous.

### 3.4 Operation: `cancelWork(runId)`

```
1. Validate run.status === "working"
2. stationId = `mission:${runId}`
3. stationRegistry.abortStation(stationId)
   → Calls manager.abort() which cancels in-flight Copilot response
   → Fires copilot:abort-complete on station bus
4. Transition run → "awaiting-review"
5. Mark attempt as "cancelled"
```

### 3.5 Operation: `completeRun(runId)`

```
1. Validate run.status === "awaiting-review" or "ready"
2. Transition run → "done"
3. stationId = `mission:${runId}`
4. stationRegistry.closeStation(stationId)
   → manager.shutdown() disconnects Copilot session
   → Deletes persisted session ID
   → Removes station from registry
5. (Optional) Clean up worktree based on policy
```

### 3.6 Completion Detection

**How does the system know a mission turn is done?**

The `CopilotSessionManager` emits `copilot:response-end` on its station bus when
the assistant finishes responding (after all tool calls resolve and the session
goes idle). This is the same signal the UI uses to know the primary station has
finished thinking.

The `TicketRunService` subscribes to the mission station's bus:

```typescript
station.bus.on("copilot:response-end", (messageId, fullText) => {
  this.applyAttemptCompletion(runId, attemptId, {
    status: "completed",
    summary: extractSummary(fullText),
  });
});

station.bus.on("copilot:error", (error) => {
  this.applyAttemptCompletion(runId, attemptId, {
    status: "failed",
    summary: error.message,
  });
});
```

No timeout-based detection. No triple-condition check. If the model takes 5
minutes because it's running 20 tool calls, the station stays in `thinking`
state and the renderer shows real-time progress.

### 3.7 Summary Extraction

Today, the SubagentRunner requires the model to return a JSON envelope with a
`summary` field. With station-backed missions, the model's final assistant
message is natural text. Two options:

**Option A (Recommended): Convention-based extraction.** The mission system
prompt instructs the model to end with a `## Summary` section. The
`extractSummary()` function parses this from the final assistant message. Falls
back to the last 200 chars if no section is found.

**Option B: Post-hoc summarisation.** After `copilot:response-end`, send a
one-shot summarisation prompt. This adds latency but guarantees structured
output. Reserve this for a future enhancement if Option A proves insufficient.

---

## 4. Persistence Changes

### 4.1 Schema Migration (V11)

```sql
-- Add station binding columns to ticket_run_attempts
ALTER TABLE ticket_run_attempts ADD COLUMN station_id TEXT;
ALTER TABLE ticket_run_attempts ADD COLUMN conversation_id TEXT;

-- Make subagent_run_id nullable (already nullable, but document intent)
-- No change needed; column is already TEXT with no NOT NULL constraint.

-- Index for station lookups
CREATE INDEX idx_ticket_run_attempts_station_id
  ON ticket_run_attempts(station_id);
```

### 4.2 Updated Attempt Row

| Column | Old role | New role |
|---|---|---|
| `subagent_run_id` | Links to SubagentRunRegistry entry | **Deprecated.** NULL for new attempts. Retained for pre-migration rows. |
| `station_id` | *(new)* | `mission:${runId}` — links to the station that ran this attempt |
| `conversation_id` | *(new)* | UUID of the conversation thread on the mission station |

### 4.3 Conversation Persistence

Station conversations are already persisted through the standard
`memoryDb.appendMessage()` path that `attachStationListeners()` wires up. Every
user prompt, assistant response, and tool call in the mission station's
conversation flows into the `messages` and `tool_calls` tables with no new code.

This is a **major win**: mission transcripts become first-class queryable
conversation history, identical to primary station conversations.

### 4.4 Station Session Persistence

Each mission station's Copilot session ID is persisted via the standard
`session_state` key pattern:

```
station:mission:{runId}:copilot-session-id
station:mission:{runId}:active-conversation-id
```

This allows session resume after Spira restart — the station reconnects to the
same Copilot session if it's still alive.

---

## 5. Renderer Integration

### 5.1 Mission Stations in Operations Roster

Mission stations appear in the Operations Roster alongside the primary station.
Each card shows:

- **Label**: `Mission: ABC-123`
- **Status dot**: Green (idle/awaiting-review), Pulsing (thinking/working),
  Red (error)
- **Title**: Ticket summary text
- **Last activity**: Timestamp of last bus event
- **Preview**: Last assistant message snippet

Clicking a mission station card focuses it, showing the full conversation in
`ChatPanel` — exactly like clicking the primary station.

### 5.2 Live Streaming During Work

Because mission work uses a real station, all existing streaming infrastructure
works without modification:

```
station.bus copilot:delta → transport → electronAPI.onChatDelta
  → chat-store.appendDelta() → ChatPanel re-render
```

The renderer sees live token streaming, tool activity indicators, and state
transitions for mission stations identically to the primary station.

### 5.3 Mission Status Overlay

The existing mission status panel (driven by `missions:runs:updated` events)
continues to show the run lifecycle. Additionally, it gains a **"View Station"**
button that focuses the mission station in the Operations Roster.

### 5.4 Station Store Changes

The `station-store.ts` already handles multi-station state via `StationId`-keyed
maps. No structural change is needed. Mission stations simply appear as
additional entries with their own state, streaming status, and unread flags.

### 5.5 Distinguishing Mission Stations

Add an optional `kind` field to `StationSummary`:

```typescript
export interface StationSummary {
  stationId: StationId;
  kind: "interactive" | "mission";  // NEW
  conversationId: string | null;
  label: string;
  title: string | null;
  state: AssistantState;
  createdAt: number;
  updatedAt: number;
  isStreaming: boolean;
  // For mission stations:
  missionRunId?: string;            // NEW
}
```

The renderer can use `kind === "mission"` to apply mission-specific styling,
disable user input on the chat panel (missions don't accept arbitrary messages),
and show mission-specific controls (continue, cancel, complete).

---

## 6. Migration Strategy

### 6.1 Existing Rows

Runs in terminal states (`done`, `error`) need no migration — they are historical
records.

Runs in `working` or `awaiting-review` status at migration time:

1. **`working` runs**: Apply the existing `recoverInterruptedWork()` pattern.
   Transition to `awaiting-review` with status message "Upgraded to
   station-backed missions. Review the worktree and continue when ready."
   The stale `subagentRunId` will point to a SubagentRunRegistry entry that
   no longer exists (it was in-memory).

2. **`awaiting-review` runs**: No change needed. The next `continueWork()` call
   will create a mission station instead of trying `writeManagedSubagent()`.

3. **`ready` / `starting` / `blocked` runs**: These haven't entered the work
   phase yet. They will naturally use the new station path on next `startWork()`.

### 6.2 Backward Compatibility for Attempt Reads

The `getTicketRun()` / `listTicketRuns()` queries already return
`subagentRunId` as a nullable field. Adding `stationId` and `conversationId`
follows the same pattern. The renderer and any consumers inspect whichever
field is populated:

```typescript
// In renderer or service code:
const hasStation = !!attempt.stationId;
const hasSubagent = !!attempt.subagentRunId;
// Use stationId for new attempts, subagentRunId for legacy
```

### 6.3 Feature Flag (Optional)

If a gradual rollout is desired, gate the new path behind a runtime flag:

```typescript
const USE_STATION_MISSIONS = process.env.SPIRA_STATION_MISSIONS !== "false";
```

When disabled, the existing `launchManagedSubagent` path is used. When enabled
(default), the station path is used. Remove the flag and the old code path once
validated.

---

## 7. What Gets Deleted

Once station-backed missions are validated:

| Code | Location | Reason |
|---|---|---|
| `buildMissionWorkerDomain()` | `index.ts:178-205` | No more synthetic subagent domain for missions |
| `mapMissionPassSnapshot()` | `index.ts:207-215` | No SubagentRunSnapshot to map |
| `MISSION_WORKER_DOMAIN_ID` | `index.ts:176` | Unused constant |
| `launchMissionPass` callback | `index.ts:1267-1323` | Replaced by station-based launch |
| `cancelMissionPass` callback | `index.ts:1324-1330` | Replaced by `abortStation()` |
| `MissionPassHandle.subagentRunId` | `ticket-runs.ts:59` | Replaced by `stationId` |
| `writeManagedSubagent` reuse logic | `index.ts:1276-1301` | Session reuse is inherent in station model |

The SubagentRunner, SubagentRunRegistry, and SubagentLockManager themselves are
**not** deleted — they continue to serve interactive subagent delegations
(delegate_to_windows, delegate_to_spira, etc.). Only the mission-specific usage
is removed.

---

## 8. New Interfaces

### 8.1 MissionStationHandle (replaces MissionPassHandle)

```typescript
export interface MissionStationHandle {
  stationId: StationId;
  conversationId: string;
  completion: Promise<MissionTurnResult>;
}

export interface MissionTurnResult {
  status: "completed" | "failed" | "cancelled";
  summary: string;
  messageId: string;          // ID of the final assistant message
  conversationId: string;     // For transcript retrieval
}
```

### 8.2 TicketRunServiceOptions (updated)

```typescript
export interface TicketRunServiceOptions {
  memoryDb: SpiraMemoryDatabase | null;
  projectRegistry: ProjectRegistryLike;
  youTrackService: YouTrackWriteService | null;
  logger: Logger;
  bus?: SpiraEventBus;
  stationRegistry?: StationRegistry;  // NEW: direct access
  // Remove: launchMissionPass, cancelMissionPass
  // (mission lifecycle is handled internally via stationRegistry)
}
```

### 8.3 StationRegistry.createStation (extended options)

```typescript
createStation(options: {
  stationId?: StationId;
  label?: string;
  kind?: "interactive" | "mission";       // NEW
  workingDirectory?: string;              // NEW: station-level cwd
  missionRunId?: string;                  // NEW: back-link
}): StationSummary
```

---

## 9. Validation Sequence

### Phase 1: Foundation (Station Creation)

1. Extend `createStation()` to accept `kind` and `workingDirectory`
2. Verify mission stations appear in `listStations()` with correct metadata
3. Verify mission stations persist and restore session IDs across restart
4. Write unit tests for station create / close / restore lifecycle

### Phase 2: Message Path

5. Wire `TicketRunService.startWork()` to create a mission station and send the
   initial prompt via `stationRegistry.sendMessage()`
6. Verify the prompt flows through the session manager, reaches Copilot, and
   returns a response
7. Verify `copilot:response-end` fires on the mission station bus
8. Verify the response is persisted as a conversation message
9. Wire `applyAttemptCompletion()` to the response-end event
10. Run against a real ticket with a simple implementation task

### Phase 3: Multi-Turn

11. Wire `continueWork()` to reuse the existing mission station
12. Verify the conversation thread grows (message count increases)
13. Verify session resume works (Copilot session reconnects after restart)
14. Test cancellation via `abortStation()`

### Phase 4: Renderer

15. Verify mission stations appear in Operations Roster
16. Verify live streaming works when viewing a mission station
17. Add `kind` field to `StationSummary` and protocol messages
18. Verify mission station chat panel disables user input
19. Add "View Station" affordance from mission status panel

### Phase 5: Cleanup

20. Run full test suite (`ticket-runs.test.ts` — 568 lines of existing tests)
21. Add new tests for station-backed lifecycle
22. Remove `buildMissionWorkerDomain`, `mapMissionPassSnapshot`, and related code
23. Apply V11 schema migration
24. Remove `subagentRunId` from new attempt creation code
25. Verify backward compatibility: old attempts with `subagentRunId` still render

---

## 10. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Copilot session limits | Each mission station holds an open session. If Copilot enforces per-user session caps, concurrent missions could fail. | Start with one active mission station at a time. Add station pooling later if session limits are observed. |
| Long-running tool calls | A mission tool call (e.g., `npm run build`) could take 10+ minutes. The session must stay alive. | `CopilotSessionManager` already has no internal timeout on tool execution. The Copilot server's own keep-alive governs session lifespan. Verify empirically. |
| Session expiration mid-mission | Copilot sessions expire after inactivity. A long tool call may look like inactivity to the server. | `sendPromptWithRecovery()` already handles expired sessions by transparently creating a fresh one. Conversation context is rebuilt from the continuity preamble. |
| Renderer performance with many stations | Dozens of mission stations could bloat the Operations Roster. | Completed/done missions close their station (§3.5). Only active missions have live stations. Archive UI can list historical conversations by `conversationId`. |
| Test suite regression | `ticket-runs.test.ts` mocks `launchMissionPass`. Those mocks must be rewritten. | Replace mock with a stub `StationRegistry` that records `createStation` / `sendMessage` calls. The test surface area stays similar. |

---

## 11. Summary of Wins

1. **No artificial timeout.** Mission turns complete when the model finishes,
   not when 60 seconds elapse.
2. **Full conversation history.** Every prompt, response, and tool call is
   persisted as standard conversation messages — queryable, displayable,
   resumable.
3. **Live visibility.** Mission work streams to the renderer in real-time,
   with tool activity indicators, just like interactive chat.
4. **Simpler code.** The `launchMissionPass` / `cancelMissionPass` callback
   indirection, SubagentRunner wrapping, snapshot mapping, and session-reuse
   heuristic are all replaced by `stationRegistry.sendMessage()`.
5. **Session continuity.** Multi-turn missions use the same Copilot session
   and conversation thread, with automatic session resume after restart.
6. **Architectural consistency.** Every long-running AI interaction in Spira
   is a station. No special cases.
