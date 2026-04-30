# Collated Provider Runtime Plan

## Problem statement

Spira currently has a real provider seam, but not yet a fully provider-independent runtime. Shinra must remain the stable operating intelligence of Spira while providers become interchangeable transports with explicit capability metadata. Copilot is a legitimate special case in that it is already agentic and exposes richer native behavior, but that richness must be treated as acceleration rather than correctness. The final architecture must let Azure/OpenAI-style providers participate in the same multi-turn, streamed, permissioned, tool-using, background-capable runtime contract without Shinra's behavior collapsing into a degraded mode.

## Consensus outcome

Shinra, Opus 4.7, and GPT-5.5 converged on the same final shape:

1. **Shinra is the product contract.** Persona, orchestration semantics, continuity, tool policy, permissions, streaming semantics, and recovery rules belong to the host runtime.
2. **Providers are adapters, not runtime owners.** They expose transport, model selection, events, and capability metadata. Native session persistence, native abort, and native streaming are optimizations only.
3. **The host runtime owns continuity.** A station or subagent run is a host runtime session first. Provider session IDs are optional acceleration metadata, never the source of truth.
4. **Tool parity is host-defined.** The same session profile should produce the same effective capability contract regardless of provider. Copilot must derive its provider-facing tool manifest from the same host capability registry, but through a provider-specific projection that avoids duplicate or reserved built-ins.
5. **Background and subagent behavior are first-class.** They must use the same runtime lifecycle primitives as the main station path, not a parallel weaker system.

## Final target architecture

### 1. Shinra Runtime Kernel

Create a host-owned runtime kernel that owns the entire agentic contract:

- persona and instruction composition
- turn lifecycle and state machine
- stream assembly and message finalization
- permission request lifecycle and fail-closed policy
- tool-call orchestration boundaries
- cancellation semantics
- continuity, checkpointing, and rehydration
- provider usage and telemetry normalization
- provider switching rules

The kernel is the thing that makes Shinra feel like Shinra. Providers must not define that behavior.

### 2. Host Runtime Session as the primary identity

Introduce a host-owned runtime session model that is primary for both station chats and subagent/background runs.

Suggested fields:

- `runtimeSessionId`
- `kind` (`station`, `subagent`, `background`)
- `stationId` or `runId` linkage
- `providerBinding` metadata
- `workingDirectory`
- `toolManifestHash`
- `artifactRefs`
- `checkpointRef`
- `turnState`
- `permissionState`
- `cancellationState`
- `usageSummary`

Provider session IDs remain attached metadata:

- `providerId`
- `providerSessionId`
- `providerModel`
- `bindingCreatedAt`
- `bindingResumedAt`
- `bindingTerminatedAt`

The host runtime session must remain stable even when the provider binding changes or disappears.

### 3. Canonical host capability registry

Promote the current tool-bridge work into a runtime-owned capability registry that is the sole source of the host capability contract. Provider-facing `ProviderToolDefinition[]` manifests should be projections from that registry rather than ad hoc hand-built lists.

It should merge:

- host operating tools
- sessionful host resource tools
- MCP tools
- Spira synthetic tools
- storage/session artifact tools
- mission-scoped tools
- subagent/delegation tools

This registry should be consumed by:

- Copilot-backed station sessions
- Azure/OpenAI-backed station sessions
- managed subagent/background runs
- any future provider adapter

Explicit end-state rule: **Copilot no longer gets a special product contract, but it may still need a special manifest projection.** Native Copilot tooling may be reused, wrapped, suppressed, or mapped to host-owned capabilities, but the visible Shinra contract must still come from the host registry.

### 3a. Provider-specific manifest projection

The final design should distinguish between:

- the **host capability registry**: the canonical list of capabilities Shinra can expose
- the **provider projection**: the concrete tool manifest a given provider session can safely ingest

This matters because Copilot may reject or mis-handle duplicate built-ins if the host blindly re-registers tools it already reserves.

So the correct end-state is **semantic parity, not literal manifest equality**.

For each capability, the projection layer should decide whether to:

- expose a host-owned implementation directly
- map the capability onto a provider-native built-in
- suppress a duplicate registration while preserving the same Shinra-visible behavior
- rename or wrap a capability where provider constraints require it

This projection layer should be explicit, testable, and driven by policy rather than scattered provider-specific exceptions.

### 4. Durable artifact store plus append-only session ledger

Split durability into two layers.

#### Artifact store

Durable artifacts that are not themselves a turn transcript:

- plan documents
- scratchpad/session notes
- durable memory items
- structured state and session tables
- mission artifacts
- subagent artifacts

#### Session ledger

