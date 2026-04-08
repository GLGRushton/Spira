# XCOM 2 Avenger Bridge — Implementation Plan

> **Status**: Planning · **Author**: Copilot Architect · **Date**: 2025-07-15

---

## 0. Executive Summary

Transform Spira's current two-panel layout into an XCOM 2 Avenger-style "base map" where the Shinra Orb sits at the center as the command node, functional areas are represented as navigable **rooms** arranged around it, MCP servers manifest as glowing facility rooms, and tool calls are visualised as energy orbs travelling from the core to target rooms. Subagent spawns dynamically create new rooms in real time.

The redesign retains the existing R3F orb, Zustand stores, and WebSocket protocol as foundations — extending rather than replacing them.

---

## 1. Component Architecture

### 1.1 New Components

| Component | Path | Purpose |
|---|---|---|
| `BaseMap` | `packages/renderer/src/components/base-map/BaseMap.tsx` | Top-level layout replacing the current `<main>` content in `AppShell`. CSS Grid radial/grid layout of rooms around the orb. **Not** an R3F canvas — pure HTML/CSS + Framer Motion. |
| `BaseMap.module.css` | `…/base-map/BaseMap.module.css` | Grid layout, responsive breakpoints. |
| `RoomCard` | `…/base-map/RoomCard.tsx` | Generic room tile: icon, label, status badge, glow border. Receives `RoomDefinition` prop. Click navigates to room detail. |
| `RoomCard.module.css` | `…/base-map/RoomCard.module.css` | Glass-panel room styling with state-driven glow classes. |
| `RoomDetailOverlay` | `…/base-map/RoomDetailOverlay.tsx` | Full-pane overlay that slides in (Framer `AnimatePresence`) when a room is focused. Contains the room's content component (ChatPanel, SettingsPanel, McpServerRoom, SubagentRoom). "Back to base" button returns to map view. |
| `RoomDetailOverlay.module.css` | `…/base-map/RoomDetailOverlay.module.css` | Overlay positioning, slide animation anchor. |
| `McpServerRoom` | `…/base-map/rooms/McpServerRoom.tsx` | Detail view for a single MCP server: connection status, tool list, recent tool call history, uptime. Replaces the inline `McpStatus` list. |
| `SubagentRoom` | `…/base-map/rooms/SubagentRoom.tsx` | Detail view for a spawned subagent: streaming output, status, linked tool calls. |
| `CoreRoom` | `…/base-map/rooms/CoreRoom.tsx` | The Shinra Orb "command node" room. Wraps the existing `ShinraOrb` + assistant state header. Always present at grid center. |
| `TravelOrb` | `…/base-map/TravelOrb.tsx` | Animated glowing dot that moves from source position to destination position. Pure Framer Motion `motion.div` with absolute positioning. |
| `TravelOrbLayer` | `…/base-map/TravelOrbLayer.tsx` | Absolute-positioned overlay that renders active `TravelOrb` instances. Reads from `useTravelOrbStore`. |
| `RoomBadge` | `…/base-map/RoomBadge.tsx` | Small status indicator on a `RoomCard` — shows active tool call count, error state, etc. |

### 1.2 Refactored Components

| Component | Change |
|---|---|
| `AppShell.tsx` | Remove the two `GlassPanel` blocks and the `orbPanel`/`contentPanel` split. Replace `<main>` content with `<BaseMap />`. Keep `TitleBar`, `Sidebar`, overlay components (`PermissionPrompt`, `ReconnectingOverlay`, etc.) unchanged. The `view` state moves from `useState` to the new `navigation-store`. |
| `Sidebar.tsx` | Expand `SidebarView` to `RoomId` type. Nav items are generated dynamically from `useNavigationStore().rooms` (static rooms + dynamic subagent/MCP rooms). `McpStatus` moves out of sidebar footer into the base map as room cards. `VoiceIndicator` stays in the sidebar footer. |
| `McpStatus.tsx` | **Deprecated** — functionality absorbed by `McpServerRoom` + `RoomCard` rendering of MCP servers. Keep the file temporarily as a legacy fallback behind a feature flag. |
| `ChatPanel.tsx` | Unchanged internally. Mounted inside `RoomDetailOverlay` when `activeRoom === "chat"`. |
| `SettingsPanel.tsx` | Unchanged internally. Mounted inside `RoomDetailOverlay` when `activeRoom === "settings"`. Remove the inline MCP server list (it now has its own room). |
| `ShinraOrb.tsx` | Unchanged. Mounted inside `CoreRoom`. |

### 1.3 Room Abstraction

A **room** is a data-driven concept, not a single React component class:

