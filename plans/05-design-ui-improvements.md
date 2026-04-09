# Spira Audit — Design and UI Improvements

Synthesized from Shinra, Sonnet, and Opus after a repo-wide review.

## 1. Make the Aux Deck a real operational surface

This is the clearest UI opportunity in the repo. The architecture and plan are already there; the surface just needs to become first-class.

**Evidence:** `plans/bridge-tool-ui-redesign-plan.md`, `packages/renderer/src/components/base/AuxDeck.tsx`, `packages/renderer/src/stores/room-store.ts`

**Recommendation:** Treat it as the live operations monitor for active and recently completed tools, not decorative chrome.

## 2. Use the empty areas of the Ship deck better

Several cells read as placeholders or reserved slots. They should either disappear or earn their footprint with live information.

**Evidence:** `packages/renderer/src/components/base/BaseDeck.tsx`

**Recommendation:** Fill them with quick actions, recent sessions, system stats, or assistant memory/history surfaces.

## 3. Unify naming around Settings vs. Operations

The current labels split hairs in a way users should not have to think about. "Operations" in the sidebar and "Settings" in the actual experience are close enough to create friction.

**Evidence:** `packages/renderer/src/components/Sidebar.tsx`, `packages/renderer/src/components/SettingsPanel.tsx`, `packages/renderer/src/tool-display.ts`

## 4. Improve the voice visual language

The current voice meter is serviceable, but modest compared with the rest of the aesthetic ambition.

**Evidence:** `packages/renderer/src/components/VoiceIndicator.tsx`, `packages/renderer/src/stores/audio-store.ts`

**Recommendation:** Upgrade from a single fill bar to a small waveform or segmented signal treatment that distinguishes standby, hearing, transcribing, and muted states more clearly.

## 5. Make the Bridge empty state more welcoming and more tactical

The current prompt chips are solid, but first launch still feels a little too quiet for a product with this much identity.

**Evidence:** `packages/renderer/src/components/chat/ChatPanel.tsx`

**Recommendation:** Add a stronger opening moment: persona-led welcome copy, capability suggestions, recent work if available, and a clearer "what Shinra can do from here" cue.

## 6. Give MCP and agent rooms more legibility

The rooms are structurally good, but they need richer density: better metadata, stronger status hierarchy, and more obvious affordances for drilling into capability or activity.

**Evidence:** `packages/renderer/src/components/base/McpRoomDetail.tsx`, `packages/renderer/src/components/base/AgentRoomDetail.tsx`

## 7. Add theme range without losing the identity

Spira has a coherent look, but the UI is effectively locked to one expression of it.

**Evidence:** `packages/shared/src/protocol.ts`, `packages/renderer/src/stores/settings-store.ts`, `packages/main/src/index.ts`

**Recommendation:** Add alternate palettes or mood variants that stay recognizably Spira rather than introducing a generic light/dark toggle with no taste.
