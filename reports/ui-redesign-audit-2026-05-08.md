# Spira UI Redesign — Audit & Vision

**Date:** 2026-05-08
**Reviewer:** UI / frontend-design pass over `packages/renderer/`
**Scope:** Whole renderer surface — `AppShell`, `Sidebar`, `TitleBar`, `BaseDeck` and all `RoomCard`s, `BridgeRoomDetail`, `ChatPanel`, `MessageBubble`, `InputBar`, `ShinraOrb`, `AssistantStatusStrip`, `AuxDeck`, `MissionShell`, `FlightLayer`.
**Companion plan:** [ui-living-airship-redesign.md](../plans/ui-living-airship-redesign.md)

> **Revision note (2026-05-08):** updated after author clarified the desired nostalgia is **heavy FFX X**, not X-2. The first draft leaned brass-and-glass cockpit (X-2 Celsius energy); this revision pivots toward Bevelle cathedral, Cloister of Trials, Macalania crystal, Sphere Grid constellation, and the Hymn of the Fayth. The audit findings (§§ 1–3) are unchanged; the vision (§§ 4–8) is rewritten.

---

## 1. Executive verdict

The essence is real. The execution is timid.

Spira already has the bones of a distinctive product — a Final Fantasy X / X-2 vocabulary (bridge, armoury, barracks, mission, pyrefly, farplane), a soulful animated orb that responds to voice and assistant phase, a navy-and-amber palette, and even some calligraphic gestures (Palatino display, corner brackets, gold eyebrows). But the whole renderer reads as **"a competent dark dashboard with FFX nouns sprinkled on top."** It is not yet **"you are standing on the deck of an airship."** The lexicon and the orb do most of the heavy lifting. The rest of the UI lets them down.

This document is an unflinching audit followed by a single bold direction: **the Living Airship.** A full conversion from "dashboard themed as ship" to "diegetic cockpit interface." The companion plan ships it in 6 phases that can each go in independently.

---

## 2. What's working — keep these

These are the pieces the redesign should **build on**, not replace:

