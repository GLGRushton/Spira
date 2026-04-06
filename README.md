# Spira — Architecture Plan

> **Status**: Pre-implementation design document. To be reviewed and merged with input from other AI models before work begins.

---

## 1. Executive Summary

Spira is a GitHub Copilot-powered desktop AI assistant with voice control, a Three.js animated orb UI, and extensible tool integrations via MCP servers. It runs as an Electron app on Windows today, but the backend must be extractable to run standalone (e.g. on Home Assistant) without changing the AI logic.

The central architectural principle is a **hard seam at the transport boundary**: the backend never imports from Electron, the renderer never imports from Node, and both sides communicate only through typed IPC contracts defined in a shared package.

---

## 2. Full Directory Structure

```
spira/
├── packages/
│   ├── shared/                         # @spira/shared — zero-dep types only
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── ipc.ts              # IpcChannel enum + IpcMessage<T> envelope
│   │   │   │   ├── copilot.ts          # CopilotMessage, SessionState, ToolCall
│   │   │   │   ├── voice.ts            # VoiceState union, VoiceEvent, TranscriptionResult
│   │   │   │   └── mcp.ts              # McpServerManifest, McpToolDefinition, McpToolCall/Result
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── renderer/                       # @spira/renderer — React UI (sandboxed, no Node)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── App.tsx
│   │   │   │   └── routes.tsx
│   │   │   ├── components/
│   │   │   │   ├── orb/
│   │   │   │   │   ├── ShinraOrb.tsx           # React wrapper, owns canvas lifecycle
│   │   │   │   │   ├── OrbScene.ts             # Three.js scene, camera, renderer setup
│   │   │   │   │   ├── OrbStateMachine.ts      # Maps VoiceState → visual parameters
│   │   │   │   │   └── shaders/
│   │   │   │   │       ├── orb.vert.glsl
│   │   │   │   │       └── orb.frag.glsl       # Animated plasma/energy field effect
│   │   │   │   ├── chat/
│   │   │   │   │   ├── ChatWindow.tsx
│   │   │   │   │   ├── MessageBubble.tsx
│   │   │   │   │   └── StreamingText.tsx       # Renders streaming token-by-token
│   │   │   │   ├── toolbar/
│   │   │   │   │   ├── StatusBar.tsx           # Active MCP servers, mic status
│   │   │   │   │   └── SettingsPanel.tsx
│   │   │   │   └── layout/
│   │   │   │       ├── MainLayout.tsx
│   │   │   │       └── GlassPanel.tsx          # Reusable glass-morphism card
│   │   │   ├── hooks/
│   │   │   │   ├── useCopilotStream.ts         # Subscribes to streaming response events
│   │   │   │   ├── useVoiceState.ts            # Subscribes to voice pipeline state
│   │   │   │   └── useIpc.ts                   # Typed IPC send/subscribe primitives
│   │   │   ├── store/
│   │   │   │   ├── chatStore.ts                # Zustand: message history, streaming state
│   │   │   │   ├── voiceStore.ts               # Zustand: current VoiceState
│   │   │   │   └── settingsStore.ts            # Zustand: user preferences (persisted)
│   │   │   ├── ipc/
│   │   │   │   └── bridge.ts                   # Typed wrapper over window.electronAPI
│   │   │   └── styles/
│   │   │       ├── theme.ts                    # Design tokens: colors, radii, fonts
│   │   │       ├── animations.ts               # Framer Motion variants
│   │   │       └── global.css
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── main/                           # @spira/main — Electron main process + IPC bridge
│   │   ├── src/
│   │   │   ├── main.ts                 # Entry point: creates window, starts backend
│   │   │   ├── window/
│   │   │   │   ├── WindowManager.ts    # Frameless window, tray icon, always-on-top
│   │   │   │   └── preload.ts          # contextBridge: exposes electronAPI to renderer
│   │   │   └── ipc/
│   │   │       ├── IpcRouter.ts        # Maps IpcChannel values to backend method calls
│   │   │       └── ElectronIpcTransport.ts  # Implements ITransport over ipcMain/ipcRenderer
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── backend/                        # @spira/backend — AI brain (runs without Electron)
│   │   ├── src/
│   │   │   ├── electron-entry.ts       # Module entry when loaded in-process by Electron main
│   │   │   ├── standalone-entry.ts     # HTTP/WebSocket entry for HA / dev-standalone mode
│   │   │   ├── copilot/
│   │   │   │   ├── CopilotAgent.ts     # Manages @github/copilot-sdk session lifecycle
│   │   │   │   ├── ToolRouter.ts       # Routes tool_call events from SDK → McpManager
│   │   │   │   └── StreamHandler.ts    # Assembles streaming chunks, emits to transport
│   │   │   ├── mcp/
│   │   │   │   └── McpManager.ts       # Loads IMcpServer instances, routes tool invocations
│   │   │   ├── voice/
│   │   │   │   └── VoicePipelineOrchestrator.ts  # wake → STT → CopilotAgent → TTS
│   │   │   ├── transport/
│   │   │   │   ├── ITransport.ts                 # Contract: send<T>/on<T>/off
│   │   │   │   ├── ElectronIpcTransport.ts        # IPC impl (Electron mode)
│   │   │   │   └── WebSocketTransport.ts          # WS impl (standalone / HA mode)
│   │   │   └── config/
│   │   │       └── AppConfig.ts        # Loads env vars + config file, validates with Zod
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── voice/                          # @spira/voice — Voice pipeline components
│   │   ├── src/
│   │   │   ├── wake-word/
│   │   │   │   ├── WakeWordDetector.ts          # Porcupine wrapper
│   │   │   │   └── AudioCaptureWorker.ts        # worker_threads worker: continuous mic read
│   │   │   ├── stt/
│   │   │   │   ├── ISttProvider.ts              # Interface: transcribe(audioBuffer) → TranscriptionResult
│   │   │   │   └── WhisperSttProvider.ts        # nodejs-whisper (whisper.cpp binding)
│   │   │   ├── tts/
│   │   │   │   ├── ITtsProvider.ts              # Interface: synthesize(text) → AudioBuffer
│   │   │   │   ├── ElevenLabsTtsProvider.ts     # ElevenLabs REST API
│   │   │   │   └── PiperTtsProvider.ts          # Local Piper TTS (offline fallback)
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── mcp-core/                       # @spira/mcp-core — MCP plugin framework
│   │   ├── src/
│   │   │   ├── interfaces/
│   │   │   │   ├── IMcpServer.ts       # Base interface every MCP server implements
│   │   │   │   └── IMcpTool.ts         # Tool definition + strongly-typed handler
│   │   │   ├── registry/
│   │   │   │   └── McpRegistry.ts      # register(server)/invoke(call)/listTools()
│   │   │   ├── base/
│   │   │   │   └── BaseMcpServer.ts    # Abstract class: declarative tool registration
│   │   │   └── validation/
│   │   │       └── ToolInputValidator.ts  # Zod-based schema validation for all tool calls
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── mcp-windows/                    # @spira/mcp-windows — Windows system controls
│       ├── src/
│       │   ├── WindowsMcpServer.ts     # Server entry: registers all Windows tools
│       │   ├── tools/
│       │   │   ├── volume.ts           # GetVolume, SetVolume, ToggleMute
│       │   │   ├── display.ts          # GetBrightness, SetBrightness, ListDisplays
│       │   │   ├── power.ts            # Sleep, Shutdown, Restart, LockScreen
│       │   │   ├── apps.ts             # LaunchApp, CloseApp, ListRunningApps
│       │   │   └── notifications.ts    # SendToast (Windows Action Center)
│       │   └── utils/
│       │       └── powershell.ts       # exec helper: runs PS1 snippets, returns typed output
│       ├── package.json
│       └── tsconfig.json
│
├── apps/
│   └── desktop/                        # Electron app assembly + packaging config
│       ├── electron-builder.config.ts  # Installer config, native module rebuilds
│       └── package.json
│
├── scripts/
│   ├── dev.ts                          # Concurrent: vite dev + tsc watch + electron
│   └── scaffold-mcp.ts                 # CLI: generates a new mcp-* package skeleton
│
├── pnpm-workspace.yaml
├── package.json                        # Root: workspace scripts, shared devDeps
├── tsconfig.base.json                  # Shared TS compiler options (strict, paths)
├── .eslintrc.cjs
└── .env.example
```

