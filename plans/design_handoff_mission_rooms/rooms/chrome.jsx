// Shared Linear chrome + atoms for the three mission-room redesigns.
// Mirrors the look of redesigns/v2-linear.jsx so this drops into the same system.

window.LN = {
  bg: "#08090b",
  surface: "#0e1014",
  surface2: "#15171c",
  surface3: "#1d1f26",
  border: "#26282f",
  borderHi: "#393b44",
  ink: "#f1f3f7",
  dim: "#9097a3",
  faint: "#5e6471",
  brand: "#5e6ad2",
  brandSoft: "rgba(94,106,210,0.14)",
  green: "#4cb782",
  greenSoft: "rgba(76,183,130,0.12)",
  amber: "#d99850",
  amberSoft: "rgba(217,152,80,0.14)",
  red: "#e5484d",
  redSoft: "rgba(229,72,77,0.14)",
  blue: "#5cb8ff",
  font: '"Inter", system-ui, -apple-system, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
};
const LN = window.LN;

window.LNAtoms = {
  Btn({ children, primary, danger, small, onClick }) {
    const bg = danger ? LN.red : primary ? LN.brand : LN.surface2;
    const bd = danger ? LN.red : primary ? LN.brand : LN.border;
    const fg = (primary || danger) ? "#fff" : LN.ink;
    return (
      <button data-no-pan onClick={onClick} style={{
        padding: small ? "4px 8px" : "6px 10px",
        border: `1px solid ${bd}`, background: bg, color: fg,
        font: `500 ${small ? 11 : 12}px ${LN.font}`, borderRadius: 6, cursor: "pointer",
      }}>{children}</button>
    );
  },
  GhostBtn({ children, onClick }) {
    return (
      <button data-no-pan onClick={onClick} style={{
        padding: "4px 8px", border: "none", background: "transparent",
        color: LN.brand, font: `500 12px ${LN.font}`, cursor: "pointer",
      }}>{children}</button>
    );
  },
  Badge({ tone, children, soft }) {
    const map = { brand: LN.brand, green: LN.green, amber: LN.amber, red: LN.red, blue: LN.blue, dim: LN.faint };
    const c = map[tone] || LN.faint;
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "2px 8px",
        border: soft ? "none" : `1px solid ${c}33`,
        background: `${c}1a`, color: c,
        font: `500 11px ${LN.font}`, borderRadius: 999, whiteSpace: "nowrap",
      }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: c }} />
        {children}
      </span>
    );
  },
  StatusDot({ tone }) {
    const map = { brand: LN.brand, green: LN.green, amber: LN.amber, red: LN.red, dim: LN.faint };
    const c = map[tone] || LN.faint;
    return <span style={{ width: 6, height: 6, borderRadius: "50%", background: c, boxShadow: tone === "green" || tone === "brand" ? `0 0 6px ${c}` : "none", flexShrink: 0 }} />;
  },
  SectionLabel({ children, right }) {
    return (
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ font: `600 11px ${LN.font}`, color: LN.faint, letterSpacing: "0.08em", textTransform: "uppercase" }}>{children}</span>
        {right}
      </div>
    );
  },
};

