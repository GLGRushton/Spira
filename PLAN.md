# Spira — Definitive Architecture Plan

> **Status**: Final merged plan. Produced by synthesizing three independent AI architectural reviews and their cross-reviews. This is the implementation blueprint.
>
> **Last updated**: 2025

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Full Directory & File Tree](#2-full-directory--file-tree)
3. [Package Responsibilities](#3-package-responsibilities)
4. [Key TypeScript Interfaces](#4-key-typescript-interfaces)
5. [mcp-servers.json Schema & Example](#5-mcp-serversjson-schema--example)
6. [Build & Dev Workflow](#6-build--dev-workflow)
7. [Implementation Phases](#7-implementation-phases)
8. [Technology Choices Table](#8-technology-choices-table)

---

## 1. Project Overview

**Spira** is a GitHub Copilot-powered desktop AI assistant with voice control, a Three.js animated orb UI (Final Fantasy X/X-2 "Shinra" aesthetic), and extensible tool integrations via MCP servers. It runs as an Electron app on Windows today; the backend is designed to be extractable to Home Assistant without modification.

### Core Architectural Principles

1. **Hard seam at the transport boundary.** Backend never imports from Electron. Renderer never imports from Node. Both sides communicate only through typed WebSocket messages defined in `@spira/shared`.
2. **Backend is always a standalone process.** Even under Electron, the backend runs as a child process communicating over WebSocket. No in-process option exists. This is the honest HA migration path.
3. **MCP servers are stdio child processes.** Spec-compliant, crash-isolated, community-compatible. No custom `IMcpServer` interface — use `@modelcontextprotocol/sdk` directly.
4. **Discriminated union protocol.** All wire messages are `ClientMessage | ServerMessage` tagged unions with compile-time exhaustiveness checking.
5. **Orb state is derived, never imperative.** The renderer reads `AssistantState` from the backend and derives all visual parameters. No animation triggers cross the wire.

---

## 2. Full Directory & File Tree

```
spira/
├── apps/
│   └── desktop/                            # Electron packaging entrypoint
│       ├── electron-builder.yml            # NSIS installer config, native module rebuild settings
│       └── package.json                    # Electron + electron-builder dependencies only
│
├── packages/
│   ├── shared/                             # @spira/shared — zero-dep contract types + Zod schemas
│   │   ├── src/
│   │   │   ├── index.ts                    # Barrel export (re-exports everything)
│   │   │   ├── protocol.ts                 # ClientMessage / ServerMessage discriminated unions
│   │   │   ├── assistant-state.ts          # AssistantState type + valid transitions documentation
│   │   │   ├── chat-types.ts              # ChatMessage, ToolCallStatus
│   │   │   ├── mcp-types.ts               # McpServerConfig, McpServerStatus
│   │   │   ├── voice-types.ts             # VoiceState, TranscriptionResult, VoicePipelineEvent
│   │   │   ├── transport.ts               # ITransport interface
│   │   │   └── config-schema.ts           # Zod schemas for .env and mcp-servers.json validation
│   │   ├── package.json                    # deps: zod (only runtime dep)
│   │   └── tsconfig.json                   # extends tsconfig.base.json
│   │
│   ├── backend/                            # @spira/backend — standalone Node.js service (ZERO Electron imports)
│   │   ├── src/
│   │   │   ├── index.ts                    # Entry: parse config, boot EventBus, start WS server, init subsystems
│   │   │   ├── server.ts                   # WebSocket server (ws library) on configurable port (default 9720)
│   │   │   ├── ws-transport.ts             # ITransport implementation over WebSocket
│   │   │   │
│   │   │   ├── copilot/                    # GitHub Copilot SDK integration
│   │   │   │   ├── session-manager.ts      # Copilot client init, session create/destroy lifecycle
│   │   │   │   ├── stream-handler.ts       # Assembles streaming deltas, emits chat:delta ServerMessages
│   │   │   │   └── tool-bridge.ts          # Registers aggregated MCP tools with Copilot as callable tools
│   │   │   │
│   │   │   ├── voice/                      # Voice pipeline (subsystem, NOT a separate package)
│   │   │   │   ├── pipeline.ts             # State machine: idle → listening → transcribing → thinking → speaking → idle
│   │   │   │   ├── wake-word.ts            # Porcupine wrapper — detects "Shinra" (or built-in keyword for dev)
│   │   │   │   ├── audio-capture.ts        # PvRecorder mic capture + silence detection + level metering
│   │   │   │   ├── stt.ts                  # ISttProvider implementation: WhisperSttProvider (nodejs-whisper / whisper.cpp)
│   │   │   │   ├── tts.ts                  # ITtsProvider implementation: ElevenLabsTtsProvider (streaming REST)
│   │   │   │   ├── tts-piper.ts            # ITtsProvider implementation: PiperTtsProvider (local offline fallback)
│   │   │   │   ├── audio-playback.ts       # PCM/MP3 playback to default audio output device
│   │   │   │   ├── stt-provider.ts         # ISttProvider interface definition
│   │   │   │   └── tts-provider.ts         # ITtsProvider interface definition
│   │   │   │
│   │   │   ├── mcp/                        # MCP server management (client side)
│   │   │   │   ├── registry.ts             # Reads mcp-servers.json, spawns MCP servers as child processes (parallel)
│   │   │   │   ├── client-pool.ts          # Pool of @modelcontextprotocol/sdk Client instances (one per server)
│   │   │   │   └── tool-aggregator.ts      # Merges tools from all connected MCP servers into one list
│   │   │   │
│   │   │   └── util/
│   │   │       ├── event-bus.ts            # Typed EventEmitter — internal nervous system for all subsystem coordination
│   │   │       ├── logger.ts               # pino structured logger (pino-pretty in dev)
│   │   │       └── errors.ts               # SpiraError base + typed subtypes (CopilotError, McpError, VoiceError)
│   │   │
│   │   ├── package.json                    # deps: ws, zod, pino, @github/copilot-sdk, @modelcontextprotocol/sdk,
│   │   │                                   #        @picovoice/porcupine-node, nodejs-whisper, piper-tts, elevenlabs
│   │   └── tsconfig.json                   # extends tsconfig.base.json; module: Node16
│   │
│   ├── main/                               # @spira/main — Electron shell (as thin as possible)
│   │   ├── src/
│   │   │   ├── index.ts                    # App entry: spawn backend, create window, wire lifecycle
│   │   │   ├── backend-lifecycle.ts        # Spawn @spira/backend as child_process, health-check, auto-restart
│   │   │   ├── ipc-bridge.ts              # Relay: renderer IPC ↔ backend WebSocket (dumb message forwarder)
│   │   │   ├── preload.ts                 # contextBridge: expose typed window.electronAPI to renderer
│   │   │   ├── window.ts                  # BrowserWindow factory (frameless, dark bg, 1000×700 default)
│   │   │   ├── tray.ts                    # System tray icon + context menu (toggle, mute, quit)
│   │   │   └── auto-update.ts             # electron-updater integration
│   │   ├── package.json                    # deps: electron, electron-updater, ws (client)
│   │   └── tsconfig.json                   # extends tsconfig.base.json
│   │
│   ├── renderer/                           # @spira/renderer — React UI (sandboxed, no Node access)
│   │   ├── src/
│   │   │   ├── main.tsx                    # React root + providers (StrictMode, ThemeProvider)
│   │   │   ├── App.tsx                     # Root layout, routes top-level component
│   │   │   │
│   │   │   ├── components/
│   │   │   │   ├── shinra-orb/             # Three.js animated sphere — the hero visual
│   │   │   │   │   ├── ShinraOrb.tsx       # @react-three/fiber Canvas wrapper component
│   │   │   │   │   ├── orb-scene.ts        # Scene: camera, lighting, bloom post-processing
│   │   │   │   │   ├── orb-mesh.ts         # Icosphere geometry + custom ShaderMaterial
│   │   │   │   │   ├── orb-particles.ts    # Orbiting particle system (Points + custom shader)
│   │   │   │   │   ├── orb-animations.ts   # AssistantState → OrbVisualParams mapping + lerp transitions
│   │   │   │   │   └── shaders/
│   │   │   │   │       ├── orb.vert.glsl   # Vertex: displacement + pulse based on uniforms
│   │   │   │   │       └── orb.frag.glsl   # Fragment: plasma/energy glow effect
│   │   │   │   │
│   │   │   │   ├── chat/
│   │   │   │   │   ├── ChatPanel.tsx        # Scrollable message list + input area container
│   │   │   │   │   ├── MessageBubble.tsx    # Single message (user/assistant/tool role styling)
│   │   │   │   │   ├── InputBar.tsx         # Text input + mic toggle button + send button
│   │   │   │   │   ├── StreamingText.tsx    # Token-by-token text reveal animation
│   │   │   │   │   └── ToolCallCard.tsx     # Inline tool invocation display (name, args, result, status)
│   │   │   │   │
│   │   │   │   ├── status/
│   │   │   │   │   ├── VoiceIndicator.tsx   # Mic state + audio level visualization bar
│   │   │   │   │   ├── McpStatus.tsx        # Connected MCP servers list + tool count
│   │   │   │   │   └── ConnectionDot.tsx    # Backend WebSocket health indicator (green/yellow/red)
│   │   │   │   │
│   │   │   │   └── layout/
│   │   │   │       ├── AppShell.tsx         # CSS Grid layout: orb area + chat + sidebar
│   │   │   │       ├── TitleBar.tsx         # Custom frameless title bar + window controls (min/max/close)
│   │   │   │       ├── Sidebar.tsx          # Nav: chat, settings, MCP servers
│   │   │   │       ├── SettingsPanel.tsx    # API keys, voice settings, TTS provider toggle, MCP enable/disable
│   │   │   │       └── GlassPanel.tsx       # Reusable frosted-glass card component
│   │   │   │
│   │   │   ├── hooks/
│   │   │   │   ├── useIpc.ts               # Typed wrapper over window.electronAPI (send/subscribe)
│   │   │   │   ├── useChat.ts              # Send message, subscribe to chat:delta stream
│   │   │   │   ├── useAssistantState.ts    # Zustand selector for current AssistantState
│   │   │   │   ├── useAudioLevel.ts        # Subscribe to audio:level ServerMessages (for orb listening anim)
│   │   │   │   └── useTtsAmplitude.ts      # Subscribe to tts:amplitude ServerMessages (for orb speaking anim)
│   │   │   │
│   │   │   ├── stores/
│   │   │   │   ├── chat-store.ts           # Zustand: message history, streaming state, pending tool calls
│   │   │   │   ├── assistant-store.ts      # Zustand: current AssistantState + previous state
│   │   │   │   ├── mcp-store.ts            # Zustand: MCP server statuses array
│   │   │   │   └── settings-store.ts       # Zustand: user prefs (persisted via electron-store)
│   │   │   │
│   │   │   ├── theme/
│   │   │   │   ├── tokens.ts               # Design tokens: FFX colors, spacing, radii, shadows, fonts
│   │   │   │   ├── global.css              # CSS reset + root variables + font imports
│   │   │   │   └── animations.ts           # Framer Motion variants (glow, pulse, fade, slide)
│   │   │   │
│   │   │   └── assets/
│   │   │       ├── fonts/                  # Custom typeface files
│   │   │       └── textures/               # Orb textures, particle sprites
│   │   │
│   │   ├── index.html                      # Vite HTML entry
│   │   ├── vite.config.ts                  # Vite config (React plugin, alias @spira/shared)
│   │   ├── package.json                    # deps: react, zustand, @react-three/fiber, framer-motion, three
│   │   └── tsconfig.json                   # extends tsconfig.base.json; moduleResolution: bundler (override)
│   │
│   └── mcp-windows/                        # @spira/mcp-windows — Windows system controls MCP server (stdio)
│       ├── src/
│       │   ├── index.ts                    # Creates MCP Server, registers all tools, starts StdioServerTransport
│       │   ├── tools/
│       │   │   ├── volume.ts               # system_get_volume, system_set_volume, system_toggle_mute
│       │   │   ├── brightness.ts           # system_get_brightness, system_set_brightness
│       │   │   ├── apps.ts                 # system_launch_app, system_close_app, system_list_apps
│       │   │   ├── display.ts              # system_get_displays, system_set_resolution
│       │   │   ├── power.ts                # system_sleep, system_shutdown, system_restart, system_lock
│       │   │   └── notifications.ts        # system_send_notification (Windows toast via PowerShell)
│       │   └── util/
│       │       ├── powershell.ts           # Allowlisted PowerShell command runner with timeout + sanitization
│       │       └── validation.ts           # Shared Zod schemas for tool input validation
│       ├── package.json                    # deps: @modelcontextprotocol/sdk, zod
│       └── tsconfig.json                   # extends tsconfig.base.json; module: Node16
│
├── assets/                                 # Non-code assets (not inside any package)
│   ├── wake-word/
│   │   └── shinra.ppn                      # Custom Porcupine wake word model (from Picovoice Console)
│   └── icons/
│       ├── spira.ico                       # Windows app icon
│       └── spira.png                       # Tray icon / general use
│
├── scripts/
│   ├── dev.ts                              # Orchestrates all dev processes concurrently (tsx)
│   ├── build.ts                            # Production build pipeline (esbuild + vite + electron-builder)
│   └── new-mcp-server.ts                   # Scaffold generator for new MCP server packages
│
├── mcp-servers.json                        # MCP server manifest — which servers to spawn at startup
├── package.json                            # pnpm workspace root: shared devDeps, workspace scripts
├── pnpm-workspace.yaml                     # packages: ['packages/*', 'apps/*']
├── tsconfig.base.json                      # Shared TS compiler options (strict, Node16, composite)
├── vitest.workspace.ts                     # Vitest workspace config (all packages)
├── biome.json                              # Biome linter + formatter config (replaces ESLint + Prettier)
├── .env.example                            # All required/optional env vars documented
└── .gitignore
```

---

## 3. Package Responsibilities

### `@spira/shared` — The Contract

| | |
|---|---|
| **Owns** | TypeScript types, discriminated union protocol, Zod schemas, string constants that cross the wire. The `ITransport` interface. |
| **Does NOT own** | Any runtime logic, classes, or functions (except Zod schema objects). No npm dependencies except `zod`. |
| **Key constraint** | `@spira/shared` may not import from any other `@spira/*` package. CI enforces this. |

**Key files and their roles:**
- `protocol.ts` — `ClientMessage` / `ServerMessage` discriminated unions. **The most important file in the codebase.** Every byte between frontend and backend is typed here.
- `assistant-state.ts` — The canonical `AssistantState` type. The backend owns transitions; the renderer derives visuals from it.
- `transport.ts` — `ITransport` interface. Even with one implementation (WebSocket), this is documented here for the HA migration contract.
- `config-schema.ts` — Zod schemas that validate `.env` values and `mcp-servers.json` structure at startup.

---

### `@spira/backend` — The Brain (Electron-Free)

| | |
|---|---|
| **Owns** | Copilot SDK sessions, voice pipeline orchestration, MCP server management, audio I/O, WebSocket server, EventBus. |
| **Does NOT own** | Electron APIs. Window management. UI state. Any `import` from `electron`. |
| **Key constraint** | Zero Electron imports. This is a standalone Node.js application. Physically impossible to accidentally couple to Electron because it runs in a separate process. |

**Internal subsystems:**

| Directory | Responsibility |
|-----------|---------------|
| `copilot/` | `@github/copilot-sdk` wrapper. Session lifecycle, streaming response assembly, tool registration via tool-bridge. |
| `voice/` | Full voice pipeline. Wake word (Porcupine) → audio capture → STT (Whisper) → Copilot → TTS (ElevenLabs/Piper) → playback. State machine in `pipeline.ts`. **Clean module boundaries**: voice files must NOT import from `copilot/` or `mcp/`. Communication is via EventBus only. |
| `mcp/` | Reads `mcp-servers.json`. Spawns MCP servers as stdio child processes in parallel. Maintains `@modelcontextprotocol/sdk` Client connections. Aggregates tools from all servers. Routes Copilot tool invocations to the correct server. |
| `util/` | EventBus (typed emitter), pino logger, error types. |

**Voice extraction note**: Voice lives in `backend/src/voice/` for v1. The clean module boundary (no cross-subsystem imports, EventBus-only coordination) is designed so that extracting to a `@spira/voice` package during the HA migration phase requires only moving files and updating imports — no logic changes.

---

### `@spira/main` — Electron Shell (Disposable)

| | |
|---|---|
| **Owns** | BrowserWindow lifecycle, system tray, preload script (contextBridge), IPC relay between renderer and backend WebSocket, backend child process management. |
| **Does NOT own** | AI logic. Voice processing. MCP tools. Business logic of any kind. |
| **Key constraint** | This package is deleted entirely when migrating to HA. Everything important is in `@spira/backend`. |

**Responsibilities in detail:**
1. **Spawn backend** (`backend-lifecycle.ts`): Start `@spira/backend` as a `child_process.fork()`, pipe stdout/stderr to main process logger, health-check via WebSocket ping, auto-restart on crash (max 3 retries with backoff).
2. **Create window** (`window.ts`): Frameless BrowserWindow (1000×700 default), dark background `#0a0e27`, load Vite dev server in dev / bundled HTML in prod.
3. **Bridge IPC** (`ipc-bridge.ts`): Connect renderer IPC channels to backend WebSocket. Dumb relay — deserialize `ClientMessage` from IPC, forward to WebSocket; receive `ServerMessage` from WebSocket, forward to renderer via IPC. No transformation.
4. **System tray** (`tray.ts`): Icon + context menu (toggle window visibility, mute mic, quit).

---

### `@spira/renderer` — React UI (Sandboxed)

| | |
|---|---|
| **Owns** | All React components, Three.js Shinra orb, Zustand stores, Framer Motion animations, FFX theme, `window.electronAPI` typed wrapper. |
| **Does NOT own** | Node.js APIs. No `fs`, `child_process`, or direct Copilot/MCP calls. |
| **Key constraint** | `nodeIntegration: false`, `contextIsolation: true`. Renderer is treated as an untrusted browser page. All data arrives through `window.electronAPI`. |

**State management**: 4 Zustand stores (chat, assistant, mcp, settings). Zustand chosen for selective subscriptions — `audio:level` events at ~30Hz only re-render the orb component, not the entire app.

**Orb visual system**: The orb reads `AssistantState` from the assistant store and derives all visual parameters (rotation speed, glow intensity, color, displacement) via a lookup table in `orb-animations.ts`. Audio level and TTS amplitude are injected as shader uniforms for real-time reactivity. The orb never knows about Copilot, MCP, or voice — it only reads state.

---

### `@spira/mcp-windows` — Windows System Controls (Standalone MCP Server)

| | |
|---|---|
| **Owns** | Windows system control tools implemented via PowerShell and Win32 APIs, using the MCP protocol over stdio. |
| **Does NOT own** | MCP protocol plumbing (that's `@modelcontextprotocol/sdk`). Copilot logic. UI. Backend internals. |
| **Key constraint** | This is a **standard MCP server**. It can be tested with the official MCP Inspector. Any community MCP client can connect to it. |

**How it works:** Uses `@modelcontextprotocol/sdk`'s `Server` class + `StdioServerTransport`. The backend spawns it as a child process (`node packages/mcp-windows/dist/index.js`) and connects via an SDK `Client` over stdio.

**Tool naming convention:** All tools prefixed with `system_` to avoid collisions with future MCP servers.

**Adding a new MCP server** (e.g., `@spira/mcp-homeassistant`):
1. `pnpm run new-mcp-server mcp-homeassistant`
2. Implement tools using `@modelcontextprotocol/sdk`'s `Server` class
3. Add entry to `mcp-servers.json`
4. Restart backend — auto-discovered and spawned

No code changes to the backend. No custom interfaces. Standard MCP protocol.

---

## 4. Key TypeScript Interfaces

### 4.1 Wire Protocol — The Most Important Interface

Every byte between frontend and backend is one of these types. The `type` field is the discriminant — TypeScript narrows automatically in switch statements, and missing a case is a compile error.

```typescript
// ─── @spira/shared/src/protocol.ts ───────────────────────────────────────

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
  | { type: 'chat:tool-call'; callId: string; toolName: string; args: Record<string, unknown>; status: ToolCallStatus; result?: unknown }
  | { type: 'audio:level'; level: number }         // 0–1 normalized mic input level (for orb)
  | { type: 'tts:amplitude'; amplitude: number }   // 0–1 normalized TTS output amplitude (for orb)
  | { type: 'voice:transcript'; text: string; confidence: number }
  | { type: 'mcp:status'; servers: McpServerStatus[] }
  | { type: 'error'; code: string; message: string; recoverable: boolean };

// ── User settings shape ──────────────────────────────────────────────────

export interface UserSettings {
  voiceEnabled: boolean;
  wakeWordEnabled: boolean;
  ttsProvider: 'elevenlabs' | 'piper';
  whisperModel: 'tiny.en' | 'base.en' | 'small.en';
  elevenLabsVoiceId: string;
  theme: 'dark';  // Only dark for v1
}
```

**Design rules:**
- Discriminated union on `type` — not `{ channel, payload }`. One concept, not two.
- Flat structure — fields live directly on the message. Fewer allocations, easier to read.
- `audio:level` and `tts:amplitude` are first-class `ServerMessage` types, not sideband events.
- Adding a new message type is a compile error everywhere it's not handled (exhaustiveness).

---

### 4.2 ITransport

```typescript
// ─── @spira/shared/src/transport.ts ──────────────────────────────────────

import type { ClientMessage, ServerMessage } from './protocol';

/**
 * Transport abstraction for frontend ↔ backend communication.
 * v1 has one implementation (WebSocket). Defined as an interface to
 * document the contract and enable testing with mocks.
 */
export interface ITransport {
  /** Send a message to the connected peer */
  send(message: ServerMessage): void;

  /** Subscribe to incoming messages. Returns an unsubscribe function. */
  onMessage(handler: (message: ClientMessage) => void): () => void;

  /** Subscribe to connection lifecycle events */
  onConnect(handler: () => void): () => void;
  onDisconnect(handler: (reason: string) => void): () => void;

  /** Graceful shutdown */
  close(): Promise<void>;
}
```

**Note:** This is typed to the specific `ClientMessage`/`ServerMessage` unions, not generic `<T>`. The transport knows the protocol. This gives type safety at every call site without casting.

---

### 4.3 AssistantState

```typescript
// ─── @spira/shared/src/assistant-state.ts ────────────────────────────────

/**
 * Canonical assistant state. The backend owns transitions via pipeline.ts.
 * The renderer derives ALL visual state from this single value.
 *
 * Valid transitions (enforced in backend/src/voice/pipeline.ts):
 *   idle → listening          (wake word detected OR push-to-talk activated)
 *   idle → thinking           (text chat:send received)
 *   listening → transcribing  (silence detected, recording ends)
 *   transcribing → thinking   (STT result ready, sent to Copilot)
 *   thinking → speaking       (Copilot response ready, TTS begins)
 *   thinking → idle           (Copilot response text-only, TTS disabled or skipped)
 *   speaking → idle           (TTS playback complete)
 *   * → error                 (any stage can fail)
 *   error → idle              (auto-recovery after timeout, default 5s)
 */
export type AssistantState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'error';
```

---

### 4.4 ISttProvider & ITtsProvider

```typescript
// ─── @spira/backend/src/voice/stt-provider.ts ────────────────────────────

import type { TranscriptionResult } from '@spira/shared';

/**
 * Speech-to-text provider interface.
 * v1 implementation: WhisperSttProvider (nodejs-whisper / whisper.cpp bindings).
 * No Python dependency.
 */
export interface ISttProvider {
  readonly name: string;
  readonly modelId: string;
  initialize(): Promise<void>;
  transcribe(audio: Buffer, sampleRate: number): Promise<TranscriptionResult>;
  dispose(): Promise<void>;
}

// ─── @spira/backend/src/voice/tts-provider.ts ────────────────────────────

/**
 * Text-to-speech provider interface.
 * v1 implementations: ElevenLabsTtsProvider (primary), PiperTtsProvider (offline fallback).
 * Returns a readable stream of PCM audio chunks for low-latency playback.
 */
export interface ITtsProvider {
  readonly name: string;
  readonly voiceId: string;
  initialize(): Promise<void>;
  /**
   * Synthesize text to audio. Returns a stream of PCM audio buffers
   * and amplitude values (for orb animation).
   */
  synthesize(text: string): AsyncGenerator<{ audio: Buffer; amplitude: number }>;
  dispose(): Promise<void>;
}
```

---

### 4.5 McpServerConfig & McpServerStatus

```typescript
// ─── @spira/shared/src/mcp-types.ts ──────────────────────────────────────

/** Declarative config for one MCP server in mcp-servers.json */
export interface McpServerConfig {
  id: string;                      // "windows-system" — stable key used for routing + display
  name: string;                    // "Windows System Controls" — human-readable display name
  transport: 'stdio';             // v1: stdio only. SSE reserved for future remote servers.
  command: string;                 // Executable to spawn (e.g., "node")
  args: string[];                  // Arguments (e.g., ["packages/mcp-windows/dist/index.js"])
  env?: Record<string, string>;    // Extra env vars injected into spawned process
  enabled: boolean;                // false = skip at startup
  autoRestart: boolean;            // Restart on crash?
  maxRestarts?: number;            // Default: 3. After this, mark as 'error' state.
}

/** Runtime status of a connected MCP server (sent to renderer via mcp:status) */
export interface McpServerStatus {
  id: string;
  name: string;
  state: 'starting' | 'connected' | 'disconnected' | 'error';
  toolCount: number;
  tools: string[];                 // Tool names (for display)
  error?: string;                  // Error message if state === 'error'
  uptimeMs?: number;
}
```

---

### 4.6 EventBus

```typescript
// ─── @spira/backend/src/util/event-bus.ts ────────────────────────────────

import { EventEmitter } from 'node:events';
import type { AssistantState } from '@spira/shared';
import type { VoicePipelineEvent } from '@spira/shared';

/**
 * Internal event map for backend subsystem coordination.
 * This is the nervous system — copilot, voice, and MCP subsystems
 * communicate through here, never by importing each other directly.
 */
export interface EventMap {
  // Voice pipeline events (internal)
  'voice:pipeline': [VoicePipelineEvent];

  // State transitions (broadcast to transport and voice)
  'state:change': [previous: AssistantState, current: AssistantState];

  // Audio levels (high-frequency, forwarded to transport for orb)
  'audio:level': [level: number];
  'tts:amplitude': [amplitude: number];

  // Copilot events
  'copilot:response-start': [messageId: string];
  'copilot:delta': [messageId: string, delta: string];
  'copilot:response-end': [messageId: string, fullText: string];
  'copilot:tool-call': [callId: string, toolName: string, args: Record<string, unknown>];
  'copilot:tool-result': [callId: string, result: unknown];

  // MCP events
  'mcp:servers-changed': [statuses: import('@spira/shared').McpServerStatus[]];
}

export class SpiraEventBus extends EventEmitter {
  override emit<K extends keyof EventMap>(event: K, ...args: EventMap[K]): boolean {
    return super.emit(event, ...args);
  }
  override on<K extends keyof EventMap>(event: K, listener: (...args: EventMap[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  override off<K extends keyof EventMap>(event: K, listener: (...args: EventMap[K]) => void): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}
```

---

### 4.7 VoicePipelineEvent & TranscriptionResult

```typescript
// ─── @spira/shared/src/voice-types.ts ────────────────────────────────────

/** Internal voice pipeline events (travel on EventBus, not over the wire) */
export type VoicePipelineEvent =
  | { type: 'wake-word:detected' }
  | { type: 'capture:start' }
  | { type: 'capture:end'; durationMs: number }
  | { type: 'capture:level'; level: number }       // 0–1 normalized
  | { type: 'stt:result'; text: string; confidence: number; durationMs: number }
  | { type: 'stt:error'; error: string }
  | { type: 'tts:start'; text: string }
  | { type: 'tts:chunk'; amplitude: number }        // 0–1 normalized
  | { type: 'tts:end' }
  | { type: 'tts:error'; error: string };

export interface TranscriptionResult {
  text: string;
  confidence: number;   // 0–1
  durationMs: number;   // Processing time
}

/** Orb visual parameters — used by renderer, defined here for shared reference */
export interface OrbVisualParams {
  rotationSpeed: number;      // radians/sec
  pulseFrequency: number;     // Hz
  pulseAmplitude: number;     // 0–1
  glowIntensity: number;      // 0–1
  colorPrimary: [number, number, number];    // RGB normalized 0–1
  colorSecondary: [number, number, number];
  particleSpeed: number;      // multiplier
  particleCount: number;
  displacementScale: number;  // vertex displacement magnitude
}
```

---

### 4.8 Orb State → Visual Mapping

```typescript
// ─── @spira/renderer/src/components/shinra-orb/orb-animations.ts ─────────

import type { AssistantState, OrbVisualParams } from '@spira/shared';

export const STATE_PARAMS: Record<AssistantState, OrbVisualParams> = {
  idle: {
    rotationSpeed: 0.15,
    pulseFrequency: 0.5,
    pulseAmplitude: 0.1,
    glowIntensity: 0.3,
    colorPrimary: [0.0, 0.6, 0.8],     // Deep teal
    colorSecondary: [0.0, 0.2, 0.4],    // Navy
    particleSpeed: 0.3,
    particleCount: 200,
    displacementScale: 0.02,
  },
  listening: {
    rotationSpeed: 0.3,
    pulseFrequency: 2.0,
    pulseAmplitude: 0.4,                 // Overridden by live audio:level at runtime
    glowIntensity: 0.7,
    colorPrimary: [0.0, 0.9, 1.0],     // Bright cyan
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
    colorSecondary: [0.2, 0.3, 0.8],    // Blue shift
    particleSpeed: 1.2,
    particleCount: 300,
    displacementScale: 0.05,
  },
  thinking: {
    rotationSpeed: 1.0,
    pulseFrequency: 4.0,
    pulseAmplitude: 0.5,
    glowIntensity: 0.8,
    colorPrimary: [0.8, 0.6, 0.1],     // Gold / amber
    colorSecondary: [0.2, 0.1, 0.5],    // Deep purple
    particleSpeed: 2.0,
    particleCount: 600,
    displacementScale: 0.12,
  },
  speaking: {
    rotationSpeed: 0.4,
    pulseFrequency: 1.5,                 // Overridden by live tts:amplitude at runtime
    pulseAmplitude: 0.6,
    glowIntensity: 0.9,
    colorPrimary: [0.0, 1.0, 0.9],     // Bright teal
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
    colorPrimary: [0.9, 0.2, 0.1],     // Red
    colorSecondary: [0.4, 0.1, 0.0],    // Dark red
    particleSpeed: 0.1,
    particleCount: 100,
    displacementScale: 0.15,             // "Distressed" displacement
  },
};
```

---

## 5. mcp-servers.json Schema & Example

### 5.1 Zod Schema (runtime validation)

```typescript
// ─── @spira/shared/src/config-schema.ts (partial) ────────────────────────

import { z } from 'zod';

export const McpServerConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'Lowercase alphanumeric + hyphens only'),
  name: z.string().min(1),
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string()).optional(),
  enabled: z.boolean(),
  autoRestart: z.boolean(),
  maxRestarts: z.number().int().min(0).max(10).optional().default(3),
});

export const McpServersFileSchema = z.object({
  $schema: z.string().optional(),
  servers: z.array(McpServerConfigSchema),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
```

### 5.2 Example mcp-servers.json

```jsonc
{
  "$schema": "./node_modules/@spira/shared/mcp-servers.schema.json",
  "servers": [
    {
      "id": "windows-system",
      "name": "Windows System Controls",
      "transport": "stdio",
      "command": "node",
      "args": ["packages/mcp-windows/dist/index.js"],
      "enabled": true,
      "autoRestart": true,
      "maxRestarts": 3
    }
    // ─── Future examples ───────────────────────────────────────────────
    // {
    //   "id": "home-assistant",
    //   "name": "Home Assistant",
    //   "transport": "stdio",
    //   "command": "node",
    //   "args": ["packages/mcp-homeassistant/dist/index.js"],
    //   "env": { "HA_URL": "http://homeassistant.local:8123", "HA_TOKEN": "..." },
    //   "enabled": false,
    //   "autoRestart": true
    // },
    // {
    //   "id": "spotify",
    //   "name": "Spotify Controls",
    //   "transport": "stdio",
    //   "command": "npx",
    //   "args": ["-y", "@community/mcp-spotify"],
    //   "env": { "SPOTIFY_CLIENT_ID": "...", "SPOTIFY_CLIENT_SECRET": "..." },
    //   "enabled": false,
    //   "autoRestart": false
    // }
  ]
}
```

### 5.3 Server Spawn Behavior

The backend's `mcp/registry.ts` loads `mcp-servers.json` at startup:
1. Validate with `McpServersFileSchema.parse()`
2. Filter to `enabled: true` servers
3. Spawn all in parallel via `Promise.all()`
4. Each spawn: `child_process.spawn(config.command, config.args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...config.env } })`
5. Connect `@modelcontextprotocol/sdk` `Client` to each via `StdioClientTransport`
6. Call `client.listTools()` to discover available tools
7. Emit `mcp:servers-changed` on EventBus with current statuses
8. If a server crashes and `autoRestart: true`, respawn up to `maxRestarts` times with exponential backoff (1s, 2s, 4s)

---

## 6. Build & Dev Workflow

### 6.1 Prerequisites

```
node >= 22.0.0
pnpm >= 9.0.0
```

Required API keys (in `.env`):
```bash
# ── Required ──────────────────────────────────────────────────────────────
GITHUB_TOKEN=xxx                  # Copilot SDK authentication (or use `gh auth login`)

# ── Required for voice ────────────────────────────────────────────────────
PICOVOICE_ACCESS_KEY=xxx          # Picovoice Console (free tier) — for wake word

# ── Optional (graceful fallback) ──────────────────────────────────────────
ELEVENLABS_API_KEY=xxx            # ElevenLabs TTS (falls back to Piper if missing)
ELEVENLABS_VOICE_ID=xxx           # Custom voice ID (default: built-in voice)

# ── Optional (with defaults) ─────────────────────────────────────────────
SPIRA_PORT=9720                   # Backend WebSocket port
WHISPER_MODEL=base.en             # Whisper model size (tiny.en | base.en | small.en)
WAKE_WORD_MODEL=assets/wake-word/shinra.ppn  # Path to .ppn file (or "porcupine" for built-in)
```

### 6.2 Initial Setup

```bash
git clone <repo> && cd spira
pnpm install
cp .env.example .env              # Fill in API keys
pnpm run whisper:setup            # Downloads Whisper model (~150MB, one-time)
```

### 6.3 Root package.json Scripts

```jsonc
{
  "private": true,
  "scripts": {
    // ── Development ────────────────────────────────────────────────────
    "dev":              "tsx scripts/dev.ts",
    "dev:backend":      "pnpm -F @spira/backend dev",
    "dev:renderer":     "pnpm -F @spira/renderer dev",
    "dev:mcp-windows":  "pnpm -F @spira/mcp-windows dev",

    // ── Quality ────────────────────────────────────────────────────────
    "typecheck":        "tsc --build --noEmit",
    "lint":             "biome check .",
    "lint:fix":         "biome check --write .",
    "format":           "biome format --write .",
    "test":             "vitest run",
    "test:watch":       "vitest watch",

    // ── Build ──────────────────────────────────────────────────────────
    "build":            "tsx scripts/build.ts",
    "package":          "pnpm build && electron-builder --config apps/desktop/electron-builder.yml",

    // ── Utilities ──────────────────────────────────────────────────────
    "whisper:setup":    "npx nodejs-whisper download",
    "new-mcp-server":   "tsx scripts/new-mcp-server.ts"
  }
}
```

### 6.4 pnpm-workspace.yaml

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

### 6.5 Dev Startup Order (`pnpm dev`)

`scripts/dev.ts` uses `concurrently` (or raw `child_process`) to start all processes:

```
┌─────────────────────────────────────────────────────────────┐
│  1. tsc --build --watch         (type-checks all packages)  │
│  2. @spira/backend via tsx watch  (WS server on :9720)      │
│  3. @spira/renderer via vite dev  (HMR on :5173)            │
│  4. @spira/main via electron .    (loads :5173, connects     │
│                                    to :9720 via ipc-bridge)  │
└─────────────────────────────────────────────────────────────┘
```

- Backend starts first, waits for WS server to be ready
- Renderer starts independently (Vite HMR, no backend dependency for dev server)
- Electron starts last (waits for both backend and renderer to be ready)
- Backend auto-restarts on file change (via `tsx --watch`)
- Renderer has Vite HMR (instant)
- Electron reloads on main process file changes

**Standalone backend dev** (no Electron needed):
```bash
pnpm dev:backend
# Backend WS on :9720. Test with: wscat -c ws://localhost:9720
# Send: {"type":"chat:send","text":"hello"}
```

**MCP server dev** (test with MCP Inspector):
```bash
pnpm dev:mcp-windows
# Or: npx @modelcontextprotocol/inspector node packages/mcp-windows/dist/index.js
```

### 6.6 Production Build Pipeline (`pnpm build`)

`scripts/build.ts` executes in order:

```
Step 1: tsc --build                    → Type-check all packages (fail fast on errors)
Step 2: esbuild @spira/shared          → packages/shared/dist/index.js
Step 3: esbuild @spira/backend         → packages/backend/dist/index.js    (single CJS bundle, platform: node)
Step 4: esbuild @spira/mcp-windows     → packages/mcp-windows/dist/index.js (single CJS bundle, platform: node)
Step 5: vite build @spira/renderer     → packages/renderer/dist/           (static HTML/JS/CSS)
Step 6: esbuild @spira/main            → packages/main/dist/               (Electron main entry)
```

**Production packaging:**
```bash
pnpm package
# → electron-builder reads apps/desktop/electron-builder.yml
# → Rebuilds native modules (Porcupine, nodejs-whisper) for Electron's Node version
# → Outputs: dist/Spira-Setup-x.y.z.exe (NSIS installer)
```

### 6.7 tsconfig.base.json

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
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  }
}
```

**Module resolution strategy:**
- Base: `module: "Node16"` / `moduleResolution: "Node16"` — correct for all Node.js packages (backend, mcp-windows, main, shared)
- Renderer override: `moduleResolution: "bundler"` in `packages/renderer/tsconfig.json` — Vite handles resolution

### 6.8 biome.json

```jsonc
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 120
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedImports": "error",
        "noUnusedVariables": "warn"
      },
      "suspicious": {
        "noExplicitAny": "warn"
      }
    }
  },
  "files": {
    "ignore": ["**/dist/**", "**/node_modules/**", "**/*.glsl"]
  }
}
```

---

## 7. Implementation Phases

### Phase 1: Foundations (Est. 1–2 days)

**Goal:** Empty packages that compile. All tooling configured. Types defined.

**Deliverables:**
- [ ] `pnpm-workspace.yaml` with all 5 packages + `apps/desktop`
- [ ] `tsconfig.base.json` + per-package `tsconfig.json` with project references
- [ ] `biome.json` at root (linter + formatter)
- [ ] `vitest.workspace.ts` configured for all packages
- [ ] `@spira/shared` — complete type definitions:
  - `protocol.ts` (ClientMessage, ServerMessage)
  - `assistant-state.ts` (AssistantState type)
  - `chat-types.ts` (ChatMessage, ToolCallStatus)
  - `mcp-types.ts` (McpServerConfig, McpServerStatus)
  - `voice-types.ts` (VoicePipelineEvent, TranscriptionResult, OrbVisualParams)
  - `transport.ts` (ITransport interface)
  - `config-schema.ts` (Zod schemas)
- [ ] Stub `package.json` for every package with correct `name`, `dependencies`, internal `@spira/*` references
- [ ] `util/event-bus.ts` skeleton in backend (typed EventEmitter with EventMap)
- [ ] `.env.example` with all keys documented
- [ ] `scripts/dev.ts` placeholder
- [ ] `mcp-servers.json` with Windows server entry (enabled: false for now)

**Acceptance criteria:** `pnpm install && pnpm typecheck && pnpm lint` all pass. Every package can import from `@spira/shared`.

---

### Phase 2: Backend Process + Transport (Est. 3–4 days)

**Goal:** Prove the backend runs standalone, communicates over WebSocket, and Electron can manage its lifecycle.

**Deliverables:**
- [ ] `@spira/backend/src/server.ts` — WebSocket server (`ws` library) on port 9720
- [ ] `@spira/backend/src/ws-transport.ts` — ITransport implementation over WebSocket
- [ ] `@spira/backend/src/index.ts` — parse `.env`, validate config, boot EventBus, start WS server
- [ ] `@spira/backend/src/util/logger.ts` — pino with `pino-pretty` in dev
- [ ] `@spira/backend/src/util/errors.ts` — SpiraError hierarchy
- [ ] `@spira/main/src/backend-lifecycle.ts` — spawn backend as child process, health-check via WS ping, auto-restart with backoff
- [ ] `@spira/main/src/ipc-bridge.ts` — relay renderer IPC ↔ backend WebSocket
- [ ] `@spira/main/src/preload.ts` — contextBridge exposing typed `window.electronAPI`
- [ ] `@spira/main/src/window.ts` — frameless BrowserWindow (placeholder content)
- [ ] `@spira/main/src/index.ts` — app entry wiring everything together
- [ ] Integration test: `wscat -c ws://localhost:9720`, send `{"type":"chat:send","text":"hello"}`, receive echo or error

**Acceptance criteria:**
1. `pnpm dev:backend` starts a WebSocket server on :9720 that accepts connections and logs messages
2. `pnpm dev` starts Electron, which spawns the backend, shows a window, and the ipc-bridge relays messages
3. Killing the backend process triggers auto-restart (visible in main process logs)

---

### Phase 3: Copilot SDK Integration (Est. 3–5 days)

**Goal:** Validate the biggest risk — GitHub Copilot SDK session management and streaming responses work end-to-end.

**Deliverables:**
- [ ] `@spira/backend/src/copilot/session-manager.ts` — connect to Copilot, create/destroy sessions, handle auth
- [ ] `@spira/backend/src/copilot/stream-handler.ts` — receive streaming deltas, emit `chat:delta` ServerMessages via EventBus → transport
- [ ] `@spira/backend/src/copilot/tool-bridge.ts` — stub (registers placeholder tools, to be wired to MCP in Phase 4)
- [ ] Wire `chat:send` ClientMessage → Copilot session → streamed response → `chat:delta` + `chat:message` ServerMessages
- [ ] `state:change` emissions: `idle → thinking → idle` on text chat flow
- [ ] Error handling: Copilot auth failure, session timeout, network errors → `error` ServerMessage + `state:change` to `error`

**Acceptance criteria:**
1. `pnpm dev:backend`, then `wscat -c ws://localhost:9720`
2. Send `{"type":"chat:send","text":"What is 2 + 2?"}`
3. Receive streaming `chat:delta` messages followed by a final `chat:message`
4. Receive `state:change` messages: `idle → thinking`, then `thinking → idle`

**Risk note:** This phase may require iteration based on Copilot SDK API surface. If the SDK is not yet available or has breaking changes, document the gap and mock the integration layer.

---

### Phase 4: MCP Framework + mcp-windows (Est. 3–5 days)

**Goal:** The AI can control the computer. Full tool-call round-trip: Copilot → backend → MCP server → Windows → result → chat.

**Deliverables:**
- [ ] `@spira/mcp-windows/src/index.ts` — MCP Server using `@modelcontextprotocol/sdk` + `StdioServerTransport`
- [ ] `@spira/mcp-windows/src/tools/volume.ts` — `system_get_volume`, `system_set_volume`, `system_toggle_mute`
- [ ] `@spira/mcp-windows/src/tools/brightness.ts` — `system_get_brightness`, `system_set_brightness`
- [ ] `@spira/mcp-windows/src/tools/apps.ts` — `system_launch_app`, `system_close_app`, `system_list_apps`
- [ ] `@spira/mcp-windows/src/tools/power.ts` — `system_sleep`, `system_shutdown`, `system_restart`, `system_lock`
- [ ] `@spira/mcp-windows/src/tools/notifications.ts` — `system_send_notification`
- [ ] `@spira/mcp-windows/src/util/powershell.ts` — allowlisted PS command runner with timeout + input sanitization
- [ ] `@spira/mcp-windows/src/util/validation.ts` — Zod schemas for all tool inputs
- [ ] `@spira/backend/src/mcp/registry.ts` — read `mcp-servers.json`, validate, spawn enabled servers in parallel
- [ ] `@spira/backend/src/mcp/client-pool.ts` — MCP Client connections via `StdioClientTransport`
- [ ] `@spira/backend/src/mcp/tool-aggregator.ts` — merge tools from all connected servers, expose as single list
- [ ] `@spira/backend/src/copilot/tool-bridge.ts` — register aggregated MCP tools with Copilot SDK as callable tools
- [ ] Zod validation on MCP tool call inputs in `client-pool.ts` (before sending over stdio)
- [ ] `scripts/new-mcp-server.ts` — scaffold generator

**Acceptance criteria:**
1. `@spira/mcp-windows` works standalone with MCP Inspector: `npx @modelcontextprotocol/inspector node packages/mcp-windows/dist/index.js`
2. Ask Spira (via wscat) "set my volume to 50%" → Copilot calls `system_set_volume` → system volume changes → confirmation streamed back
3. `mcp:status` ServerMessage shows `windows-system` as `connected` with correct tool count
4. Invalid tool args (e.g., `system_set_volume({ level: -50 })`) are caught by Zod validation and returned as a meaningful error to Copilot for self-correction

---

### Phase 5: Voice Pipeline (Est. 4–6 days)

**Goal:** Fully hands-free interaction. Wake word → listen → transcribe → AI response → speak.

**Deliverables:**
- [ ] `voice/audio-capture.ts` — PvRecorder continuous mic capture + configurable silence detection
- [ ] `voice/wake-word.ts` — Porcupine wrapper (built-in "porcupine" keyword for dev; swap to custom "Shinra" `.ppn` when trained)
- [ ] `voice/stt-provider.ts` — ISttProvider interface
- [ ] `voice/stt.ts` — `WhisperSttProvider` using `nodejs-whisper` with `base.en` model
- [ ] `voice/tts-provider.ts` — ITtsProvider interface
- [ ] `voice/tts.ts` — `ElevenLabsTtsProvider` (chunked streaming for low latency)
- [ ] `voice/tts-piper.ts` — `PiperTtsProvider` (offline fallback, no API key needed)
- [ ] `voice/audio-playback.ts` — play PCM/MP3 to default output device
- [ ] `voice/pipeline.ts` — state machine: idle → listening → transcribing → thinking → speaking → idle
  - Wire to EventBus for all state transitions
  - `audio:level` events emitted at ~30Hz during capture
  - `tts:amplitude` events emitted during TTS playback
  - Error recovery: timeout to idle after 30s, retry on transient errors
- [ ] `voice:toggle` and `voice:push-to-talk` ClientMessage handling
- [ ] `voice:transcript` ServerMessage when STT completes (so renderer can show what was heard)
- [ ] Silence detection tuning (configurable threshold + minimum speech duration)

**Acceptance criteria:**
1. Say "Porcupine" (or configured wake word) → backend logs wake detection, emits `state:change` to `listening`
2. Speak a command → silence detected → STT runs → `state:change` to `transcribing` → `thinking`
3. Copilot processes → TTS plays response → `state:change` through `speaking` → `idle`
4. Full round-trip: "Set my volume to 30%" works entirely hands-free
5. Push-to-talk (hold spacebar via `voice:push-to-talk` message) works as alternative to wake word
6. `audio:level` events stream to frontend at ~30Hz during `listening` state
7. `tts:amplitude` events stream to frontend during `speaking` state

**Voice module boundary check:** At PR review, verify that no file in `voice/` imports from `copilot/` or `mcp/`. All inter-subsystem communication goes through EventBus.

---

### Phase 6: UI + Visual Shell (Est. 4–6 days)

**Goal:** The app looks and feels like the FFX/X-2 Shinra aesthetic. Orb is alive.

**Deliverables:**
- [ ] `@spira/renderer` — Vite + React 19 + TypeScript scaffolding
- [ ] FFX theme tokens (`tokens.ts`): navy `#0a0e27`, teal `#00d4aa`, cyan `#00e5ff`, gold `#cc9900`, etc.
- [ ] `global.css` — CSS reset, root variables, font imports
- [ ] `AppShell.tsx` — CSS Grid layout (orb area + chat + sidebar)
- [ ] `TitleBar.tsx` — custom frameless title bar with window controls
- [ ] `GlassPanel.tsx` — frosted-glass card component (used throughout)
- [ ] `ChatPanel.tsx` + `MessageBubble.tsx` + `InputBar.tsx` + `StreamingText.tsx` + `ToolCallCard.tsx`
- [ ] `chat-store.ts` + `assistant-store.ts` + `mcp-store.ts` + `settings-store.ts` (Zustand)
- [ ] `useIpc.ts` + `useChat.ts` + `useAssistantState.ts` + `useAudioLevel.ts` + `useTtsAmplitude.ts` hooks
- [ ] `ShinraOrb.tsx` — @react-three/fiber canvas with:
  - Icosphere mesh + custom GLSL shader (plasma/energy glow)
  - Orbiting particle system
  - `orb-animations.ts` state-driven params with smooth lerp transitions
  - `audio:level` uniform for listening state
  - `tts:amplitude` uniform for speaking state
  - Performance target: 60fps on integrated GPU
- [ ] `VoiceIndicator.tsx` — mic state + level bar
- [ ] `McpStatus.tsx` — connected servers + tool count in sidebar
- [ ] `ConnectionDot.tsx` — backend health indicator
- [ ] `Sidebar.tsx` — navigation (chat, settings, MCP servers)
- [ ] `SettingsPanel.tsx` — API keys, voice options, TTS provider toggle, MCP server enable/disable
- [ ] Framer Motion transitions (chat panel slide, status fade, orb state transitions)
- [ ] `scripts/dev.ts` fully wired (backend + vite + electron concurrent)

**Acceptance criteria:**
1. `pnpm dev` opens a dark-themed Electron window with the orb, chat panel, and sidebar
2. Text chat works end-to-end with streaming text reveal
3. Tool calls show inline with name, args, and result
4. Orb animates through all 6 AssistantState values with correct colors and behaviors
5. During voice interaction, orb responds to `audio:level` (listening) and `tts:amplitude` (speaking)
6. Settings panel allows toggling voice, changing TTS provider, enabling/disabling MCP servers
7. MCP status shows connected servers with tool counts
8. 60fps on integrated GPU (measure with Chrome DevTools Performance tab in Electron)

---

### Phase 7: Polish + Ops (Est. 2–3 days)

**Goal:** Production-ready installer. Robust error handling. Clean shutdown.

**Deliverables:**
- [ ] Error handling audit: every `await` has a catch, every failure surfaces to user
- [ ] Voice pipeline recovery: configurable timeout to idle, retry with backoff on transient errors
- [ ] Backend crash recovery: main process shows "Reconnecting..." overlay, auto-restarts backend
- [ ] Graceful shutdown: Electron quit → close WS → stop MCP servers → stop voice capture → exit
- [ ] `settings-store.ts` persisted via `electron-store`
- [ ] System tray (`tray.ts`): toggle window, mute mic, quit
- [ ] `auto-update.ts` — electron-updater integration
- [ ] `apps/desktop/electron-builder.yml` — NSIS installer config, native module rebuild for Porcupine + nodejs-whisper
- [ ] Custom "Shinra" Porcupine wake word model (from Picovoice Console)
- [ ] Structured logging: pino JSON logs in production, pino-pretty in dev
- [ ] Memory + CPU profiling: idle target <100MB RSS, <2% CPU
- [ ] `pnpm build && pnpm package` produces working `.exe` installer
- [ ] README with full setup instructions

**Acceptance criteria:**
1. `pnpm package` produces `dist/Spira-Setup-x.y.z.exe`
2. Clean install on a fresh Windows 10/11 machine works end-to-end (text + voice + tools)
3. Killing backend process from Task Manager triggers visible reconnection in UI, then auto-recovery
4. App uses <100MB RSS and <2% CPU when idle
5. Tray icon works (toggle window, mute mic, quit)
6. Settings persist across app restarts

---

## 8. Technology Choices Table

| Category | Choice | Rationale |
|----------|--------|-----------|
| **Runtime** | Node.js ≥ 22 | LTS, native ESM, required for Electron |
| **Package manager** | pnpm 9+ | Strict dependency resolution, workspace support, fast |
| **Language** | TypeScript 5.x (strict mode) | Non-negotiable for a project of this complexity |
| **Monorepo** | pnpm workspaces + `tsc --build` | Simple, no extra tooling (no Nx/Turborepo). `tsc --build` handles project references. |
| **Linter/Formatter** | Biome | Single tool replaces ESLint + Prettier. Faster. Fewer configs. |
| **Test framework** | Vitest | Jest-compatible API, native ESM, workspace-aware, fast |
| **Desktop shell** | Electron | Required for Windows desktop app. Frameless window, tray, native module support. |
| **Electron packaging** | electron-builder | First-class native module rebuild support (needed for Porcupine, nodejs-whisper). NSIS installer. |
| **Backend server** | `ws` (WebSocket library) | Lightweight, well-maintained, no framework overhead. Backend is a WS server, not HTTP. |
| **AI engine** | `@github/copilot-sdk` | Core project requirement. Copilot for LLM, tool calling, streaming. |
| **MCP SDK** | `@modelcontextprotocol/sdk` | Official SDK. Used directly — no wrapper. Spec-compliant stdio transport. |
| **UI framework** | React 19 | Ecosystem, devtools, Three.js integration via @react-three/fiber |
| **UI bundler** | Vite | Instant HMR, React plugin, modern defaults |
| **State management** | Zustand | Selective subscriptions (critical for 30Hz audio events), minimal boilerplate, excellent TS inference |
| **3D rendering** | Three.js via @react-three/fiber + @react-three/drei | React-integrated Three.js. Declarative scene graph. postprocessing for bloom. |
| **CSS approach** | CSS Modules + design tokens in `tokens.ts` | Simple, scoped, no runtime cost. Tokens give TS autocomplete for theme values. |
| **Animations** | Framer Motion (UI) + GLSL shaders (orb) | Framer for layout transitions. Raw GLSL for orb performance (no abstraction layer). |
| **Node bundler** | esbuild (direct) | Single-file CJS bundles for backend + MCP servers. No tsup wrapper — fewer abstractions. |
| **Module resolution** | Node16 (base) / bundler (renderer) | Node16 is correct for Node packages. Renderer overrides to bundler for Vite compatibility. |
| **Wake word** | Porcupine (Picovoice) | Best-in-class local wake word. Free tier. Custom keyword training. Node.js bindings. |
| **STT** | nodejs-whisper (whisper.cpp) | Local, no Python dependency, `base.en` model runs on CPU in <2s. |
| **TTS (primary)** | ElevenLabs REST API (streaming) | High-quality voices. Streaming API for low-latency first-chunk playback. |
| **TTS (fallback)** | Piper TTS | Fully local, free, fast. Ensures app works without API keys or internet. |
| **Logging** | pino + pino-pretty | Structured JSON in prod, human-readable in dev. Fast. |
| **Validation** | Zod | Runtime schema validation at MCP boundary. Infers TS types from schemas. |
| **TS config** | `composite: true` + project references | Enables `tsc --build` incremental compilation across packages |

---

## Appendix A: HA Migration Path

When ready to move the backend to Home Assistant:

1. Deploy `@spira/backend` on the HA host (Node.js addon, Docker container, or standalone)
2. Point a web frontend (or a thin native client) at `ws://<ha-host>:9720`
3. `@spira/main` and `@spira/renderer` are replaced or adapted — the backend is untouched
4. `@spira/mcp-windows` stays on the Windows machine as a remote MCP server (change transport from `stdio` to `sse` in `mcp-servers.json`)
5. Voice can optionally stay local: Porcupine + Whisper run on the Windows machine, transcription is sent to the remote backend as a `chat:send` message

The WebSocket-always architecture means the standalone path is the *only* path — it's battle-tested from day one.

---

## Appendix B: FFX Theme Reference Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `bg.primary` | `#0a0e27` | Main background (deep navy) |
| `bg.secondary` | `#111638` | Card/panel backgrounds |
| `bg.glass` | `rgba(16, 22, 56, 0.7)` | Frosted glass panels |
| `accent.teal` | `#00d4aa` | Primary accent, orb idle glow |
| `accent.cyan` | `#00e5ff` | Secondary accent, orb listening |
| `accent.gold` | `#cc9900` | Orb thinking state |
| `text.primary` | `#e8eaf6` | Main text |
| `text.secondary` | `#7986cb` | Muted text |
| `error` | `#ff5252` | Error states |
| `border.glow` | `rgba(0, 212, 170, 0.3)` | Subtle glowing borders |

---

*This is the definitive plan. Build it.*