---

## 3. Package Responsibilities

### `@spira/shared`
**Owns**: TypeScript interfaces and enums that cross the IPC serialization boundary (renderer ↔ main ↔ backend). Pure types — no runtime code, no imports.  
**Does NOT own**: Any implementation. No class instances, no functions. If it has a runtime dependency, it's in the wrong package.  
**Rationale**: IPC messages are serialized. Both sides of the wire must agree on shape without a circular dependency.

---

### `@spira/renderer`
**Owns**: All React components, Three.js orb, Zustand stores, Framer Motion animations, the FFX theme, and the `bridge.ts` wrapper over `window.electronAPI`.  
**Does NOT own**: Any Node.js APIs. No `fs`, no `child_process`, no direct Copilot SDK calls. Receives all data through `window.electronAPI` (the contextBridge).  
**Key constraint**: `nodeIntegration: false`, `contextIsolation: true` — enforced. The renderer is treated as an untrusted browser page.

---

### `@spira/main`
**Owns**: Electron window lifecycle, tray icon, frameless window config, the preload script (contextBridge definition), and IPC routing logic that proxies channels between renderer and backend.  
**Does NOT own**: AI logic, voice processing, MCP tool execution. It is a thin bridge.  
**Rationale**: Keeping main thin means Electron is swappable. If we move to a web frontend, we replace `@spira/main` with an HTTP server — the backend is untouched.

