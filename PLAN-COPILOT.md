# Spira — Architecture Plan (Copilot Review)

> **Author**: GitHub Copilot (second reviewer)
> **Reviewing**: Existing plan in `README.md`
> **Purpose**: Independent opinionated plan for merge discussion

---

## Preamble: Where I Agree and Disagree with the Existing Plan

The existing plan in `README.md` is solid on fundamentals: monorepo structure, typed IPC boundary, Zustand for state, Vite for renderer, phased delivery. I endorse those choices.

**I disagree on four architectural decisions that affect the entire system's trajectory:**

| # | Existing Plan | My Position | Impact |
|---|---|---|---|
| 1 | Backend runs **in-process** inside Electron main | Backend runs as a **standalone WebSocket server** always — even in Electron mode | Testability, crash isolation, HA migration |
| 2 | MCP servers loaded as **in-process modules** | MCP servers run as **stdio child processes** per the MCP spec | Crash isolation, spec compliance, language independence |
| 3 | Separate `@spira/mcp-core` package with custom `IMcpServer` interface | **No `mcp-core` package** — use `@modelcontextprotocol/sdk` directly; put shared types in `@spira/shared` | Avoid reinventing the SDK |
| 4 | Separate `@spira/voice` package | Voice pipeline **lives inside `@spira/backend`** as a subsystem | Reduces package management overhead; voice is not independently deployable anyway |

