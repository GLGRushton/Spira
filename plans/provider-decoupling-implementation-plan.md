# Provider Decoupling Remaining Work Plan

## Current confirmed state

The original decoupling pass has already cleared the first major boundary:

- provider-neutral contracts exist in `packages/backend/src/provider/types.ts`
- Copilot SDK imports are isolated to `packages/backend/src/provider/copilot/`
- the main station path and subagent path already speak in `ProviderClient` / `ProviderSession` terms
- usage events are normalized and emitted on the host event bus
- Azure OpenAI exists as a real adapter spike

What is **not** done is the part that actually decides whether Shinra is provider-independent: the **durable host-owned runtime**. Runtime state is still too transient, recovery is partial, and the Azure proof is not yet acceptance-grade.

## Remaining acceptance criteria

This plan is complete when all of the following are true:

1. Main station execution and subagent/background execution run through the same **host-owned runtime model**, not just the same provider interfaces.
2. Pending permission requests, active tool-call state, cancellation state, and background/subagent lifecycle state are durably represented and recoverable across reconnects/restarts where feasible, or fail closed explicitly.
3. Host-owned continuity, checkpointing, and resumability work even when a provider lacks native persistent sessions.
4. Provider capability fallback behavior is explicit for missing session persistence, missing native abort, and partial usage reporting.
5. Usage/cost telemetry is emitted **and persisted** with provider, station, run, session, and timestamp correlation.
6. Azure OpenAI runs through the unchanged bridge with acceptance-grade parity for streamed response behavior, tool calls, permissions, cancellation, background/subagent flow, and restart/recovery expectations defined by the host runtime.
7. Residual Copilot-branded orchestration helpers are either renamed or relocated so the architecture reflects the seam cleanly, while SDK imports remain confined to `provider/copilot/`.

## What must stay stable

These are still explicitly out of scope:

- renderer UX
- preload/main/renderer bridge semantics
- shared protocol shape, except additive fields if genuinely needed
- mission and room semantics
- MCP server execution model
- Shinra persona behavior at the host level
- host-visible room and control semantics for long-running/background work

If these begin changing materially, the scope has slipped.

## Remaining work

## Phase 1 - Build the durable host runtime

Introduce the missing host-owned runtime layer under `packages/backend/src/runtime/` or equivalent and make it the source of truth for:

- run state for station and subagent/background flows
- checkpoint and resume records
- pending permission records
- tool invocation journal / replay boundaries
- cancellation markers and recovery states
- background/subagent lifecycle state

This phase should focus on **durability semantics first**, not naming cleanup.

**Goal:** move Shinra's agentic behavior out of process-local maps and timers and into a host-owned runtime model.

**Milestone R1:** runtime state that currently lives only in memory has a durable host-owned representation and explicit fail-closed rules where recovery is not feasible.

## Phase 2 - Move station and subagent orchestration onto the shared runtime

Refactor the current orchestration so station and subagent flows consume the same runtime primitives for:

- stream assembly and turn lifecycle
- permission lifecycle
- continuation / checkpoint use
- cancellation handling
- background run visibility and control
- tool-call journaling boundaries

This is also where the remaining Copilot-shaped orchestration helpers should stop being runtime dependencies:

- `copilot/session-manager.ts`
- `copilot/session-config.ts`
- `copilot/tool-bridge.ts`
- `copilot/stream-handler.ts`
- `copilot/permission-decisions.ts`

The target is not a giant rewrite. The target is to keep current behavior while making the shared runtime, not the `copilot/` folder, own orchestration semantics.

**Goal:** make provider neutrality structural for the host runtime, not merely typed at the adapter boundary.

**Milestone R2:** station and subagent orchestration share the same host runtime behaviors and no longer depend on Copilot-specific runtime helpers for core lifecycle semantics.

## Phase 3 - Make capability fallback behavior explicit

Expand the capability model so the runtime owns fallback behavior for:

- provider-native session resume vs host continuity/checkpoint replay
- provider-native abort vs host-authoritative cancellation markers
- full streaming vs mediated or synthetic streaming behavior
- full usage reporting vs partial or unknown usage

This phase should produce runtime-level rules, not provider-specific guesswork.

**Goal:** prevent provider limitations from leaking into orchestration behavior as ad hoc special cases.

**Milestone R3:** capability-driven fallback behavior is explicit enough that Copilot and Azure run under the same host policy model.

## Phase 4 - Persist usage and cost telemetry

Keep the normalized `provider:usage` event, but add a real persistence/reporting sink for:

- provider
- model or deployment
- station ID
- run ID
- session ID
- timestamps and latency
- input/output/total tokens where available
- estimated or actual cost where available
- source quality (`provider`, `estimated`, `unknown`)

If some fields are unavailable, preserve partial records explicitly rather than hiding the gap.

**Goal:** turn usage from a transient log line into durable control-plane data.

**Milestone R4:** provider usage is durably recorded and queryable for both station and subagent flows.

## Phase 5 - Finish the Azure OpenAI proof

Treat Azure OpenAI as an existing adapter spike that now needs to satisfy the host runtime contract end to end:

- streamed station response behavior through the existing bridge
- at least one real tool-call path
- permission flow mapping
- subagent/background proof path
- cancellation behavior through the unchanged bridge
- restart/recovery behavior under the host-owned runtime model
- usage capture through the persistent telemetry path

Do not optimize for broad multi-provider ergonomics before this proof is convincing.

**Goal:** prove that Shinra's runtime remains agentic even when the provider is effectively stateless.

**Milestone R5:** Azure OpenAI passes the host runtime proof without material bridge changes.

## Phase 6 - Final architecture cleanup and guardrails

Once the runtime and Azure proof are complete:

- rename or relocate residual Copilot-branded orchestration helpers that no longer belong in `copilot/`
- keep provider-specific binding inside `provider/copilot/`
- add a repository guardrail or test that ensures direct Copilot SDK imports stay confined to the adapter boundary
- remove stale transitional wiring left over from the migration

This phase is deliberately last. Naming cleanliness matters, but it is not the blocker.

**Goal:** make the final architecture read the way it now behaves.

**Milestone R6:** the code structure reflects the provider seam cleanly and prevents regressions back across the boundary.

## Recommended sequence

The remaining work should proceed in this order:

1. build the durable host runtime
2. move station and subagent flows onto it
3. formalize capability fallback behavior
4. persist usage and cost telemetry
5. finish the Azure OpenAI proof
6. clean up naming and add import guardrails

This keeps the work focused on the real gap: **runtime ownership and durability**, not abstraction theater.

## Main remaining risks

- **Durability drift:** persisting only IDs while leaving live runtime state effectively transient
- **Subagent regressions:** background/idling/write/stop semantics are still delicate
- **Azure false parity:** accepting a one-shot non-streaming spike as proof of runtime independence
- **Cleanup too early:** renaming Copilot-branded modules before the runtime responsibilities have actually moved

## Rollback strategy

Keep rollback simple:

- preserve provider/session factory switching while the runtime migration is underway
- prefer additive runtime wiring over bridge changes
- do not couple rollback to renderer or protocol reversions

## Final verdict

The seam-building work is largely done. The remaining plan is about making that seam **real under failure, restart, cancellation, permissions, and background execution**.

In plain terms: Spira no longer needs a bigger provider abstraction. It needs Shinra's runtime to become durable enough that Copilot is merely one adapter, not the hidden owner of agent continuity.