---

### `@spira/backend`
**Owns**: Copilot SDK session management, tool call routing, MCP server loading, voice pipeline orchestration, and transport abstraction.  
**Does NOT own**: Electron APIs (no `ipcMain` imports — those live in the `ElectronIpcTransport` which is injected). No UI state.  
**Two entry points**: `electron-entry.ts` loads the backend as a module inside the main process (simple, good for v1). `standalone-entry.ts` starts a WebSocket server for HA/headless operation.

---

### `@spira/voice`
**Owns**: Wake word detection (Porcupine), speech-to-text (Whisper), text-to-speech (ElevenLabs/Piper), and audio capture worker.  
**Does NOT own**: The orchestration loop that connects them — that lives in `VoicePipelineOrchestrator.ts` in `@spira/backend`. Voice is a library of pipeline components, not a pipeline itself.  
**Rationale**: Voice components are independently testable (you can test STT accuracy without running Copilot). The backend owns the sequence; voice owns the capabilities.

---

### `@spira/mcp-core`
**Owns**: `IMcpServer` interface, `McpRegistry`, `BaseMcpServer` abstract class, and Zod-based input validation.  
**Does NOT own**: Any domain-specific tools. No Windows APIs, no Home Assistant calls.  
**The plugin contract**: Any package exporting a class that implements `IMcpServer` is a valid MCP server. The registry does not care where it came from.

---

### `@spira/mcp-windows`
**Owns**: Windows system control tools implemented via PowerShell and Win32 APIs.  
**Does NOT own**: The registry. It registers itself when instantiated; it doesn't know about other servers.

---

## 4. Key TypeScript Interfaces