```typescript
// packages/shared/src/room-types.ts (NEW FILE)

export type RoomKind = "core" | "chat" | "settings" | "mcp-server" | "subagent";

export interface RoomDefinition {
  id: string;                       // e.g. "core", "chat", "mcp:filesystem", "subagent:abc123"
  kind: RoomKind;
  label: string;                    // Display name
  caption?: string;                 // Subtitle
  icon?: string;                    // Emoji or icon key
  status: "idle" | "active" | "error" | "spawning" | "completed";
  /** For mcp-server rooms: the McpServerStatus.id */
  serverId?: string;
  /** For subagent rooms: the subagent ID */
  subagentId?: string;
  /** Grid position hint — row, col in the base map grid. Auto-assigned if omitted. */
  position?: { row: number; col: number };
  /** Timestamp of last activity — used for glow intensity decay */
  lastActivityAt?: number;
}
```

Each `RoomKind` maps to a content component inside `RoomDetailOverlay`:

```typescript
// packages/renderer/src/components/base-map/room-content-registry.ts (NEW FILE)

const ROOM_CONTENT: Record<RoomKind, React.ComponentType<{ roomId: string }>> = {
  core:        CoreRoom,
  chat:        () => <ChatPanel />,
  settings:    () => <SettingsPanel />,
  "mcp-server": McpServerRoom,
  subagent:    SubagentRoom,
};
```

### 1.4 Base Map Layout Strategy

**Decision: CSS Grid, not R3F.**

Rationale:
- The orb already has its own R3F `<Canvas>`. Adding rooms as 3D objects would require either embedding HTML in R3F (`<Html>` from drei — poor perf, no CSS Modules) or building full 3D room models (enormous scope).
- A CSS Grid gives us responsive breakpoints, accessible keyboard navigation, and trivial integration with Framer Motion for room transitions.
- The R3F orb canvas lives inside the center grid cell (`CoreRoom`). Travel orbs use Framer Motion with `position: absolute` in a portal layer.

Layout sketch (5×5 grid, orb at center):

```
┌─────────┬─────────┬───────────┬─────────┬─────────┐
│         │ MCP:fs  │           │ MCP:git │         │
│ (empty) │  room   │  (empty)  │  room   │ (empty) │
├─────────┼─────────┼───────────┼─────────┼─────────┤
│ Chat    │         │           │         │Settings │
│  room   │ (empty) │   CORE    │ (empty) │  room   │
├─────────┼─────────┤  (Shinra  ├─────────┼─────────┤
│         │         │   Orb)    │         │         │
│ (empty) │Sub:abc  │           │Sub:def  │ (empty) │
└─────────┴─────────┴───────────┴─────────┴─────────┘
```

The grid auto-fills. Static rooms (core, chat, settings) have fixed positions. MCP servers and subagents fill remaining slots using a `useRoomLayout` hook that assigns `{ row, col }` via a simple ring-allocation algorithm around the center.

---

## 2. State / Store Changes

### 2.1 New Store: `navigation-store.ts`

```typescript
// packages/renderer/src/stores/navigation-store.ts (NEW FILE)

import { create } from "zustand";
import type { RoomDefinition, RoomKind } from "@spira/shared";

interface NavigationStore {
  /** All registered rooms. Keyed by room ID for O(1) lookup. */
  rooms: Map<string, RoomDefinition>;
  /** Currently focused room ID, or null = base map overview */
  activeRoomId: string | null;
  /** Previously focused room (for back navigation) */
  previousRoomId: string | null;

  // Actions
  registerRoom: (room: RoomDefinition) => void;
  unregisterRoom: (roomId: string) => void;
  updateRoomStatus: (roomId: string, status: RoomDefinition["status"]) => void;
  updateRoomActivity: (roomId: string) => void;
  focusRoom: (roomId: string) => void;
  returnToMap: () => void;
}
```

**Static rooms** (`core`, `chat`, `settings`) are registered at mount time in `AppShell`. **MCP server rooms** are registered/unregistered reactively in a `useEffect` that watches `useMcpStore().servers`. **Subagent rooms** are registered when `subagent:spawn` events arrive.

### 2.2 New Store: `travel-orb-store.ts`

```typescript
// packages/renderer/src/stores/travel-orb-store.ts (NEW FILE)

import { create } from "zustand";

export interface TravelOrbEntry {
  id: string;           // = tool callId
  sourceRoomId: string; // typically "core"
  targetRoomId: string; // MCP server room or subagent room
  toolName: string;
  status: "traveling" | "arrived" | "returning" | "done";
  startedAt: number;
  color: [number, number, number]; // RGB tuple, derived from target room kind
}

interface TravelOrbStore {
  orbs: TravelOrbEntry[];
  launchOrb: (entry: Omit<TravelOrbEntry, "status" | "startedAt">) => void;
  updateOrbStatus: (id: string, status: TravelOrbEntry["status"]) => void;
  removeOrb: (id: string) => void;
  clearAll: () => void;
}
```

