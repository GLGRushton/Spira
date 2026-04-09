# Spira Audit — Ideas (Fun Feature Suggestions)

Synthesized from Shinra, Sonnet, and Opus after a repo-wide review.

## 1. Custom wake-word training wizard

Spira already supports custom wake-word model paths. Turning that into a guided in-app "train Shinra to your voice" flow would be distinctive and delightfully on-brand.

**Evidence:** `README.md`, `packages/backend/src/voice/wake-word-openwakeword.ts`

## 2. Ambient ship mode

When idle, let Spira become a living status display: orb, system telemetry, subtle motion, and low-noise atmosphere rather than just a minimized utility window.

**Evidence:** `packages/renderer/src/components/base/BaseDeck.tsx`, `packages/renderer/src/components/orb/*`, `packages/mcp-windows/src/tools/*`

## 3. Persona packs

The Shinra identity is already deliberate. Formalizing that into switchable personas with different tone, voice, color, and prompt style could be fun without undermining usefulness.

**Evidence:** `packages/backend/src/copilot/session-manager.ts`, `packages/shared/src/protocol.ts`

## 4. Mission debriefs after reset

When a session ends, Shinra could summarize what was accomplished, which tools were used, and any pending threads. A satisfying bit of ceremony, and quietly useful.

**Evidence:** `packages/renderer/src/components/chat/InputBar.tsx`, `packages/renderer/src/stores/chat-store.ts`

## 5. Orb mood system based on task category

The orb already reacts to assistant state. Extending it to react to research vs. system actions vs. vision work would make the product feel more alive without becoming gaudy.

**Evidence:** `packages/renderer/src/components/orb/*`, `packages/renderer/src/tool-display.ts`

## 6. Floating mini-window mode

A compact, always-on-top orb plus mic/composer overlay would suit gaming, browsing, and coding better than the full control-room layout.

**Evidence:** `packages/main/src/window.ts`, `packages/renderer/src/components/orb/*`

## 7. Game-aware companion mode

Spira already has Nexus Mods plus Windows app/process awareness. Combining them into a mode that notices what game is running and offers relevant mod/help workflows would be charming and actually useful.

**Evidence:** `packages/mcp-nexus-mods/src/*`, `packages/mcp-windows/src/tools/apps.ts`
