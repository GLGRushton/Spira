# Spira Audit — New Genuinely Helpful Features

Synthesized from Shinra, Sonnet, and Opus after a repo-wide review.

## 1. Searchable conversation archive

**Value:** This is the single most practical upgrade. Shinra would stop being "the assistant for this window" and become "the assistant that remembers what we already solved."

**Grounding:** Chat messages already have stable IDs, roles, timestamps, and trim logic.

**Evidence:** `packages/renderer/src/stores/chat-store.ts`

## 2. Clipboard tools

**Value:** Reading from and writing to the clipboard would unlock an enormous number of everyday workflows: explain copied errors, rewrite copied text, place generated output back on the clipboard, and bridge across apps cleanly.

**Grounding:** This fits naturally beside the existing Windows system MCP tools.

**Evidence:** `packages/mcp-windows/src/tools/*`

## 3. File-system MCP server

**Value:** Spira can already inspect windows, automate UIs, read the screen, and search Nexus Mods, but it lacks a straightforward first-party file surface. That caps how helpful Shinra can be outside the repo or browser.

**Grounding:** The repo already has scaffolding for new MCP servers and a strong MCP pattern.

**Evidence:** `scripts/new-mcp-server.ts`, `mcp-servers.json`

## 4. Scheduled reminders and timers

**Value:** A desktop assistant becomes materially more useful when it can remember to do something later, not just answer now.

**Grounding:** Spira already has notifications, TTS, background processes, and app lifecycle control.

**Evidence:** `packages/mcp-windows/src/tools/notifications.ts`, `packages/backend/src/voice/*`

## 5. Global push-to-talk hotkey

**Value:** This would make voice genuinely usable while coding, gaming, or working in another application.

**Grounding:** The voice pipeline already supports push-to-talk activation; the missing piece is a global shortcut and UI for configuring it.

**Evidence:** `packages/backend/src/index.ts`, `packages/backend/src/voice/pipeline.ts`, `packages/main/src/index.ts`

## 6. Web search as a first-class tool

**Value:** `web_fetch` is useful once Shinra already has a URL. Search would remove that bottleneck and greatly improve research tasks.

**Grounding:** The renderer already classifies `web_search` as an expected tool category.

**Evidence:** `packages/renderer/src/stores/room-store.ts`, `packages/renderer/src/tool-display.ts`

## 7. Multi-model selection

**Value:** Let users pick speed vs. depth instead of forcing a one-size-fits-all assistant style for every task.

**Grounding:** Spira already has strong operational affordances, subagents, and model-aware usage patterns; exposing this in product form would be genuinely useful for real work.

**Evidence:** `packages/backend/src/copilot/session-manager.ts`
