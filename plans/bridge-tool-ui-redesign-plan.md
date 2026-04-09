## Problem

The current Bridge chat UI renders tool calls inline as expandable cards with args and results. That makes the transcript noisy, overemphasizes raw payloads, and leaves the Aux Deck in the bottom-right underused.

## Goals

1. Remove verbose tool-call noise from the default chat transcript.
2. Use the Bridge chrome, especially the Aux Deck, to present live tool activity more elegantly.
3. Show compact tool usage summaries near Shinra without turning the transcript into a log viewer.
4. Preserve debuggability without making args/results the default UI.

## Current architecture

- `packages/renderer/src/components/chat/ToolCallCard.tsx` renders verbose args/results cards in chat.
- `packages/renderer/src/components/chat/MessageBubble.tsx` mounts one tool card per tool call.
- `packages/renderer/src/components/base/BridgeRoomDetail.tsx` contains the Bridge layout and an unused Aux Deck placeholder.
- `packages/renderer/src/stores/chat-store.ts` stores tool calls on assistant messages.
- `packages/renderer/src/stores/room-store.ts` tracks live tool flights with `callId`, `toolName`, `status`, and timing.
- `packages/renderer/src/hooks/useIpc.ts` dual-writes tool events into both chat and room state.

## Key findings

- The Aux Deck is already structurally available and can be repurposed without major layout surgery.
- Live tool state already exists in `room-store`, which makes an active-tools surface feasible.
- Tool history already exists in `chat-store`, which makes summary chips feasible.
- Most operational tools currently route to `"settings"` rather than `"bridge"`, so an Aux Deck that only shows bridge-local tools would miss most real activity.
- A highly dynamic split-tile Aux Deck may be more complexity than value unless concurrent tool activity is common in real usage.

## Recommended product direction

### 1. Chat transcript

- Remove verbose args/result cards from the default chat view.
- Keep the transcript focused on user and assistant conversation.
- Preserve a hidden or secondary debug affordance for inspecting raw tool args/results later if needed.

### 2. Shinra idle summary

- Show compact summary chips near Shinra when the assistant is idle.
- Default scope should be the **latest assistant turn**, not the entire session.
- Example chips:
  - `view x10`
  - `powershell x2`
  - `rg x4`
- If needed later, session-level totals can be added as a separate secondary summary.

### 3. Aux Deck as live active-tools monitor

- Use the Aux Deck as a global active-tools surface, not a bridge-only surface.
- Show currently running tools and briefly retain recently completed tools so the panel does not feel twitchy.
- Start with a **single stacked live monitor** rather than committing immediately to split panes.
- If later data shows frequent concurrency, evolve to split tiles or a small grid.

### 4. Animations

- Use lightweight Framer Motion and CSS animation, not another Three.js surface.
- Prefer category-based animation styling instead of bespoke per-tool animations.

Candidate categories:

- **Inspecting**: `view`, `rg`, `glob`, `read_*`
- **Operating**: `powershell`, `apply_patch`, `sql`
- **Researching**: `web_fetch`, `task`, `read_agent`
- **Vision**: `vision_*`, `ui_*`
- **System**: `system_*`

## Recommended UX model

| Surface | Purpose | Default content |
|---|---|---|
| Chat transcript | conversation | user/assistant messages only |
| Shinra panel | passive recent summary | compact latest-turn tool chips |
| Aux Deck | live operations | running tools + short completion linger |
| Debug detail | on-demand inspection | args/results when explicitly opened |

## Implementation approach

### Phase 1 — declutter chat

1. Remove `ToolCallCard` from the default message flow.
2. Optionally replace it with a tiny inline "running tools" status line while a response is still active.
3. Keep raw tool data in state; do not delete the underlying records.

### Phase 2 — add Shinra summary chips

1. Add a derived selector that aggregates tool calls from the latest assistant response.
2. Render compact chips in the Shinra stage when the assistant is idle.
3. Cap chip count and collapse overflow if needed.

### Phase 3 — replace Aux Deck placeholder

1. Build an `AuxDeck` or `ActiveToolPanel` component.
2. Derive active items from `room-store.flights`.
3. Show running and very recently completed tools.
4. Render a stacked tactical list first: tool name, status, animation, optional elapsed time.

### Phase 4 — polish and hardening

1. Add optional debug drill-down for args/results.
2. Validate repeated same-name tool calls are matched by `callId`, not name fallback.
3. Revisit persistence of large tool payloads in `sessionStorage`.
4. If concurrency patterns justify it, introduce tile splitting in the Aux Deck.

## Technical cautions

- `room-store.ts` uses module-level Maps for transient tool routing; this is workable but brittle.
- `chat-store.ts` currently persists tool payloads, which may be larger than the eventual UI needs.
- Repeated same-name tool calls need accurate `callId`-based matching for correct summaries.
- The Aux Deck should not depend on room routing semantics that currently classify many tools as `"settings"`.

## Open decisions before implementation

1. Should the transcript show any minimal inline "running tools" indicator during execution?
2. Should debug details open from Shinra chips, Aux Deck items, or both?
3. How long should completed tools linger in the Aux Deck before fading out?
4. What threshold of concurrent active tools justifies a split-tile layout instead of a stacked list?