An append-only, replayable ledger for each runtime session:

- runtime session creation
- provider bind/resume/swap events
- system prompt sections used for the session
- tool manifest signature
- user turns
- assistant deltas
- assistant final messages
- tool execution start and completion
- tool results and errors
- permission requests and decisions
- cancellation markers
- checkpoints and summaries
- usage records
- recovery outcomes

Current runtime state persistence is useful, but it is not yet canonical continuity. The final runtime must treat the ledger and checkpoint set as the source of truth.

### 5. Checkpointing and rehydration engine

Create a host-owned rehydration engine with this precedence:

1. load artifacts and the session ledger
2. restore the latest valid checkpoint
3. reopen a provider session if native resume exists
4. otherwise rebuild provider context from the host checkpoint and replay policy
5. continue under the same host runtime session ID

Continuity preambles may remain as a last-resort fallback, but they should not be the primary continuity strategy.

### 6. Shared turn engine for station and subagent flows

Refactor station execution and subagent/background execution so they share the same runtime primitives:

- provider attach and detach
- turn dispatch
- event normalization
- stream mediation
- permission gating
- tool journaling
- usage capture
- cancellation handling
- checkpoint emission
- recovery transitions

The entrypoints differ. The lifecycle semantics should not.

### 7. Host-owned interactive resource layer

Sessionful tools such as PowerShell must become durable host resources with explicit lifecycle policy.

Required concepts:

- host resource IDs
- runtime session ownership
- current state (`running`, `idle`, `completed`, `unrecoverable`, `cancelled`)
- process metadata where safe
- last-known output cursor
- recovery policy on restart

Not every live external process can be perfectly reattached after a crash, and the system should not pretend otherwise. Explicit unrecoverable states are better than fake continuity.

## Capability model

The current capability flags are useful, but the final plan should sharpen them into two groups.

### Correctness-relevant facts

- native provider session resume availability
- native abortability
- native streaming availability
- usage reporting quality
- model switching support
- tool-calling semantics support

### Acceleration hints

- native durable session reuse
- native token-by-token streaming
- native cost reporting richness
- native partial-result semantics
- native reasoning/tool orchestration convenience

Correctness must never depend on acceleration hints.

## Required invariants

1. **Shinra is host-owned and stable.**
2. **Provider capability never defines product capability.**
3. **Host runtime session ID is primary; provider session ID is secondary.**
4. **Same session profile yields the same effective capability contract across providers, even when provider-facing manifests differ.**
5. **Permissions are host-authoritative and fail closed.**
6. **Cancellation is host-authoritative; provider abort is an optimization path.**
7. **Streaming is host-defined; native streaming improves latency but not semantics.**
8. **Background and subagent runs are first-class runtime sessions.**
9. **Provider switching preserves Shinra identity, artifacts, and continuity policy.**
10. **Direct provider SDK usage remains confined to provider adapters.**

## Phased implementation plan

## Progress

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0 - Freeze the runtime contract | Complete | Landed explicit provider contract fields for manifest projection, model selection, and tool calling, plus a typed runtime session contract, checkpoint payload contract, ledger event contract, and provider-switch provenance scaffolding. |
| Phase 1 - Make the host capability registry canonical | Complete | Landed a runtime-owned capability composition path, provider-aware projection, source/binding-aware manifest hashes, session-bound manifest provenance for station and subagent resumes, host-only delegation support, and fail-closed refresh/recovery behavior. |
| Phase 2 - Add ledger-backed durability | Complete | Runtime sessions, append-only ledger events, checkpoints, provider bind/switch provenance, host-resource lifecycle events, and restart recovery journaling are now durable for station and subagent flows. |
| Phase 3 - Extract the shared runtime engine | Complete | Station and subagent flows now share host-owned turn, lifecycle, permission, recovery, session-state, and state-derivation helpers, including pending-permission and cancellation semantics. |
| Phase 4 - Make host continuity primary | Complete | Host continuity is now checkpoint-first with selective post-checkpoint replay, prompt preambles are fallback-only, and interrupted background/subagent runs fail closed on restart. |
| Phase 5 - Support provider switching as a first-class runtime feature | Complete | Station and subagent runtime sessions now preserve host identity across provider switching, persist switch provenance, and restore provider overrides from durable runtime state after restart. |
| Phase 6 - Harden interactive resource durability | Complete | PowerShell resources now persist lifecycle state including idle/cancelled/unrecoverable transitions, expose restart follow-up semantics, and journal restart degradation into the runtime ledger. |
| Phase 7 - Acceptance-grade parity proof and guardrails | Complete | Cross-provider station and background follow-up parity tests now cover Copilot and Azure/OpenAI-style providers; Copilot SDK and Copilot-branded helper imports are fenced out of runtime-owned code; and the host-owned PowerShell layer now honors runtime working directories, preserves timed-out sync terminal output for one final read, and evicts terminal sessions cleanly. |