```typescript
// ─── @spira/shared/types/mcp.ts ───────────────────────────────────────────

export interface McpServerManifest {
  id: string;           // "windows-system" — unique, stable, used for routing
  name: string;         // "Windows System Controls" — human readable
  version: string;
  domain: string;       // "system" | "media" | "home" | "browser" etc.
  tools: McpToolDefinition[];
}

export interface McpToolDefinition {
  name: string;         // "SetVolume" — unique within the server
  description: string;  // Fed verbatim to the Copilot system prompt
  inputSchema: Record<string, unknown>;  // JSON Schema object
}

export interface McpToolCall {
  callId: string;       // Correlation ID for async results
  serverId: string;
  toolName: string;
  parameters: Record<string, unknown>;
}

export interface McpToolResult {
  callId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}


// ─── @spira/mcp-core/interfaces/IMcpServer.ts ─────────────────────────────

import type { McpServerManifest, McpToolCall, McpToolResult } from '@spira/shared';

export interface IMcpServer {
  readonly manifest: McpServerManifest;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  invokeTool(call: McpToolCall): Promise<McpToolResult>;
}


// ─── @spira/shared/types/voice.ts ─────────────────────────────────────────

export type VoiceState =
  | 'idle'
  | 'wake-detected'
  | 'listening'
  | 'transcribing'
  | 'thinking'        // Copilot is streaming
  | 'speaking'        // TTS is playing
  | 'error';

export interface VoiceEvent {
  type: 'state-change' | 'transcription-ready' | 'utterance-start' | 'utterance-end';
  state?: VoiceState;
  transcription?: string;
  errorMessage?: string;
}

export interface TranscriptionResult {
  text: string;
  confidence: number;
  durationMs: number;
}


// ─── @spira/shared/types/copilot.ts ───────────────────────────────────────

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolName?: string;   // Populated when role === 'tool'
  isStreaming?: boolean;
}

export interface CopilotStreamChunk {
  messageId: string;
  delta: string;
  isDone: boolean;
}


// ─── @spira/shared/types/ipc.ts ───────────────────────────────────────────

export const IpcChannel = {
  // Renderer → Backend (via main)
  SEND_MESSAGE:         'copilot:send-message',
  VOICE_TOGGLE:         'voice:toggle',
  MCP_LIST_SERVERS:     'mcp:list-servers',
  SETTINGS_UPDATE:      'settings:update',

  // Backend → Renderer (via main)
  COPILOT_STREAM_CHUNK: 'copilot:stream-chunk',
  COPILOT_STREAM_END:   'copilot:stream-end',
  VOICE_STATE_CHANGE:   'voice:state-change',
  MCP_TOOL_EXECUTING:   'mcp:tool-executing',
  MCP_TOOL_RESULT:      'mcp:tool-result',
  ERROR:                'app:error',
} as const;

export type IpcChannelKey = keyof typeof IpcChannel;
export type IpcChannelValue = typeof IpcChannel[IpcChannelKey];


// ─── @spira/backend/transport/ITransport.ts ───────────────────────────────

export interface ITransport {
  /** Send a typed event to the frontend */
  send<T>(channel: string, payload: T): void;
  /** Subscribe to typed events from the frontend. Returns unsubscribe fn. */
  on<T>(channel: string, handler: (payload: T) => void): () => void;
}


// ─── @spira/voice/stt/ISttProvider.ts ─────────────────────────────────────

export interface ISttProvider {
  readonly modelName: string;
  transcribe(audioBuffer: Buffer, sampleRate: number): Promise<TranscriptionResult>;
}


// ─── @spira/voice/tts/ITtsProvider.ts ─────────────────────────────────────

export interface ITtsProvider {
  readonly voiceId: string;
  synthesize(text: string): Promise<Buffer>;  // Returns PCM audio buffer
}
```

---

## 5. Orb Visual State Machine

The `OrbStateMachine` in the renderer maps `VoiceState` to Three.js shader parameters. The orb reacts visually without any AI knowledge — it only reads `VoiceState` from the Zustand `voiceStore`.

| VoiceState       | Orb Behaviour                                              |
|------------------|------------------------------------------------------------|
| `idle`           | Slow pulse, deep navy/teal, low emission                   |
| `wake-detected`  | Sharp brightness spike, cyan flash                         |
| `listening`      | Waveform distortion on surface, active teal glow           |
| `transcribing`   | Rotation speed increase, inner sphere brightens            |
| `thinking`       | Geometric pattern animation, gold/amber tones              |
| `speaking`       | Outward ripple pulses timed to TTS audio amplitude         |
| `error`          | Red desaturated pulse, slow decay back to idle             |

The orb shader accepts four uniforms: `uState` (int), `uTime` (float), `uAmplitude` (float for TTS sync), `uPulse` (float for wake spike). The `OrbStateMachine` drives these each animation frame.

---

## 6. Build & Dev Workflow

### Dev mode
```bash
pnpm dev
```
This runs `scripts/dev.ts` (via `tsx`) which concurrently starts:
1. `vite` dev server for `@spira/renderer` (HMR on port 5173)
2. `tsc --watch` for `@spira/backend`, `@spira/voice`, `@spira/mcp-*` packages
3. `electron .` with `ELECTRON_DEV=true` (main process watches for tsc output changes via nodemon)

The renderer dev server is loaded by Electron via `loadURL('http://localhost:5173')` when `ELECTRON_DEV=true`.

### Backend standalone (for testing without Electron)
```bash
pnpm --filter @spira/backend dev:standalone
```
Starts the WebSocket transport on port 8765. Connect with any WS client to simulate the frontend.

### Production build
```bash
pnpm build          # Compiles all packages in dependency order
pnpm package        # electron-builder: packages to dist/
```

### Adding a new MCP server
```bash
pnpm scaffold-mcp --name spotify --domain media
```
`scripts/scaffold-mcp.ts` generates `packages/mcp-spotify/` with boilerplate, registers it in `pnpm-workspace.yaml`, and adds an import to `McpManager.ts`.