Lifecycle:
1. `tool:call` with `status: "running"` → `launchOrb({ id: callId, sourceRoomId: "core", targetRoomId: resolvedMcpRoomId, ... })`
2. Framer Motion `onAnimationComplete` on `TravelOrb` → `updateOrbStatus(id, "arrived")`
3. `tool:call` with `status: "success"|"error"` → `updateOrbStatus(id, "returning")` → after return animation → `removeOrb(id)`

### 2.3 New Store: `subagent-store.ts`

```typescript
// packages/renderer/src/stores/subagent-store.ts (NEW FILE)

import { create } from "zustand";

export type SubagentStatus = "spawning" | "running" | "completed" | "error";

export interface SubagentEntry {
  id: string;
  name: string;
  purpose?: string;         // Short description from the LLM
  status: SubagentStatus;
  parentMessageId?: string; // Chat message that triggered the spawn
  toolCallIds: string[];    // Tool calls attributed to this subagent
  output?: string;          // Final output when completed
  createdAt: number;
  completedAt?: number;
}

interface SubagentStore {
  subagents: Map<string, SubagentEntry>;
  spawnSubagent: (entry: Omit<SubagentEntry, "status" | "createdAt" | "toolCallIds">) => void;
  updateSubagent: (id: string, update: Partial<SubagentEntry>) => void;
  addToolCallToSubagent: (subagentId: string, callId: string) => void;
  removeSubagent: (id: string) => void;
  clearAll: () => void;
}
```

### 2.4 Extensions to Existing Stores

**`mcp-store.ts`** — add a derived field mapping tool names to server IDs:

```typescript
// Add to McpStore interface:
toolToServerMap: Map<string, string>; // toolName → serverId
```

This map is recomputed whenever `setServers` is called, by iterating each `McpServerStatus` and its `tools[]` array. The `useIpc` hook uses this map to resolve which MCP server room a tool call should target.

**`chat-store.ts`** — add an optional `subagentId` field to `ToolCallEntry`:

```typescript
export interface ToolCallEntry {
  callId?: string;
  name: string;
  args: unknown;
  result?: unknown;
  status?: "pending" | "running" | "success" | "error";
  details?: string;
  subagentId?: string;  // NEW — links tool call to a subagent
}
```

**`assistant-store.ts`** — no changes needed. The orb's visual state continues to be driven by `AssistantState`.

---

## 3. Protocol / Event Changes

### 3.1 New ServerMessage Types

Add to `packages/shared/src/protocol.ts`:

```typescript
// Subagent lifecycle events
| { type: "subagent:spawn"; subagentId: string; name: string; purpose?: string; parentMessageId?: string }
| { type: "subagent:update"; subagentId: string; status: SubagentStatus; output?: string }
| { type: "subagent:complete"; subagentId: string; output?: string }
| { type: "subagent:error"; subagentId: string; error: string }
```

### 3.2 Enrich Existing `tool:call` Message

Add an optional `serverId` field to the existing `tool:call` ServerMessage so the renderer doesn't have to reverse-lookup it:

```typescript
| {
    type: "tool:call";
    callId: string;
    name: string;
    status: ToolCallStatus;
    args?: unknown;
    details?: string;
    serverId?: string;     // NEW — MCP server ID that owns this tool
    subagentId?: string;   // NEW — if this tool call is on behalf of a subagent
  }
```

### 3.3 Backend Changes Required

**`packages/backend/src/server.ts` (WsServer)**:
- In the `copilot:tool-call` handler, look up the tool's `serverId` from `McpToolAggregator.getTools()` and include it in the `tool:call` message.
- Register new bus events for subagent lifecycle.

**`packages/backend/src/util/event-bus.ts`**:
Add new event types:

```typescript
"subagent:spawn": [{ subagentId: string; name: string; purpose?: string; parentMessageId?: string }];
"subagent:update": [{ subagentId: string; status: SubagentStatus; output?: string }];
"subagent:complete": [{ subagentId: string; output?: string }];
"subagent:error": [{ subagentId: string; error: string }];
```

**`packages/backend/src/copilot/session-manager.ts`**:
- When the Copilot SDK emits events that indicate subagent creation (this depends on how subagents are modeled in the SDK — likely through specific tool calls or session events), emit the corresponding bus events.
- **Phase 1 fallback**: If the SDK doesn't natively expose subagent lifecycle, the renderer can infer subagent-like groupings from tool call patterns. The protocol types are defined upfront but the backend emitter is wired in Phase 4.

**`packages/backend/src/copilot/tool-bridge.ts`**:
- In `buildTool()`, capture the `tool.serverId` and pass it through the event bus emission so it reaches the WS server.

### 3.4 Enriched `ToolCallPayload` in ElectronApi

Update `packages/shared/src/electron-api.ts`:

```typescript
export interface ToolCallPayload {
  callId: string;
  name: string;
  status: ToolCallStatus;
  args?: unknown;
  details?: string;
  serverId?: string;     // NEW
  subagentId?: string;   // NEW
}
```

