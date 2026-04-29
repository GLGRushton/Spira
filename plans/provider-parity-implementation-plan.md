# Provider Parity Implementation Plan

## Objective

Make Spira's capabilities provider-independent so that switching between Copilot, Azure OpenAI, or a future provider does not materially change what Shinra can do, how long-running work behaves, or what state survives restart and recovery.

## Core principle

Providers should be model transports, not capability owners.

Copilot-specific behavior is still leaking through in three places:

- base operational tools
- durable multi-round session continuity
- restart-safe background/subagent execution

The plan is to move those responsibilities into host-owned runtime and storage layers, then let each provider consume the same contract.

## Minimum required parity

1. **Base operational tools**
   - `powershell`, `read_powershell`, `write_powershell`, `stop_powershell`, `list_powershell`
   - file read/search/edit tools such as `view`, `rg`, `glob`, and host-owned write/edit flows including `apply_patch`
   - other existing first-class Spira tools that the UI and orchestration already treat as standard operating tools

2. **Session storage**
   - durable plans
   - useful memories
   - session scratch state
   - session/task todos and structured state
   - conversation continuity artifacts needed for restart and provider swap

3. **Agentic multi-round sessions**
   - durable station sessions
   - durable background/subagent sessions
   - restart-safe follow-up after idle/background work
   - host-owned continuation even when a provider has no native persistent session support

## Additional required parity

- permission semantics parity
- working directory and path semantics parity
- streaming behavior parity, including explicit host-buffered fallback when native streaming is missing
- cancellation parity, including explicit host-authoritative cancellation when native abort is missing
- usage and telemetry parity
- tool manifest refresh parity when MCP/tool inventory changes
- prompt/system instruction parity
- subagent lifecycle parity
- recovery and error messaging parity
- provider swap parity within an existing station/session

## Current confirmed gaps

1. Azure currently receives the host tool bridge output, but that bridge only exposes MCP-backed tools plus Spira synthetic tools. It does not expose the base operating tool surface such as PowerShell or patch/file operations.
2. Azure session continuity is host-managed only in memory today, so restart-safe resume is not real parity.
3. Current durable runtime state is useful but shallow. It persists station state, permission requests, subagent snapshots, and usage, but it does not yet persist a canonical replayable session ledger.
4. Background and subagent recovery remains asymmetric because durable multi-round follow-up still depends too heavily on provider session persistence.
5. The renderer already classifies operating tools as first-class tools, which means the product contract is ahead of the provider/runtime implementation.

## Target architecture

### 1. Host Capability Registry

Create a provider-neutral host capability registry that owns the complete tool surface exposed to Shinra.

It should include:

- operating tools
- MCP tools
- Spira synthetic tools
- mission-scoped tools
- subagent control tools
- storage tools

This registry becomes the only source for `ProviderToolDefinition[]`.

Provider-native tools should either be disabled, ignored, or wrapped behind the same host contract so the visible and behavioral tool surface remains stable.

### 2. Host Session Ledger

Create a durable ledger for stations and subagents that persists:

- system prompt and instruction sections
- provider/model metadata
- working directory
- tool manifest signature
- user turns
- assistant turns
- tool calls and results
- permission records
- cancellation markers
- checkpoints/summaries
- links to plans, memories, and structured session storage

Provider-managed session IDs become optional acceleration, not correctness.

### 3. Host Resume/Rehydrate Engine

Add a host-owned resume engine that can:

1. reopen a provider session after restart or provider swap
2. rehydrate canonical state from checkpoints and the ledger
3. replay or compact prior context as needed
4. continue the same station or subagent flow with the same tools and storage handles

Native provider session resume is an optimization path when available, not the primary continuity mechanism.

### 4. Unified Agent Runtime

Main station execution and subagent/background execution should run through the same durable runtime primitives for:

- turn lifecycle
- tool execution boundaries
- permission lifecycle
- cancellation
- idle/background recovery
- usage capture
- replay and checkpointing

## Implementation phases

### Phase 0 - Define the parity contract

Write the canonical provider parity contract before further implementation.

It must define:

