# Permission Lifecycle Resilience — Implementation Plan

**Parent plan:** [model-escalation-architecture.md](./model-escalation-architecture.md) — "Approval-flow resilience" slice.

**Status:** drafted 2026-05-08, in progress.

## Goal

Make permission gating robust to renderer refresh, transport disconnect, and backend restart, and add an opt-in **auto-approve** setting that bypasses prompting entirely. After this slice:

1. A pending approval prompt survives a renderer reload — the new renderer re-prompts from durable state instead of silently abandoning the request.
2. A backend restart cleanly resolves any in-flight approvals as `expired` and the UI is told (no "blocked" zombie state, no clicks-into-the-void on stale prompts).
3. A user-controlled "Auto-approve permissions" toggle short-circuits the whole flow — useful in trusted-loop scenarios — while still leaving an audit trail.
4. WorkSession execution phases react explicitly to `expired` / `orphaned` / `denied` outcomes instead of leaning on the model to interpret a `user-not-available` result.

## Background — what already exists

Audited in this conversation. Anchors:

- DB persistence: `runtime_permission_requests` table; `upsertRuntimePermissionRequest` / `resolveRuntimePermissionRequest` / `listPendingRuntimePermissionRequests` ([memory-db/src/database/runtime.ts:273](../packages/memory-db/src/database/runtime.ts:273)).
- Workflow blocking: `RuntimeWorkflowBlock { kind: "approval", pendingRequestIds, ... }` ([backend/src/runtime/runtime-contract.ts:157](../packages/backend/src/runtime/runtime-contract.ts:157)) and `reconcileWorkflowPermissionBlocking` ([backend/src/runtime/session-manager.ts:978](../packages/backend/src/runtime/session-manager.ts:978)).
- Startup recovery: `recoverInterruptedRuntimeState` flips all DB rows to `expired` at boot ([memory-db/src/database/runtime.ts:1094](../packages/memory-db/src/database/runtime.ts:1094)). But it does **not** emit `permission:complete`, so any cached UI prompt and any blocked workflow is still on the renderer's screen until something else resolves it.
- Preload replay cache: `latestServerMessages` keyed by `${type}:${stationId}` ([main/src/preload.ts:80](../packages/main/src/preload.ts:80)) replays cached permission requests to fresh subscribers — but only for as long as preload memory survives, and only at the preload layer.
- Transport disconnect handler: `bus.on("transport:client-disconnected")` calls `stationRegistry.handleClientDisconnected()`, which calls `cancelPendingPermissionRequests` on every station — currently expires every pending approval on any renderer reload ([backend/src/index.ts:2464](../packages/backend/src/index.ts:2464), [backend/src/runtime/station-registry.ts:418](../packages/backend/src/runtime/station-registry.ts:418)).
- 60s timeout: `PERMISSION_REQUEST_TIMEOUT_MS = 60_000` silently auto-rejects ([backend/src/runtime/session-manager/shared.ts:10](../packages/backend/src/runtime/session-manager/shared.ts:10), [session-manager.ts:2603](../packages/backend/src/runtime/session-manager.ts:2603)).

## Gaps this plan closes

1. Renderer reload → all pending approvals are expired in-process (`handleClientDisconnected` is too aggressive).
2. Renderer reload (preload survives) → preload replays, but a true window-destroy or BrowserWindow swap does not.
3. Backend restart → DB rows go `expired` but nothing tells the UI; workflow state may not reconcile until next sync.
4. Late approve/deny against a missing in-memory entry → `resolvePermissionRequest` returns `false`, click silently does nothing.
5. Silent 60s timeout masquerading as "user-not-available".
6. WorkSession execution phases don't have explicit reactions to expired/denied outcomes.
7. No way to opt out of prompting for trusted/headless loops.

## Out of scope

- Re-attaching the original in-flight tool call across backend restart (requires resumable tool execution — much bigger).
- Per-tool, per-server granular auto-approve policy. This slice ships a single global toggle.
- A new "orphaned" wire status. We collapse orphans into `expired` to keep the protocol simple.

## Design

### 1. Auto-approve setting

Add `autoApprovePermissions: boolean` (default `false`) to `UserSettings` ([packages/shared/src/protocol.ts:424](../packages/shared/src/protocol.ts:424)).

- Renderer: add toggle to Voice/general settings or a new "Permissions" section in `SettingsPanel.tsx`.
- Renderer store + persistence already round-trip arbitrary `UserSettings` keys, so the new field flows through `useSettingsStore`, `setSettings`, and `settings:current` automatically once added to the type and `DEFAULT_SETTINGS`.
- Backend ingests via the existing `settings:update` handler. We add a `userSettingsService` (or extend the existing settings application path) to track current values centrally and broadcast to consumers.

In `SessionManager.handleToolPermissionRequest`:
- Before the bus emit / Promise wait, check the auto-approve flag.
- If on: persist the request to DB **and** immediately resolve as `approved`; emit `permission:request` followed by `permission:complete` with `result: "approved"` and an `auto: true` marker (so UI can render "auto-approved" briefly and audit logs reflect the path).
- Subagent runner gets the same hook through its own permission handler (it shares the runtime permission lifecycle).

This keeps audit trails intact (DB + ledger event) while skipping user interaction.

### 2. Transport-disconnect must not expire pending requests