| Asset | Why it works |
| --- | --- |
| The pyrefly orb ([ShinraOrb.tsx](../packages/renderer/src/components/orb/ShinraOrb.tsx), [ShinraOrb.module.css](../packages/renderer/src/components/orb/ShinraOrb.module.css)) | 24 motes, drift + blink + audio-driven core + voice waves + scan sweep. Per-state palette swap. This is the *soul* of Spira. The redesign **promotes** it from a 290px aside to the gravitational center. |
| The color skeleton ([global.css:1-32](../packages/renderer/src/global.css)) | Deep navy (#080d1c), farplane teal (#68c6b4), Macalania cyan (#8dd6ea), Spiran gold (#d7b062 / #e3bf77). The hues are right — they're just used too evenly. |
| The lexicon | Bridge, Armoury, Barracks, Field Office, Operations, Missions, pyrefly, farplane, Shinra. We keep all of it; we just *show* what we already say. |
| Per-station presence color via CSS `color-mix` ([BridgeRoomDetail.module.css:71-83](../packages/renderer/src/components/base/BridgeRoomDetail.module.css)) | The `--presence-color` pattern is excellent. Extend it everywhere. |
| Flight-layer trail orbs ([FlightLayer.tsx](../packages/renderer/src/components/base/FlightLayer.tsx)) | Genuinely cool — tool calls visualized as orbs flying between rooms. Underused; should be louder. |
| The "S + 3 motes" mark in [Sidebar.tsx:73-78](../packages/renderer/src/components/Sidebar.tsx) | Strongest piece of identity in the app. Promote into a real Yevon-glyph monogram. |

---

## 3. What's holding it back

### 3.1 Typography is wrong for the world

```
--font-ui: "Segoe UI", system-ui, sans-serif;
--font-display: "Palatino Linotype", "Book Antiqua", Georgia, serif;
```

Segoe UI is **Windows chrome**. It says *settings dialog*, not *airship console*. Palatino is a step toward the FFX chapter-screen feel but it is flat, lifeless on glyphs, and lacks the carved/inscriptional quality that FFX's chapter cards use. The audio of the type is wrong: nothing here whispers "Spiran ruin" or "Yevon scripture."

**Evidence in the wild:** every room title uses Palatino in `text-transform: uppercase` with `letter-spacing: 0.03em`. Palatino was not drawn for that — its caps are wide and soft and need optical kerning the system cannot supply.

### 3.2 The deck overview is not a deck

[BaseDeck.tsx](../packages/renderer/src/components/base/BaseDeck.tsx) renders a 3×3 CSS grid of rectangular cards with corner brackets. Each "room" is the *same shape* — only the gradient tint and label differ.

The backdrop tries to suggest a ship cross-section (a vertical spine line, two horizontal "row lines," six glowing eyelets at intersections) but at the resolutions this app actually runs at, those marks are <1% opacity dust. The user sees seven nearly-identical tiles in a grid. There is no airship. There is no hull. There is no port/starboard, fore/aft, above/below. The metaphor is *told* by labels and *not shown* anywhere on screen.

### 3.3 Visual repetition (one recipe, eight panels)

Almost every panel in the app follows the same recipe:

```css
border: 1px solid rgba(141, 214, 234, 0.14);
border-radius: 14px – 20px;
background:
  radial-gradient(circle at 88% 16%, rgba(141, 214, 234, 0.06), transparent 22%),
  linear-gradient(180deg, rgba(13–17, 19–24, 40–56, 0.86–0.96), rgba(8, 12, 30, 0.7–0.96));
box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 0 44px rgba(227, 191, 119, 0.08);
```

I count **17** panel-style declarations across the renderer using minor variations of this recipe ([RoomCard.module.css:1-15](../packages/renderer/src/components/base/RoomCard.module.css), [ChatPanel.module.css:1-15](../packages/renderer/src/components/chat/ChatPanel.module.css), [BridgeRoomDetail.module.css:46-83](../packages/renderer/src/components/base/BridgeRoomDetail.module.css), [Sidebar.module.css:157-166](../packages/renderer/src/components/Sidebar.module.css), [MissionShell.module.css:7-18](../packages/renderer/src/components/missions/MissionShell.module.css), `BaseDeck.module.css`, `AuxDeck.module.css`, `AssistantStatusStrip.module.css`, etc.).

The result: every surface looks like a sibling of every other surface. Hierarchy collapses. The bridge does not feel different from the armoury does not feel different from the chat panel.

### 3.4 The orb is buried

The orb is the soul of the product. On the deck overview it does not appear at all (the bridge tile shows two text mini-panels instead). On the bridge view it sits in a `max-width: 290px; min-height: 230px;` chip in an `aside.visualColumn` ([BridgeRoomDetail.module.css:42-44](../packages/renderer/src/components/base/BridgeRoomDetail.module.css), [ShinraOrb.module.css:1-9](../packages/renderer/src/components/orb/ShinraOrb.module.css)) — dwarfed by the chat. The pyreflies and farplane halo and audio-driven core deserve to *be* the room.

### 3.5 No diegetic surface materials

A real airship/spacecraft cockpit has materials: brushed brass, riveted hull plates, lacquered wood, frosted glass, leather. Spira has only one material: **dark glass**. There is no metal, no wood, no engraving, no rivet, no curve of the hull. Everything is rounded rectangles with a teal stroke.

### 3.6 No shape language

FFX has rich shape DNA — the Yevon spiral, the Sphere Grid hexagon lattice, the curved bony fins of the Fahrenheit / Celsius hull, the arched portals of Bevelle, the soft round summoner sigils. **None of this DNA appears anywhere in the renderer.** Every boundary is `border-radius: 8–20px`. Every divider is a 1px linear gradient. We have the world's vocabulary; we lack its silhouettes.

### 3.7 Color hierarchy is muddy

Six accent colors compete on equal footing:

| Token | Usage |
| --- | --- |
| `--accent-teal` `#68c6b4` | system "idle" + chat user bubbles + scrollbar |
| `--accent-cyan` `#8dd6ea` | "listening" + borders + corner brackets |
| `--accent-gold` `#d7b062` | inscriptions, very rare |
| `--accent-amber` `#e3bf77` | eyebrows, "speaking" |
| `--accent-purple` `#4f8bbd` | "thinking" — but it is a **blue-grey**, not purple, despite the name |
| `--state-error` `#ef4444` | Tailwind red-500 — generic |

There is no dominant. The amber/gold — the *Spiran* color, the summoner color, the airship-glint color — is the rarest. The redesign should let gold sing.

### 3.8 Motion is conservative

The orb is animated beautifully. Everything else is `framer-motion` fade/slide on view transitions and a few hover transitions. No ambient motion. The bridge, once landed, is static. There is no engine hum, no cloud parallax, no ship sway, no pyrefly storm crossing the empty state. The *world* does not breathe.

### 3.9 Mission view fork

`MissionShell` ([MissionShell.module.css:14-18](../packages/renderer/src/components/missions/MissionShell.module.css)) and [AppShell.module.css:38-49](../packages/renderer/src/components/AppShell.module.css) both shift to a different blue palette `rgba(115, 141, 220, ...)` on `missionApp`. It feels like a different app, not a focused mode of the same one. The aesthetic should *deepen*, not switch.

### 3.10 The corner-bracket motif is thin

Many panels have a small `::before` and `::after` set of L-brackets in the corners. The motif is fine, but it is the *only* repeated decorative gesture, and it is small (28×28px), low-contrast, and identical on every surface. It carries no meaning.

### 3.11 "Field Office" — tone breakage

Of the seven primary nouns — Bridge, Armoury, Barracks, Operations, Missions, Settings, Field Office — six are airship/military. **Field Office** is corporate real-estate. It snaps the world.

### 3.12 Empty states are dead air

[ChatPanel.tsx:129-152](../packages/renderer/src/components/chat/ChatPanel.tsx) shows three example prompts inside a small panel with the headline "Shinra is awaiting orders." The three prompts are good copy but the visual is forgettable. This is a *prime moment* to put a slow drift of pyreflies behind the prompts and to let the Cinzel display type carve "AWAITING ORDERS" with an animated stroke.

### 3.13 The boot shell is an afterthought

[index.html:7-92](../packages/renderer/index.html) renders a minimal pre-React boot panel using Segoe UI on solid navy. It is the very first frame of the app and currently says nothing about what Spira is. The redesign treats the boot as the *opening shot* — pyreflies congregating into the orb, "SPIRA" engraving in.

---

## 4. The redesign — The Cloister Above

One sentence: **Cid's airship is a flying cloister. The interface is its sacred chambers — Bevelle marble, Macalania crystal, Spiran gold, and pyreflies adrift in dusk.**

### 4.1 Aesthetic direction

> A solemn, FFX-nostalgic flying cloister. The user is inside Cid's airship, but the airship is not a cockpit — it is a **temple in the sky**. Bevelle cathedral arches frame every chamber. Macalania crystal forms the windows and panels. Spiran gold inscriptions name the rooms in the language of Yevon. Pyreflies drift through the air as if you're standing in a ruin at dusk, watching memory pass. Behind it all, a faint hymn — silent, vertical, breathing — the Hymn of the Fayth as a light layer.
>
> The reference is **FFX, not X-2**: To Zanarkand piano, the Cloister of Trials, the prayer animation, the moment Yuna walks into Bahamut's chamber, the dust of pyreflies on the road to Zanarkand. The vibe is **reverent**, not zippy.

This is **maximalist** in atmosphere and **restrained** in chrome. Heavy on world (clouds, pyreflies, hymn-light, sphere-grid constellations). Quiet on UI noise (no cyber-borders, no terminal scanlines, no hex-grid overlays for their own sake).

### 4.2 Typography (commit and don't waver)

Drop Segoe UI and Palatino entirely. New stack:

| Role | Family | Why |
| --- | --- | --- |
| **Display / engraved labels** | **Cinzel Variable** (OFL via @fontsource-variable) | Roman inscriptional capital. Reads like Bevelle stone tablet, like the FFX chapter-card lettering. Used for room titles, eyebrows, the SPIRA wordmark, and all "carved" UI. |
| **Body / messages / meta** | **Cormorant Garamond** (OFL via @fontsource) | Italianate Garamond revival with delicate strokes and high-contrast capitals. Cathedral-inscriptional warmth without losing legibility at body size. Replaces the earlier draft's Fraunces — Cormorant feels more **temple-script** and less *contemporary editorial*. Used for chat content, captions, tooltips, paragraph text. |
| **Hymn / vocalise accent** | **Pinyon Script** (OFL via @fontsource) | Calm, single-weight calligraphic script. Used **rarely** — three places only: the Hymn watermark on the boot, a faded inscription behind the orb chamber, and the bottom epitaph on the deck overview. Never for body text. Never for UI. |
| **UI numerics / mono** | **JetBrains Mono Variable** (OFL) | For mission IDs, ticket counts, ports, elapsed times, file paths in tool flights. |

Explicitly avoided: Inter, Roboto, Space Grotesk, Arial, system-ui, Segoe UI, Palatino, Times, Helvetica.

Token additions to [global.css](../packages/renderer/src/global.css):

```css
--font-display: "Cinzel Variable", "Cinzel", "Cormorant SC", serif;
--font-body: "Cormorant Garamond", Georgia, "Times New Roman", serif;
--font-hymn: "Pinyon Script", "Italianno", cursive;
--font-mono: "JetBrains Mono Variable", "JetBrains Mono", "Cascadia Code", monospace;
--font-eyebrow: "Cinzel Variable", serif; /* 11px / 0.18em / uppercase / weight 500 */
```

### 4.3 Color (Bevelle gold over Zanarkand dusk)

The previous draft locked to brass-warm cockpit gold. The FFX revision **softens** the gold toward Bevelle cathedral gold and adds two new tones — Macalania crystal and Bevelle marble — that didn't exist in the cockpit framing. The hull shifts from pure navy to **dusk indigo** (Zanarkand-at-dusk) to support those tones.

| Role | Token | Hex | Usage |
| --- | --- | --- | --- |
| **Hull** (dominant, ~62%) | `--hull-deep` / `--hull-mid` / `--hull-edge` / `--hull-rim` | `#080d22` / `#121a3a` / `#1d2750` / `#2a3358` | Backgrounds, plates, chamber walls. Indigo, not navy — closer to the Zanarkand opening shot. |
| **Spiran gold** (hero, ~14%) | `--gold-bright` / `--gold-warm` / `--gold-deep` / `--gold-shadow` | `#f5da9c` / `#e0c489` / `#a8854a` / `#5e4720` | Engraved labels, primary actions, active state, the orb's halo, room titles. Bevelle/Zanarkand sodium-gold, not brass-cockpit yellow. |
| **Macalania crystal** (atmospheric, ~10%) | `--crystal-mist` / `--crystal-glow` / `--crystal-deep` | `#bff0e6` / `#92e3da` / `#3d7a76` | Windows, glass panels, hover halos, listening state, link underlines, the ice-forest motifs. |
| **Bevelle marble** (rare highlight, ~6%) | `--marble-ivory` / `--marble-warm` | `#f1e6cc` / `#d8c8a3` | The single brightest highlights — chat text on important moments, the assistant's voice text, the prayer-animation focus ring. |
| **Hymn** (vocalise accent, ~3%) | `--hymn-soft` / `--hymn-bright` | `#b89ed8` / `#d4bff0` | Used only by the Hymn-of-the-Fayth motion layer and the "thinking" state. Replaces the old `--state-thinking` blue-grey. |
| **Sin** (state error, ~5%) | `--sin-blood` / `--sin-deep` | `#a83a3a` / `#5e1818` | Replaces flat Tailwind red-500 with Sin's blood-garnet. Used only for actual error states. |

Remove `--accent-purple` entirely. Promote the existing `--accent-amber` chain to `--gold-*`. The `--state-thinking` token now points at `--hymn-soft`. Macalania crystal **is** the new cyan family.

### 4.4 Shape language — sphere grid, arches, hymn-bar

Five motifs codified in [new file] `packages/renderer/src/components/decor/Glyphs.tsx`:

1. **Yevon Spiral** — the three-arm logarithmic spiral. Used as the loading indicator, the wordmark monogram, the corner-cartouche on cartouche-variant plates, and the "AWAITING" stamp in the chat empty state.
2. **Sphere Grid Constellation** — *the* signature motif. Nodes connected by glowing lines, breathing slowly. Used as: (a) the deck overview's primary structure (§ 4.5), (b) hover-ripple on room cards, (c) the bullet glyph for nav items, (d) the background of the Cloister chamber on the bridge.
3. **Bevelle Arch / Compound Arch** — single thin gold arc above each room title (cartouche cap), elevated to a *compound* triple-arch above the bridge orb chamber (echoing the Bevelle cathedral exterior). Replaces the corner-bracket motif everywhere.
4. **Cloister Pedestal** — a stepped octagonal base with a recessed glyph slot. Holds the orb on the bridge. Holds confirmation prompts (permission, reset). Holds the active-station mark in Operations. The pedestal is the FFX trial-puzzle vessel — give it room.
5. **Hymn Vocalise Bar** — a thin vertical lavender light column on the right edge of the screen, breathing at ~7s period. Carries the *vocal* of the hymn — silent, ambient, present during long agent operations. This is the only place lavender appears.

Borders go from uniform `border-radius: 14px` everywhere to a deliberate vocabulary:

- **Plates** (instrument panels): `border-radius: 4px` with a thin gold inscription-line on the bottom edge instead of rivets — temple, not factory.
- **Cartouches** (room titles, the orb chamber): clip-path `polygon` with chamfered top corners + Bevelle arch above.
- **Glasswork** (chat, message bubbles, Macalania panels): `border-radius: 16px` with an inner `inset 0 1px 0 rgba(crystal-mist)` glass highlight and a faint frosted gradient.
- **Pedestals** (confirmation, orb base): stepped octagon via clip-path; gold-rimmed; cast a soft underglow.

### 4.5 Spatial composition — Sphere Grid over the airship hull

Replace the 3×3 grid in [BaseDeck.tsx](../packages/renderer/src/components/base/BaseDeck.tsx) with a **Sphere Grid constellation** of room-nodes, set against a soft silhouette of the airship hull behind. The Sphere Grid is the second-most iconic visual in FFX (after the orb). The airship silhouette keeps the user's "I'm on a ship" intuition that the original UI invested in.

```
                           ✦ BRIDGE          (gold, large node, brightest)
                          ╱  │  ╲
                         ╱   │   ╲
                ✦ CLOISTER ─ ✦ ARMOURY      (mid nodes — your three "rooms")
                  │            │
              ✦ PILGRIMAGE ── ✦ OPERATIONS   (lower nodes)
                  │            │
                  ╰─── ✦ SPHERE GRID ───╯    (Settings — the grid editor itself)

      ░░░░░ airship hull silhouette behind, low opacity ░░░░░
```

Each node is a **sphere** (a circular cartouche) sized by its activity. Lines between nodes are the actual sphere-grid connections, drawn in `--gold-deep`. The currently-active node lights at `--gold-bright` and casts the strongest halo. Hover lights the path *to* that node. Flights (the existing `FlightLayer`) travel along the constellation lines as glowing capsules — same data, much better diegesis.

The airship hull silhouette behind the constellation: a single hand-drawn SVG path of the Fahrenheit silhouette (or a clearly FFX-airship-shaped composite), rendered at ~6% opacity in `--gold-shadow`. Slow parallax — drifts left at ~600s per cycle. Anchors the *flying* part of "flying cloister."

| Old name | New name | Sphere-grid node identity |
| --- | --- | --- |
| Bridge / Command | **Bridge** | Largest node, top of the constellation. The orb shines through it. |
| Armoury (MCP) | **Armoury** | Right-mid node. Inside: vertical glyph-marked weapon silhouettes, one per connected MCP server. |
| Barracks | **Barracks** | (currently grouped under "Cloister" in the constellation if used; otherwise its own node.) |
| Field Office (agents) | **Cloister** | Round chamber seen from above with a single Sphere Grid node at its center; ring of sleeping pyreflies = ready agents. **Replaces the corporate "Field Office" name with the FFX-iconic "Cloister."** |
| Operations | **Operations** | Bezel dial of stations as needles. Stays "Operations" — generic enough to fit. |
| Missions / Projects | **Pilgrimage Log** | A leather-bound pilgrimage record of mission tickets, with brass clips. **Replaces "Missions" with the in-game term for what the player's actually doing.** |
| Settings | **Sphere Grid** | The Sphere Grid editor itself — settings as nodes you've activated/deactivated. **The most FFX-iconic rename in the redesign.** |

These node-silhouettes can be authored once as inline SVG in `decor/RoomSilhouettes.tsx`. They are decorative; data overlays them.

### 4.6 Promote the orb — Fayth statue on a pedestal

The orb stops being "the engine" (X-2 framing). It becomes **the Fayth statue** in the Cloister of Trials antechamber. Same pyrefly visual; new staging:

1. **Deck overview** — at the gravitational center of the Sphere Grid constellation, the orb floats above a stepped octagonal pedestal, framed by a triple Bevelle arch behind. Room-nodes orbit around it.
2. **Bridge view** — the orb is **dead center**, stage-sized (`min(60vmin, 540px)`), suspended above a Cloister Pedestal with a Yevon-spiral inscription glowing on the floor (the FFX prayer-animation echo). Behind it, three Bevelle arches recede as if you're looking into the back of the temple. Chat moves below as a torchlit hymnal scroll. Pinyon Script "Ieyui Nobomeno..." style watermark fades in and out at ~5% opacity behind the orb during idle — never legible enough to be literal lyrics, just the *shape* of vocalise.
3. **Status strip** — the existing `AssistantStatusStrip` 8px dot becomes a 22px **mini-Fayth** that pulses on speak.

### 4.7 Motion — the world breathes; the hymn carries

Add five ambient motion layers, painted globally in `AppShell`. These are not decoration — they're the *score* of the interface.

1. **Pyrefly drift** (z: -3): a low-density field of slow-moving pyreflies, ~12 in flight at any moment, randomly positioned, lifetime 14–22s, fading in/out. Density spikes briefly when the assistant transitions out of `idle`. Color tinted by current presence color.
2. **Macalania ash / cloud parallax** (z: -3): two SVG layers of soft ash-flake/cloud-band particles drifting at 280s and 480s loops. Tinted `--crystal-mist` at 0.04 opacity. Provides the slow horizontal *passing* feeling of being in motion above the world.
3. **Sphere Grid breathe** (z: -2, only on deck): the constellation lines pulse opacity 0.4 → 0.6 over 6s. The active-room node breathes faster.
4. **Hymn vocalise bar** (z: -1): the vertical lavender light column on the right edge breathes at 7s period, opacity 0 → 0.12. **Always on**, so quiet you barely register it. Spikes brighter (to 0.22) during long agent operations (>15s tool flights, mission runs). This is the silent score. Replaces the previous draft's "engine throb" — gold→indigo at the bottom edge would compete too directly with the deck constellation.
5. **Ship sway** (the `.app` shell): `transform: rotate(0.18deg)` cycling over 11s. Imperceptible per-frame; deeply felt over a minute. **Skipped under `prefers-reduced-motion`.**

In addition (event-driven motion):

- **Boot reveal** (§ 4.10): pyreflies congregate from corners; "SPIRA" engraves in Cinzel; Pinyon Script hymn watermark fades.
- **Room hover**: a Sphere Grid hex-ripple expands across the card from the cursor; the path *to* the active node lights gold.
- **Speak/Listen state change**: the orb's pedestal floor-glyph fires a single golden ripple outward (one-shot, 480ms ease-out). The FFX prayer animation in 24 frames.
- **Tool flight arrival**: the destination node's halo flares once (240ms).
- **Agent operation begins** (long mission run): the Hymn bar brightens to 0.22 for the duration; returns to 0.12 at the end.

### 4.8 Diegetic empty states

Every empty state gets a **world** answer:

| Surface | Empty payload |
| --- | --- |
| Chat (no messages) | A single Cinzel headline "AWAITING ORDERS" carved in stroke-animation, plus 3 free-floating pyreflies idling in formation beside it. The 3 example chips become **prayer scrolls** — small Cormorant Garamond italic on a parchment-tinted plate, with a Yevon spiral seal at the corner. |
| Aux deck (no flights) | The Yevon spiral slowly rotates; "BRIDGE QUIET" engraved in Cinzel through it. |
| Cloister (no agent rooms) | A round chamber from above with a single empty Sphere Grid node at its center; "No fayths summoned." |
| Operations (single station) | The bezel dial shows one needle alone; below: "One bridge active." |
| Pilgrimage Log (no missions) | A closed pilgrimage book with a brass clip; "No pilgrimage active." |

### 4.9 Mission view becomes the pilgrimage record

`MissionShell` switches from "blue-tinted cousin of the bridge" to a **pilgrimage scroll**: parchment-tinted hull (`#1a1408` warm parchment-on-near-black), brass clip at the top, ticket id stamped, mission body in Cormorant Garamond. The FFX summoner pilgrimage record. The other rooms (Bridge, Operations, etc.) look like temple chambers; Mission view looks like the record of the journey through them.

Mission room-tabs (Details / Changes / Actions / Processes) become brass-edged tablet tabs, each with its own Yevon-glyph icon.

### 4.10 The boot shell as opening shot — Zanarkand at dusk

[index.html](../packages/renderer/index.html) is replaced with a real opening sequence. Same backing markup (we still need the `#root` and `#spira-boot-shell` for fatal recovery), but the visual is **the Zanarkand opening shot** — silent, slow, FFX-piano-flavored:

1. **Dusk silhouette** (0.0–0.3s): black-to-deep-indigo gradient, a faint silhouette of Zanarkand-style ruins along the bottom edge (single hand-drawn SVG path).
2. **Pyrefly congregation** (0.2–1.1s): 9–12 pyreflies fade in from random radial coordinates, slowly arcing toward the center of the screen, congregating into a single bright orb-point.
3. **Hymn watermark** (0.4–1.2s): a Pinyon Script watermark — a few hymn-shaped strokes, never readable as words — fades in at 14% opacity behind the gathering orb, then fades down to 4% as the wordmark begins.
4. **Wordmark engrave** (0.8–1.6s): "SPIRA" engraves in Cinzel via SVG `stroke-dashoffset` — one letter per ~140ms, staggered. Color: `--gold-bright`.
5. **Subtitle settle** (1.4–1.8s): "SHINRA · COMMAND INTERFACE" appears below the wordmark in spaced Cinzel small caps at `--gold-warm`.
6. **Single arch** (1.5–1.9s): one Bevelle arch draws underneath the wordmark in `--gold-deep`.
7. **Crossfade to root** (1.8–2.1s): `#root` fades up; the boot shell fades down.

Total: ~2.1s. Same recovery path on error (current copy retained, but now styled with Cinzel + Cormorant Garamond and the new palette).

---

## 5. Differentiation moments — what someone remembers

Three "tell-your-friend" moments the redesign has to land. All three explicitly hit FFX X nostalgia, not X-2:

1. **The boot — Zanarkand at dusk.** Pyreflies converging from corners, Pinyon Script hymn watermark behind, "SPIRA" engraving in Cinzel, single Bevelle arch settling under the wordmark. The opening 2 seconds *are* "To Zanarkand," visually.
2. **The deck — Sphere Grid Constellation.** The first time the user lands on the deck and sees the rooms as **a Sphere Grid**, glowing nodes connected by gold lines, breathing slowly, with the airship hull silhouette drifting behind. This is the single most FFX-iconic moment in the app — the Sphere Grid is in muscle memory for anyone who played 80 hours of FFX.
3. **The Bridge — the Fayth Chamber.** The orb dead center, suspended above a Cloister Pedestal with a Yevon-spiral floor glyph, framed by a triple Bevelle arch behind. Pinyon Script hymn watermark drifts at 5% opacity. When the user asks Shinra a question and the orb pulses, it's **the prayer animation**. If this moment lands, the user has the same body-feeling as walking Yuna into a temple.

If those three land, every other surface in the app reads as part of the same world.

---

## 6. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Maximalism interferes with reading legibility (especially chat) | Chat content uses Fraunces 16px / 1.62 line-height with a cream-tinted near-white (`#f0e5cb`) on a flat dark plate behind the message bubbles — *more* legible than today. Decoration sits outside the reading rectangle. |
| Ambient motion creates GPU load on weaker devices | All ambient layers respect `prefers-reduced-motion`. Skybox + pyrefly storm + engine throb collapse to a static gradient when reduced. Tested baseline: Intel UHD 630 / Electron renderer. |
| Inscriptional caps at small sizes look jagged | Cinzel is variable; we use weight 500 at 11px and 600 at 22px+. We render at full DPI scale, antialiased, and reserve all-caps for ≥11px. |
| New shape language drifts each surface design | All shapes are codified in `decor/Glyphs.tsx` + `decor/RoomSilhouettes.tsx` + tokens. No surface invents shapes. |
| The redesign breaks tests / IPC contracts | Pure renderer change. Stores, IPC, mission run state are untouched. Visual snapshot tests will need rebaselining; component test contracts (e.g. [MessageBubble.test.tsx](../packages/renderer/src/components/chat/MessageBubble.test.tsx), [McpClusterDetail.test.tsx](../packages/renderer/src/components/base/McpClusterDetail.test.tsx)) keep passing. |
| Renaming "Field Office" / "Settings" / "Missions" breaks nav | The `SidebarView` / `SpiraUiView` types stay the same id strings (`agents`, `settings`, `projects`). Only the human label changes — to **Cloister**, **Sphere Grid**, **Pilgrimage Log** respectively. |
| Heavy FFX iconography reads as IP-infringing on the chrome | Yevon spiral, sphere-grid hex, Bevelle arches, pyrefly motes, and Cloister pedestals are all **abstract visual primitives in the public domain** (logarithmic spirals, hexagons, archways, particle drifts, octagonal stepped bases). They evoke FFX without copying any specific Square Enix asset. The Pinyon Script "hymn" watermark is shape-only — never the actual hymn lyrics. |

---

## 7. What this report **does not** propose

To keep scope honest, the redesign **does not**:

- Change IPC, the chat protocol, the MCP wire format, or any backend behavior.
- Touch the voice pipeline, audio store, or wake-word logic.
- Refactor stores (`chat-store`, `room-store`, `station-store`, etc.) — they stay as-is.
- Add R3F / WebGL beyond what's already in [package.json:10-21](../packages/renderer/package.json) (`@react-three/fiber` is already installed but currently unused — we may use it for the orb in a later phase, but not as a hard dependency of this redesign).
- Rewrite the mission run controller, the permission lifecycle, or any business logic.

This is a renderer redesign. The plan in [ui-living-airship-redesign.md](../plans/ui-living-airship-redesign.md) is structured so it can ship in phases without ever halting feature work.

---

## 8. Recommendation

**Adopt The Cloister Above direction.** The changes are:

- **Right-sized for impact:** identifiable from the first frame (Zanarkand dusk → Sphere Grid → Fayth chamber). Three moments any FFX player recognizes in the first 90 seconds.
- **True to the existing product:** keeps the lexicon, keeps the orb, keeps the IPC and stores untouched. Refines (not replaces) the colors. Promotes the airship from "label" to "silhouette behind the constellation."
- **Phased and safe:** the implementation plan ships in 6 independent phases. Each phase leaves the app shippable. Phase 1 alone (atmosphere + tokens + fonts) lands ~60% of the perception lift.
- **Reverent, not parodic:** the FFX iconography is abstract (spirals, hexagons, arches, octagonal pedestals, particle drift). Evocation, not imitation. Pinyon Script hymn watermarks are shape-only, never literal lyrics.

The current UI is competent. The Cloister Above UI is *the reason someone installs Spira instead of yet another assistant — and the reason an FFX player keeps it open just to look at it.* That's the gap the redesign closes.

Proceed to [ui-living-airship-redesign.md](../plans/ui-living-airship-redesign.md) for file-level steps, token diffs, and the phase rollout.
