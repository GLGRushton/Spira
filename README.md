# Spira

> A GitHub Copilot-powered AI assistant with a Final Fantasy X/X-2 aesthetic, voice control, and extensible MCP integrations.

## Features
- 🤖 GitHub Copilot AI (streaming, tool-calling)
- 🎙️ Voice control with wake word "Shinra" (Porcupine + Whisper STT + ElevenLabs TTS)
- 🖥️ Windows system control via MCP (volume, brightness, apps, power, notifications)
- ✨ FFX/X-2 themed UI with living orb visualisation
- 🔌 Extensible MCP server framework

## Prerequisites
- Node.js ≥ 22
- pnpm ≥ 9
- Windows 10/11 (for mcp-windows features)
- GitHub Copilot access (CLI must be installed and authenticated)

## Setup

1. Clone the repo
2. `pnpm install`
3. Copy `.env.example` to `.env` and fill in:
   - `GITHUB_TOKEN` — GitHub personal access token with Copilot access
   - `PICOVOICE_ACCESS_KEY` — From [Picovoice Console](https://console.picovoice.ai/) (free tier)
   - `ELEVENLABS_API_KEY` — From [ElevenLabs](https://elevenlabs.io/) (optional, enables high-quality TTS)
   - `ELEVENLABS_VOICE_ID` — Voice ID from ElevenLabs dashboard

## Development

```bash
pnpm dev          # Start backend + renderer + Electron concurrently
pnpm typecheck    # Type check all packages
pnpm lint         # Lint all packages
pnpm test         # Run tests
```

## Building

```bash
pnpm build        # Compile all packages
pnpm package      # Build Electron installer (outputs to dist/)
```

## Adding a new MCP server

```bash
pnpm new-mcp-server my-server-name
```

This scaffolds a new `packages/mcp-my-server-name/` package. Implement your tools in `src/tools/`, then add the server to `mcp-servers.json` with `enabled: true`.

## Architecture

See [PLAN.md](./PLAN.md) for the full architecture document.

### Key concepts
- **Backend** always runs as a child process of Electron main, communicating over WebSocket (port 9720)
- **MCP servers** run as stdio child processes spawned by the backend
- **EventBus** is the internal nervous system — subsystems never import each other directly
- **Voice pipeline** is entirely self-contained; all integration via EventBus

### Package structure
```
apps/desktop/          Electron packager config
packages/
  shared/              Protocol types, shared interfaces
  backend/             Node.js backend (Copilot SDK, MCP, voice)
  main/                Electron main process
  renderer/            React + R3F frontend
  mcp-windows/         Windows system control MCP server
scripts/               Dev tooling
```