### Key `tsconfig.base.json` settings
```json
{
  "compilerOptions": {
    "strict": true,
    "moduleResolution": "bundler",
    "target": "ES2022",
    "lib": ["ES2022"],
    "declaration": true,
    "paths": {
      "@spira/shared": ["../shared/src/index.ts"],
      "@spira/mcp-core": ["../mcp-core/src/index.ts"],
      "@spira/voice": ["../voice/src/index.ts"]
    }
  }
}
```

---

## 7. Implementation Phases

### Phase 1 — Foundations (No Electron yet)
**Goal**: Prove the MCP plugin pattern works end-to-end.
1. pnpm workspace, `tsconfig.base.json`, ESLint with `@typescript-eslint`
2. `@spira/shared` — all types, zero runtime code
3. `@spira/mcp-core` — `IMcpServer`, `McpRegistry`, `BaseMcpServer`, Zod validation
4. `@spira/mcp-windows` — `SetVolume` and `GetVolume` as the first two working tools
5. Unit tests: registry routing, tool input validation, error handling

**Exit criteria**: `McpRegistry.invoke({ serverId: 'windows-system', toolName: 'SetVolume', ... })` changes the system volume.

---

### Phase 2 — Backend Standalone
**Goal**: Full AI conversation loop without Electron.
1. `@spira/backend` with `CopilotAgent`, `ToolRouter`, `McpManager`, `WebSocketTransport`
2. Wire `@github/copilot-sdk` session creation and streaming
3. Tool calls from Copilot route through `McpManager` → `mcp-windows`
4. `standalone-entry.ts` — test with `wscat` or a simple HTML page

**Exit criteria**: "Set my volume to 50%" via WebSocket triggers the Windows volume change, response streams back.

---

### Phase 3 — Electron Shell
**Goal**: Working desktop app with text chat.
1. `@spira/main` — `WindowManager` (frameless, 800×600 default), `preload.ts`, `IpcRouter`
2. `ElectronIpcTransport` — connects `ipcMain` to backend `ITransport`
3. `@spira/renderer` — `ChatWindow`, `MessageBubble`, `StreamingText`, `useIpc` hook
4. Basic FFX dark theme (no orb yet — placeholder circle)

**Exit criteria**: Type "set volume to 30%" in the chat UI, hear the system volume change, see the streamed response.

---

### Phase 4 — Voice Pipeline
**Goal**: Hands-free interaction.
1. `@spira/voice` — `WhisperSttProvider` (small model), `ElevenLabsTtsProvider`, `WakeWordDetector`
2. `AudioCaptureWorker` (worker_threads) — continuous mic capture without blocking
3. `VoicePipelineOrchestrator` — state machine: idle → wake → STT → Copilot → TTS → idle
4. Voice state events flow through `ITransport` to renderer's `voiceStore`
5. Use "porcupine" built-in keyword during dev; swap to custom "Shinra" model when trained

**Exit criteria**: Say "Porcupine" → orb reacts → speak a command → system responds with Shinra voice.

---

### Phase 5 — Shinra Orb
**Goal**: The UI becomes the centrepiece.
1. Three.js scene in `ShinraOrb.tsx` — sphere geometry with custom GLSL shader
2. `OrbStateMachine` — maps `VoiceState` to shader uniforms per animation frame
3. TTS audio analysis (Web Audio API) feeds `uAmplitude` uniform for lip-sync effect
4. FFX Art Nouveau geometric border overlay (SVG, CSS `clip-path`)
5. Framer Motion transitions for chat window slide-in/slide-out

**Exit criteria**: Full visual pipeline — orb glows on wake, pulses on speech, animates while thinking.

---

### Phase 6 — Hardening & Additional MCP Servers
**Goal**: Production-ready.
1. All remaining `mcp-windows` tools (display, power, apps, notifications)
2. `SettingsPanel` — configure API keys, voice settings, MCP server enable/disable
3. `settingsStore` persisted to `electron-store`
4. Error recovery in voice pipeline (timeout back to idle, visual error state)
5. `electron-builder` packaging — NSIS installer, native module rebuilds for Porcupine/Whisper
6. Custom "Shinra" Porcupine keyword model from Picovoice Console

---

## 8. Key Technical Decisions