// Linear app chrome with sidebar + breadcrumb header + mission sub-nav.
// The room body fills the remaining space and is the part each variation owns.
window.LNRoomShell = function LNRoomShell({ room, title, right, children, headerExtra }) {
  const M = window.ROOMS_DATA.mission;
  const navItems = [
    { id: "bridge",   label: "Bridge",        count: null,   icon: "M" },
    { id: "deck",     label: "Workspace",     count: 7,      icon: "W" },
    { id: "pickup",   label: "Inbox",         count: 12,     icon: "I" },
    { id: "mission",  label: "Active mission", count: null,  icon: "A", sel: true },
    { id: "settings", label: "Settings",      count: null,   icon: "S" },
  ];
  const rooms = [
    { id: "details",   label: "Details",   caption: "Overview" },
    { id: "changes",   label: "Changes",   caption: "Diff & files" },
    { id: "actions",   label: "Actions",   caption: "Git workflow" },
    { id: "processes", label: "Processes", caption: "Launch profiles" },
  ];
  const stations = [
    { state: "active", label: "Bridge",   title: "LH-417 · recovery", elapsed: "24m" },
    { state: "active", label: "Validate", title: "renderer · tsc",    elapsed: "02m" },
    { state: "idle",   label: "Pickup",   title: "—",                  elapsed: "" },
    { state: "idle",   label: "Review",   title: "—",                  elapsed: "" },
  ];

  return (
    <div style={{ width: "100%", height: "100%", background: LN.bg, color: LN.ink, font: `13px/1.5 ${LN.font}`, display: "grid", gridTemplateColumns: "232px 1fr", overflow: "hidden" }}>
      {/* Sidebar — identical to v2-linear */}
      <aside style={{ borderRight: `1px solid ${LN.border}`, background: LN.surface, display: "grid", gridTemplateRows: "auto auto 1fr auto", overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: `linear-gradient(135deg, ${LN.brand}, #8a52d6)`, display: "grid", placeItems: "center", color: "#fff", font: `700 12px ${LN.font}` }}>S</div>
          <div style={{ flex: 1, font: `600 13px ${LN.font}` }}>Spira</div>
          <div style={{ font: `10px ${LN.mono}`, color: LN.faint, padding: "2px 6px", border: `1px solid ${LN.border}`, borderRadius: 4 }}>⌘K</div>
        </div>
        <div style={{ padding: "0 8px 4px" }}>
          {navItems.map((n) => (
            <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 6, background: n.sel ? LN.surface3 : "transparent", color: n.sel ? LN.ink : LN.dim, cursor: "pointer", marginBottom: 1 }}>
              <div style={{ width: 16, height: 16, borderRadius: 4, background: n.sel ? LN.brand : LN.surface3, display: "grid", placeItems: "center", color: n.sel ? "#fff" : LN.faint, font: `600 9px ${LN.font}` }}>{n.icon}</div>
              <span style={{ flex: 1, font: `500 13px ${LN.font}` }}>{n.label}</span>
              {n.count != null ? <span style={{ font: LN.mono, fontSize: 11, color: LN.faint }}>{n.count}</span> : null}
            </div>
          ))}
        </div>
        <div style={{ overflow: "auto", padding: "8px 8px 8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 8px 4px" }}>
            <span style={{ font: `600 11px ${LN.font}`, color: LN.faint, letterSpacing: "0.04em" }}>Stations</span>
            <span style={{ font: LN.mono, fontSize: 11, color: LN.faint }}>4</span>
          </div>
          {stations.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: s.state === "idle" ? LN.faint : LN.green, boxShadow: s.state === "idle" ? "none" : `0 0 6px ${LN.green}` }} />
              <span style={{ font: `500 12px ${LN.font}`, color: s.state === "idle" ? LN.faint : LN.ink }}>{s.label}</span>
              <span style={{ flex: 1, font: `12px ${LN.font}`, color: LN.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</span>
              <span style={{ font: LN.mono, fontSize: 10, color: LN.faint }}>{s.elapsed}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 8px 4px" }}>
            <span style={{ font: `600 11px ${LN.font}`, color: LN.faint, letterSpacing: "0.04em" }}>Repos</span>
          </div>
          {["renderer","backend","shared","mcp-windows-ui","scripts"].map((r, i) => (
            <div key={r} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 8px", borderRadius: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: ["#5e6ad2","#4cb782","#d99850","#5cb8ff","#a07cef"][i] }} />
              <span style={{ font: `500 12px ${LN.font}`, color: LN.dim }}>{r}</span>
            </div>
          ))}
        </div>
        <div style={{ borderTop: `1px solid ${LN.border}`, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 24, height: 24, borderRadius: "50%", background: "linear-gradient(135deg, #d96d4c, #d99850)", display: "grid", placeItems: "center", font: `600 10px ${LN.font}` }}>KA</div>
          <div style={{ flex: 1 }}>
            <div style={{ font: `500 12px ${LN.font}` }}>K. Ardal</div>
            <div style={{ font: `11px ${LN.font}`, color: LN.faint }}>Online · 42ms</div>
          </div>
        </div>
      </aside>

      {/* Main column: page header + mission sub-nav + room body */}
      <main style={{ display: "grid", gridTemplateRows: "auto auto 1fr", overflow: "hidden", minWidth: 0 }}>
        <div style={{ borderBottom: `1px solid ${LN.border}`, padding: "10px 22px", background: LN.bg }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, font: `12px ${LN.font}`, color: LN.faint }}>
            <span>Spira</span><span>/</span><span>Missions</span><span>/</span>
            <span style={{ color: LN.ink, font: LN.mono, fontSize: 12 }}>{M.id}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 6, gap: 12 }}>
            <div style={{ font: `600 18px ${LN.font}`, letterSpacing: "-0.01em", color: LN.ink }}>{M.title}</div>
            <window.LNAtoms.Badge tone="amber">Pass {M.pass.current}/{M.pass.total}</window.LNAtoms.Badge>
            <window.LNAtoms.Badge tone="brand">Awaiting review</window.LNAtoms.Badge>
            <span style={{ font: LN.mono, fontSize: 12, color: LN.faint }}>{M.branch}</span>
            <div style={{ flex: 1 }} />
            {right}
          </div>
        </div>
        <div style={{ borderBottom: `1px solid ${LN.border}`, padding: "0 22px", display: "flex", gap: 4, background: LN.bg }}>
          {rooms.map((r) => {
            const sel = r.id === room;
            return (
              <div key={r.id} style={{
                padding: "10px 14px 12px", cursor: "pointer", position: "relative",
                font: `500 13px ${LN.font}`, color: sel ? LN.ink : LN.dim,
              }}>
                {r.label}
                {sel ? <div style={{ position: "absolute", left: 8, right: 8, bottom: -1, height: 2, background: LN.ink, borderRadius: 1 }} /> : null}
              </div>
            );
          })}
          <div style={{ flex: 1 }} />
          {headerExtra}
        </div>
        <div style={{ overflow: "hidden", minWidth: 0 }}>{children}</div>
      </main>
    </div>
  );
};