These disagreements are detailed in [Section 6](#6-key-technical-decisions--disagreements). The rest of this document presents my full plan.

---

## Table of Contents

1. [Directory Structure](#1-directory-structure)
2. [Package Responsibilities](#2-package-responsibilities)
3. [Key Interfaces & Contracts](#3-key-interfaces--contracts)
4. [Build & Dev Workflow](#4-build--dev-workflow)
5. [Implementation Phases](#5-implementation-phases)
6. [Key Technical Decisions & Disagreements](#6-key-technical-decisions--disagreements)

---

## 1. Directory Structure

Five packages, not seven. Every package has a clear owner and a reason to exist separately.

```
spira/
├── packages/
│   ├── shared/                        # @spira/shared — zero-dep types + constants
│   │   ├── src/
│   │   │   ├── index.ts               # Barrel export
│   │   │   ├── assistant-state.ts     # AssistantState enum (idle → listening → transcribing → thinking → speaking → error)
│   │   │   ├── voice-events.ts        # Voice pipeline event discriminated union
│   │   │   ├── mcp-types.ts           # McpServerConfig, McpServerStatus, McpTool types
│   │   │   ├── messages.ts            # ClientMessage / ServerMessage discriminated unions (the IPC protocol)
│   │   │   ├── chat-types.ts          # ChatMessage, ChatDelta, ToolCallStatus
│   │   │   └── config-schema.ts       # Zod schemas for runtime config validation
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── backend/                       # @spira/backend — standalone Node.js server (ZERO Electron imports)
│   │   ├── src/
│   │   │   ├── index.ts               # Entry: parse config, start WebSocket server, boot subsystems
│   │   │   ├── server.ts              # WebSocket server on configurable port (default 9720)
│   │   │   │
│   │   │   ├── copilot/               # GitHub Copilot SDK integration
│   │   │   │   ├── session-manager.ts # Session lifecycle: init client, create/destroy sessions
│   │   │   │   ├── tool-bridge.ts     # Registers MCP-aggregated tools with Copilot as callable tools
│   │   │   │   └── stream-handler.ts  # Assembles streaming deltas, emits to transport
│   │   │   │
│   │   │   ├── voice/                 # Voice pipeline (subsystem, not a separate package)
│   │   │   │   ├── pipeline.ts        # State machine: idle → wake → record → transcribe → think → speak → idle
│   │   │   │   ├── wake-word.ts       # Porcupine wrapper — listens for "Shinra"
│   │   │   │   ├── audio-capture.ts   # PvRecorder mic capture + silence detection
│   │   │   │   ├── stt.ts             # nodejs-whisper (whisper.cpp) local transcription
│   │   │   │   ├── tts.ts             # ElevenLabs streaming TTS (primary)
│   │   │   │   ├── tts-piper.ts       # Piper local TTS (offline fallback)
│   │   │   │   └── audio-playback.ts  # PCM playback to speakers
│   │   │   │
│   │   │   ├── mcp/                   # MCP server management
│   │   │   │   ├── registry.ts        # Reads mcp-servers.json, spawns/manages MCP server processes
│   │   │   │   ├── client-pool.ts     # Pool of @modelcontextprotocol/sdk Client instances (one per server)
│   │   │   │   └── tool-aggregator.ts # Merges tools from all connected servers into a single list
│   │   │   │
│   │   │   └── util/
│   │   │       ├── logger.ts          # pino structured logger
│   │   │       ├── event-bus.ts       # Typed EventEmitter (internal coordination)
│   │   │       └── errors.ts          # SpiraError base class + specific subtypes
│   │   │
│   │   ├── mcp-servers.json           # Declarative registry: which MCP servers to spawn
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── mcp-windows/                   # @spira/mcp-windows — standalone MCP server (stdio transport)
│   │   ├── src/
│   │   │   ├── index.ts               # Creates MCP Server, registers all tools, starts stdio transport
│   │   │   ├── tools/
│   │   │   │   ├── volume.ts          # system_get_volume, system_set_volume, system_toggle_mute
│   │   │   │   ├── brightness.ts      # system_get_brightness, system_set_brightness
│   │   │   │   ├── apps.ts            # system_launch_app, system_close_app, system_list_apps
│   │   │   │   ├── display.ts         # system_get_displays, system_set_resolution
│   │   │   │   ├── power.ts           # system_sleep, system_shutdown, system_restart, system_lock
│   │   │   │   └── notifications.ts   # system_send_notification (Windows toast)
│   │   │   └── util/
│   │   │       ├── powershell.ts      # Allowlisted PowerShell command runner with timeout
│   │   │       └── validation.ts      # Shared Zod schemas for tool inputs
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── main/                          # @spira/main — Electron shell (as thin as possible)
│   │   ├── src/
│   │   │   ├── index.ts               # App entry: spawn backend, create window, setup lifecycle
│   │   │   ├── ipc-bridge.ts          # Renderer IPC ↔ backend WebSocket message relay
│   │   │   ├── preload.ts             # contextBridge: expose typed electronAPI to renderer
│   │   │   ├── window.ts              # BrowserWindow factory (frameless, dark, size defaults)
│   │   │   ├── tray.ts                # System tray icon + context menu
│   │   │   ├── backend-lifecycle.ts   # Spawns @spira/backend as child process, health-checks, restarts
│   │   │   └── auto-update.ts         # electron-updater integration
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── renderer/                      # @spira/renderer — React UI (sandboxed, no Node access)
│       ├── src/
│       │   ├── main.tsx               # React root + providers
│       │   ├── App.tsx                # Root layout, theme provider
│       │   │
│       │   ├── components/
│       │   │   ├── shinra-orb/        # Three.js animated sphere — the hero visual
│       │   │   │   ├── ShinraOrb.tsx  # R3F Canvas wrapper component
│       │   │   │   ├── orb-scene.ts   # Scene setup: camera, lighting, post-processing
│       │   │   │   ├── orb-mesh.ts    # Icosphere geometry + custom shader material
│       │   │   │   ├── orb-particles.ts   # Orbiting particle system
│       │   │   │   ├── orb-animations.ts  # State → visual parameter mapping
│       │   │   │   └── shaders/
│       │   │   │       ├── orb.vert.glsl  # Vertex: displacement + pulse
│       │   │   │       └── orb.frag.glsl  # Fragment: plasma/energy glow
│       │   │   │
│       │   │   ├── chat/
│       │   │   │   ├── ChatPanel.tsx       # Scrollable message list + input
│       │   │   │   ├── MessageBubble.tsx   # Single message (user/assistant/tool)
│       │   │   │   ├── InputBar.tsx        # Text input + mic toggle + send button
│       │   │   │   ├── StreamingText.tsx   # Token-by-token text reveal animation
│       │   │   │   └── ToolCallCard.tsx    # Shows tool name, args, result inline
│       │   │   │
│       │   │   ├── status/
│       │   │   │   ├── VoiceIndicator.tsx  # Mic state + audio level visualization
│       │   │   │   ├── McpStatus.tsx       # Connected servers list + tool count
│       │   │   │   └── ConnectionDot.tsx   # Backend connection health (green/red)
│       │   │   │
│       │   │   └── layout/
│       │   │       ├── AppShell.tsx        # Grid layout: orb area + chat + sidebar
│       │   │       ├── TitleBar.tsx        # Custom frameless title bar + window controls
│       │   │       ├── Sidebar.tsx         # Nav: chat, settings, MCP servers
│       │   │       └── GlassPanel.tsx      # Reusable frosted-glass card component
│       │   │
│       │   ├── hooks/
│       │   │   ├── useAssistantState.ts   # Zustand selector for current assistant state
│       │   │   ├── useIpc.ts              # Typed wrapper over window.electronAPI
│       │   │   ├── useChat.ts             # Send message, subscribe to stream
│       │   │   ├── useAudioLevel.ts       # Backend-streamed mic level (for orb)
│       │   │   └── useTtsAmplitude.ts     # Backend-streamed TTS amplitude (for orb speaking)
│       │   │
│       │   ├── stores/
│       │   │   ├── chat-store.ts          # Zustand: messages, streaming state, history
│       │   │   ├── assistant-store.ts     # Zustand: AssistantState + metadata
│       │   │   ├── mcp-store.ts           # Zustand: MCP server statuses
│       │   │   └── settings-store.ts      # Zustand: user prefs (persisted via electron-store)
│       │   │
│       │   ├── theme/
│       │   │   ├── tokens.ts              # Design tokens: colors, spacing, radii, shadows
│       │   │   ├── ffx-theme.ts           # Full theme object (consumed by vanilla-extract or styled)
│       │   │   ├── global.css             # CSS reset + root variables + font imports
│       │   │   └── animations.ts          # Keyframe definitions (glow, pulse, fade, slide)
│       │   │
│       │   └── assets/
│       │       ├── fonts/
│       │       └── textures/              # Orb textures, particle sprites
│       │
│       ├── index.html
│       ├── vite.config.ts
│       ├── package.json
│       └── tsconfig.json
│
├── assets/                            # Non-code assets
│   ├── wake-word/
│   │   └── shinra.ppn                 # Custom Porcupine wake word model
│   └── icons/
│       ├── spira.ico
│       └── spira.png
│
├── scripts/
│   ├── dev.ts                         # Orchestrates all dev processes concurrently
│   ├── build.ts                       # Production build pipeline
│   └── new-mcp-server.ts             # Scaffold generator for new MCP server packages
│
├── package.json                       # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json                 # Shared compiler options
├── vitest.workspace.ts                # Vitest workspace config
├── electron-builder.yml               # Production packaging config
├── .eslintrc.cjs
├── .prettierrc
├── .env.example
└── README.md
```

### Structural Differences from Existing Plan

| Existing Plan | My Plan | Why |
|---|---|---|
| 7 packages (`shared`, `renderer`, `main`, `backend`, `voice`, `mcp-core`, `mcp-windows`) | 5 packages (`shared`, `renderer`, `main`, `backend`, `mcp-windows`) | `voice` absorbed into `backend`; `mcp-core` eliminated — see Section 6 |
| `apps/desktop/` for Electron assembly | No `apps/` dir — `electron-builder.yml` at root | Unnecessary indirection for a single-platform app |
| `backend/src/electron-entry.ts` + `standalone-entry.ts` | Single `backend/src/index.ts` — always a WebSocket server | Backend is always standalone; Electron connects to it |
| `main/src/ipc/IpcRouter.ts` + `ElectronIpcTransport.ts` | `main/src/ipc-bridge.ts` (single file) + `backend-lifecycle.ts` | Simpler: main spawns backend and bridges messages |

---

## 2. Package Responsibilities

### `@spira/shared` — The Contract

**Owns:** TypeScript types, Zod schemas, and string constants that cross the wire between any two packages.

**Does NOT own:** Any runtime logic. Any classes. Any npm dependencies except `zod`.

**Key files:**
- `messages.ts` — The **discriminated union** protocol. Every message between frontend and backend is typed here. This is the most important file in the entire codebase.
- `assistant-state.ts` — The single source of truth for what "states" the assistant can be in.
- `mcp-types.ts` — Server config shape, server status shape, tool definition shape.
- `config-schema.ts` — Zod schemas that validate `.env` and config files at startup.

**Enforcement:** CI lint rule: `@spira/shared` may not import from any other `@spira/*` package.

---

### `@spira/backend` — The Brain (Electron-Free)

**Owns:** Copilot SDK sessions, voice pipeline orchestration, MCP server management, audio I/O, WebSocket server.

**Does NOT own:** Electron APIs. Window management. UI state. IPC serialization details.

**The single most important architectural rule:** This package has **zero imports from `electron`**. It is a standalone Node.js application. The Electron main process spawns it as a child process and connects to its WebSocket.

**Internal subsystems:**

| Directory | Responsibility |
|-----------|---------------|
| `copilot/` | `@github/copilot-sdk` wrapper. Session lifecycle, streaming response handling, tool registration. |
| `voice/` | Full voice pipeline. Wake word (Porcupine) → audio capture → STT (Whisper) → TTS (ElevenLabs/Piper) → playback. State machine orchestration. |
| `mcp/` | Reads `mcp-servers.json`. Spawns MCP servers as child processes. Maintains `@modelcontextprotocol/sdk` client connections. Aggregates tools. Routes invocations. |
| `server.ts` | WebSocket server. Receives `ClientMessage`, broadcasts `ServerMessage`. Stateless relay between the frontend and internal subsystems. |

**Why voice is here, not a separate package:**
- Voice is never consumed independently. No other package imports from voice.
- The pipeline orchestrator needs deep integration with the Copilot session (it feeds transcriptions in and plays responses out).
- A separate package means cross-package event plumbing for mic levels, TTS amplitude, pipeline state — all of which are internal backend concerns.
- The voice *components* (STT, TTS, wake word) are still cleanly separated into single-responsibility files. Package boundaries ≠ module boundaries.

---

### `@spira/mcp-windows` — Windows System Controls (Standalone MCP Server)

**Owns:** Tools for controlling Windows system functions via the MCP protocol.

**Does NOT own:** MCP protocol plumbing (that's `@modelcontextprotocol/sdk`). Copilot logic. UI.

**How it works:** This is a **standard MCP server** that communicates over **stdio** (JSON-RPC on stdin/stdout). The backend's MCP registry spawns it as a child process:

```json
// mcp-servers.json
{
  "servers": [
    {
      "id": "windows-system",
      "name": "Windows System Controls",
      "transport": "stdio",
      "command": "node",
      "args": ["packages/mcp-windows/dist/index.js"],
      "enabled": true,
      "autoRestart": true
    }
  ]
}
```

**Tool naming convention:** All tools prefixed with `system_` to avoid collisions with future MCP servers. E.g., `system_set_volume`, `system_launch_app`.

**Adding a new MCP server** (e.g., `@spira/mcp-homeassistant`):
1. `pnpm run new-mcp-server mcp-homeassistant`
2. Implement tools using `@modelcontextprotocol/sdk`'s `Server` class
3. Add entry to `mcp-servers.json`
4. Restart backend — auto-discovered

No code changes to the backend. No custom interfaces. Standard MCP protocol.

---

### `@spira/main` — Electron Shell (Disposable)

**Owns:** BrowserWindow lifecycle, system tray, IPC relay between renderer and backend, backend process management.

**Does NOT own:** AI logic. Voice processing. MCP tools. Business logic of any kind.

**Key responsibilities:**
1. **Spawn backend:** Start `@spira/backend` as a child process, monitor health, restart on crash.
2. **Create window:** Frameless BrowserWindow with dark background. Load Vite dev server in dev, bundled HTML in production.
3. **Bridge IPC:** `ipc-bridge.ts` connects renderer IPC channels to the backend WebSocket. It's a dumb relay — deserialize from IPC, serialize to WebSocket, and vice versa.
4. **System tray:** Icon + context menu (toggle window, mute mic, quit).

**Why spawn backend as child process instead of in-process?**
- Backend crash doesn't kill the UI (show "reconnecting..." instead of a white screen).
- Backend can be tested without Electron installed (`node packages/backend/dist/index.js`).
- When migrating to HA, `@spira/main` is deleted entirely. Backend is already standalone.
- No risk of accidentally importing `electron` in backend code.

**The preload script** (`preload.ts`) exposes a typed `window.electronAPI` via `contextBridge`:
```ts
contextBridge.exposeInMainWorld('electronAPI', {
  send: (msg: ClientMessage) => ipcRenderer.send('spira:client-message', msg),
  onMessage: (cb: (msg: ServerMessage) => void) => {
    ipcRenderer.on('spira:server-message', (_e, msg) => cb(msg));
  },
  removeMessageListener: (cb) => { /* cleanup */ },
});
```

---

### `@spira/renderer` — React UI

**Owns:** All visual rendering. Three.js orb. FFX theme. Chat UI. User interaction.

**Does NOT own:** Node.js APIs. Backend logic. Direct mic access. `contextIsolation: true`, `nodeIntegration: false`.

**Key technology choices:**
- **Vite** for bundling + HMR
- **React 19** with TypeScript
- **Zustand** for state (4 stores: chat, assistant, mcp, settings)
- **@react-three/fiber** + **@react-three/drei** for the Shinra orb
- **vanilla-extract** for type-safe, zero-runtime CSS theming (see [Decision 8](#decision-8-vanilla-extract-over-styled-components))
- **Framer Motion** for UI transitions (chat panel slide, status fade)

---

## 3. Key Interfaces & Contracts

### 3.1 The Wire Protocol (Most Important Interface)

Everything between frontend and backend is a `ClientMessage` or `ServerMessage`. This is the **only** communication channel.

```typescript
// @spira/shared/src/messages.ts

import type { AssistantState } from './assistant-state';
import type { ChatMessage, ToolCallStatus } from './chat-types';
import type { McpServerStatus } from './mcp-types';

// ── Client → Server ───────────────────────────────────────────────────────

export type ClientMessage =
  | { type: 'chat:send'; text: string }
  | { type: 'chat:cancel' }
  | { type: 'voice:toggle'; enabled: boolean }
  | { type: 'voice:push-to-talk'; active: boolean }
  | { type: 'settings:update'; settings: Partial<UserSettings> }
  | { type: 'mcp:refresh' };

// ── Server → Client ───────────────────────────────────────────────────────

export type ServerMessage =
  | { type: 'state:change'; previous: AssistantState; current: AssistantState }
  | { type: 'chat:delta'; messageId: string; delta: string; done: boolean }
  | { type: 'chat:message'; message: ChatMessage }
  | { type: 'chat:tool-call'; toolName: string; args: unknown; status: ToolCallStatus }
  | { type: 'audio:level'; level: number }           // 0-1 mic level for orb
  | { type: 'tts:amplitude'; amplitude: number }     // 0-1 TTS amplitude for orb
  | { type: 'mcp:status'; servers: McpServerStatus[] }
  | { type: 'error'; code: string; message: string };
```

**Design choices:**
- **Discriminated union on `type`** — not an enum + payload bag. TypeScript narrows automatically in switch statements.
- **Flat structure** — no `{ type, payload }` wrapper. Fewer object allocations, easier to read.
- **No `channel` string** — the `type` field IS the channel. One concept, not two.

This differs from the existing plan's `IpcChannel` enum approach. The discriminated union is superior because:
1. Adding a new message type is a compile error everywhere it's not handled
2. No string-matching bugs — TypeScript ensures exhaustiveness
3. The union IS the documentation — no separate enum/payload mapping to keep in sync

---

### 3.2 Assistant State

```typescript
// @spira/shared/src/assistant-state.ts

export type AssistantState =
  | 'idle'            // Waiting for wake word or text input
  | 'listening'       // Wake word detected, recording user speech
  | 'transcribing'    // Whisper processing audio → text
  | 'thinking'        // Copilot processing (may include tool calls)
  | 'speaking'        // TTS playback in progress
  | 'error';          // Something failed (details in ServerMessage error)

// Valid transitions (enforced in pipeline.ts):
// idle → listening (wake word detected)
// idle → thinking (text message sent)
// listening → transcribing (silence detected, recording ends)
// transcribing → thinking (transcription complete)
// thinking → speaking (Copilot response ready)
// thinking → idle (Copilot response is text-only, no TTS)
// speaking → idle (TTS playback complete)
// * → error (any stage can fail)
// error → idle (auto-recovery after timeout)
```

**Note:** I use `type` alias, not `enum`. String literal unions are lighter, work in plain JSON serialization, and don't require importing the enum at every usage site.

---

### 3.3 MCP Types

```typescript
// @spira/shared/src/mcp-types.ts

/** Declarative config for an MCP server in mcp-servers.json */
export interface McpServerConfig {
  id: string;                    // "windows-system" — stable key for routing
  name: string;                  // "Windows System Controls" — display name
  transport: 'stdio' | 'sse';   // stdio = child process, sse = remote server
  command?: string;              // For stdio: executable to spawn
  args?: string[];               // For stdio: command arguments
  url?: string;                  // For sse: server URL
  env?: Record<string, string>;  // Extra env vars for the spawned process
  enabled: boolean;
  autoRestart: boolean;
  maxRestarts?: number;          // Default: 3
}

/** Runtime status of a connected MCP server */
export interface McpServerStatus {
  id: string;
  name: string;
  state: 'starting' | 'connected' | 'disconnected' | 'error';
  toolCount: number;
  tools: string[];               // Tool names for display
  error?: string;
  uptimeMs?: number;
}
```

**Note:** I don't define `IMcpServer` or `IMcpTool` interfaces. MCP servers are standard MCP protocol implementations using `@modelcontextprotocol/sdk`. They don't implement a Spira-specific interface. The backend's MCP client talks to them via the standard protocol. See [Decision 2](#decision-2-no-spira-mcp-core-package--use-the-official-sdk).

---

### 3.4 Chat Types

```typescript
// @spira/shared/src/chat-types.ts

export interface ChatMessage {
  id: string;                    // UUID
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;             // Unix ms
  toolCall?: {                   // Present when assistant invoked a tool
    name: string;
    args: Record<string, unknown>;
    result?: unknown;
    status: ToolCallStatus;
  };
}

export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error';
```

---

### 3.5 Voice Pipeline Events (Internal to Backend)

```typescript
// @spira/shared/src/voice-events.ts
// These are used internally by the backend event bus.
// Only state:change, audio:level, and tts:amplitude cross the wire to the frontend.

export type VoicePipelineEvent =
  | { type: 'wake-word:detected' }
  | { type: 'capture:start' }
  | { type: 'capture:end'; durationMs: number }
  | { type: 'capture:level'; level: number }
  | { type: 'stt:result'; text: string; confidence: number; durationMs: number }
  | { type: 'stt:error'; error: string }
  | { type: 'tts:start'; text: string }
  | { type: 'tts:chunk'; amplitude: number }
  | { type: 'tts:end' }
  | { type: 'tts:error'; error: string };
```

---

### 3.6 Orb State Mapping

```typescript
// @spira/renderer/src/components/shinra-orb/orb-animations.ts

import type { AssistantState } from '@spira/shared';

export interface OrbVisualParams {
  rotationSpeed: number;     // radians/sec
  pulseFrequency: number;    // Hz
  pulseAmplitude: number;    // 0-1
  glowIntensity: number;     // 0-1
  colorPrimary: [number, number, number];    // RGB normalized
  colorSecondary: [number, number, number];
  particleSpeed: number;     // multiplier
  particleCount: number;
  displacementScale: number; // vertex displacement amount
}

export const STATE_PARAMS: Record<AssistantState, OrbVisualParams> = {
  idle: {
    rotationSpeed: 0.15,
    pulseFrequency: 0.5,
    pulseAmplitude: 0.1,
    glowIntensity: 0.3,
    colorPrimary: [0.0, 0.6, 0.8],    // Deep teal
    colorSecondary: [0.0, 0.2, 0.4],   // Navy
    particleSpeed: 0.3,
    particleCount: 200,
    displacementScale: 0.02,
  },
  listening: {
    rotationSpeed: 0.3,
    pulseFrequency: 2.0,
    pulseAmplitude: 0.4,               // Reacts to audio level at runtime
    glowIntensity: 0.7,
    colorPrimary: [0.0, 0.9, 1.0],    // Bright cyan
    colorSecondary: [0.0, 0.4, 0.6],
    particleSpeed: 0.8,
    particleCount: 400,
    displacementScale: 0.08,
  },
  transcribing: {
    rotationSpeed: 0.6,
    pulseFrequency: 3.0,
    pulseAmplitude: 0.3,
    glowIntensity: 0.6,
    colorPrimary: [0.0, 0.7, 0.9],
    colorSecondary: [0.2, 0.3, 0.8],   // Blue shift
    particleSpeed: 1.2,
    particleCount: 300,
    displacementScale: 0.05,
  },
  thinking: {
    rotationSpeed: 1.0,
    pulseFrequency: 4.0,
    pulseAmplitude: 0.5,
    glowIntensity: 0.8,
    colorPrimary: [0.8, 0.6, 0.1],    // Gold/amber
    colorSecondary: [0.2, 0.1, 0.5],   // Deep purple
    particleSpeed: 2.0,
    particleCount: 600,
    displacementScale: 0.12,
  },
  speaking: {
    rotationSpeed: 0.4,
    pulseFrequency: 1.5,               // Overridden by TTS amplitude at runtime
    pulseAmplitude: 0.6,
    glowIntensity: 0.9,
    colorPrimary: [0.0, 1.0, 0.9],    // Bright teal
    colorSecondary: [0.0, 0.5, 0.7],
    particleSpeed: 0.6,
    particleCount: 350,
    displacementScale: 0.1,
  },
  error: {
    rotationSpeed: 0.05,
    pulseFrequency: 1.0,
    pulseAmplitude: 0.2,
    glowIntensity: 0.4,
    colorPrimary: [0.9, 0.2, 0.1],    // Red
    colorSecondary: [0.4, 0.1, 0.0],   // Dark red
    particleSpeed: 0.1,
    particleCount: 100,
    displacementScale: 0.15,           // "Distressed" displacement
  },
};
```

---

## 4. Build & Dev Workflow

### 4.1 Prerequisites

```
node >= 22
pnpm >= 9
```

Required API keys (in `.env`):
```bash
PICOVOICE_ACCESS_KEY=xxx          # Picovoice Console (free tier)
ELEVENLABS_API_KEY=xxx            # ElevenLabs (optional — Piper fallback works without)
ELEVENLABS_VOICE_ID=xxx           # Custom Shinra voice
GITHUB_TOKEN=xxx                  # For Copilot SDK authentication (or use Copilot CLI login)
SPIRA_PORT=9720                   # Backend WebSocket port (optional, default 9720)
WHISPER_MODEL=base.en             # Whisper model size (optional, default base.en)
```

### 4.2 Setup

```bash
git clone <repo> && cd spira
pnpm install
cp .env.example .env              # Fill in API keys
pnpm run whisper:setup            # Downloads Whisper model (~150MB, one-time)
```

### 4.3 Development

```bash
# Full stack — the daily driver command
pnpm dev
# This runs concurrently:
#   1. tsc --build --watch        (type-checks all packages)
#   2. @spira/backend via tsx watch  (auto-restarts on change)
#   3. @spira/renderer via vite dev  (HMR on :5173)
#   4. @spira/main via electron .    (reloads on backend/renderer changes)

# Individual package dev
pnpm -F @spira/backend dev        # Backend only (WS on :9720) — test with wscat
pnpm -F @spira/renderer dev       # UI only (Vite :5173) — needs backend running
pnpm -F @spira/mcp-windows dev    # MCP server only — test with MCP Inspector

# Testing
pnpm test                         # vitest across all packages
pnpm -F @spira/backend test       # Backend tests only
pnpm typecheck                    # tsc --noEmit for all packages
pnpm lint                         # ESLint
```

### 4.4 Root `package.json`

```jsonc
{
  "private": true,
  "scripts": {
    "dev": "tsx scripts/dev.ts",
    "build": "tsx scripts/build.ts",
    "typecheck": "tsc --build --noEmit",
    "test": "vitest run",
    "lint": "eslint 'packages/*/src/**/*.{ts,tsx}'",
    "format": "prettier --write .",
    "whisper:setup": "npx nodejs-whisper download",
    "new-mcp-server": "tsx scripts/new-mcp-server.ts"
  }
}
```

### 4.5 `pnpm-workspace.yaml`

```yaml
packages:
  - 'packages/*'
```

### 4.6 Production Build

```bash
pnpm build
# Pipeline:
#   1. tsc --build                  (type-check all packages)
#   2. esbuild @spira/backend       → packages/backend/dist/index.js (single bundle)
#   3. esbuild @spira/mcp-windows   → packages/mcp-windows/dist/index.js (single bundle)
#   4. vite build @spira/renderer   → packages/renderer/dist/ (static assets)
#   5. esbuild @spira/main          → packages/main/dist/ (Electron entry)
#   6. electron-builder             → dist/Spira-Setup-x.y.z.exe

# Output: dist/Spira-Setup-x.y.z.exe (NSIS installer)
```

### 4.7 `tsconfig.base.json`

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

**Note:** I use `module: "Node16"` + `moduleResolution: "Node16"` (not `"bundler"`). The existing plan uses `"bundler"` which doesn't work correctly for Node.js packages that need to resolve `.js` extensions. `"Node16"` is the correct setting for a monorepo where backend packages run in Node.js.

The renderer package overrides to `"moduleResolution": "bundler"` in its own tsconfig since Vite handles resolution.

---

## 5. Implementation Phases

### Phase 0: Monorepo Scaffold (1 day)
**Goal:** Empty packages that type-check.

- [ ] `pnpm-workspace.yaml` with all 5 packages
- [ ] `tsconfig.base.json` + per-package `tsconfig.json` with `references`
- [ ] `@spira/shared` — all type definitions from Section 3 (types only, no runtime)
- [ ] Stub `package.json` for each package with correct `name`, `dependencies`
- [ ] ESLint + Prettier shared config
- [ ] Vitest workspace configuration
- [ ] `.env.example` with all keys documented
- [ ] `pnpm typecheck` passes
- [ ] `scripts/dev.ts` placeholder (just echoes "dev mode")

**Exit criteria:** `pnpm install && pnpm typecheck` succeeds. All 5 packages exist and import from `@spira/shared`.

**Rationale:** Do the boring scaffolding in one shot so every subsequent phase builds on a working foundation.

---

### Phase 1: Backend + Copilot Text Chat (3–4 days)
**Goal:** Prove the riskiest integration works — Copilot SDK session + streaming.

- [ ] `@spira/backend` WebSocket server (`ws` library) on port 9720
- [ ] `copilot/session-manager.ts` — connect to Copilot CLI, create session
- [ ] `copilot/stream-handler.ts` — receive streaming deltas, emit as `ServerMessage`
- [ ] `server.ts` — accept `chat:send` ClientMessage, return `chat:delta` + `chat:message` ServerMessage
- [ ] `util/logger.ts` — pino with `pino-pretty` in dev
- [ ] `util/event-bus.ts` — typed EventEmitter
- [ ] Integration test: connect via `ws`, send message, receive streamed response

**Exit criteria:** `pnpm -F @spira/backend dev`, then `wscat -c ws://localhost:9720`, send `{"type":"chat:send","text":"hello"}`, receive streaming response.

**Rationale:** The Copilot SDK is the biggest unknown. It's new, has evolving APIs, and requires the Copilot CLI to be running. If this doesn't work, the entire project needs to pivot. Prove it first.

---

### Phase 2: Electron Shell + Chat UI (3–4 days)
**Goal:** Visible, interactive desktop app with text chat.

- [ ] `@spira/main` — BrowserWindow (frameless, 1000×700, dark bg)
- [ ] `preload.ts` — contextBridge exposing typed `electronAPI`
- [ ] `backend-lifecycle.ts` — spawn `@spira/backend` as child process, pipe logs
- [ ] `ipc-bridge.ts` — relay IPC ↔ WebSocket
- [ ] `@spira/renderer` — Vite + React 19 + TypeScript
- [ ] FFX dark theme tokens (navy `#0a0e27`, teal `#00d4aa`, cyan `#00e5ff`)
- [ ] `ChatPanel` + `MessageBubble` + `InputBar` + `StreamingText`
- [ ] `chat-store.ts` + `assistant-store.ts` (Zustand)
- [ ] `useIpc.ts` + `useChat.ts` hooks
- [ ] Custom `TitleBar` with window controls
- [ ] `scripts/dev.ts` — runs backend + vite + electron concurrently

**Exit criteria:** `pnpm dev` opens an Electron window. Type a message, see Copilot's streamed response in a dark-themed chat UI.

---

### Phase 3: MCP Framework + Windows Server (3–5 days)
**Goal:** The AI can control the computer.

- [ ] `@spira/mcp-windows` — MCP server with `@modelcontextprotocol/sdk` + `StdioServerTransport`
- [ ] Tool: `system_set_volume` / `system_get_volume` / `system_toggle_mute`
- [ ] Tool: `system_set_brightness` / `system_get_brightness`
- [ ] Tool: `system_launch_app` / `system_close_app` / `system_list_apps`
- [ ] Tool: `system_sleep` / `system_shutdown` / `system_restart` / `system_lock`
- [ ] Tool: `system_send_notification`
- [ ] `util/powershell.ts` — allowlisted PS command runner with timeout + sanitization
- [ ] `@spira/backend/mcp/registry.ts` — read `mcp-servers.json`, spawn servers as child processes
- [ ] `@spira/backend/mcp/client-pool.ts` — MCP Client connections via stdio
- [ ] `@spira/backend/mcp/tool-aggregator.ts` — merge tools from all servers
- [ ] `@spira/backend/copilot/tool-bridge.ts` — register aggregated MCP tools with Copilot SDK
- [ ] `@spira/renderer` — `ToolCallCard` component (show tool invocation inline)
- [ ] `@spira/renderer` — `McpStatus` component (sidebar: connected servers + tool count)
- [ ] `scripts/new-mcp-server.ts` — scaffold generator

**Exit criteria:** Ask Spira "set my volume to 50%" → Copilot calls `system_set_volume` → volume changes → confirmation in chat.

**Rationale:** MCP is the extensibility story. Proving the full tool-call round-trip (Copilot → backend → MCP server → system → result → chat) unlocks all future integrations.

---

### Phase 4: Shinra Orb Visual (2–3 days)
**Goal:** The hero visual is alive on screen.

- [ ] `@react-three/fiber` + `@react-three/drei` setup
- [ ] Icosphere mesh with custom GLSL shader (plasma/energy glow)
- [ ] Orbiting particle system (points + custom shader)
- [ ] `orb-animations.ts` — state-driven visual params (from Section 3.6)
- [ ] Smooth lerp transitions between states
- [ ] Art Nouveau geometric border (CSS/SVG overlay around orb area)
- [ ] Performance target: 60fps on integrated GPU
- [ ] Hook to `assistant-store` — orb reacts to state changes from text chat

**Exit criteria:** Orb animates through all 6 states. Sending a chat message triggers `idle → thinking → idle` with visible animation.

**Rationale:** The orb is pure visual — it doesn't block functionality. But placing it before voice means voice development gets immediate visual feedback (you see the orb react to wake word, listening, etc.).

---

### Phase 5: Voice Pipeline (4–6 days)
**Goal:** Fully hands-free interaction.

- [ ] `voice/audio-capture.ts` — PvRecorder continuous mic capture
- [ ] `voice/wake-word.ts` — Porcupine with built-in "porcupine" keyword (swap to "Shinra" `.ppn` when trained)
- [ ] `voice/stt.ts` — `nodejs-whisper` with `base.en` model
- [ ] `voice/tts.ts` — ElevenLabs streaming (chunked playback for low latency)
- [ ] `voice/tts-piper.ts` — Piper local TTS fallback (no API key needed)
- [ ] `voice/audio-playback.ts` — play PCM/MP3 to default audio output
- [ ] `voice/pipeline.ts` — state machine wiring: wake → capture → silence-detect → STT → Copilot → TTS → idle
- [ ] Audio level streaming to frontend (for orb `listening` animation)
- [ ] TTS amplitude streaming to frontend (for orb `speaking` animation)
- [ ] `VoiceIndicator` component (mic level, active state)
- [ ] Push-to-talk alternative (hold spacebar)
- [ ] `voice:toggle` client message support
- [ ] Silence detection tuning (don't cut off mid-sentence, don't wait forever)

**Exit criteria:** Say "Porcupine, set my volume to 30%" → orb reacts through all states → volume changes → Shinra voice responds → orb returns to idle.

**Rationale:** Voice is the most complex, most hardware-dependent subsystem. It depends on backend (Copilot), MCP (tool calls), and renderer (orb visuals) all being stable. Build it last.

---

### Phase 6: Polish & Ship (2–3 days)
**Goal:** Production-ready installer.

- [ ] Error handling audit (every `await` has a catch, every failure has user feedback)
- [ ] Voice pipeline recovery (timeout to idle, retry on transient errors)
- [ ] Settings panel (API keys, voice sensitivity, TTS provider toggle, MCP enable/disable)
- [ ] `settings-store.ts` persisted via `electron-store`
- [ ] System tray (toggle window, mute mic, quit)
- [ ] `electron-builder.yml` — NSIS installer, native module rebuild config
- [ ] Auto-updater integration
- [ ] Custom "Shinra" Porcupine wake word model (from Picovoice Console)
- [ ] Memory + CPU profiling (idle should be <50MB, <1% CPU)
- [ ] README with setup instructions

**Exit criteria:** `pnpm build` produces a working `.exe` installer. Clean install on a fresh Windows machine works end-to-end.

---

## 6. Key Technical Decisions & Disagreements

### Decision 1: Backend Always Standalone (WebSocket Server)

**Existing plan:** Backend runs in-process inside Electron main. `electron-entry.ts` loads it as a module. `standalone-entry.ts` exists for future HA mode.

**My position:** Backend is **always** a standalone WebSocket server. Even in Electron mode, the main process spawns it as a child process and connects via WebSocket.

**Why I disagree with in-process:**

| Concern | In-Process | Standalone |
|---------|-----------|------------|
| Backend crash | Kills the entire Electron app | Main process shows "reconnecting...", restarts backend |
| Testing | Need Electron installed to run backend tests | `node packages/backend/dist/index.js` — zero Electron dependency |
| Import discipline | Easy to accidentally `import { app } from 'electron'` in backend code | Physically impossible — backend is a separate process |
| Resource monitoring | Backend CPU/memory mixed with Electron's | Separate process = separate monitoring |
| HA migration | Need to test a second entry point that may drift | The entry point IS the production entry point. No drift. |
| Dev experience | Restart Electron to restart backend | Backend hot-reloads independently |

**The trade-off** is slightly higher complexity in `@spira/main` (it must manage a child process). I mitigate this with `backend-lifecycle.ts` — a ~50-line module that spawns, health-checks, and auto-restarts the backend.

**The 1-line HA migration claim in the existing plan is incorrect.** If the backend is loaded as a module in Electron, moving to HA means you've never tested the standalone WebSocket path in production. You have two entry points and only one is battle-tested. With my approach, the standalone path IS the only path — it's always tested.

---

### Decision 2: No `@spira/mcp-core` Package — Use the Official SDK

**Existing plan:** A dedicated `@spira/mcp-core` package containing `IMcpServer`, `McpRegistry`, `BaseMcpServer`, and `ToolInputValidator`.

**My position:** Delete `mcp-core`. Use `@modelcontextprotocol/sdk` directly. Put shared types in `@spira/shared`.

**Why:**

The `@modelcontextprotocol/sdk` already provides:
- `Server` class with tool registration
- `Client` class with tool discovery and invocation
- `StdioServerTransport` and `SSEClientTransport`
- Zod-based input schema validation
- JSON-RPC message framing

Creating `IMcpServer` and `BaseMcpServer` reinvents this with a Spira-specific interface that:
- Doesn't match the MCP spec (confusing for anyone who's read the MCP docs)
- Must be maintained in sync with SDK updates
- Adds a learning curve for contributors who know MCP but not our custom abstraction
- Makes it harder to use community MCP servers (they implement the spec, not our interface)

**My approach:**
- `@spira/mcp-windows` uses `@modelcontextprotocol/sdk`'s `Server` class directly. It's a standard MCP server.
- `@spira/backend/mcp/registry.ts` uses `@modelcontextprotocol/sdk`'s `Client` class to connect to servers.
- `@spira/shared/mcp-types.ts` defines the config and status types (not tool execution interfaces).
- Any community MCP server (e.g., a Spotify MCP server someone else wrote) can be added to `mcp-servers.json` and it just works — no adapter needed.

---

### Decision 3: Voice as Backend Subsystem (Not Separate Package)

**Existing plan:** Separate `@spira/voice` package containing wake word, STT, TTS components. Backend's `VoicePipelineOrchestrator` consumes them.

**My position:** Voice lives in `@spira/backend/src/voice/`. No separate package.

**Arguments for separate package (from existing plan):**
> "Voice is independently testable (you can test STT accuracy without running Copilot)."

**My counterarguments:**
1. You can test STT accuracy by importing `@spira/backend/src/voice/stt.ts` directly in a test file. Package boundaries are not required for testability.
2. Voice is not independently *deployable*. You will never `npm install @spira/voice` in a project that doesn't also need `@spira/backend`. It has exactly one consumer.
3. The pipeline orchestrator (`pipeline.ts`) needs deep integration with audio capture, wake word, STT, and TTS. Putting them in different packages means every state transition crosses a package boundary, adding async overhead and complexity.
4. The existing plan acknowledges this tension: the orchestrator lives in backend, not in voice. So voice is a "library of components" consumed by one caller. That's just... a directory.
5. Separate packages add real overhead: separate `package.json`, separate `tsconfig.json`, separate build step, separate version, potential version drift between `@spira/voice` and `@spira/backend`.

**My compromise:** The voice directory has clean internal separation. Each file (`wake-word.ts`, `stt.ts`, `tts.ts`, etc.) is independently importable and testable. The *module* boundaries are clean. I just don't see the need for *package* boundaries.

---

### Decision 4: MCP Servers as Stdio Child Processes (Not In-Process Modules)

**Existing plan:** MCP servers are loaded as in-process modules. The `IMcpServer.invokeTool()` method is called directly.

> "Loading servers as modules is 100× faster, simpler to debug, and shares the Node process for resource efficiency."

**My position:** MCP servers run as **stdio child processes**, communicating via JSON-RPC per the MCP specification.

**Why I disagree with in-process:**

1. **Crash isolation.** An MCP server that calls PowerShell to set system brightness should not be able to crash the AI brain. In-process, a segfault in a native module kills everything.

2. **The MCP spec exists for a reason.** The protocol is designed for process isolation. By loading modules, we lose:
   - Language independence (future MCP servers could be Python, Go, Rust)
   - The ability to use community MCP servers without writing adapters
   - Process-level sandboxing

3. **"100× faster" doesn't matter.** Tool calls happen at human-conversation speed (once every few seconds). The JSON-RPC overhead is <1ms. The PowerShell command it runs takes 50-200ms. Serialization is not the bottleneck.

4. **"Simpler to debug" is wrong.** With stdio, you can test any MCP server with the official MCP Inspector tool. With in-process modules, you need a custom test harness.

5. **Extensibility.** The biggest value of MCP is the ecosystem. If someone writes a Home Assistant MCP server in Python, I want to add it to `mcp-servers.json` and have it work. With in-process modules, I can only use TypeScript servers that implement our custom `IMcpServer` interface.

**Performance concern addressed:** Spawning a child process takes ~50ms. We do it once at startup, not per tool call. The MCP client connection stays open for the lifetime of the backend.

---

### Decision 5: Single-File `messages.ts` over `IpcChannel` Enum

**Existing plan:** `IpcChannel` const object with string values + separate payload types.
**My position:** Single discriminated union (`ClientMessage | ServerMessage`) in `messages.ts`.

The existing approach requires correlating a channel string with its payload type manually. With discriminated unions, TypeScript does this automatically:

```typescript
// Existing plan approach — easy to get wrong:
transport.on(IpcChannel.COPILOT_STREAM_CHUNK, (payload: CopilotStreamChunk) => { ... });
// What if someone passes the wrong payload type? TypeScript can't catch it.

// My approach — impossible to get wrong:
function handleMessage(msg: ServerMessage) {
  switch (msg.type) {
    case 'chat:delta':
      // msg is narrowed to { type: 'chat:delta'; messageId: string; delta: string; done: boolean }
      // TypeScript knows exactly what fields exist
      break;
  }
}
// Exhaustiveness checking: miss a case, get a compile error.
```

---

### Decision 6: `module: "Node16"` over `"bundler"` for tsconfig

**Existing plan:** `moduleResolution: "bundler"` in `tsconfig.base.json`.

**My position:** `module: "Node16"` / `moduleResolution: "Node16"` as the base, with renderer overriding to `"bundler"`.

`"bundler"` mode tells TypeScript "a bundler will resolve imports" — it skips file extension validation and allows bare specifiers. This is correct for the renderer (Vite resolves imports) but **wrong** for Node.js packages:
- `@spira/backend` runs in Node.js directly (via `tsx` in dev, bundled in prod)
- `@spira/mcp-windows` runs in Node.js as a child process
- Both need correct `.js` extension resolution

Using `"bundler"` for these means TypeScript won't catch import resolution errors that crash at runtime.

---

### Decision 7: `esbuild` for All Node Bundling (Not `tsup`)

**Existing plan:** `tsup` for Node packages.

**My position:** `esbuild` directly.

`tsup` is a wrapper around `esbuild` that adds CJS+ESM dual output, `.d.ts` generation, and a config file format. We don't need any of that:
- We don't publish to npm — no CJS/ESM dual output needed.
- Type declarations come from `tsc --build`, not the bundler.
- `esbuild` config is 5 lines in `scripts/build.ts`.
- One less dependency. One less config format to learn.

---

### Decision 8: `vanilla-extract` over `styled-components`

The FFX theme is heavy — lots of custom colors, gradients, glow effects, animations. A zero-runtime CSS solution means:
- Theme tokens get TypeScript autocomplete (type `tokens.color.` and see all options)
- No style injection at runtime (faster paint, no FOUC)
- Styles are extracted at build time by Vite
- Smaller bundle than styled-components

Trade-off: less familiar than styled-components. Worth it for a heavily themed app.

---

### Decision 9: Piper TTS as Offline Fallback (Agreement)

I **agree** with the existing plan's addition of `PiperTtsProvider`. ElevenLabs requires an API key and internet. A local TTS fallback ensures the app is functional without either. The `tts.ts` / `tts-piper.ts` split makes this a config toggle.

---

### Decision 10: Port 9720

Backend WebSocket on port `9720`. Outside common ranges, no known conflicts. Configurable via `SPIRA_PORT` env var. Mnemonic: SP on a phone keypad.

---

## Summary of Architectural Differences

| Aspect | Existing Plan | My Plan | Winner (my opinion) |
|--------|--------------|---------|-------------------|
| Package count | 7 | 5 | 5 — less overhead, same separation |
| Backend hosting | In-process (Electron main) | Standalone WebSocket (always) | Standalone — testable, crash-isolated, honest HA path |
| MCP server hosting | In-process modules | Stdio child processes | Stdio — spec-compliant, crash-isolated, ecosystem-compatible |
| MCP framework | Custom `IMcpServer` in `@spira/mcp-core` | Use `@modelcontextprotocol/sdk` directly | SDK — don't reinvent it |
| Voice location | Separate `@spira/voice` package | Inside `@spira/backend/src/voice/` | Backend subsystem — one consumer, no deployment independence |
| IPC protocol | `IpcChannel` enum + loose types | Discriminated union (`ClientMessage`/`ServerMessage`) | Union — compile-time exhaustiveness |
| Module resolution | `"bundler"` for all | `"Node16"` base, `"bundler"` for renderer only | Node16 — correct for Node.js packages |
| Node bundler | `tsup` | `esbuild` direct | esbuild — fewer abstractions |
| CSS approach | Not specified | vanilla-extract | vanilla-extract — zero-runtime, type-safe |

---

*Ready for merge discussion with the third reviewer.*