### 3.5 New Export from `packages/shared/src/index.ts`

```typescript
export type { RoomDefinition, RoomKind } from "./room-types.js";
export type { SubagentStatus } from "./protocol.js"; // or from a new subagent-types.ts
```

### 3.6 No New ClientMessage Types Needed (Phase 1–3)

Room navigation is purely renderer-side state. No backend queries needed to switch rooms. In a future phase, clicking an MCP server room could send a `mcp:query-server` message to get live diagnostics, but that's out of scope for the initial redesign.

---

## 4. Animation Strategy

### 4.1 Travel Orbs: Framer Motion, Not R3F

**Decision**: Travel orbs are `motion.div` elements with `position: absolute` in a portal overlay (`TravelOrbLayer`), not R3F objects.

Rationale:
- Travel orbs move between DOM elements (room cards). Coordinates come from `getBoundingClientRect()` on room card refs.
- R3F would require projecting DOM positions into 3D space — fragile and unnecessary for a 2D flight path.
- Framer Motion provides spring physics, `onAnimationComplete` callbacks, and GPU-accelerated `transform` transitions.

### 4.2 TravelOrb Implementation

```tsx
// packages/renderer/src/components/base-map/TravelOrb.tsx

interface TravelOrbProps {
  entry: TravelOrbEntry;
  sourceRect: DOMRect;
  targetRect: DOMRect;
  onArrived: () => void;
  onReturned: () => void;
}

// Renders a motion.div with:
//   - initial={{ x: sourceCenter.x, y: sourceCenter.y, scale: 0.3, opacity: 0 }}
//   - animate (traveling): { x: targetCenter.x, y: targetCenter.y, scale: 1, opacity: 1 }
//   - animate (returning): { x: sourceCenter.x, y: sourceCenter.y, scale: 0.3, opacity: 0 }
//   - transition: { type: "spring", damping: 20, stiffness: 80, duration: 0.8 }
//   - CSS: radial-gradient glow, box-shadow with entry.color, border-radius: 50%
//   - Size: 12–16px circle
//   - Optional: SVG trail/comet tail using a second motion.div with blur filter
```

### 4.3 Coordinate Resolution

`TravelOrbLayer` maintains a `Map<string, React.RefObject<HTMLDivElement>>` of room card refs, populated via a React Context (`RoomRefContext`). Each `RoomCard` registers its ref on mount.

```typescript
// packages/renderer/src/components/base-map/RoomRefContext.tsx (NEW FILE)

interface RoomRefContextValue {
  registerRef: (roomId: string, ref: React.RefObject<HTMLDivElement>) => void;
  unregisterRef: (roomId: string) => void;
  getRect: (roomId: string) => DOMRect | null;
}
```

`TravelOrbLayer` calls `getRect(sourceRoomId)` and `getRect(targetRoomId)` each frame (via `useAnimationFrame` or `onUpdate` in Framer) to handle window resize during flight.

### 4.4 Room Activation Glow

When a tool call targets a room:
1. `useNavigationStore().updateRoomActivity(roomId)` sets `lastActivityAt = Date.now()`.
2. `RoomCard` reads `lastActivityAt` and computes a CSS class:
   - If `Date.now() - lastActivityAt < 3000` → `styles.activeGlow` (bright pulsing border, box-shadow with room accent color).
   - Glow fades via CSS `transition: box-shadow 2s ease-out`.
3. The room's border color pulses using a CSS `@keyframes` animation toggled by the `data-active` attribute.

```css
/* RoomCard.module.css */
.card[data-active="true"] {
  border-color: var(--room-accent);
  box-shadow: 0 0 24px var(--room-accent), inset 0 0 12px rgba(var(--room-accent-rgb), 0.1);
  animation: roomPulse 1.5s ease-in-out infinite;
}

@keyframes roomPulse {
  0%, 100% { box-shadow: 0 0 24px var(--room-accent); }
  50% { box-shadow: 0 0 40px var(--room-accent), 0 0 60px rgba(var(--room-accent-rgb), 0.3); }
}
```

### 4.5 Existing R3F Canvas — No Changes

The `ShinraOrb` R3F `<Canvas>` stays exactly as-is, mounted inside `CoreRoom`. The orb's visual state continues to be driven by `orbStateParams[assistantState]`. No additional R3F canvases are created — all travel orb and room animations are CSS/Framer Motion.

### 4.6 Room Enter/Exit Transitions

When the user clicks a room card to focus it:

```tsx
// RoomDetailOverlay uses AnimatePresence
<AnimatePresence mode="wait">
  {activeRoomId && (
    <motion.div
      key={activeRoomId}
      className={styles.overlay}
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -20 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <RoomContent roomId={activeRoomId} />
    </motion.div>
  )}
</AnimatePresence>
```

The base map fades/scales slightly behind the overlay (not unmounted — stays rendered for orb animations in background).

---

