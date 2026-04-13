# Spira — FFX Atmosphere Design Plan

A practical plan for deepening the Final Fantasy X feeling across the Spira
renderer without introducing kitsch, clutter, or usability regressions.

---

## 1  Diagnosis: What Currently Reads FFX vs Generic

### Already FFX-coded (keep and build on)

| Surface / element | FFX signal |
|---|---|
| **ShinraOrb pyrefly congregation** | The single strongest FFX moment in the app. 24-particle system with per-state colour palettes, farplane halo, memory veil, void glow — all named and tuned to evoke Spira's spiritual cosmology. |
| **Room names** (Bridge, Barracks, Armoury, Field Office) | Read as a military airship or XCOM command deck. Dual-coded: both FFX-Cid's-airship and operational metaphor. |
| **Brand copy** ("Spira", "Shinra Operations", "Shinra interface") | Direct homage. Users who know FFX recognise it immediately. |
| **Colour palette** — deep navy BGs + teal/cyan accents | Evokes Spira's underwater temples and machina tech. The aquamarine accent range is distinctly FFX-adjacent without being a sprite-rip. |
| **Phase names** (Farplane Halo, Memory Veil, Congregation) | CSS class names carry the lore internally; they don't leak into UI copy, which is the right balance. |

### Currently generic (opportunities)

