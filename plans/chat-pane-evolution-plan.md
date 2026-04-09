## Problem

The Bridge chat pane is visually stronger after the tool UI overhaul, but the core conversation surface still has three major weaknesses:

1. Users cannot stop or steer a response once streaming starts.
2. Streaming text renders as plain text and then snaps into markdown at completion.
3. The UI does not clearly support clarification-question loops, pending/thinking states, or session-state boundaries after clear/reset/reconnect.

## Proposed approach

Improve the pane in phased, reviewable increments:

1. Add user control during generation and remove the "dead zone" after send.
2. Make streaming render like the finished response instead of changing presentation at the end.
3. Add first-class UX for Shinra asking follow-up questions and for users acting on prior messages.
4. Harden session-state and IPC flow so the chat stays trustworthy as features grow.

## Status

Completed. All four phases were implemented, reviewed with Sonnet and Opus at each phase boundary, and validated with changed-file Biome checks plus full typecheck, test, and build runs.

## Scope

### In scope

- Immediate pending/thinking state after submit
- Stop-generation control
- Markdown-aware streaming presentation
- Clarification-question affordances
- Message actions such as copy and retry
- Empty state and session-state notices where needed
- Reset confirmation polish
- Supporting IPC/store work required for the above

### Out of scope for this pass

- Full conversation virtualization
- Drag-and-drop multimodal composer
- Analytics/feedback pipelines
- Large backend protocol redesign beyond what the UI changes require

## Phase plan

### Phase 1 - generation control

Deliver the foundational control loop:

1. Show a pending/thinking state immediately after submit, before the first delta arrives.
2. Add a Stop button while streaming.
3. Wire the stop action through the existing app layers or add the minimum protocol needed if the backend lacks an interrupt path.
4. Keep Clear/Reset semantics coherent with the new streaming state.

### Phase 2 - streaming presentation

Fix the most obvious rendering seam:

1. Replace plain-text streaming with markdown-aware streaming.
2. Remove or reduce the artificial character-drip effect if it fights real token cadence.
3. Preserve cursor/active-response affordances without causing layout flash.
4. Make tool activity and streamed text coexist without jumpy layout changes.

### Phase 3 - collaborative chat affordances

Make the pane better at actual dialogue:

1. Add a distinct assistant-question treatment for clarification prompts.
2. Autofocus and visually emphasize the composer when Shinra is awaiting input.
3. Add message actions, starting with copy and retry/regenerate.
4. Add an empty/welcome state for fresh panes.

### Phase 4 - state honesty and polish

Tighten the truthfulness of the surface:

1. Replace native reset confirmation with an in-app confirmation pattern.
2. Add session/context notices when UI history and backend context may diverge after clear/reset/reconnect.
3. Refactor chat IPC wiring if needed to support the new behaviors cleanly.
4. Clean up any state duplication or fragile local-only flags exposed by the earlier phases.

## Review protocol

- Sonnet and Opus review the implementation plan before coding begins.
- At the end of each implementation phase, Sonnet and Opus review the code and findings before the next phase starts.
- Fixes raised by those reviews are folded into the same phase before moving on when they materially affect correctness, UX, or maintainability.

## Key files likely to change

- `packages/renderer/src/components/chat/ChatPanel.tsx`
- `packages/renderer/src/components/chat/ChatPanel.module.css`
- `packages/renderer/src/components/chat/InputBar.tsx`
- `packages/renderer/src/components/chat/InputBar.module.css`
- `packages/renderer/src/components/chat/MessageBubble.tsx`
- `packages/renderer/src/components/chat/MessageBubble.module.css`
- `packages/renderer/src/components/chat/StreamingText.tsx`
- `packages/renderer/src/components/chat/StreamingText.module.css`
- `packages/renderer/src/hooks/useIpc.ts`
- `packages/renderer/src/stores/chat-store.ts`
- `packages/shared/src/protocol.ts`
- `packages/shared/src/electron-api.ts`
- `packages/main/src/preload.ts`
- `packages/backend/src/index.ts`

## Notes and cautions

- `useIpc.ts` is already carrying a great deal of orchestration; avoid deepening that tangle unless a phase explicitly includes refactoring it.
- `addUserMessage` currently has multiple ingress paths; be careful not to introduce duplicate user messages while improving pending/clarification flows.
- Clear vs Reset must remain clearly distinct:
  - Clear = UI wipe, backend session retained
  - Reset = UI wipe, backend session discarded
- If a backend abort path does not exist, add the narrowest safe protocol for it rather than inventing renderer-only faux cancellation.

## Todos

1. Plan and review chat-pane upgrade phases with Sonnet and Opus.
2. Implement generation control improvements.
3. Implement markdown-aware streaming and transcript stability improvements.
4. Implement collaborative chat affordances and message actions.
5. Implement session-state polish and any necessary IPC hardening.
6. Validate the full chat-pane upgrade and prepare it for commit.