## 5. Phasing

### Phase 1: Base Map Shell + Room Navigation (Frontend only)

**Deliverable**: Replace the current two-panel layout with the base map grid. Static rooms only (core, chat, settings). Click a room → overlay slides in with existing ChatPanel/SettingsPanel. Back button returns to map.

**Files created**:
- `packages/renderer/src/components/base-map/BaseMap.tsx`
- `packages/renderer/src/components/base-map/BaseMap.module.css`
- `packages/renderer/src/components/base-map/RoomCard.tsx`
- `packages/renderer/src/components/base-map/RoomCard.module.css`
- `packages/renderer/src/components/base-map/RoomDetailOverlay.tsx`
- `packages/renderer/src/components/base-map/RoomDetailOverlay.module.css`
- `packages/renderer/src/components/base-map/rooms/CoreRoom.tsx`
- `packages/renderer/src/components/base-map/rooms/CoreRoom.module.css`
- `packages/renderer/src/components/base-map/room-content-registry.ts`
- `packages/renderer/src/stores/navigation-store.ts`
- `packages/shared/src/room-types.ts`

**Files modified**:
- `packages/renderer/src/components/AppShell.tsx` — replace `<main>` contents
- `packages/renderer/src/components/Sidebar.tsx` — drive nav from `navigation-store`
- `packages/shared/src/index.ts` — export new types

**Testable**: App launches, shows grid of 3 rooms + orb at center. Clicking rooms shows existing panels.

**Backend changes**: None.

---

### Phase 2: MCP Server Rooms + Glow (Frontend only)

**Deliverable**: Each MCP server appears as a dynamic room card on the base map. Room status reflects `McpServerStatus.state`. Room detail overlay shows tool list and server diagnostics.

**Files created**:
- `packages/renderer/src/components/base-map/rooms/McpServerRoom.tsx`
- `packages/renderer/src/components/base-map/rooms/McpServerRoom.module.css`
- `packages/renderer/src/components/base-map/RoomBadge.tsx`
- `packages/renderer/src/components/base-map/RoomBadge.module.css`
- `packages/renderer/src/components/base-map/useRoomLayout.ts` — auto-assign grid positions

**Files modified**:
- `packages/renderer/src/stores/navigation-store.ts` — reactive MCP room registration
- `packages/renderer/src/stores/mcp-store.ts` — add `toolToServerMap`
- `packages/renderer/src/hooks/useIpc.ts` — on `onMcpStatus`, sync rooms into `navigation-store`
- `packages/renderer/src/components/base-map/RoomCard.tsx` — add `data-active` glow, status badges

**Testable**: MCP servers appear/disappear as rooms. Clicking shows tool list. Connection status shown with colored borders.

**Backend changes**: None.

---

### Phase 3: Travel Orb Animations (Frontend + minor backend)

**Deliverable**: When a tool is called, a glowing orb visually travels from the Core room to the target MCP server room. On completion, it returns. Room glows on impact.

**Files created**:
- `packages/renderer/src/stores/travel-orb-store.ts`
- `packages/renderer/src/components/base-map/TravelOrb.tsx`
- `packages/renderer/src/components/base-map/TravelOrb.module.css`
- `packages/renderer/src/components/base-map/TravelOrbLayer.tsx`
- `packages/renderer/src/components/base-map/RoomRefContext.tsx`

**Files modified**:
- `packages/renderer/src/hooks/useIpc.ts` — on `onToolCall`, resolve target room and launch travel orb
- `packages/renderer/src/components/base-map/BaseMap.tsx` — mount `TravelOrbLayer`, provide `RoomRefContext`
- `packages/renderer/src/components/base-map/RoomCard.tsx` — register ref in `RoomRefContext`, glow on activity

**Backend change (small)**:
- `packages/backend/src/server.ts` — in `copilot:tool-call` handler, look up `serverId` from `toolCalls` map + `toolAggregator` and include it in the `tool:call` message.
- `packages/shared/src/protocol.ts` — add `serverId?: string` to `tool:call` ServerMessage.
- `packages/shared/src/electron-api.ts` — add `serverId?: string` to `ToolCallPayload`.

**Testable**: Send a chat message that triggers a tool call. Watch the glowing orb fly from center to the correct MCP server room and back. Room pulses on arrival.

---

### Phase 4: Subagent Lifecycle (Backend + Frontend)

**Deliverable**: Backend emits subagent lifecycle events. Renderer creates dynamic rooms for subagents. Tool calls attributed to subagents route to the correct room.

**Files created**:
- `packages/renderer/src/stores/subagent-store.ts`
- `packages/renderer/src/components/base-map/rooms/SubagentRoom.tsx`
- `packages/renderer/src/components/base-map/rooms/SubagentRoom.module.css`