| Surface / element | What feels off-the-shelf |
|---|---|
| **Typography** | `"Segoe UI", system-ui, sans-serif` is Windows-default. Every Electron app uses it. Uppercase + letter-spacing is doing the heavy lifting for personality; the actual typeface contributes nothing. |
| **Background treatment** | `radial-gradient(circle at top, rgba(0,229,255,0.06), transparent 28%)` is a single subtle wash. The rest of the shell is flat `#0a0e27`. Outside the Orb viewport, nothing moves or breathes. |
| **GlassPanel / card chrome** | Consistent but interchangeable with any dark-theme admin panel. `backdrop-filter: blur(16px)` + gradient + border is a 2022 glassmorphism template. No texture, no Spira-specific ornament. |
| **Chat bubbles** | Standard left/right alignment, teal-vs-dark scheme. The USER / SPIRA labels are functional but carry zero thematic weight. Nothing in the bubble chrome suggests this is a Spira terminal. |
| **Sidebar** | Structurally fine. Visually it's a plain dark column with text buttons. No iconographic system, no ambient texture, no sense of place. |
| **Status indicators** | Coloured dots with `box-shadow` glow. Functional, but identical to every devtools/monitoring UI. |
| **Empty states** | "Start a conversation" with prompt chips. Could be any chat product. |
| **Scrollbar** | The gradient thumb is nice but it's a minor detail on an otherwise neutral chrome. |
| **Motion outside the Orb** | Framer-motion handles enter/exit and layout shifts. There is almost no ambient motion: no background drift, no subtle particle layer, no environmental rhythm. The Orb is a vivid island in a static shell. |
| **Iconography** | Effectively none. The sidebar logo-mark is a letter "S" in a square. Window controls are Unicode characters. Room cards use text-only corner brackets. |
| **Sound / haptic** | No UI sounds at all. (Not necessarily a problem — but it's a missed FFX texture.) |

### Key insight

The Orb is the product's soul. Everything else is infrastructure that doesn't participate in the atmosphere. The plan should radiate outward from the Orb, lending its visual language to the surrounding surfaces in progressively subtler doses.

---

## 2  Guiding Principles

### P1 — The Orb is the Fayth; everything else is the temple

The ShinraOrb + pyrefly congregation is the centre of gravity. Other surfaces should defer to it, not compete with it. Atmospheric treatments on the shell, sidebar, and panels should feel like _echoes_ of the Orb's energy — residual light, stray motes, distant hum — not independent spectacles.

### P2 — Machina, not magic

FFX's technology aesthetic is machina: refined, slightly alien engineering with organic curves and luminous accents, not sparkly fantasy UI. Think Al Bhed consoles, airship control panels, sphere-grid nodes. Aim for that industrial-spiritual hybrid where glow lines serve a functional purpose (indicating data flow, status, readiness) rather than decoration.

### P3 — Atmosphere is subtractive, not additive

The best atmospheric moments in FFX are quiet: underwater light caustics, distant pyreflies over the Moonflow, the hum of the Farplane. Resist the urge to _add stuff_. Prefer ambient motion, colour-temperature shifts, and textural depth over ornamental widgets. Every visible element should still serve usability or spatial orientation.

### P4 — Terminology earns its keep

Room names already work because they map 1:1 to real functions. Any new FFX-flavoured copy must pass the same test: does the term _clarify_ the function for someone who's never played FFX, or at least not confuse them? If it only works as a fan reference, it belongs in a CSS class name, not a user-facing label.

### P5 — Reversibility and restraint

Every atmospheric change should be behind a token, a CSS variable, or a feature flag so it can be dialled back without surgery. No phase should ship a change that makes the app harder to read, slower to render, or inaccessible.

---

## 3  Phased Implementation Plan

### Phase 0 — Foundation tokens (low risk, high leverage)

_Goal: Expand the design-token vocabulary so later phases can reference thematic values without hardcoding._

#### 0a. Ambient colour tokens

Add to `tokens.ts` and `global.css`:

```
--ambient-glow-warm:   rgba(204, 153, 0, 0.04);   /* distant pyrefly warmth */
--ambient-glow-cool:   rgba(0, 229, 255, 0.05);    /* temple caustic */
--ambient-glow-spirit: rgba(124, 58, 237, 0.04);   /* farplane residue */
--surface-veil:        rgba(17, 22, 56, 0.7);       /* glass overlay for panels */
--surface-etch:        rgba(0, 229, 255, 0.08);     /* hairline light-engravings */
```

These are deliberately low-opacity so they can composite without fighting content.

#### 0b. Typography tokens

Introduce a display typeface for headings, titles, and the sidebar brand. Candidates (all available via Google Fonts or self-hosted, all free):

| Candidate | FFX resonance | Risk |
|---|---|---|
| **Rajdhani** | Geometric, slightly futuristic, clean at small sizes. Evokes machina readouts. | Low — highly legible, good weight range. |
| **Orbitron** | Overtly sci-fi; works for single-word titles but tires quickly in sentences. | Medium — can feel gimmicky if overused. |
| **Exo 2** | Technical but warm; wide weight range; good for both headings and UI labels. | Low. |

Recommendation: **Rajdhani** (600/700 weights) for display text (titles, eyebrows, brand mark). Keep Segoe UI / system stack for body text and chat content — readability is non-negotiable there.

```
--font-display: "Rajdhani", "Segoe UI", system-ui, sans-serif;
--font-body:    "Segoe UI", system-ui, sans-serif;
--font-mono:    "Cascadia Code", "Consolas", monospace;
```

#### 0c. Motion tokens

```
--drift-slow:    22s;    /* background veil movement */
--drift-normal:  14s;    /* mid-layer particle drift */
--pulse-ambient:  6s;    /* idle background pulse period */
--caustic-period: 18s;   /* light-caustic cycle */
```

**Risk:** Minimal — tokens alone change nothing visible. Subsequent phases consume them.

**Files touched:** `tokens.ts`, `global.css`

---

### Phase 1 — Ambient background and environmental depth (low risk)

_Goal: Make the shell feel like a living space, not a flat dark container._

#### 1a. Layered background treatment on `body` / `#root`

Replace the single radial gradient with a composite:

```css
body {
  background:
    /* caustic sweep — slow-drifting radial highlight */
    radial-gradient(ellipse 60% 40% at var(--caustic-x, 30%) var(--caustic-y, 20%),
      var(--ambient-glow-cool), transparent 50%),
    /* warm hearth — subtle bottom-corner warmth (pyrefly residue) */
    radial-gradient(circle at 80% 90%,
      var(--ambient-glow-warm), transparent 30%),
    /* base */
    var(--bg-primary);
}
```

Animate `--caustic-x` and `--caustic-y` with a very slow CSS `@keyframes` (18-22 s cycle, ease-in-out) to create gentle underwater-light movement. Alternatively, drive the variables from `requestAnimationFrame` with a Lissajous curve for smoother, less periodic motion.

#### 1b. Stray-mote particle layer (optional, defeatable)

A sparse, full-viewport particle layer (6-10 motes, ~2-4px, very low opacity) drifting slowly across the window. CSS-only (`@keyframes` on absolutely-positioned pseudo-elements or a lightweight `<canvas>`) to avoid JS overhead.

This extends the Orb's pyrefly language to the entire shell at a whisper level. Should be togglable via a `--show-ambient-particles: 1` custom property (or a user setting) so it can be disabled on low-end machines or by preference.

#### 1c. Background responds to assistant state

When Shinra is actively thinking/acting, subtly shift the background warm-hearth gradient toward `--ambient-glow-spirit` (purple) and increase the caustic drift speed by ~20%. When speaking, shift toward `--ambient-glow-warm` (gold). When idle, cool and slow everything back down.

This makes the _entire environment_ breathe with Shinra's state, not just the Orb. Effect should be barely perceptible (3-5% opacity delta) — users should feel it before they consciously notice it.

**Risk:** Low. All effects are composited behind content and should have no interaction with layout or text legibility. GPU cost of animating two CSS custom properties + 6-10 motes is negligible. The defeatable flag eliminates accessibility/performance concerns.

**Files touched:** `global.css`, possibly a new `AmbientLayer.tsx` component, `AppShell.tsx` (pass assistant state to ambient layer)

---

### Phase 2 — Surface texture and panel chrome (low-medium risk)

_Goal: Move GlassPanel and card chrome from generic glassmorphism to machina-temple aesthetic._

#### 2a. Etch-line borders

Replace solid `1px solid var(--border-default)` on panels and cards with a composite border treatment:

```css
.panel {
  border: 1px solid var(--surface-etch);
  /* Fine inner etch — like machina panel seams */
  box-shadow:
    inset 0 0 0 1px var(--surface-etch),
    var(--shadow-panel);
}
```

The double-etch (border + inset shadow) creates the look of precision-machined panel edges with light catching the seam — very Al Bhed console.

#### 2b. Corner glyphs on key containers

The RoomCard already has corner-bracket pseudo-elements (`:before`, `:after`). Evolve these from simple right-angles into slightly stylised "sphere-grid node" corner marks: a small arc or dot-plus-line motif at 2-3 corners, drawn with `border-radius` + short `border` segments. Keep them single-colour (accent-cyan at low opacity) so they read as functional framing, not decoration.

Apply similar (but more restrained) corner marks to:
- GlassPanel (only the `glow` variant)
- BridgeRoomDetail's Shinra stage
- PermissionPrompt panel

Don't apply to: chat bubbles (too busy), sidebar nav items (too small), settings controls (too utilitarian).

#### 2c. Panel surface noise (very subtle)

Add a tiled, low-contrast noise texture (`mix-blend-mode: overlay`, ~3-5% opacity) to GlassPanel backgrounds. This breaks up the perfectly smooth gradient and gives surfaces a faintly metallic, machina-hull quality. Can be a tiny (64×64) inline SVG data-URI or a CSS `repeating-conic-gradient` grain pattern to avoid an asset.

**Risk:** Low-medium. Border and shadow changes are purely cosmetic and reversible. Corner glyphs require careful sizing to avoid visual clutter on smaller panels. Noise texture must be extremely subtle to avoid looking dirty on low-DPI screens — test at 100% and 150% scaling.

**Files touched:** `GlassPanel.module.css`, `RoomCard.module.css`, `BridgeRoomDetail.module.css`, `PermissionPrompt.module.css`

---

### Phase 3 — Typography and brand identity (low risk)

_Goal: Give display text a distinct FFX-machina voice._

#### 3a. Apply display font to targeted surfaces

With the font loaded (Phase 0b), apply `font-family: var(--font-display)` to:

- **TitleBar** brand text ("Spira", "Shinra interface")
- **Sidebar** logo text and nav labels (but _not_ captions — keep those in body font for legibility)
- **Room card** titles (uppercase labels like "Bridge", "Armoury")
- **ChatPanel** eyebrow ("Conversation archive"), empty-state title
- **BridgeRoomDetail** section header ("Shinra interface")
- **BaseDeck** room-card titles
- **AssistantStatusStrip** "Shinra" label

Do **not** apply to: chat message content, input fields, settings controls, monospace code blocks, timestamps, or metadata. These must remain in the body/mono stack for readability.

#### 3b. Refine the sidebar brand mark

Replace the plain "S" text in a square with a more deliberate mark:

Option A — A stylised "S" that evokes the Yevon script's curved + angular hybrid (drawn as SVG, not a font glyph).
Option B — A small sphere-grid node icon (concentric rings with radial lines).
Option C — An abstracted pyrefly cluster (3-4 dots in orbital arrangement).

Any of these is an improvement over a raw letter. The mark should be ≤40px, monochrome (teal), and work at the sidebar's current scale.

**Risk:** Low. Font swap on headings is visually impactful but structurally trivial. Brand mark is a single SVG swap. Biggest risk is the display font feeling too "gamey" in context — mitigate by limiting it to uppercase labels and testing at real scale before committing.

**Files touched:** `global.css` (font-face import), `TitleBar.module.css`, `Sidebar.module.css`, `Sidebar.tsx` (logo mark), `RoomCard.module.css`, `ChatPanel.module.css`, `BridgeRoomDetail.module.css`, `AssistantStatusStrip.module.css`, `BaseDeck.module.css`

---

### Phase 4 — Status indicators and state language (medium risk)

_Goal: Replace generic coloured dots with a system that feels like machina instrumentation._

#### 4a. Status indicator restyle

Current: 8-9px circle + coloured box-shadow glow. 
Proposed: A concentric-ring treatment — a 2px inner dot surrounded by a 1px ring with a gap, pulsing gently when active. Think sphere-grid node activation. Still maps the same colours to the same states, but has a distinctive silhouette.

Apply to: ConnectionDot, sidebar station pulses, McpStatus server dots, AgentCluster state indicators, AuxDeck flight status, OperationsRoster station states.

The pulse animation should _synchronise_ loosely with the Orb's current pulse period (already exposed as `--pulse-duration`) so the whole interface breathes together.

#### 4b. AuxDeck flight tracks → flow lines

The existing animated scan bar on running tools is good. Enhance it:
- Make the "scan" shimmer slightly warm-toned (gold thread through cyan) to echo the pyrefly colour mix.
- When a tool completes, flash the track briefly with `--accent-teal` then fade, like energy dissipating along a machina conduit.
- The flight orbs (16×16) could gain a very subtle 2-mote trail (two trailing dots at decreasing opacity) to echo the pyrefly motif without a full particle system.

#### 4c. Phase-badge treatment (BridgeRoomDetail, AssistantStatusStrip)

The phase badges ("Planning", "Investigating", "Delegating", etc.) currently use `color-mix()` for dynamic colours. Add a faint animated underline or edge-glow that pulses in time with the Orb. This visually links the textual status to the Orb's state, reinforcing that both are reading from the same "soul".

**Risk:** Medium. Status indicators are high-frequency UI elements. Changes to their size, shape, or animation timing directly affect scannability. Must A/B the concentric-ring treatment against the current dots at real data density (e.g., 5+ MCP servers, 8+ agents). If the rings are too noisy at density, fall back to the dots with just the synchronised pulse.

**Files touched:** `ConnectionDot.module.css`, `Sidebar.module.css`, `McpStatus.module.css`, `AgentClusterDetail.module.css`, `AuxDeck.module.css`, `BridgeRoomDetail.module.css`, `AssistantStatusStrip.module.css`, `OperationsRoster.module.css`

---

### Phase 5 — Chat and composer atmosphere (medium risk)

_Goal: Make the conversation surface feel like a Spira terminal transcript, not a generic chat._

#### 5a. Bubble chrome refinement

- **Assistant bubbles:** Add the etch-line inner border (from Phase 2a). Add a faint `::before` top-edge highlight (1px, accent-cyan at 10%) that suggests a machina readout panel.
- **User bubbles:** Keep the teal gradient but add a subtle diagonal hatch pattern (CSS `repeating-linear-gradient`, 45deg, 2% opacity) that reads as "user transmission" vs "system output." Very subtle — more texture than pattern.
- **Question state:** The existing enhanced glow is good. Add a single stray pyrefly mote (tiny animated dot) near the question mark / awaiting indicator to draw the eye.

#### 5b. Empty state and welcome screen

Replace the generic "Start a conversation" with a more thematic treatment:
- Title: Consider "Ready on the Bridge" or "Awaiting orders, Commander" (test both — the second is more fun but must not feel silly after the 100th time).
- Add 3-5 very slow-drifting pyrefly motes behind the empty-state content, fading in over 2s after mount. This connects the empty chat to the Orb's visual language.
- Prompt chips: Style with the etch-line border treatment so they feel like machina interface options, not social-media suggestions.

#### 5c. Message meta labels

Currently `USER` and `SPIRA`. Consider:
- `SPIRA` → `SHINRA` (matches the assistant identity consistently)
- Or keep `SPIRA` and add a tiny orb/mote icon (4px, state-coloured) before the label on assistant messages. This is cheaper than a label rename and connects visually to the Orb.

#### 5d. Streaming cursor

Current: blinking `▋` in cyan. Consider: a small pulsing orb (6-8px) instead of a block cursor — echoing the Orb's focus core at miniature scale. Risks: must not be mistaken for content; must not distract from reading. Fall back to current cursor if testing shows readability issues.

**Risk:** Medium. Chat is the highest-traffic surface. Any chrome addition (hatch patterns, motes, edge highlights) must be tested for readability at long conversation lengths with dense markdown content. The empty-state pyreflies are low-risk since they're only visible when no content exists. The streaming cursor change is the highest-risk item in this phase — default to the current cursor unless the orb variant clearly tests better.

**Files touched:** `MessageBubble.module.css`, `ChatPanel.module.css`, `ChatPanel.tsx`, `StreamingText.module.css`, `InputBar.module.css`

---

### Phase 6 — Iconography system (medium risk)

_Goal: Replace text-only / Unicode UI elements with a small, consistent icon set that carries the machina aesthetic._

#### 6a. Design a micro icon set (12-16 icons)

Hand-draw or adapt a set of SVG icons at 16-20px reference size. Visual language: thin strokes (1.5px), rounded terminals, occasional concentric-circle motif. Inspired by sphere-grid nodes and Al Bhed machina glyphs — geometric, luminous, functional.

Needed icons (minimum):
- **Ship** (base deck) — stylised top-down vessel or compass rose
- **Bridge** — helm/wheel or command-chair silhouette
- **Armoury** — interlocking rings or tool cluster
- **Barracks** — personnel/squad formation dots
- **Field Office** — branching node graph
- **Operations** — stacked horizontal lines (activity roster)
- **Settings** — gear or calibration dial
- **Voice** — waveform or concentric arcs
- **Send** — directional arrow or thrust indicator
- **Stop** — square-in-circle (sphere grid "lock")
- **Clear** — sweep arc
- **Archive** — stacked planes
- **Expand / collapse** — chevron (already implied by +/-)
- **Close / dismiss** — X with rounded terminals
- **Window controls** — minimise/maximise/close (replace Unicode chars)

#### 6b. Apply to sidebar and controls

Place icons before sidebar nav labels (Ship, Bridge, etc.). Reduces reliance on text and gives the nav a machina-console feel. Icons should be teal by default, brighter on active/hover.

Replace the sidebar `+` / `-` toggle with the chevron icon.

Replace TitleBar window controls with the icon set variants.

**Risk:** Medium. Custom icons require design effort and must be tested at multiple DPIs. Poorly drawn icons will make the app look amateurish rather than thematic. Mitigate by starting with 4-5 key icons (Ship, Bridge, Send, Stop, Voice) and expanding only after validating the visual language.

**Files touched:** New `assets/icons/` SVG files, `Sidebar.tsx`, `Sidebar.module.css`, `TitleBar.tsx`, `TitleBar.module.css`, `InputBar.tsx`, `ChatPanel.tsx`

---

### Phase 7 — Copy and terminology refinement (low risk, high flavour)

_Goal: Audit user-facing strings for opportunities to add FFX flavour without obscuring meaning._

#### Proposed changes (conservative)

| Current | Proposed | Rationale |
|---|---|---|
| "Command stations" (sidebar section) | Keep as-is | Already perfect — military + operational. |
| "Base overview" (Ship caption) | "Deck overview" | "Base" is generic; "Deck" reinforces the ship metaphor. |
| "Grouped local tools" (Armoury caption) | "Linked machina" or "Tool racks" | "Grouped local tools" is purely descriptive. "Linked machina" is thematic; "Tool racks" is the safe alternative. |
| "Live delegation rooms" (Field Office caption) | "Active deployments" | Tighter, more military. |
| "Voice + MCP" (Settings caption) | "Systems config" | More command-deck. |
| "Start a conversation" (empty state) | "Awaiting orders" or "Bridge ready" | Fits the command metaphor. |
| "Conversation archive" (chat toolbar) | "Mission log" | Natural for a command-deck. FFX has extensive mission/quest log UX. |
| "Wake Link" (voice indicator) | Keep as-is | Already distinctive and clear. |
| "Standing by" (idle status) | Keep as-is | Already good — military idle state. |
| "Delivering response" (speaking status) | "Transmitting" | Fits the radio/comms metaphor. |
| "Deciding the next move" (thinking status) | "Assessing" or keep as-is | "Assessing" is more tactical. |

#### What to leave alone

- Tool names (these come from MCP servers and must remain recognisable).
- Error messages (clarity > flavour).
- Technical metadata (timestamps, IDs, counts).
- Settings labels (must be unambiguous).

**Risk:** Low. Copy changes are the easiest to revert. The only danger is terms that confuse new users. Test each label by asking: "Would someone who has never played FFX understand what this does?" If no, don't ship it.

**Files touched:** `Sidebar.tsx`, `ChatPanel.tsx`, `shinra-status.ts`, `VoiceIndicator.tsx`, `tool-display.ts`, `BaseDeck.tsx`

---

### Phase 8 — Ambient sound (optional, aspirational, higher risk)

_Goal: Add subtle UI sounds that evoke FFX's ambient audio design._

This phase is explicitly optional and should only be pursued if the earlier phases land well.

#### Candidates

- **State-transition chime:** A short, crystalline tone (like a sphere-grid node activation) when Shinra transitions from idle → thinking. One note, ~200ms, very quiet.
- **Send confirmation:** A soft "whoosh" (like launching a Blitzball) on message send.
- **Pyrefly ambient hum:** An extremely low, slow sine-wave drone (barely audible) that plays while the Orb is visible and Shinra is active. Inspired by the Farplane ambient audio.
- **Permission prompt:** A deeper, attention-getting tone (like the Yevon prayer bell, but a single note — not the full melody, which would be corny and a rights concern).

All sounds must be:
- Original compositions (no FFX audio rips — copyright concern)
- Defeatable (mute toggle, defaulting to off)
- ≤ 100ms latency from trigger to playback
- ≤ 50KB total

**Risk:** Higher. Sound is polarising. Many users work in shared environments. Default-off mitigates this, but even the existence of UI sounds can feel gimmicky. Only pursue if testing with 3-5 real users shows positive reception.

**Files touched:** New audio assets, `SpeechController.tsx` (or new `UiSoundController.tsx`), settings store, `SettingsPanel.tsx`

---

## 4  What to Keep Restrained

These surfaces should receive _minimal or no_ atmospheric treatment to protect usability:

| Surface | Reason |
|---|---|
| **Chat message content area** | Dense text + markdown + code blocks. Any background texture or motion competes with reading. The bubble _chrome_ can evolve (Phase 5), but the content area inside must stay clean. |
| **Settings panel controls** | Toggles, sliders, inputs, selects — these are functional widgets. Theme them with token colours (they already are) but don't add ornament. |
| **Monospace / code blocks** | These are developer content. They should feel like a clean terminal, not a themed surface. |
| **Error states** | Red + clear copy. No thematic distractions when something is broken. |
| **Permission prompt content** | Security-critical. The _panel chrome_ can be themed (Phase 2b), but the approve/deny controls and explanation text must be maximally clear. |
| **Scrollbars** | Already themed. Don't make them busier. |
| **Animation timing on interactive controls** | Buttons, toggles, and inputs should respond in ≤160ms (current `--animation-fast`). Atmospheric animations can be slow; interactive feedback must stay snappy. |

---

## 5  Summary — Priority × Risk Matrix

| Phase | Priority | Risk | Effort | Key payoff |
|---|---|---|---|---|
| 0 — Tokens | P0 | Minimal | Small | Unblocks everything else |
| 1 — Ambient background | P1 | Low | Medium | Biggest atmosphere gain for lowest risk |
| 2 — Panel chrome | P1 | Low-Med | Medium | Moves panels from generic to machina |
| 3 — Typography + brand | P1 | Low | Small | Instant identity upgrade |
| 4 — Status indicators | P2 | Medium | Medium | Unifies the visual heartbeat |
| 5 — Chat atmosphere | P2 | Medium | Medium | Themes the highest-traffic surface |
| 6 — Iconography | P3 | Medium | Large | Replaces text with visual language |
| 7 — Copy/terminology | P1 | Low | Tiny | Quick flavour win, no code risk |
| 8 — Ambient sound | P4 | Higher | Medium | Polarising but distinctive |

Recommended implementation order: **0 → 3 → 7 → 1 → 2 → 4 → 5 → 6 → 8**

(Tokens first, then the two quickest flavour wins — typography and copy — then the atmospheric and structural work in descending risk order. Icons and sound are last because they require the most design iteration.)