Replace `cancelPendingPermissionRequests` from the disconnect handler with a softer behavior:
- Keep the in-memory pending Promise alive when the transport drops.
- The renderer side has already cleared its in-memory store via `clearRendererTransientState`, so on reconnect the prompt UI starts empty and we re-emit (see #3).
- We still cancel pending requests on **shutdown** and on station-explicit reset/clear — those are the genuinely terminal cases.

Rename `cancelPendingPermissionRequests` → keep a public method but rename the internal disconnect path to something like `handleTransportDisconnected`, which is now a no-op for permissions.

### 3. Re-emit pending permission requests on transport reconnect

Add a `replayPendingPermissionRequests(stationId?)` method to `StationRegistry` that:
- Iterates persisted pending DB rows for each station via `runtimeStore.listPersistedPendingPermissionRequests(stationId)` (a small wrapper over `listPendingRuntimePermissionRequests` that returns the full payload, not just IDs).
- For every row whose ID matches a still-live in-memory `pendingPermissionRequests` entry, re-emits `assistant:permission-request` so the transport sends a fresh `permission:request` server message.
- For rows with no live in-memory entry (true orphans), resolves the DB row as `expired` and emits `permission:complete` with `result: "expired"`. (This is the in-band version of the boot-time recovery, called any time we detect drift.)

Call sites:
- `bus.on("transport:client-connected")` (or equivalent — wire one if missing) at backend startup once a transport binds.
- After `recoverInterruptedRuntimeState` at boot, we additionally emit `permission:complete` for the IDs returned in `expiredPermissionRequestIds` so a freshly-mounted renderer that somehow received them clears its UI. (Renderer connects after backend startup, so the events fire as soon as the transport is bound.)

### 4. Replace silent 60s timeout with durable `expired`

- Lengthen `PERMISSION_REQUEST_TIMEOUT_MS` to 30 minutes (configurable via env, default 30m).
- On expiry, the session manager should:
  - Update the DB row to `expired`.
  - Emit `permission:complete` with `result: "expired"`.
  - Resolve the awaiting Promise with `permissionUserNotAvailable()` as before (preserves provider semantics — the tool call returns "user not available").
- Remove the unused `denied` literal from `clearPendingPermissionRequests("denied")` if nothing else uses it; today everything passes `"expired"`.

### 5. Idempotent late approve / deny

Update `SessionManager.resolvePermissionRequest(requestId, approved)`:
- If the in-memory map has the entry → existing path (resolve Promise, clear timeout).
- If not, but the DB row is still `pending` → mark it resolved (`approved` or `denied`), emit `permission:complete` with the right result, and return `true` so the IPC handler doesn't log a warning.
- If the DB row is already `expired`/`approved`/`denied` → idempotent, return `true`, optional debug log.

This means a late click after backend restart records the user's intent and clears the UI even though the original tool call is gone.

### 6. WorkSession reaction to permission outcomes

Today, WorkSession reads `RuntimeWorkflowBlock.kind === "approval"` and treats it as transient. Extend that:
- When a permission resolves with `result: "expired" | "denied"` during an active execution phase (`implement` / `validate`), surface a phase-level signal: WorkSession transitions the phase to `stalled` with a persisted `blockedReason` of `approval-expired` or `approval-denied`.
- For `approved` (including auto-approved), no behavior change.
- For startup-time expirations, the phase transitions to `stalled` only if it was actively in `implement`/`validate` at the time of the original block.

Surface point: `assistant:permission-complete` emit already carries `result`. WorkSession state machine reads it via the same pathway that consumes workflow updates (`workflow.updated`). Add a small mapper in the WorkSession reducer that maps non-approved completions during execution phases to a stall.

### 7. Tests

New / extended unit tests:
- Renderer reload / transport disconnect → pending requests preserved (existing `station-registry.test.ts`).
- Replay on reconnect → re-emits `permission:request` for live pending IDs.
- Replay on reconnect → emits `permission:complete` (expired) for orphans.
- Late `permission:respond` against missing in-memory entry → DB row resolved, `permission:complete` emitted.
- Auto-approve setting on → no `permission:request` wait, immediate `approved` complete, DB row resolved as `approved` with `auto: true`.
- 30-minute timeout fires `expired`.
- WorkSession transitions to `stalled` with reason `approval-expired` / `approval-denied` when an execution-phase request resolves non-approved.

## Implementation order

1. Add `autoApprovePermissions` to shared `UserSettings` + default + renderer store + settings panel toggle.
2. Surface a tracked auto-approve flag inside `SessionManager` (via env or ctor option fed from a settings service).
3. Implement auto-approve short-circuit in `handleToolPermissionRequest`.
4. Soften `handleClientDisconnected` (no longer expire pending permissions).
5. Add `replayPendingPermissionRequests` on transport bind / reconnect.
6. Add `permission:complete` emission for boot-time expired IDs (in `bootstrap()` after `recoverInterruptedState`).
7. Lengthen `PERMISSION_REQUEST_TIMEOUT_MS` to 30 min and ensure `expired` is the explicit outcome.
8. Make `resolvePermissionRequest` idempotent against missing in-memory entries.
9. WorkSession mapping of non-approved resolution to phase stall during execution.
10. Tests for each above.
11. Update `model-escalation-architecture.md` with the completed slice.

## Risks

- Replay timing: if we re-emit `permission:request` before the renderer has re-mounted its IPC listeners, it gets dropped. Mitigation: replay is triggered by `transport:client-connected`, which already implies a client is listening; and the preload replay cache is a fallback.
- Auto-approve is a foot-gun. Mitigation: settings UI surfaces the toggle with a clear caption ("Bypass approval prompts. Only enable for trusted, monitored sessions."). It's off by default and not exposed in the runtime-config secure section.
- Subagent runners share the same lifecycle. Need to make sure the auto-approve hook is applied uniformly there.
