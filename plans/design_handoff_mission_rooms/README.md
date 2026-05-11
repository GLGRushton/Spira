# Handoff: Mission Rooms Redesign (Changes / Actions / Processes)

## Overview

Three takes each on the three "doing the work" rooms of an active Spira mission. Nine
artboards total, presented side-by-side on a pannable canvas for direct comparison.

The rooms covered:

- **Changes** — the diff + files surface (what's in the working tree across every
  managed repo and submodule).
- **Actions** — the commit / push / publish / PR workflow that ships those changes.
- **Processes** — launch profiles + live services running for the mission.

The fourth room, **Details**, is not redesigned here — the parent chrome (sidebar,
breadcrumb, mission tab strip) is reused from the broader `App Redesigns.html`
exploration (the "v2-Linear" direction).

---

## About the design files

The files in this bundle are **design references created in HTML**. They are
React-on-the-fly prototypes that show *intended look and behavior*, not production
code to copy directly. The task is to recreate these designs in the Spira codebase
(packages/renderer — React + TypeScript + CSS modules) using its established
patterns: the existing `MissionShell` and `Mission*Room` files in
`src/components/missions/`, the existing CSS module conventions, and the existing
theme tokens.

The chrome shown in the prototypes (sidebar + breadcrumb header + mission sub-nav)
is rendered against a **Linear-inspired token set** that does not yet exist in the
codebase. That theme is documented in the sibling file
`SPIRA_LINEAR_DESIGN_SPEC.md`. **If the team has chosen not to adopt that theme,
the room *bodies* in these prototypes (the unique part of each variation) still
translate directly — only the chrome wrapper changes.** Each room body is a single
self-contained surface and does not reach into the chrome for tokens beyond the
ones listed under "Design tokens" below.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, and interaction affordances
are all specified. Layout grids, component sizes, and copy are as-shipped.

The mock data (`rooms/data.js`) is shaped after the real `TicketRunSummary`,
review snapshot, and launch-profile types found in
`src/components/missions/rooms/Mission{Changes,Actions,Processes}Room.tsx`, so
component props should map directly.

---

## Files in this bundle

```
design_handoff_mission_rooms/
├── README.md                       ← this file
├── Mission Rooms Redesigns.html    ← the canvas wrapper (open this in a browser)
├── rooms/
│   ├── data.js                     ← realistic mock data shaped like the real types
│   ├── chrome.jsx                  ← shared Linear chrome (sidebar + mission tabs)
│   ├── changes.jsx                 ← 3 Changes-room variations
│   ├── actions.jsx                 ← 3 Actions-room variations
│   └── processes.jsx               ← 3 Processes-room variations
└── redesigns/
    └── canvas.jsx                  ← the pan/zoom DesignCanvas wrapper
```

Open `Mission Rooms Redesigns.html` directly in a browser to see the working
prototypes. Drag to pan, ⌘/Ctrl + scroll to zoom, double-click any artboard to
focus it fullscreen.

---

## Screens / Views

