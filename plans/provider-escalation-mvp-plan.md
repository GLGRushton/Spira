# Provider Escalation MVP Plan

## Goal

Add two experimental provider adapters, `openai-escalation` and `azure-openai-escalation`, so Spira can compare baseline provider performance against a narrow escalation-aware variant without changing the existing `openai` and `azure-openai` providers.

## Why this shape

Provider ID is already a first-class seam in Spira across config, runtime selection, persistence, provider switching, and usage tracking. That makes separate experimental providers the cleanest way to run an A/B comparison while keeping the current providers as the control group.

This MVP intentionally does **not** implement the full orchestration design from `plans\model-escalation-architecture.md`. It adds a focused experiment layer inside the provider boundary.

## MVP architecture

### Provider IDs

Add two canonical IDs:

- `openai-escalation`
- `azure-openai-escalation`

Keep:

- `openai`
- `azure-openai`
- `copilot`

### Design boundary

- **Shared, main, renderer:** learn the new provider IDs and the minimal config needed to select them.
- **Backend provider layer:** owns the experimental routing behavior.
- **Session manager, subagent runner, runtime persistence:** stay provider-agnostic and continue to carry provider IDs through existing flows.

### Implementation principle

Build the new providers as **thin variants** over the existing OpenAI and Azure OpenAI stacks.

Do **not** clone the full provider implementations. Refactor just enough shared code so the experimental variants can reuse the same transport, session state, tool-calling, streaming, and continuity machinery.

## MVP behavior

### OpenAI escalation provider

- Base target: existing `OPENAI_MODEL`
- Escalation target: new `OPENAI_ESCALATION_MODEL`
- Reuse:
  - `OPENAI_API_KEY`
  - `OPENAI_BASE_URL`

### Azure OpenAI escalation provider

- Base target: existing `AZURE_OPENAI_DEPLOYMENT`
- Escalation target: new `AZURE_OPENAI_ESCALATION_DEPLOYMENT`
- Optional label: `AZURE_OPENAI_ESCALATION_MODEL`
- Reuse:
  - `AZURE_OPENAI_API_KEY`
  - `AZURE_OPENAI_ENDPOINT`
  - `AZURE_OPENAI_API_VERSION`

### Escalation rules for MVP

Keep them narrow, deterministic, and easy to test:

1. Empty assistant response from provider.
2. Max tool-call iteration exhaustion for a single turn.
3. Retryable provider failure where reissuing on the escalation target is safe.

### Session policy

- Escalation is **one-way** for MVP.
- Once a session escalates, it remains on the escalation target for the rest of that session.
- If an explicit upstream requested model is supplied, internal escalation should be disabled for that session to preserve comparison integrity.

## Implementation phases

## Phase 1: Provider surface and config plumbing

Update the provider ID surface everywhere it is currently enumerated or normalized.

### Expected work

- extend `MODEL_PROVIDERS`
- update `SPIRA_MODEL_PROVIDER` validation
- update runtime-config alias normalization and allowed values
- update error text that currently only mentions `copilot`, `azure-openai`, and `openai`
- update provider labels shown in backend messages
- update secure runtime-config metadata and Settings UI provider selection

### Files likely touched

- `packages\shared\src\model-provider.ts`
- `packages\shared\src\config-schema.ts`
- `packages\shared\src\config-schema.test.ts`
- `packages\main\src\runtime-config-utils.ts`
- `packages\main\src\runtime-config-utils.test.ts`
- `packages\main\src\index.ts`
- `packages\renderer\src\components\SettingsPanel.tsx`
- `packages\backend\src\provider\provider-config.ts`

## Phase 2: Add minimal experimental config

Add only the configuration required for the new experimental targets.

### New config for MVP

- `OPENAI_ESCALATION_MODEL`
- `AZURE_OPENAI_ESCALATION_DEPLOYMENT`
- `AZURE_OPENAI_ESCALATION_MODEL` (optional telemetry label)

### Design note

Do not add a forest of policy knobs yet. Start with fixed behavior in code so the experiment stays interpretable.

## Phase 3: Refactor shared provider internals

Refactor the provider implementations just enough to support variants cleanly.

### Expected work

- make OpenAI provider creation variant-aware
- make Azure provider creation variant-aware
- remove hardcoded baseline provider IDs from host continuity snapshots and provider-specific state where needed
- ensure actual provider IDs survive runtime binding, resume, and persistence

### Critical constraint

Azure escalation must route through a distinct deployment path. A model-label-only implementation would make the experiment invalid.

## Phase 4: Add the experimental provider adapters

Implement:

- `openai-escalation`
- `azure-openai-escalation`

These adapters should:

- advertise the new provider IDs
- use the baseline provider capabilities unless there is a real behavior difference
- switch to the escalation target on the narrow trigger set
- stay escalated for the remainder of the session

## Phase 5: Telemetry and experiment instrumentation

The experiment is only useful if the data comes out clean.

### Capture and persist

- provider ID
- actual model or deployment label used
- input, output, and total tokens
- estimated cost when available
- latency
- escalation happened or not
- escalation reason

### Principle

Use existing usage and runtime persistence first. Add only a minimal escalation decision record if current logs and usage records are not enough to explain why a session switched targets.

## Phase 6: Testing and rollout readiness

### Test coverage to add or update

- provider ID acceptance in shared config parsing
- runtime-config normalization, aliases, allowed values, and error strings
- provider factory creation for both experimental providers
- OpenAI escalation routing behavior
- Azure escalation deployment routing behavior
- session manager behavior with new provider IDs
- subagent runner behavior with new provider IDs
- provider binding and persistence tests where provider IDs are enumerated
- memory/persistence validation where provider IDs are normalized

### Baseline safety check

Keep explicit tests that prove `openai` and `azure-openai` still behave as before.

## Telemetry comparison plan

Compare:

- `openai` vs `openai-escalation`
- `azure-openai` vs `azure-openai-escalation`

Use:

- provider ID
- actual model or deployment label
- token counts
- cost when available
- latency
- completion/error rates

This keeps the experiment simple enough to interpret before investing in any dashboard work.

## Risks

1. **Provider copy-paste debt**  
   Cloning provider folders will create four maintenance paths instead of two. Avoid it.

2. **Azure comparison becoming fake**  
   If Azure does not switch deployments, the experiment will report a difference that does not exist.

3. **Host continuity mismatches**  
   Some provider state currently assumes baseline provider IDs. That must become variant-aware.

4. **Noisy comparison due to explicit requested models**  
   If upstream callers set models directly, the experiment can become hard to interpret. The MVP should treat explicit requested models as an override that disables internal escalation.

## Cleanup path if the experiment succeeds

If the new providers perform better:

1. keep them temporarily as explicit experiment variants while data is verified
2. decide whether to:
   - replace baseline providers with the escalation variants, or
   - fold the behavior back into baseline providers behind a policy layer
3. deprecate the old provider IDs only after migration and telemetry review

## Consensus summary

This plan reflects a reconciled review of the current codebase and two requested heavyweight planning passes:

- `gpt-5.5`
- `claude-opus-4.7`

Both agreed on the same essentials:

- separate experimental provider IDs are the right seam
- reuse the existing provider engines
- keep the MVP narrow
- make Azure escalation deployment-based
- prioritize clean telemetry over feature breadth