### Final closeout status

The provider-runtime implementation is now complete.

Final closeout work hardened the remaining lifecycle seams that reviewers repeatedly surfaced:

- station teardown now preserves provider provenance for late-opened sessions and uses guarded cleanup when persisted runtime state is stale
- provider-session cleanup is durable outside startup, serialized against concurrent drains, and reused consistently across startup recovery, clear/switch/cancel teardown, and tool-drift refresh
- subagent recovery and cleanup now resolve provider binding atomically from runtime contract versus snapshot state, including explicit host-managed bindings where no resumable provider session exists
- legacy session-only subagent snapshots now infer provider identity from durable switch history safely: subagent-local history wins when it exists, otherwise station history is used
- recovered runs keep their bound provider even when it matches the configured default provider, so station overrides no longer steal resumed work

Final reviewer passes found no significant remaining issues after these fixes, and the validation suite for the closeout slice is green.

### Phase 0 - Freeze the runtime contract

Define the canonical Shinra runtime contract before further migration:

- runtime session model
- runtime turn model
- ledger schema
- checkpoint schema
- artifact references
- provider binding model
- streaming policy
- cancellation policy
- permission policy
- provider switching semantics
- recovery rules

This phase should produce contract tests and documentation, not large rewrites.

**Completed:** the codebase now has explicit provider capability fields for `toolManifestMode`, `modelSelection`, and `toolCalling`; a typed runtime session contract; a typed checkpoint payload contract; a typed runtime ledger event contract; and explicit host-manifest versus provider-projection hash separation for provider bindings and switch provenance.

### Phase 1 - Make the host capability registry canonical

Replace the conceptual role of `getCopilotTools` with a runtime-owned capability registry plus provider projection layer.

Goals:

- Copilot and Azure consume the same host capability registry
- Copilot and other providers receive projected manifests that respect provider-native reserved or duplicate tools
- host tools are first-class for all providers
- provider-native built-ins do not define the product contract
- station and subagent tool manifests derive from one registry path
- deterministic host capability and provider projection signatures become durable runtime inputs

This is the point where semantic parity becomes structural instead of aspirational.

**Completed:** the runtime capability registry is now built from a runtime-owned composition path rather than a Copilot-specific manifest builder; provider projections are source-aware and binding-aware; deterministic host/projection hashes are durable station and subagent inputs; station resume now fails closed on session/provenance drift; subagents enforce their effective domain surface (`serverIds`, `allowedToolNames`, host-tool policy) in both manifest composition and execution lookup; host-only/read-only delegation lanes are exposed and preserved correctly; and persisted non-default stations now carry `workingDirectory` so restart restores the same semantic tool binding.

### Phase 2 - Add ledger-backed durability

Extend current runtime persistence into a real append-only session ledger plus checkpoints.

Persist:

- turn boundaries
- assistant deltas and final messages
- tool activity
- permission decisions
- usage records
- cancellation markers
- provider attach/resume/swap records
- host manifest hash and provider projection hash on bind/swap events
- checkpoint summaries
- checkpoint payloads with provenance
- artifact references

This phase should avoid renderer changes and focus on durable runtime truth.

**Completed:** station and subagent flows now persist runtime sessions, append-only ledger events, and checkpoints; provider bind/switch provenance and provider identity are durable; PowerShell host resources persist lifecycle state and recovery outcomes; and restart recovery now journals unrecoverable host-resource transitions back into the runtime ledger.

### Phase 3 - Extract the shared runtime engine

Move station and subagent orchestration onto shared runtime primitives.

Shared components should own:

- stream handling
- turn completion rules
- permission lifecycle
- tool execution journaling
- runtime state transitions
- usage normalization
- cancellation semantics

Residual Copilot-branded runtime helpers should stop being lifecycle owners during this phase, though naming cleanup can wait.

**Completed:** station and subagent/background execution now share host-owned runtime turn handling, ledger lifecycle emission, permission request lifecycle, runtime-session persistence, checkpoint-aware recovery, and shared turn/permission/cancellation state derivation; `turn.state_changed` emission is no longer effectively station-only; pending permission state is durably represented for subagents; and cancellation request/completion semantics are shared rather than inferred from local closure state.

### Phase 4 - Make host continuity primary

Implement checkpoint-based resume and selective replay.

Rules:

