# UI Living Airship Redesign — Implementation Plan

**Status:** drafted 2026-05-08, not started.
**Companion report:** [ui-redesign-audit-2026-05-08.md](../reports/ui-redesign-audit-2026-05-08.md)

> **Revision note (2026-05-08):** updated after author clarified the desired nostalgia is **heavy FFX X**, not X-2. The first draft leaned brass-cockpit. This revision pivots to **The Cloister Above** — Cid's airship as a flying temple, with Sphere Grid constellation, Bevelle arches, Macalania crystal, and the Hymn of the Fayth as a silent motion layer. Phase boundaries are unchanged; aesthetic targets and a few file additions are revised below.

## Goal

Convert the Spira renderer from "dark dashboard with FFX nouns" to **The Cloister Above** — a heavy-FFX-X-nostalgic flying temple. Cid's airship rendered not as a cockpit but as **sacred chambers**: Bevelle marble arches, Spiran sodium gold, Macalania crystal panels, pyreflies adrift, the Sphere Grid as the deck overview, and the Hymn of the Fayth as a silent vertical light layer. Six independent phases. Each leaves the app shippable.

The redesign keeps all current functionality, IPC, stores, and tests. It is purely a renderer-visual change.

## Scope

In scope:
- `packages/renderer/src/global.css`
- `packages/renderer/src/tokens.ts`
- `packages/renderer/src/components/**/*.{tsx,module.css}`
- `packages/renderer/index.html` (boot shell only)
- `packages/renderer/package.json` (font + small SVG-helper deps)

Out of scope (explicitly):
- Any file outside `packages/renderer/`.
- Stores (`chat-store`, `room-store`, `station-store`, `mission-runs-store`, etc.).
- IPC handlers ([hooks/ipc/](../packages/renderer/src/hooks/ipc/)).
- Protocol / shared types.
- Voice pipeline, MCP, missions backend.

## Background — what already exists

Audited in [ui-redesign-audit-2026-05-08.md](../reports/ui-redesign-audit-2026-05-08.md). Anchors:

- Color tokens: [global.css:1-32](../packages/renderer/src/global.css) and the duplicate object in [tokens.ts](../packages/renderer/src/tokens.ts).
- Layout shell: [AppShell.tsx](../packages/renderer/src/components/AppShell.tsx) + [AppShell.module.css](../packages/renderer/src/components/AppShell.module.css).
- Sidebar nav: [Sidebar.tsx](../packages/renderer/src/components/Sidebar.tsx) + [Sidebar.module.css](../packages/renderer/src/components/Sidebar.module.css).
- Deck overview: [BaseDeck.tsx](../packages/renderer/src/components/base/BaseDeck.tsx) + [BaseDeck.module.css](../packages/renderer/src/components/base/BaseDeck.module.css).
- Room cards: [RoomCard.tsx](../packages/renderer/src/components/base/RoomCard.tsx) + [RoomCard.module.css](../packages/renderer/src/components/base/RoomCard.module.css).
- Bridge view: [BridgeRoomDetail.tsx](../packages/renderer/src/components/base/BridgeRoomDetail.tsx) + [BridgeRoomDetail.module.css](../packages/renderer/src/components/base/BridgeRoomDetail.module.css).
- Orb: [ShinraOrb.tsx](../packages/renderer/src/components/orb/ShinraOrb.tsx) + [ShinraOrb.module.css](../packages/renderer/src/components/orb/ShinraOrb.module.css).
- Chat: [ChatPanel.tsx](../packages/renderer/src/components/chat/ChatPanel.tsx), [InputBar.tsx](../packages/renderer/src/components/chat/InputBar.tsx), [MessageBubble.tsx](../packages/renderer/src/components/chat/MessageBubble.tsx).
- Status strip: [AssistantStatusStrip.tsx](../packages/renderer/src/components/AssistantStatusStrip.tsx).
- Aux deck: [AuxDeck.tsx](../packages/renderer/src/components/base/AuxDeck.tsx) + [AuxDeck.module.css](../packages/renderer/src/components/base/AuxDeck.module.css).
- Flight layer: [FlightLayer.tsx](../packages/renderer/src/components/base/FlightLayer.tsx).
- Mission shell: [MissionShell.tsx](../packages/renderer/src/components/missions/MissionShell.tsx) + [MissionShell.module.css](../packages/renderer/src/components/missions/MissionShell.module.css).
- Boot shell: [index.html](../packages/renderer/index.html).

## Out of scope risks closed by this plan

The redesign **explicitly avoids**:

- Changing any `SpiraUiView` / `SidebarView` id strings — only display labels move.
- Adding R3F/WebGL hard dependencies (we use only SVG + CSS + Framer Motion, all already on disk per [package.json:10-21](../packages/renderer/package.json)).
- New stores or new IPC events.
- New tests' wire contracts (existing component tests stay green).

## Phase rollout

Each phase ships independently. Phase N can land before phase N+1 starts.

### Phase 1 — Tokens, fonts, and the atmosphere layer (foundation)