- the host-owned tool inventory
- argument/result schemas
- read/write classification
- permission requirements
- session storage primitives
- resume semantics
- streaming and cancellation policy
- telemetry expectations
- failure and recovery rules

Add golden tests that compare the effective Copilot and Azure manifests and lifecycle policies.

### Phase 1 - Build the host base-tool layer

Introduce a host-owned operational tool layer for:

- PowerShell execution and session control
- file read/search/edit operations
- patch application
- structured session SQL access if it remains part of the standard operating contract
- any other existing built-in operating tools already treated as first-class in Spira

Feed this layer through the same registry used by both providers and by subagents.

This phase is complete when Copilot and Azure expose the same operating tool surface to equivalent stations and subagents.

### Phase 2 - Build durable session storage

Extend host storage so plans, memories, and structured session state are first-class and durable.

Add explicit storage surfaces for:

- session plan documents
- useful memory entries
- session scratchpad state
- structured session tables/state
- conversation-linked continuity artifacts

The host session ledger should reference these durable artifacts directly.

This phase is complete when plan/memory/task context survives backend restart and provider swap without relying on provider-specific storage.

### Phase 3 - Build restart-safe multi-round continuity

Implement host-owned checkpointing and rehydration for stations.

Replace continuity-preamble-only recovery with:

- ledger-backed replay
- compacted checkpoints
- explicit fallback rules when replay is partial

This phase is complete when a station can continue the same task after restart under either provider with the same tools and durable context.

### Phase 4 - Make subagents and background runs durable

Move subagent/background continuity onto the same host-owned session ledger and rehydrate path.

Persist enough state for restart-safe:

- idle recovery
- `read_subagent`
- `write_subagent`
- `stop_subagent`
- tool-call visibility
- summary/result replay

This phase is complete when Azure background/idle runs can survive restart and accept follow-up input with the same semantics as Copilot.

### Phase 5 - Normalize capability fallback behavior

Make fallback behavior explicit and runtime-owned for:

- native provider session resume vs host replay
- native abort vs host-authoritative cancellation
- native streaming vs host-buffered streaming
- full usage reporting vs partial/unknown usage
- provider swap during an existing conversation

This phase is complete when provider limitations no longer leak into user-visible orchestration behavior as ad hoc special cases.

### Phase 6 - Harden parity with tests and guardrails

Add contract and integration coverage for:

- effective tool manifest parity
- permission parity
- station resume parity
- subagent resume parity
- provider swap continuity
- usage/telemetry parity
- dynamic tool manifest refresh
- recovery/error messaging parity

Add a repository guardrail ensuring direct Copilot SDK usage remains confined to the provider adapter boundary.

## Acceptance criteria

The plan is complete when all of the following are true:

1. Switching providers does not materially change the visible tool set for the same station/subagent configuration.
2. PowerShell and other operating tools work through host-owned definitions rather than provider-specific magic.
3. Plans, memories, and structured session state are durable and provider-independent.
4. Stations can resume meaningful multi-round work after backend restart under both Copilot and Azure.
5. Background and idle subagents can be recovered and written to after restart under both providers.
6. Permission prompts, streaming behavior, cancellation behavior, and recovery/error semantics are provider-neutral at the host level.
7. Usage and correlation metadata remain durable and queryable regardless of provider.
8. Provider-managed persistence can disappear without removing core Shinra capabilities.

## Risks

- transcript replay and checkpoint growth can increase token cost unless compaction is deliberate
- interactive shell/session tools require durable host process orchestration, not just chat-state persistence
- permission requests must fail closed or be safely reissued after restart
- tool manifest changes can invalidate stale checkpoints if signatures are not tracked carefully
- copying Copilot behavior too literally would preserve the wrong dependency boundary

## Rollout guidance

- keep provider switching additive during migration
- land the host capability registry before attempting broad Azure parity claims
- make the host ledger the source of truth before renaming residual Copilot-shaped orchestration files
- treat native provider resume as optional optimization from the start

## Final verdict

Spira should not merely support multiple providers.

Spira should own the capabilities that matter, so that provider choice affects model characteristics, not Shinra's practical agency.