- use provider-native resume only when available and safe
- otherwise rebuild from checkpoint plus replay policy
- use continuity preambles only as fallback
- define explicit fail-closed behavior for interrupted in-flight turns
- recover idle subagents and background runs from host state

This phase is where Azure/OpenAI becomes truly agentic under the host runtime.

**Completed:** recovery now rebuilds host context from checkpoints plus selective post-checkpoint ledger replay; `runtime_recovery` system-message sections carry authoritative host continuity bundles for station and subagent sessions; conversation continuity preambles are suppressed whenever durable host recovery is available and left only as last-resort fallback; and persisted in-flight background runs fail closed during hydration instead of being treated as resumptively live.

### Phase 5 - Support provider switching as a first-class runtime feature

A runtime session should be able to switch providers without losing host identity.

Required behavior:

- preserve `runtimeSessionId`
- preserve artifacts and checkpoints
- rebuild the provider binding from host state
- preserve binding revision, manifest/projection provenance, and checkpoint linkage
- maintain permission semantics
- maintain tool manifest semantics
- continue telemetry under the same logical session

The provider becomes an attachment to Shinra's runtime, not the definition of the session.

**Completed:** station and subagent/background runtime sessions now preserve their host runtime session identity while switching providers, persist `provider.switched` provenance into the runtime contract and ledger, and restore the effective provider binding from durable runtime state after restart.

### Phase 6 - Harden interactive resource durability

Promote PowerShell and similar host resources into durable runtime-managed resources.

Add:

- resource journals
- explicit recovery states
- stale/unrecoverable markers
- follow-up semantics after restart
- lifecycle tests around cancellation, idle state, and recovery boundaries

This phase closes the gap between chat continuity and operational continuity.

**Completed:** PowerShell sessions now persist host-resource ownership and lifecycle state across running, idle, cancelled, completed, and unrecoverable boundaries; persisted unrecoverable sessions remain visible for follow-up reads after restart; and restart-time degradation is appended to the runtime ledger so operational continuity is explicit rather than implied.

### Phase 7 - Acceptance-grade parity proof and guardrails

Add acceptance tests for both Copilot and Azure/OpenAI-style providers covering:

- station multi-turn flows
- streamed response behavior
- tool calling and permissions
- cancellation
- background/subagent follow-up
- restart and recovery
- provider switching
- telemetry persistence
- tool manifest parity

Then finish architecture cleanup:

- relocate or rename Copilot-branded orchestration helpers
- keep SDK imports confined to `provider/copilot/`
- add guardrails that prevent new runtime leakage back across the seam

**Completed:** acceptance coverage now explicitly proves cross-provider multi-turn station parity and cross-provider background follow-up parity for both Copilot and Azure/OpenAI-style providers; a dedicated guardrail test enforces that GitHub Copilot SDK imports remain confined to `provider/copilot/` and that runtime-owned modules do not regress back to Copilot-branded helpers; and the final host-tools closeout makes PowerShell sessions honor the runtime working directory, retain terminal output for one final post-timeout sync read, and evict terminal sessions without leaving stale live entries behind.

## Main risks

- ledger growth and replay cost
- weak checkpoint quality leading to fake continuity
- false parity if Azure only passes happy-path one-shot scenarios
- interactive tool recovery complexity
- permission ambiguity across cancellation and restart
- provider switch drift if manifest and checkpoint provenance are not tracked tightly

## Non-goals

- redesigning the renderer
- reproducing Copilot-native quirks exactly
- pretending every in-flight external process can be fully recovered after hard restart
- expanding the public protocol more than necessary
- abstracting every conceivable provider feature up front

## Revisions to current planning direction

The existing parity and decoupling plans are fundamentally sound, but the final collated version should sharpen these points:

1. explicitly require Copilot to consume the same host capability registry as every other provider, while allowing a provider-specific projection that avoids duplicate built-ins
2. upgrade runtime persistence from snapshots to a ledger plus checkpoints model
3. make provider switching a core target, not a late-stage polish item
4. demote continuity preambles to fallback-only recovery
5. add a dedicated host interactive-resource durability layer
6. distinguish capability facts from accelerators so provider richness does not become hidden correctness

## Recommended execution order

1. freeze the Shinra runtime contract
2. canonicalize the host capability registry
3. add the durable ledger and checkpoint model
4. move station and subagent flows onto shared runtime primitives
5. make host continuity primary
6. add provider switching
7. harden interactive resource durability
8. finish parity tests and guardrails

## Short verdict

The final architecture should read as: **one Shinra runtime, one host-owned continuity model, one canonical tool contract, many provider adapters**. Copilot remains a valuable accelerator, but never the hidden owner of agentic correctness.