### Decision 1: Separate `@spira/voice` package
The voice pipeline is complex, has its own test surface (transcription accuracy, latency), and should not be entangled with Copilot logic. When Spira moves to Home Assistant, voice can stay local on the Windows machine while the AI runs remotely. This split enables that topology.

### Decision 2: Backend runs in-process in Electron main (not a child process)
Loading `@spira/backend` as a module in the Electron main process is simpler for v1: shared memory, no serialization overhead, easier debugging. The `ITransport` abstraction ensures this decision is reversible — swap `ElectronIpcTransport` for `ChildProcessTransport` if needed later.

### Decision 3: `nodejs-whisper` (whisper.cpp binding) over Python subprocess
Avoids the Python runtime as a Windows dependency. `nodejs-whisper` wraps whisper.cpp as a native Node addon. Tradeoff: fewer model options than Python Whisper, but `whisper-small` (244M params) is sufficient for assistant commands and runs on CPU in < 2s.

### Decision 4: Zod validation at the MCP registry boundary
All tool calls originate from an LLM, which can produce malformed parameters. Zod validates against the tool's `inputSchema` before the tool handler is ever called. This protects Windows system tools (you don't want `SetBrightness(-999)` reaching the Win32 API) and gives meaningful error messages back to the LLM for self-correction.

### Decision 5: Zustand over Redux or React Context for renderer state
Voice state changes at high frequency (many events/second during active conversation). Context API triggers full subtree re-renders. Zustand uses selective subscriptions — `useVoiceState()` only re-renders components that subscribe to voice, not the entire app. No boilerplate, excellent TypeScript inference.

### Decision 6: Vite for renderer, `tsup` for Node packages
Vite gives instant HMR for the UI. `tsup` (esbuild-based) gives fast CJS+ESM dual output for Node packages with correct sourcemaps. `tsc` alone for Node packages is slow and doesn't bundle — `tsup` handles both.

### Decision 7: MCP servers as loaded modules, not child processes
The MCP spec assumes subprocess communication (stdio/JSON-RPC), but loading servers as modules is 100× faster, simpler to debug, and shares the Node process for resource efficiency. The `IMcpServer` interface can be adapted to a subprocess adapter later with no changes to tool implementations.

### Decision 8: `electron-builder` over `electron-forge`
`electron-builder` has first-class support for rebuilding native modules (`--node-gyp`) against Electron's Node version. Both Porcupine and Whisper native addons require this. `electron-forge` can do it but requires more configuration for non-standard native modules.

### Decision 9: `PiperTtsProvider` as offline fallback
ElevenLabs costs per character. Add `PiperTtsProvider` (fully local, fast, free) as the offline fallback. The `ITtsProvider` interface makes this a config switch. Users with no ElevenLabs key get a functional (if less spectacular) experience.

### Decision 10: Custom "Shinra" wake word requires Picovoice Console
The Picovoice Console (free tier) allows training custom keyword models. Until the custom model is trained, the system ships with the "porcupine" built-in keyword. `WakeWordDetector` accepts a `modelPath` config option — swap the `.ppn` file to change the keyword with no code change.

---

## 9. What I Would Change from the Proposed Stack

| Proposed | Changed To | Reason |
|---|---|---|
| `packages/main` handles voice | Separate `packages/voice` | Voice is independently testable and deployable |
| No shared types package | `packages/shared` is mandatory | IPC boundary requires a serialization contract |
| Single backend entry | Two entries (electron + standalone) | Future HA migration requires standalone mode from day one |
| No mention of validation | Zod in `mcp-core` | LLM-generated tool calls must be validated before execution |
| No offline TTS fallback | `PiperTtsProvider` added | ElevenLabs dependency makes offline use impossible |

---

## 10. Migration Path to Home Assistant

When ready to move the backend to HA:

1. Deploy `@spira/backend` with `standalone-entry.ts` on the HA host (Node.js addon or Docker)
2. Replace `ElectronIpcTransport` in `@spira/main` with `WebSocketTransport` pointing at the HA host
3. No changes to `@spira/backend`, `@spira/voice`, or any MCP server
4. Voice can optionally stay local (Porcupine + Whisper run on the Windows machine, only the Copilot call goes to HA) — `VoicePipelineOrchestrator` supports this via a `remoteTranscription: false` config flag

The transport abstraction is the entire migration — one line in the Electron main process.