Each room has three variations (V1 / V2 / V3). They share **the same data**;
they differ only in how that data is laid out. The intent is for the team to pick
one direction per room (they don't have to be the same number across rooms).

### CHANGES room

The **Changes** room shows the live diff across every repo and managed submodule
in the mission, plus the file list. Today's implementation lives in
`MissionChangesRoom.tsx` and uses the `controller.reviewSnapshot.repos` /
`.submodules` shape — both variations consume that same shape.

#### V1 — Split diff (file tree + viewer)

**Mental model:** GitHub PR review page. Tree on the left, full diff on the right.

- **Layout:** Two-pane grid, 300px left column + flexible right column. Both fill
  the available room height (header + mission tabs already consumed above).
- **Left column:** File filter input at the top. Then a stack of repo groups,
  each with a header row (repo path, branch, total +/− delta) and per-file rows
  beneath it. Submodules appear above repos, badged "Managed submodule" with the
  Spira brand color. A file row is `status-chip + truncated path + delta bars`.
  Selected file has a 2px brand-color left border and brand-soft background.
- **Right column:** Diff viewer. Header row (status chip, full path, hunk count,
  delta, Unified / Open buttons) + scrollable patch lines. Patch lines use the
  unified-diff convention: monospace, gutter for sign (`+`/`−`/blank), green
  tint for adds, red tint for dels, faint gray for context, dimmer for `@@`
  hunk markers.
- **Best when:** the user wants to *read code*. Heavy diff sessions.

#### V2 — Stacked groups (repo accordion + inline hunks)

**Mental model:** the current Spira layout, refined.

- **Layout:** Single scrollable column. Each repo is a rounded card. Header row
  identifies the repo (path, branch, n files, delta). Below the header, each
  file is a row: chevron, status chip, path, hunk count, delta. Click expands
  inline below the row to show that file's hunks as patch lines (full-width).
- **Submodule cards** sit at the top, framed in brand color and badged.
- **Empty repos** collapse to a single dashed-border line that names the repo and
  says "no tracked diff in this managed repo."
- **Best when:** you want the *current* mental model with the diff visible
  without leaving the row context.

#### V3 — PR summary (stat strip + flat table)

**Mental model:** the PR overview tab.

- **Layout:** Three blocks stacked.
  1. **Stat strip** — 5 columns: Files changed, Additions, Deletions, Repos,
     Submodules. Big numbers; +/− are green/red.
  2. **Changed files table** — one flat row per file across every repo and
     submodule. Columns: status, path, repo (submodules indented with `↳`,
     brand color), hunks, delta. Group-by-repo and hide-clean toggles in the
     section label.
  3. **Preview panel** — the first file pre-expanded, showing hunk 1 of N as a
     patch block. Link to "open full diff →" routes back to V1 or V2 in a real
     implementation.
- **Best when:** the user is reviewing what's *about* to ship, not editing code.

---

### ACTIONS room

The **Actions** room is where commits, pushes, publishes, and PR opens happen.
The current implementation is `MissionActionsRoom.tsx` and consumes the same
`reviewSnapshot.repos` / `.submodules` shape plus per-repo workflow state
(ahead/behind, upstream, blockedBy, pr metadata).

The mission's workflow is the same four stages everywhere: **Diff → Commit → Push → PR.**

#### V1 — Pipeline cards

- **Layout:** Single scrollable column of repo cards. Each card has two rows
  separated by a divider:
  - **Row 1:** Left side — repo title, branch, and three "facts" (Branch /
    Upstream / Ahead·Behind). Right side — the **stage rail**: 4 numbered nodes
    (Diff, Commit, Push, PR) with a connecting bar that progresses brand-blue
    up to the current stage, or amber if blocked.
  - **Row 2:** Left — commit-draft textarea (or "Pull request" CTA group if the
    repo is already pushed and only needs a PR opened). Right — a hint box
    (amber-tinted when blocked) explaining the next required action, and the
    primary CTA aligned to the bottom-right.
- **Managed submodules** appear at the top, brand-badged, and surface their own
  "Align parents" CTA when the canonical submodule SHA isn't matched by parent
  repos.
- **Best when:** you want to see the *whole mission's workflow state* at a glance.

#### V2 — Two-pane focus

- **Layout:** 300px left list + flexible right detail.
- **Left list:** all repos + submodules, each row a stack of (title, branch) +
  status pill (Commit / Push / PR ready / Blocked / Clean). Submodules prefixed
  with `↳` in brand color. Selected row has 2px brand-color left border.
- **Right detail:** the chosen item, opened up.
  - Title row with status badge + action buttons (Open URL, Restart, etc.).
  - 3-column fact grid (Branch / Upstream / Ahead·Behind).
  - If blocked, an amber alert strip explaining the blocker.
  - **Commit draft section** — large textarea with monospace 13px body, plus
    Discard / Push / Commit row. Brand-blue ⌘↵ hint right-aligned.
  - **Recent commits on this branch** — table-like list: short SHA (brand),
    message, author, time.
- **Best when:** the user is committing repo-by-repo with intent. Quieter than V1.

#### V3 — Workflow checklist

- **Layout:** Single ordered checklist.
- **Top strip:** an overall progress card — "2 of 5 ready · 1 blocked · 1 PR
  pending" + a 5-segment progress bar + a one-line "next step" hint.
- **Body:** one row per repo / submodule. Each row has a checkbox-like state
  glyph (✓ for clean, ! for blocked, empty for in-progress), title + branch,
  an explicit "Next:" line ("Commit the draft", "Push 1 commit", "Waiting on
  submodule: spira-mcp-cli", etc.), a micro stage rail (4 dots + connectors),
  and the primary CTA on the far right.
- **The first row pre-expands its commit draft** as a read-only preview below
  the row, indented to align with the title column.
- **Best when:** the user wants the system to tell them *exactly what to do next*.

---

### PROCESSES room

The **Processes** room lists launch profiles per repo and the live state of any
running services. Today's implementation is `MissionProcessesRoom.tsx` and
consumes `services` (running) + `launchProfiles` (configured).

#### V1 — Live dashboard

- **Layout:**
  1. **Stat strip** — Running, Stopped, Profiles, Mean uptime.
  2. **Running services** — 2-column grid of *live cards*. Each card: header
     row (live dot, name, repo, mini sparkline), 3-column metric row (Uptime,
     CPU, Mem), URL row with Open / Logs / Stop buttons, and a 4-line tail of
     the most recent stdout in a near-black log box.
  3. **Launch profiles** — repo groups, each profile is a row: active dot,
     name + launcher command, env, URL, Start CTA. Unlaunchable profiles
     (missing build artifact, etc.) dim to 55%.
- **Best when:** the mission has 2-4 live services and the user wants a cockpit.

#### V2 — Two-pane log explorer

- **Layout:** 300px left list of every profile across every repo (live profiles
  badged green), full-height right pane shows the selected profile.
- **Right pane top:** state dot + name + state badge + action buttons (Open URL,
  Restart, Stop). 5-column fact strip: Launcher, Project, Environment, URL,
  Uptime.
- **Right pane middle:** filter row — stdout/stderr legend, filter input,
  Wrap / Copy / Clear ghost buttons.
- **Right pane bottom:** full-bleed log viewer. Near-black background, monospace
  12px, color-coded lines (cyan for vite banners, green for ready/added, amber
  for nest/errors, red for removed/destructive). A blinking cursor at the
  bottom indicates the tail is live.
- **Best when:** the user is debugging *one* service deeply.

#### V3 — Table-first with drawer

- **Layout:** A single dense table covers every profile in the mission. Columns:
  expand chevron, service (name + launcher in mono), repo, env, state badge,
  uptime · CPU/mem, action button (Start / Stop / Open). One row per profile,
  ungrouped — repo column carries the grouping information.
- **Selected row** expands inline into a drawer at row position: 3-card fact
  grid (URL, project path, environment) + recent stdout in a 150px log tail
  with "Pop out logs" affordance.
- **Best when:** the mission has 6+ profiles and the user wants the smallest
  surface that still shows everything.

---

## Interactions & behavior

Behaviors apply to *all three variations of a room* unless noted.

### Changes
- File click → focus that file's diff (V1: load in right pane / V2: expand inline
  / V3: scroll into preview block).
- Refresh button → re-fetches the review snapshot from the controller.
- Filter input (V1) → live-filters file tree by substring match on path.
- Toggle "Hide clean" (V3) → hides repos with `add+del===0`.

### Actions
- Primary CTA per row routes through the controller's existing workflow methods:
  `commit({repo, message})`, `push({repo})`, `publish({repo})`, `openPullRequest({repo})`.
- Blocked rows: primary CTA is disabled and labeled "Blocked"; tooltip and inline
  hint surface the blocking submodule(s).
- ⌘/Ctrl + Enter inside a commit-draft textarea triggers Commit.
- "Run next step" (V3 top action) executes the *first non-blocked, non-clean row's*
  primary action.

### Processes
- Start / Stop / Restart route through the existing services controller.
- Open button on a profile with a URL opens that URL in a new window.
- The log tail in V1 cards and the full log in V2 are *live* — append-only,
  auto-scrolled. Filter input (V2) is a literal substring match on stdout
  lines.
- Logs are color-coded by a simple regex pass:
  - line starts with `▲` → brand cyan
  - line contains `✓` → green
  - line starts with `[nest]` or contains `ERROR` → amber
  - line contains `removed` → red, `added` → green
  - else → dim text

### Hover / focus / active states
All clickable rows: on hover, background shifts up one surface tier
(`surface` → `surface2`). Primary buttons: background lifts ~6% on hover.
Disabled buttons render at 55% opacity with cursor: not-allowed.

---

## State management

State the variations need beyond what the existing controllers already provide:

| Room | Variation | New state |
|------|-----------|-----------|
| Changes | V1 | `selectedFilePath: string \| null`, `fileFilter: string` |
| Changes | V2 | `expandedFilePaths: Set<string>` |
| Changes | V3 | `groupByRepo: boolean`, `hideClean: boolean`, `previewFilePath: string \| null` |
| Actions | V2 | `selectedRepoPath: string \| null` |
| Actions | V3 | `expandedFirstRow: boolean` (visual only — first non-clean row pre-expands) |
| Processes | V2 | `selectedProfileId: string \| null`, `logFilter: string` |
| Processes | V3 | `expandedProfileId: string \| null` |

Persist these in the same controller / store layer the existing mission rooms use.

---

## Design tokens

The room *bodies* depend on a small token surface. If the team adopts the Linear
chrome wholesale, these come for free; otherwise alias them onto the existing
Spira tokens.

```css
--bg:        #08090b;   /* canvas background */
--surface:   #0e1014;   /* card / panel surface (1 tier above bg) */
--surface-2: #15171c;   /* hover / nested surface (2 tiers above bg) */
--surface-3: #1d1f26;   /* inset / well */
--border:    #26282f;
--border-hi: #393b44;

--ink:    #f1f3f7;      /* primary text */
--dim:    #9097a3;      /* secondary text */
--faint:  #5e6471;      /* tertiary text / metadata */

--brand:       #5e6ad2;
--brand-soft:  rgba(94,106,210,0.14);
--green:       #4cb782;
--green-soft:  rgba(76,183,130,0.12);
--amber:       #d99850;
--amber-soft:  rgba(217,152,80,0.14);
--red:         #e5484d;
--red-soft:    rgba(229,72,77,0.14);
--blue:        #5cb8ff;

/* typography */
--font:  "Inter", system-ui, -apple-system, sans-serif;
--mono:  "IBM Plex Mono", ui-monospace, monospace;

/* radii */
--r-sm: 6px;   /* buttons, chips */
--r-md: 8px;   /* inputs, small cards */
--r-lg: 10px;  /* panels */
--r-xl: 12px;  /* full cards */
```

### Typography scale (in use across all rooms)

| Use | Family | Size / weight / leading |
|-----|--------|--------------------------|
| Page title | Inter | 18px / 600 / -0.01em tracking |
| Section label | Inter | 11px / 600 / 0.08em uppercase, color `--faint` |
| Card title | Inter | 13–14px / 500–600 |
| Body | Inter | 12–13px / 400–500 |
| Metadata | Inter | 11–12px / 400, color `--dim` or `--faint` |
| Inline code / paths / counts | IBM Plex Mono | 11–13px / 400–500 |
| Stat numbers | Inter | 22px / 600 / -0.01em |
| Patch lines | IBM Plex Mono | 12px / 400 / 1.55 |

### Spacing

8px base. Common values: 4, 6, 8, 10, 12, 14, 18, 22, 28, 32.

### Atoms (`rooms/chrome.jsx → window.LNAtoms`)

- **`Btn`** — `padding: 6px 10px`, 1px border, 6px radius. Variants: default
  (surface-2 fill, ink text), `primary` (brand fill, white text), `danger` (red
  fill, white text), `small` (5px/9px padding, 11px text).
- **`GhostBtn`** — transparent, brand-colored, no border. Used for inline
  "Regenerate", "Open full diff", etc.
- **`Badge`** — pill, 2px/8px padding, tone-tinted background (12% alpha) with
  matching dot. Tones: `brand`, `green`, `amber`, `red`, `blue`, `dim`.
- **`StatusDot`** — 6px dot, optional glow shadow for `green` / `brand`.
- **`SectionLabel`** — small caps eyebrow with optional `right` slot for a
  ghost button or filter chips.

---

## Assets

No images or icons are required beyond what's already in the Spira icon system.
The prototypes use a handful of single-character glyphs in lieu of icons
(`▾` `▸` `↳` `›` `✓` `+` `−` `!`); replace with the actual icon components from
the codebase (`packages/renderer/src/components/icons/` if that's where they
live).

The "Spira" wordmark in the sidebar is a CSS gradient on a 24px rounded square
showing the letter **S** — keep using the production logo asset instead.

---

## Implementation order (suggested)

1. **Add the tokens** to the renderer's theme module — either as a new "Linear"
   theme or aliased onto the existing tokens.
2. **Build the atoms** (`Btn`, `GhostBtn`, `Badge`, `StatusDot`, `SectionLabel`)
   as proper React components in the existing component folder. These appear
   in every variation; getting them right unblocks everything else.
3. **Pick one room and one variation** to land first. Recommended starting
   point: **Processes V3 (table + drawer)** — it has the smallest surface and
   the cleanest single-source-of-truth (`services` + `launchProfiles`).
4. Then Changes (recommended: V2 — closest to current behavior, easiest diff).
5. Then Actions (recommended: V1 or V3 depending on whether the team prefers
   parallel cards or an ordered checklist).

Each variation is independent — the team can ship one room redesigned without
the others.
