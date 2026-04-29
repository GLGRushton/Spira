# Orchestration SDK Escape Hatch

## Why this exists

Shinra's current core is too coupled to Copilot CLI economics. With Copilot moving to usage-based billing, the orchestration layer needs to become provider-agnostic so Spira is not pinned to one expensive backend.

## Core idea

Build the orchestration layer as an independent SDK that lives inside the Spira monorepo for now, but is designed so it can be lifted into another project later with minimal change.

Spira should become a host of the SDK, not the place where the orchestration logic is permanently trapped.

## Proposed split

### Portable orchestration SDK

Owns:

- provider interfaces
- routing and policy logic
- agent runtime and task lifecycle
- tool contracts
- memory and context contracts
- telemetry, budget tracking, and cost-aware escalation

Should not know about:

- Spira views or UI concepts
- Spira-specific settings screens
- local desktop control details
- app-specific upgrade flows
- product wording or persona presentation

### Spira integration layer

Owns:

- UI wiring
- local settings and persistence details
- MCP server integration details
- Spira-specific defaults and policies
- Shinra persona and product behavior

## Initial package shape

- `packages/orchestration-sdk`
- `packages/provider-copilot-cli`
- future provider packages for direct APIs or local runtimes
- Spira app code consuming the SDK through host bindings

## Design rules

1. Model capabilities, not Copilot CLI quirks.
2. Treat cost as a first-class runtime signal.
3. Keep host integration thin.
4. Make provider adapters swappable.
5. Make extraction possible without rewriting orchestration logic.

## Practical outcome

This gives Spira an escape hatch:

- keep Copilot CLI as one backend for now
- add cheaper or local providers later
- route tasks by cost, capability, privacy, and latency
- reuse the orchestration layer outside Spira if needed