**Files modified**:
- `packages/shared/src/protocol.ts` — add `subagent:spawn`, `subagent:update`, `subagent:complete`, `subagent:error` ServerMessage types; add `subagentId?: string` to `tool:call`.
- `packages/shared/src/electron-api.ts` — add `subagentId?: string` to `ToolCallPayload`; add `onSubagentSpawn`, `onSubagentUpdate`, `onSubagentComplete` handlers.
- `packages/shared/src/index.ts` — export `SubagentStatus` type.
- `packages/backend/src/util/event-bus.ts` — add subagent event types.
- `packages/backend/src/server.ts` — wire subagent bus events to WS messages.
- `packages/backend/src/copilot/session-manager.ts` — emit subagent events based on Copilot SDK session events (implementation depends on SDK capability; may require a heuristic based on tool call patterns in the interim).
- `packages/renderer/src/hooks/useIpc.ts` — handle `subagent:*` messages, sync to `subagent-store` and `navigation-store`.
- `packages/renderer/src/stores/navigation-store.ts` — register/unregister subagent rooms.
- `packages/renderer/src/stores/travel-orb-store.ts` — support subagent room as travel target.
- `packages/renderer/src/components/base-map/room-content-registry.ts` — register SubagentRoom.
- `packages/renderer/src/stores/chat-store.ts` — add `subagentId` to `ToolCallEntry`.

**Testable**: Trigger a multi-tool workflow. Subagent rooms appear dynamically. Travel orbs route to them. Completed subagent rooms gray out / show completion badge.

---

### Phase 5: Visual Polish + Theming (Frontend only)

**Deliverable**: XCOM 2 aesthetic refinements. Dark tactical palette, scanline overlays, hexagonal grid hints, room connection lines (SVG), ambient particle effects on the base map, sound effects for room activation.

**Files created**:
- `packages/renderer/src/components/base-map/GridLines.tsx` — SVG overlay drawing faint connection lines between rooms.
- `packages/renderer/src/components/base-map/GridLines.module.css`
- `packages/renderer/src/components/base-map/ScanlineOverlay.tsx` — CSS pseudo-element scanline effect.
- `packages/renderer/src/components/base-map/AmbientParticles.tsx` — Lightweight CSS-only floating particles (no R3F).

**Files modified**:
- `packages/renderer/src/global.css` — add new CSS custom properties for XCOM palette.
- `packages/renderer/src/tokens.ts` — extend token set with room-specific colors and tactical theme values.
- `packages/renderer/src/components/base-map/BaseMap.module.css` — hexagonal grid hints, background texture.
- `packages/renderer/src/components/base-map/RoomCard.module.css` — beveled edges, holographic border effects.
- `packages/renderer/src/components/base-map/TravelOrb.module.css` — comet tail, trail glow.

**Testable**: Visual inspection. Compare against XCOM 2 reference screenshots. No functional changes.

---

### Phase 6: Responsive Layout + Keyboard Navigation (Frontend only)

**Deliverable**: Base map adapts to window sizes (compact 3-column at narrow widths, full grid at wide). Keyboard navigation: Tab between rooms, Enter to focus, Escape to return. Screen reader labels.

**Files modified**:
- `packages/renderer/src/components/base-map/BaseMap.module.css` — responsive breakpoints.
- `packages/renderer/src/components/base-map/BaseMap.tsx` — keyboard event handlers, `aria-*` attributes.
- `packages/renderer/src/components/base-map/RoomCard.tsx` — `tabIndex`, `role="button"`, `aria-label`.
- `packages/renderer/src/components/base-map/RoomDetailOverlay.tsx` — focus trap, Escape handler.

**Testable**: Resize window, verify layout. Tab through rooms. Screen reader audit.

---

## 6. Likely Risks

### 6.1 Performance: R3F Canvas Budget

**Risk**: The existing `ShinraOrb` R3F Canvas with Bloom post-processing already consumes significant GPU. Adding another Canvas or too many animated elements could drop framerate.

**Mitigation**: 
- Travel orbs are pure CSS/Framer Motion (`transform` + `opacity`), GPU-composited, zero WebGL cost.
- Only one R3F Canvas exists (inside `CoreRoom`). No additional canvases.
- `TravelOrbLayer` caps concurrent animated orbs at 8 (additional tool calls queue). Completed orbs are removed from DOM immediately.
- The `ShinraOrb` canvas already has `performance={{ min: 0.5 }}` and `dpr={[1, 2]}` — adequate.
- Phase 5 ambient particles use CSS `animation`, not R3F.

### 6.2 Layout: Base Map at Various Window Sizes

**Risk**: The 5×5 grid with variable room count may look sparse with 2 MCP servers or overcrowded with 8+ servers + subagents.

**Mitigation**:
- `useRoomLayout` uses a responsive grid: `grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))`.
- The Core room spans 2×2 cells at large sizes, 1×1 at compact sizes.
- Maximum visible rooms capped at 12. Additional rooms accessible via a "More rooms…" overflow row that scrolls horizontally.
- Media queries at 960px, 720px, 540px breakpoints collapse to fewer columns.

