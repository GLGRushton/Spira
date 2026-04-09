# Spira Audit — Nice to Haves

Synthesized from Shinra, Sonnet, and Opus after a repo-wide review.

## 1. Export transcript as Markdown or JSON

Useful for handoffs, documentation, and keeping a record of successful sessions without requiring a full archival feature.

**Evidence:** `packages/renderer/src/stores/chat-store.ts`

## 2. Message timestamps and better session cues

The data exists, but the conversation surface still hides temporal context. Subtle timestamps and stronger session-boundary notices would make long chats easier to trust.

**Evidence:** `packages/renderer/src/stores/chat-store.ts`, `packages/renderer/src/components/chat/ChatPanel.tsx`, `packages/renderer/src/hooks/useIpc.ts`

## 3. Richer agent room timelines

Agent rooms are a promising concept, but the current detail view is still more status card than mission log.

**Evidence:** `packages/renderer/src/stores/room-store.ts`, `packages/renderer/src/components/base/AgentRoomDetail.tsx`

## 4. Better MCP room introspection

Tool chips should reveal descriptions, argument expectations, and maybe sample usage instead of just existing as names.

**Evidence:** `packages/renderer/src/components/base/McpRoomDetail.tsx`, `packages/backend/src/mcp/tool-aggregator.ts`

## 5. Keyboard shortcuts for common actions

Focus composer, stop streaming, reset session, mute voice, and open the Bridge without hunting through the UI.

**Evidence:** `packages/renderer/src/components/AppShell.tsx`, `packages/renderer/src/components/chat/InputBar.tsx`

## 6. Tray quick actions

The tray exists; it should do a bit more. Toggle wake-word listening, toggle spoken replies, and jump straight into compose.

**Evidence:** `packages/main/src/tray.ts`, `packages/main/src/index.ts`

## 7. On-demand tool call inspection

The transcript is cleaner now, which is good. What is still missing is an elegant debug affordance to inspect tool args/results only when the user wants them.

**Evidence:** `plans/bridge-tool-ui-redesign-plan.md`, `packages/renderer/src/components/chat/ToolActivityLine.tsx`, `packages/renderer/src/stores/chat-store.ts`