**Goal:** the *whole app* feels different on the next reload, without any layout change. Establishes the FFX X palette, type, and ambient world (pyrefly drift, Macalania ash clouds, Hymn vocalise, ship sway).

**Files:**

1. [packages/renderer/package.json](../packages/renderer/package.json) — add fonts:
   ```json
   "@fontsource-variable/cinzel": "^5.0.0",
   "@fontsource/cormorant-garamond": "^5.0.0",
   "@fontsource/pinyon-script": "^5.0.0",
   "@fontsource-variable/jetbrains-mono": "^5.0.0"
   ```
   No other deps; all decoration is hand-authored SVG + CSS.

2. [packages/renderer/src/main.tsx](../packages/renderer/src/main.tsx) — import fonts at top:
   ```ts
   import "@fontsource-variable/cinzel";
   import "@fontsource/cormorant-garamond/400.css";
   import "@fontsource/cormorant-garamond/400-italic.css";
   import "@fontsource/cormorant-garamond/600.css";
   import "@fontsource/pinyon-script/400.css";
   import "@fontsource-variable/jetbrains-mono";
   ```

3. [packages/renderer/src/global.css](../packages/renderer/src/global.css) — replace `:root` block. New token tree (FFX X palette per [audit § 4.3](../reports/ui-redesign-audit-2026-05-08.md)):
   - Hull (Zanarkand-dusk indigo, not navy): `--hull-deep #080d22`, `--hull-mid #121a3a`, `--hull-edge #1d2750`, `--hull-rim #2a3358`.
   - Spiran gold (Bevelle/sodium, not brass-cockpit): `--gold-bright #f5da9c`, `--gold-warm #e0c489`, `--gold-deep #a8854a`, `--gold-shadow #5e4720`.
   - Macalania crystal: `--crystal-mist #bff0e6`, `--crystal-glow #92e3da`, `--crystal-deep #3d7a76`.
   - Bevelle marble: `--marble-ivory #f1e6cc`, `--marble-warm #d8c8a3`.
   - Hymn (vocalise lavender, used very sparingly): `--hymn-soft #b89ed8`, `--hymn-bright #d4bff0`.
   - Sin (state error, replaces Tailwind red): `--sin-blood #a83a3a`, `--sin-deep #5e1818`.
   - Type:
     - `--font-display "Cinzel Variable", "Cinzel", serif`
     - `--font-body "Cormorant Garamond", Georgia, "Times New Roman", serif`
     - `--font-hymn "Pinyon Script", "Italianno", cursive`
     - `--font-mono "JetBrains Mono Variable", "JetBrains Mono", "Cascadia Code", monospace`
     - `--font-eyebrow "Cinzel Variable", serif`
   - Legacy aliases (so phases 1–3 don't have to touch every CSS file):
     - `--accent-amber: var(--gold-warm)`
     - `--accent-gold: var(--gold-bright)`
     - `--accent-teal: var(--crystal-glow)`
     - `--accent-cyan: var(--crystal-mist)`
     - `--accent-purple: var(--hymn-soft)`
     - `--text-display: var(--marble-ivory)` (was `#f0e5cb`)
     - `--text-primary: var(--marble-warm)`
     - `--state-thinking: var(--hymn-soft)`
     - `--state-error: var(--sin-blood)`
   - Ambient-motion knobs: `--sway-deg 0.18deg`, `--sway-duration 11s`, `--hymn-period 7s`.
   - Body `font-family: var(--font-body)` (was `var(--font-ui)`).
   - Body background: replace radial-gradient ellipses with new dusk-indigo + soft Bevelle-gold low-glow at the horizon.

4. [packages/renderer/src/components/atmosphere/PyrefleField.tsx](../packages/renderer/src/components/atmosphere/PyrefleField.tsx) **(new)** — *replaces* the prior draft's "PyrefleStorm" (which was streaking comets, X-2-feeling). Renders a low-density slow-drifting field of ~12 pyreflies, each fading in/out over 14–22s, randomly positioned across the viewport. Color tinted by the current presence color (read off `useShinraStatusContext`). All keyframes CSS-only; only the spawn schedule is JS. Disabled under `prefers-reduced-motion`.

5. [packages/renderer/src/components/atmosphere/MacalaniaDrift.tsx](../packages/renderer/src/components/atmosphere/MacalaniaDrift.tsx) **(new)** — *replaces* the prior draft's "SkyboxLayer." Two SVG layers of soft ash-flake/cloud-band particles drifting at 280s and 480s loops in `--crystal-mist` at 0.04 opacity. The sense of *passing above the world* without any cloud-cockpit framing.

6. [packages/renderer/src/components/atmosphere/HymnVocalise.tsx](../packages/renderer/src/components/atmosphere/HymnVocalise.tsx) **(new)** — *replaces* the prior draft's "EngineThrob." A thin vertical lavender light bar fixed to the right edge of the viewport, breathing at `--hymn-period` (7s), opacity 0 → 0.12. Subscribes to a derived selector for "is anything long-running": when `useChatStore` `isStreaming` || any flight has been alive >15s, opacity ceiling lifts to 0.22 for the duration. Single CSS variable drives the brightness; React only flips a class.

7. [packages/renderer/src/components/AppShell.tsx](../packages/renderer/src/components/AppShell.tsx) — mount the three atmosphere components inside `<div className={styles.app}>`, before the title bar. Order from bottom to top of stacking: MacalaniaDrift (z: -3) → PyrefleField (z: -2) → HymnVocalise (z: -1) → existing chrome.

8. [packages/renderer/src/components/AppShell.module.css](../packages/renderer/src/components/AppShell.module.css) — add the ship-sway keyframe and apply to `.app` (skip under `@media (prefers-reduced-motion: reduce)`).

**Tests / smoke check after phase 1:**
- `pnpm typecheck` clean.
- `pnpm lint` clean.
- App boots; every view looks recognizably the same but with FFX X type, palette, and the three atmosphere layers.
- Reduced-motion turns off pyrefly field, Macalania drift, hymn vocalise, and sway.
- Existing component tests pass (no behavior change).

**Why this is phase 1:** lowest-risk, highest-recognition change. Sets the FFX X palette/type/atmosphere that subsequent phases lean on.

---

### Phase 2 — Shape language & decor primitives

**Goal:** introduce the FFX X shape DNA — Yevon spiral, Sphere Grid constellation, Bevelle arches, Cloister pedestals, hymn-vocalise bar, ash-marble inscriptions — and make them available everywhere.

**Files:**

1. [packages/renderer/src/components/decor/Glyphs.tsx](../packages/renderer/src/components/decor/Glyphs.tsx) **(new)** — exported components, each is a single inline `<svg>`:
   - `<YevonSpiral size? color? strokeWidth? />` — three-arm logarithmic spiral. Used as the loading indicator, the wordmark monogram, and the chat empty-state seal.
   - `<SphereGridNode size? state? />` — a circular cartouche representing one node in the Sphere Grid. State drives glow intensity and color (`idle`, `active`, `hover`).
   - `<SphereGridConnector from to active? />` — a glowing line between two coordinates, drawn in `--gold-deep`; brightens to `--gold-warm` when `active`.
   - `<SphereGridConstellation nodes edges activeId? />` — the composed primitive: takes a list of nodes and edges, draws the whole graph. The deck overview is built from this.
   - `<BevelleArch width? color? strokeWidth? />` — symmetric single-arc cartouche cap. Default placement: above any `cartouche` plate's title.
   - `<BevelleTripleArch width? color? />` — three nested arches receding into the distance. Used **once only**: behind the orb on the bridge.
   - `<CloisterPedestal height? glyph? />` — stepped octagonal base via `clip-path: polygon(...)`; gold-rimmed; casts a soft underglow. Optional inscribed glyph in the recessed slot.
   - `<HymnInscription text variant />` — a Pinyon Script inscription at low opacity. `variant: "watermark" | "epitaph"`. Used three places only.
   - `<EngravedDivider width? />` — a gold-and-shadow horizontal hairline with a tiny center spiral.
   - `<AirshipSilhouette opacity? />` — a single hand-drawn SVG path of an FFX-flavored airship (composite Fahrenheit/Cid airship shape, original art). Used as the deck overview backdrop at ~6% opacity.

2. [packages/renderer/src/components/decor/Plate.tsx](../packages/renderer/src/components/decor/Plate.tsx) **(new)** — a wrapper that replaces the 17-times-repeated panel recipe. Variants tuned to FFX cathedral feel:
   - `variant="tablet"` — Bevelle stone tablet. `border-radius: 4px`, gold inscription-line on the bottom edge, hull-mid background, gold hairline border. Replaces the prior draft's "instrument" variant.
   - `variant="cartouche"` — chamfered-corner clip-path with a `<BevelleArch />` above the title. For room titles and the orb chamber framing.
   - `variant="glass"` — Macalania crystal panel: `border-radius: 16px`, inner `inset 0 1px 0 var(--crystal-mist)` highlight, frosted gradient over hull-deep, faint `--crystal-glow` border at 24% alpha.
   - `variant="parchment"` — pilgrimage-record warmth: `#1a1408` parchment-tinted background with a brass clip detail. Used by Mission view.
   - `variant="pedestal"` — wraps the `<CloisterPedestal />` primitive for confirmation prompts (permission, reset).

   ```tsx
   interface PlateProps {
     variant: "tablet" | "cartouche" | "glass" | "parchment" | "pedestal";
     tone?: "hull" | "gold" | "crystal" | "parchment";
     children: ReactNode;
     padding?: "none" | "sm" | "md" | "lg";
     className?: string;
     active?: boolean;
     title?: string; // shown in Cinzel for cartouche variant
   }
   ```

3. [packages/renderer/src/components/decor/Plate.module.css](../packages/renderer/src/components/decor/Plate.module.css) **(new)** — all five variants codified once. Active state lifts gold border to `--gold-bright` and adds `box-shadow: 0 0 0 1px var(--gold-warm), 0 0 36px color-mix(in srgb, var(--gold-bright) 18%, transparent)`.

4. Migrate the existing [GlassPanel.tsx](../packages/renderer/src/components/GlassPanel.tsx) to delegate to `<Plate variant="glass">` while keeping its public props. **No call-site changes needed in this phase.**

**Test surface:** these are pure presentational components with no IPC. Add a single Vitest snapshot for `<YevonSpiral />` and `<SphereGridConstellation />` (with a fixed 6-node fixture) to lock the SVG structure. Existing tests untouched.

**Why this is phase 2:** subsequent room/sidebar redesigns *consume* these primitives. The Sphere Grid Constellation is the structural primitive of phase 4 and must exist as a stable component before the deck rebuilds on top of it.

---

### Phase 3 — Sidebar, TitleBar, AssistantStatusStrip (the chrome)

**Goal:** the persistent UI chrome (left rail + top bar + the floating status strip) becomes the temple's processional path. Highest-frequency surfaces; biggest perception lift per-pixel.

**Files:**

1. [packages/renderer/src/components/Sidebar.tsx](../packages/renderer/src/components/Sidebar.tsx) — restructure layout:
   - Logo block becomes a Cinzel "SPIRA" wordmark + a `<YevonSpiral />` monogram (replacing the "S + 3 motes" hack). Subcaption uses Cinzel small caps spaced 0.18em.
   - Each nav item becomes a Bevelle stone tablet (`<Plate variant="tablet">`, single-line Cinzel label, no caption sub-line — captions move to a tooltip).
   - Active item: tablet fills with `--gold-warm` background, label inverts to `--hull-deep`. A small Yevon spiral seal appears in the corner.
   - Station list panel becomes a Macalania-crystal panel (`<Plate variant="glass">`); each station = a row with a Cinzel station label + a Cormorant Garamond italic title.
   - **Renames** (only the human label; ids unchanged):
     - "Field Office" → **"Cloister"** (replaces the previous draft's "War Room")
     - "Settings" → **"Sphere Grid"** (replaces the previous draft's "Helm")
     - "Missions" → **"Pilgrimage Log"** (replaces the previous draft's "Logbook")
     - "Armoury" stays
     - "Operations" stays
     - "Bridge" stays
     - "Ship" → **"Deck"** (deck of the cloister, but the constellation view)
   - The strings live in the existing `items` array at [Sidebar.tsx:14-23](../packages/renderer/src/components/Sidebar.tsx).

2. [packages/renderer/src/components/Sidebar.module.css](../packages/renderer/src/components/Sidebar.module.css) — full rewrite. Replace all 17 `linear-gradient(180deg, rgba(...))` blocks with token references. Add a thin Bevelle-gold frame strip on the right edge.

3. [packages/renderer/src/components/TitleBar.tsx](../packages/renderer/src/components/TitleBar.tsx) — wordmark uses Cinzel; the brand mark becomes a `<YevonSpiral />` monogram. `controlButton`s become small gold-rimmed dial-toggles.

4. [packages/renderer/src/components/TitleBar.module.css](../packages/renderer/src/components/TitleBar.module.css) — restyle to match.

5. [packages/renderer/src/components/AssistantStatusStrip.tsx](../packages/renderer/src/components/AssistantStatusStrip.tsx) — replace the 8px orb dot with a 22px mini-Fayth (small `<ShinraOrb size="strip" />` variant). The strip becomes a thin Bevelle-tablet reading: presence color + Cinzel phase label + Cormorant Garamond italic summary.

6. [packages/renderer/src/components/AssistantStatusStrip.module.css](../packages/renderer/src/components/AssistantStatusStrip.module.css) — restyle.

7. [packages/renderer/src/components/orb/ShinraOrb.tsx](../packages/renderer/src/components/orb/ShinraOrb.tsx) — accept an optional `size?: "stage" | "chamber" | "strip"` prop. Default `"chamber"`. `"strip"` is 22px and skips the pyrefly array (just core + halo). `"stage"` is `min(60vmin, 540px)`, full pyreflies + the new Cloister Pedestal underneath + a Pinyon Script hymn watermark behind it. The ShinraOrb's per-state palette tokens (`--pyrefly-primary` / `--pyrefly-secondary` / `--pyrefly-accent`) at [ShinraOrb.module.css:182-216](../packages/renderer/src/components/orb/ShinraOrb.module.css) get retuned to FFX-X presence colors:
   - `idle`: `--crystal-glow` / `--gold-warm` / `--marble-warm`
   - `listening`: `--crystal-mist` / `--crystal-glow` / `--marble-ivory`
   - `thinking`: `--hymn-soft` / `--hymn-bright` / `--gold-warm`
   - `speaking`: `--gold-bright` / `--gold-warm` / `--marble-ivory`
   - `error`: `--sin-blood` / `--gold-shadow` / `--sin-deep`

**Tests:** existing tests stay green ([renderer-fatal.test.ts](../packages/renderer/src/renderer-fatal.test.ts), [shinra-status.test.ts](../packages/renderer/src/shinra-status.test.ts), [station-store.test.ts](../packages/renderer/src/stores/station-store.test.ts), [chat-store.test.ts](../packages/renderer/src/stores/chat-store.test.ts), [room-store.test.ts](../packages/renderer/src/stores/room-store.test.ts), [control-snapshot.test.ts](../packages/renderer/src/automation/control-snapshot.test.ts), [mcp-server-status.test.ts](../packages/renderer/src/components/base/mcp-server-status.test.ts), [mission-display-utils.test.ts](../packages/renderer/src/components/missions/mission-display-utils.test.ts), [mission-utils.test.ts](../packages/renderer/src/components/projects/mission-utils.test.ts), [project-utils.test.ts](../packages/renderer/src/components/projects/project-utils.test.ts), [youtrack-state-mapping-utils.test.ts](../packages/renderer/src/components/projects/youtrack-state-mapping-utils.test.ts), [reset-transient-state.test.ts](../packages/renderer/src/hooks/ipc/reset-transient-state.test.ts), [register-chat-handlers.test.ts](../packages/renderer/src/hooks/ipc/register-chat-handlers.test.ts), [MessageBubble.test.tsx](../packages/renderer/src/components/chat/MessageBubble.test.tsx), [StreamingText.test.tsx](../packages/renderer/src/components/chat/StreamingText.test.tsx), [McpClusterDetail.test.tsx](../packages/renderer/src/components/base/McpClusterDetail.test.tsx)).

**Why this is phase 3:** the chrome is on screen 100% of the time. Selling the airship in the chrome means every later phase is reinforcement.

---

### Phase 4 — Deck overview as Sphere Grid Constellation

**Goal:** the BIG payoff. Replace the 3×3 RoomCard grid with a **Sphere Grid constellation** of room-nodes set against a soft airship-hull silhouette. This is the single most FFX-iconic moment in the redesign.

**Files:**

1. [packages/renderer/src/components/decor/RoomSilhouettes.tsx](../packages/renderer/src/components/decor/RoomSilhouettes.tsx) **(new)** — one inline SVG per room (each is the *interior* visible inside its Sphere Grid node):
   - `<BridgeInterior state />` — small ghost of the orb visible through a Bevelle arch.
   - `<ArmouryInterior servers />` — vertical glyph-marked weapon silhouettes, count = `servers.length` capped at 6.
   - `<CloisterInterior agents />` — round chamber from above with a single Sphere Grid node at its center; ring of pyrefly motes = ready agents.
   - `<OperationsInterior stations />` — bezel dial face, needles per station.
   - `<PilgrimageInterior />` — leather-bound pilgrimage record with brass clips.
   - `<SphereGridInterior />` — a recursive miniature Sphere Grid (settings = the grid editor itself).

   These are *decorative* SVGs read off props but aren't interactive — clicks bubble up to the parent node button.

2. [packages/renderer/src/components/base/BaseDeck.tsx](../packages/renderer/src/components/base/BaseDeck.tsx) — replace the 3×3 grid with a Sphere Grid constellation:
   - At the top of the constellation: the **Bridge node** (largest sphere, visually prominent), with the live `<ShinraOrb size="chamber" />` floating just above it.
   - Mid tier: three nodes — **Armoury**, **Cloister**, **Operations**.
   - Lower tier: two nodes — **Pilgrimage Log**, **Sphere Grid**.
   - Connecting lines (`<SphereGridConnector>`) drawn in `--gold-deep`; the path *to* the active node lights to `--gold-warm`.
   - Behind the constellation: `<AirshipSilhouette opacity={0.06} />` parallaxing slowly left.
   - Below the constellation: a single Pinyon Script `<HymnInscription variant="epitaph">` reading something hymn-shaped (decorative, not literal).
   - The existing flight data still drives lights — flights now travel as glowing capsules along the constellation edges.

3. [packages/renderer/src/components/base/BaseDeck.module.css](../packages/renderer/src/components/base/BaseDeck.module.css) — full rewrite. The constellation is positioned via CSS Grid with named-area placement; each node is anchored at a fixed grid coordinate so the `<SphereGridConnector>` lines can compute exact endpoints.

4. [packages/renderer/src/components/base/RoomCard.tsx](../packages/renderer/src/components/base/RoomCard.tsx) — RoomCard becomes a **constellation-node** wrapper rather than a tile. Renders a `<SphereGridNode>` + the room's `<RoomInterior>` silhouette overlaid + the existing topline/body/preview blocks anchored beside the node (callout-style, like a Sphere Grid tooltip). Add prop `nodeSize?: "primary" | "secondary"` (Bridge is `primary`, all others `secondary`). The `roomNodesRef` Map (used by `FlightLayer`) keeps working — we still expose a clickable button per node.

5. [packages/renderer/src/components/base/RoomCard.module.css](../packages/renderer/src/components/base/RoomCard.module.css) — full rewrite. Remove the 4 corner-bracket pseudo-elements. Hover state = the node halo brightens + the connector lines *to* this node light up via a CSS sibling-selector chain on `[data-room-id]:hover ~ ...`. Active = node fills `--gold-bright` and casts a 36px halo.

6. [packages/renderer/src/components/base/FlightLayer.tsx](../packages/renderer/src/components/base/FlightLayer.tsx) — keep all positioning logic. Visual change: the trail becomes a *gold inscription line* (single 1px gradient stroke); the orb becomes a small Sphere Grid capsule glowing the activity color. Brass-tube/Roman-numeral framing from the prior draft is dropped — that was X-2 cockpit pop, not FFX X.

7. [packages/renderer/src/components/base/FlightLayer.module.css](../packages/renderer/src/components/base/FlightLayer.module.css) — restyle.

**Tests:** [McpClusterDetail.test.tsx](../packages/renderer/src/components/base/McpClusterDetail.test.tsx) and [mcp-server-status.test.ts](../packages/renderer/src/components/base/mcp-server-status.test.ts) keep passing (no logic change). Add a snapshot for `BaseDeck` rendering with 0 servers / 0 agents to lock the empty-constellation composition.

**Why this is phase 4:** highest-reward visual moment. The Sphere Grid constellation is what an FFX player will photograph and send to a friend. Lands on top of the foundation (phase 1) and primitives (phase 2).

---

### Phase 5 — Bridge as the Fayth Chamber

**Goal:** the bridge becomes the Cloister of Trials antechamber. Orb dead center as the Fayth on a pedestal, three Bevelle arches receding behind, Pinyon Script hymn watermark drifting at 5%, chat below as a torchlit hymnal scroll.

**Files:**

1. [packages/renderer/src/components/base/BridgeRoomDetail.tsx](../packages/renderer/src/components/base/BridgeRoomDetail.tsx) — re-layout:
   - Top: a thin status rail (eyebrow + Cinzel station name + phase badge).
   - Center: the **Fayth Chamber** — `<ShinraOrb size="stage" />` floating above a `<CloisterPedestal glyph={<YevonSpiral />} />`, framed by a `<BevelleTripleArch />` backdrop. A `<HymnInscription variant="watermark" />` drifts behind the orb at ~5% opacity.
   - Below: the chat console (`<ChatPanel>`) as a Macalania-glass plate (`<Plate variant="glass">`). Visually reads as the hymnal table beneath the Fayth.
   - Aux deck (the tool monitor) collapses into a horizontal strip across the bottom of the chamber, not a vertical sidebar.

2. [packages/renderer/src/components/base/BridgeRoomDetail.module.css](../packages/renderer/src/components/base/BridgeRoomDetail.module.css) — full rewrite. Two-row grid: `auto minmax(0, 1fr)`. Center stage holds the Fayth Chamber; chat sits below.

3. [packages/renderer/src/components/orb/ShinraOrb.module.css](../packages/renderer/src/components/orb/ShinraOrb.module.css) — add the `"stage"` size variant (no max-width cap, scale all halos and the focus core proportionally). Keep all existing keyframes. **Add a one-shot keyframe** `prayerRipple` that fires on assistant state-change: a single golden ring expands outward from the pedestal floor in 480ms ease-out. (The FFX prayer animation in 24 frames.)

4. [packages/renderer/src/components/base/AuxDeck.tsx](../packages/renderer/src/components/base/AuxDeck.tsx) — accept an optional `orientation?: "vertical" | "horizontal"` prop. Default `vertical` (preserves current call sites). Bridge passes `horizontal`.

5. [packages/renderer/src/components/base/AuxDeck.module.css](../packages/renderer/src/components/base/AuxDeck.module.css) — add horizontal layout class; make the card list a horizontal scroll-snap track. Restyle each card as a small Bevelle tablet (Plate variant `tablet`).

6. [packages/renderer/src/components/chat/ChatPanel.tsx](../packages/renderer/src/components/chat/ChatPanel.tsx) — small structural changes only:
   - Empty state shows the new diegetic empty: 3 free-floating pyreflies + Cinzel headline "AWAITING ORDERS" with stroke-animation. Example chips become **prayer-scroll** plates — Cormorant Garamond italic on a parchment-tinted Plate, Yevon spiral seal at the corner.
   - Toolbar uses Cinzel for the title.
7. [packages/renderer/src/components/chat/ChatPanel.module.css](../packages/renderer/src/components/chat/ChatPanel.module.css) — restyle to a Macalania-glass plate.

8. [packages/renderer/src/components/chat/MessageBubble.module.css](../packages/renderer/src/components/chat/MessageBubble.module.css) — restyle:
   - User bubble: gold-tinted Bevelle tablet, Cormorant Garamond 16/1.62 in `--marble-warm`.
   - Assistant bubble: hull-mid Macalania-glass plate with a left-edge gold hairline; corners chamfered (clip-path), not rounded. Body in `--marble-ivory`. Code spans use JetBrains Mono Variable in `--crystal-mist`.
   - Question state: cartouche corners + a `<BevelleArch />` above the bubble.

9. [packages/renderer/src/components/chat/InputBar.module.css](../packages/renderer/src/components/chat/InputBar.module.css) — restyle:
   - Textarea becomes an engraved gold-rimmed Bevelle tablet with Cormorant Garamond italic input text.
   - Transmit button is a primary gold button (Cinzel small caps "TRANSMIT").
   - Reset / Clear actions become small gold dial-toggles.

**Tests:** [MessageBubble.test.tsx](../packages/renderer/src/components/chat/MessageBubble.test.tsx) and [StreamingText.test.tsx](../packages/renderer/src/components/chat/StreamingText.test.tsx) stay green (no markup contract change beyond class names; tests assert text/render behavior, not classes).

**Why this is phase 5:** the bridge is where the user actually spends time talking to Shinra. Selling the chamber is the second-most-impactful single change.

---

### Phase 6 — Pilgrimage Log + Zanarkand-at-dusk boot

**Goal:** finish the world. Mission view becomes a pilgrimage scroll; the boot shell becomes the FFX-X opening shot.

**Files:**

1. [packages/renderer/src/components/missions/MissionShell.tsx](../packages/renderer/src/components/missions/MissionShell.tsx) — restructure:
   - Status bar becomes a brass clip + ticket-id stamp atop a parchment plate.
   - Mission body uses `<Plate variant="parchment">` with a parchment-tinted hull background (`#1a1408` over `--hull-deep`).
   - Eyebrow uses Cinzel small caps; ticket title uses Cormorant Garamond.

2. [packages/renderer/src/components/missions/MissionShell.module.css](../packages/renderer/src/components/missions/MissionShell.module.css) — full rewrite. Drop the `rgba(115, 141, 220, ...)` blue palette; all surfaces draw from the FFX-X palette tokens.

3. [packages/renderer/src/components/AppShell.module.css](../packages/renderer/src/components/AppShell.module.css) — drop `.missionApp::before` / `.missionApp::after` color forks. Mission view now inherits the same atmosphere; the *content* (parchment plate) is the only thing that signals mission mode.

4. [packages/renderer/src/components/missions/MissionNav.tsx](../packages/renderer/src/components/missions/MissionNav.tsx) + [MissionNav.module.css](../packages/renderer/src/components/missions/MissionNav.module.css) — restyle to a brass-edged mission tablet with engraved Cinzel tabs and a small Yevon-glyph icon per tab.

5. [packages/renderer/src/components/missions/rooms/MissionDetailsRoom.module.css](../packages/renderer/src/components/missions/rooms/MissionDetailsRoom.module.css) — restyle to the parchment-cartouche ladder.

6. [packages/renderer/index.html](../packages/renderer/index.html) — replace boot shell with the **Zanarkand-at-dusk opening shot**:
   - Dusk gradient — black-to-deep-indigo with a faint ruin silhouette along the bottom edge (single inline SVG path).
   - 9–12 pyreflies fade in from random radial coordinates, slowly arc toward the center, congregate into a single bright orb-point (CSS-only, `@keyframes` per pyrefly with random `animation-delay`).
   - A Pinyon Script hymn watermark — a few hymn-shaped strokes, never readable as words — fades in at 14% opacity behind the gathering orb at 0.4–1.2s, then fades down to 4%.
   - "SPIRA" engraves in via SVG `stroke-dashoffset` (Cinzel-shaped paths inline; ~140ms per letter staggered) at 0.8–1.6s, color `--gold-bright`.
   - Subtitle "SHINRA · COMMAND INTERFACE" appears below in Cinzel small caps spaced 0.18em at `--gold-warm`.
   - A single Bevelle arch draws underneath in `--gold-deep` at 1.5–1.9s.
   - Total intro ~2.1s; on `markReady()` the boot shell fades out and `#root` fades in.
   - Failure path retains current copy + reload button + details `<pre>` (kept verbatim in markup; restyled with Cinzel + Cormorant Garamond + the new palette).

7. [packages/renderer/src/renderer-fatal.ts](../packages/renderer/src/renderer-fatal.ts) — no changes (the boot shell's failure path is already wired here).

**Tests:** [renderer-fatal.test.ts](../packages/renderer/src/renderer-fatal.test.ts) stays green (we don't touch the failure recovery contract).

**Why this is phase 6:** finishes the picture. After this, every surface in the app — including first paint and mission mode — speaks the same language.

---

## Cross-cutting checks

After every phase:

| Check | Command |
| --- | --- |
| Type safety | `pnpm typecheck` |
| Lint | `pnpm lint` (Biome) |
| Tests | `pnpm test` (Vitest workspace; renderer suites listed under [vitest.workspace.ts](../vitest.workspace.ts)) |
| Manual smoke | `pnpm dev` — verify deck → bridge → mission round-trip, voice indicator, station switching, MCP detail, agent room detail |
| Reduced motion | Run with OS-level reduce-motion enabled — verify ambient layers freeze, ship sway disabled, pyrefly storm disabled |

Visual snapshot tests are **not** added in this plan — UI is changing too fluidly across phases. Instead, the existing component tests assert behavior (text content, role, IPC dispatches) and stay green throughout.

---

## Migration risks & their mitigations

| Risk | Mitigation |
| --- | --- |
| `--accent-*` and `--state-*` token name collisions break unmigrated CSS modules | Phase 1 keeps the legacy tokens as aliases; phases 3-6 migrate consumers gradually. No dual-token churn. |
| Cinzel at small sizes (10–11px eyebrows) renders blocky | Eyebrows render at 11px / weight 500 / tracking 0.18em — verified rendering target in dev. Fall back to `--font-body` at <10px. |
| Pyrefly storm plus skybox plus engine throb adds GPU cost | `prefers-reduced-motion` collapses all three to a static gradient. Pyrefly storm caps to 3 in flight. Skybox is pure SVG transform translation (composited). |
| Renaming "Field Office" → "Cloister", "Settings" → "Sphere Grid", "Missions" → "Pilgrimage Log", "Ship" → "Deck" confuses users mid-flight | Internal ids (`agents`, `settings`, `projects`, `ship`) unchanged. Add a one-line `.stationCaption` tooltip ("formerly Field Office", etc.) for the first 14 days, then remove. |
| Heavy FFX iconography reads as IP-infringing | All shape primitives are abstract: logarithmic spirals, hexagons, archways, octagonal stepped pedestals, particle drift. They evoke FFX without copying any specific Square Enix asset. The Pinyon Script hymn watermark is shape-only — never literal lyrics. Airship silhouette is original art composited from common hull-shape primitives. |
| `RoomCard` and `GlassPanel` have many call sites; migrating them all in phase 2 is risky | Phase 2 lands `<Plate>` as a *new* primitive. `<GlassPanel>` and `<RoomCard>` migrate *internally* without changing their public props. No call site needs to change for phases 1-3. |
| The boot shell is critical for fatal recovery — replacing it can break the failure path | The `#spira-boot-shell`, `#root`, `#spira-boot-title`, `#spira-boot-message`, `#spira-boot-details`, `#spira-boot-reload` element ids and the `window.__spiraRendererBoot` API stay verbatim. Only the *visual shell* around them changes. The failure path tests in [renderer-fatal.test.ts](../packages/renderer/src/renderer-fatal.test.ts) keep passing. |
| `AnimatePresence` view transitions ([AppShell.tsx:115-179](../packages/renderer/src/components/AppShell.tsx)) interact badly with the new layouts | Keep the existing motion definitions. The new BaseDeck cross-section is a single child of the `motion.div`, so the parent transition is unchanged. |

---

## Definition of done

The redesign is complete when:

1. Every surface listed in [§ Background](#background--what-already-exists) renders in the new visual language.
2. `pnpm typecheck` / `pnpm lint` / `pnpm test` are clean.
3. `prefers-reduced-motion` correctly disables ambient layers and sway.
4. Boot shell fades from the opening shot to `#root` without visual hiccup; failure path still shows the existing recovery panel.
5. No store, IPC, or shared-protocol file outside `packages/renderer/` has been edited.
6. The first frame the user sees is unmistakably **Spira** — not "another dark dashboard."

---

## Estimated phase costs (relative)

| Phase | Risk | Surface area | Notes |
| --- | --- | --- | --- |
| 1. Tokens, fonts, atmosphere | Low | 7 files (3 new) | Largest perception lift per minute of work. FFX-X palette, Cinzel + Cormorant Garamond + Pinyon Script + JetBrains Mono. |
| 2. Decor primitives | Low | 4 files (4 new) | No call-site impact. **Sphere Grid Constellation primitive is the structural blocker for phase 4.** |
| 3. Sidebar / TitleBar / StatusStrip | Medium | 8 files | Touches always-visible chrome. Renames land here. |
| 4. Deck as Sphere Grid Constellation | Medium-High | 7 files (1 new) | The signature moment — second-most-recognizable FFX visual after the orb. |
| 5. Bridge as Fayth Chamber | Medium-High | 9 files | Highest-traffic functional surface. Chat legibility must stay strong (Cormorant Garamond at 16/1.62 on hull-mid is verified ≥ 6:1 contrast). |
| 6. Pilgrimage Log + Zanarkand boot | Medium | 6 files | Closes the world. The 2.1s opening shot is the first frame any user ever sees. |

Each phase ships behind no flag — they are visual changes, not behavioral changes. Rollback is `git revert` of that phase's commit.

---

## What this plan does **not** do

- Does **not** add WebGL/R3F orb. The current CSS+SVG orb is excellent and the redesign keeps it. R3F/postprocessing remain installed for a future phase if desired but are unused here.
- Does **not** introduce a UI framework (no Tailwind, no shadcn, no chakra, etc.). All styling is the existing CSS-modules approach.
- Does **not** change accessibility patterns — focus rings, aria roles, alerts, live regions are preserved or upgraded (focus ring goes from teal to `--brass-bright`, contrast verified ≥ 4.5:1 against hull tokens).
- Does **not** add documentation files, screenshots, or storybook entries unless the user asks for them. The plan itself is the deliverable.