### 6.3 Protocol Complexity: Out-of-Order Subagent Events

**Risk**: `subagent:spawn` may arrive after the first `tool:call` with that `subagentId`. Or `subagent:complete` may arrive before the last tool result.

**Mitigation**:
- `useIpc` handles `tool:call` with an unknown `subagentId` by auto-creating a placeholder subagent entry in `subagent-store` with `status: "running"`. When the real `subagent:spawn` arrives, it merges.
- `subagent:complete` marks the subagent as completed but does not remove its room immediately — the room stays for 30 seconds with a "completed" badge before fading.
- All subagent events include `subagentId` as the primary key — no ordering dependency.

### 6.4 CSS Modules vs. Framer Motion

**Risk**: Framer Motion's `animate` prop applies inline styles, which can conflict with CSS Module transitions on the same properties.

**Mitigation**:
- Strict separation: CSS Modules handle static styling (colors, borders, layout). Framer Motion handles dynamic motion (position, scale, opacity).
- Never apply CSS `transition` on `transform` or `opacity` in CSS Modules for elements that Framer Motion also animates.
- `TravelOrb` styling is 100% Framer Motion + inline styles. `RoomCard` glow uses CSS `animation` on `box-shadow` only (Framer doesn't touch `box-shadow`).

### 6.5 Tool-to-Server Resolution

**Risk**: Tool names may not be unique across MCP servers (the `McpToolAggregator` already throws if duplicates exist, but it's a runtime error). Without `serverId` on `tool:call`, the renderer must reverse-lookup.

**Mitigation**:
- Phase 3 adds `serverId` to the `tool:call` protocol message, populated server-side. This is the authoritative source.
- Before Phase 3 ships, the renderer falls back to `mcp-store.toolToServerMap` for reverse lookup. If the lookup fails, the travel orb targets the Core room (graceful degradation).

### 6.6 Subagent SDK Support

**Risk**: The GitHub Copilot SDK may not have first-class subagent lifecycle events. The `session-manager.ts` integration depends on what the SDK exposes.

**Mitigation**:
- Phase 4 defines the protocol types and renderer handling upfront.
- If the SDK doesn't emit subagent events, the backend can infer subagent boundaries heuristically: e.g., a burst of tool calls with a shared prefix, or a specific tool call that indicates delegation.
- A mock event emitter in `session-manager.ts` can simulate subagent events for development and testing.

---

## 7. Validation / End-to-End Testing

### 7.1 Travel Orb E2E Validation

**Test setup**: Connect to a real MCP server (e.g., `mcp-windows` or `mcp-vision` from the monorepo). Send a chat message that triggers a known tool (e.g., `list_windows`).

**Validation steps**:
1. Verify `tool:call` message arrives with `status: "running"` and `serverId` populated.
2. Verify `travel-orb-store` has a new entry with correct `sourceRoomId` and `targetRoomId`.
3. Verify the `TravelOrb` DOM element animates from Core room center to MCP server room center (visual inspection + Playwright screenshot comparison).
4. Verify `tool:call` with `status: "success"` triggers return animation.
5. Verify `travel-orb-store` entry is removed after return animation completes.
6. Verify target `RoomCard` glow activates during tool execution and fades after 3 seconds.

**Automation**: Add a Playwright test that:
- Starts the Electron app with a mock backend (or the real backend with a stdio MCP server that has a `sleep` tool).
- Sends a chat message.
- Screenshots the base map at: (a) before tool call, (b) during travel, (c) on arrival, (d) after completion.
- Compares against golden screenshots with a 5% pixel tolerance.

### 7.2 Mock/Stub Approach for Subagent Events

Create a development-only mock event source:

```typescript
// packages/backend/src/copilot/mock-subagent-emitter.ts (DEV ONLY)

export function emitMockSubagentLifecycle(bus: SpiraEventBus): void {
  const id = randomUUID();
  bus.emit("subagent:spawn", { subagentId: id, name: "Research Agent", purpose: "Gathering file context" });
  
  setTimeout(() => {
    bus.emit("subagent:update", { subagentId: id, status: "running" });
  }, 500);
  
  setTimeout(() => {
    bus.emit("subagent:complete", { subagentId: id, output: "Found 3 relevant files." });
  }, 4000);
}
```

Wire this into `packages/backend/src/index.ts` behind an `ENABLE_MOCK_SUBAGENTS=true` env flag. This lets frontend engineers develop and test subagent rooms without a real Copilot session.

### 7.3 Key Visual Regression Points

Capture golden screenshots for:

| Checkpoint | Description |
|---|---|
| `base-map-idle` | Base map with Core + Chat + Settings rooms, no activity. |
| `base-map-mcp-connected` | Base map with 2 MCP servers connected (green status). |
| `base-map-mcp-error` | One MCP server in error state (red glow). |
| `travel-orb-mid-flight` | Travel orb between Core and an MCP room (captured at 50% of animation). |
| `travel-orb-arrival` | Travel orb at destination, target room glowing. |
| `room-detail-chat` | Chat room detail overlay open. |
| `room-detail-mcp` | MCP server room detail overlay open, showing tool list. |
| `subagent-spawn` | New subagent room appearing with "spawning" animation. |
| `subagent-complete` | Subagent room with "completed" badge. |
| `responsive-narrow` | Base map at 720px window width. |
| `responsive-wide` | Base map at 1440px window width. |

### 7.4 Unit Tests

- `navigation-store.test.ts` — room registration, focus, back navigation, dynamic MCP room sync.
- `travel-orb-store.test.ts` — orb lifecycle, max concurrent orbs, cleanup.
- `subagent-store.test.ts` — spawn, update, complete, out-of-order handling.
- `useRoomLayout.test.ts` — grid position assignment with variable room counts.
- `room-types.ts` — type-level tests (TypeScript compiler is sufficient).

### 7.5 Integration Test

A Vitest integration test in `packages/renderer/` that:
1. Creates a mock `electronAPI` (already pattern-matched from `useIpc.ts`).
2. Mounts `<AppShell />` with React Testing Library.
3. Fires a sequence of `onMcpStatus` → `onToolCall(running)` → `onToolCall(success)` events.
4. Asserts that the navigation store, travel orb store, and DOM reflect the expected state at each step.

---

## Appendix A: File Index

### New Files (21 files)

```
packages/shared/src/room-types.ts
packages/renderer/src/stores/navigation-store.ts
packages/renderer/src/stores/travel-orb-store.ts
packages/renderer/src/stores/subagent-store.ts
packages/renderer/src/components/base-map/BaseMap.tsx
packages/renderer/src/components/base-map/BaseMap.module.css
packages/renderer/src/components/base-map/RoomCard.tsx
packages/renderer/src/components/base-map/RoomCard.module.css
packages/renderer/src/components/base-map/RoomDetailOverlay.tsx
packages/renderer/src/components/base-map/RoomDetailOverlay.module.css
packages/renderer/src/components/base-map/RoomBadge.tsx
packages/renderer/src/components/base-map/RoomBadge.module.css
packages/renderer/src/components/base-map/TravelOrb.tsx
packages/renderer/src/components/base-map/TravelOrb.module.css
packages/renderer/src/components/base-map/TravelOrbLayer.tsx
packages/renderer/src/components/base-map/RoomRefContext.tsx
packages/renderer/src/components/base-map/room-content-registry.ts
packages/renderer/src/components/base-map/useRoomLayout.ts
packages/renderer/src/components/base-map/rooms/CoreRoom.tsx
packages/renderer/src/components/base-map/rooms/CoreRoom.module.css
packages/renderer/src/components/base-map/rooms/McpServerRoom.tsx
packages/renderer/src/components/base-map/rooms/McpServerRoom.module.css
packages/renderer/src/components/base-map/rooms/SubagentRoom.tsx
packages/renderer/src/components/base-map/rooms/SubagentRoom.module.css
packages/renderer/src/components/base-map/GridLines.tsx         (Phase 5)
packages/renderer/src/components/base-map/GridLines.module.css  (Phase 5)
packages/renderer/src/components/base-map/ScanlineOverlay.tsx   (Phase 5)
packages/renderer/src/components/base-map/AmbientParticles.tsx  (Phase 5)
packages/backend/src/copilot/mock-subagent-emitter.ts           (Dev only)
```

### Modified Files (14 files)

```
packages/shared/src/protocol.ts          — new ServerMessage types, enriched tool:call
packages/shared/src/electron-api.ts      — enriched ToolCallPayload, new subagent handlers
packages/shared/src/index.ts             — new exports
packages/renderer/src/components/AppShell.tsx      — replace main content with BaseMap
packages/renderer/src/components/Sidebar.tsx        — dynamic room-driven nav
packages/renderer/src/components/SettingsPanel.tsx  — remove inline MCP list
packages/renderer/src/stores/chat-store.ts          — add subagentId to ToolCallEntry
packages/renderer/src/stores/mcp-store.ts           — add toolToServerMap
packages/renderer/src/hooks/useIpc.ts               — handle new events, drive stores
packages/renderer/src/global.css                    — new CSS custom properties (Phase 5)
packages/renderer/src/tokens.ts                     — extended token set (Phase 5)
packages/backend/src/server.ts                      — enrich tool:call, wire subagent events
packages/backend/src/util/event-bus.ts              — new subagent event types
packages/backend/src/copilot/session-manager.ts     — emit subagent lifecycle events
```

### Deprecated (1 file)

```
packages/renderer/src/components/McpStatus.tsx  — replaced by McpServerRoom + RoomCard
```
