// V1 Live dashboard · V2 Two-pane with log · V3 Table-first + expandable drawer
const P_LN = window.LN;
const { Btn: PBtn, GhostBtn: PGhost, Badge: PBadge, StatusDot: PDot, SectionLabel: PSection } = window.LNAtoms;

function stateTone(state) {
  if (state === "Running")  return "green";
  if (state === "Starting") return "brand";
  if (state === "Stopping") return "amber";
  if (state === "Error")    return "red";
  return "dim";
}

function LogTail({ lines, height = 120, dense }) {
  return (
    <div style={{
      height, overflow: "auto",
      background: "#04060a", border: `1px solid ${P_LN.border}`, borderRadius: 8,
      padding: dense ? "6px 10px" : "8px 12px",
      font: `${dense ? 11 : 12}px/1.5 ${P_LN.mono}`, color: P_LN.dim,
    }}>
      {lines.map((l, i) => {
        const tone = l.startsWith("▲") ? P_LN.brand
          : l.includes("✓") ? P_LN.green
          : l.startsWith("[nest]") || l.includes("ERROR") ? P_LN.amber
          : P_LN.dim;
        return <div key={i} style={{ color: tone, whiteSpace: "pre" }}>{l}</div>;
      })}
    </div>
  );
}

function MiniSpark({ tone = "green" }) {
  // little square-wave-ish svg, just visual flavor
  const c = tone === "green" ? P_LN.green : tone === "red" ? P_LN.red : P_LN.brand;
  return (
    <svg width="64" height="20" viewBox="0 0 64 20" style={{ display: "block" }}>
      <polyline fill="none" stroke={c} strokeWidth="1.5" strokeOpacity="0.9"
        points="0,14 6,10 10,12 16,6 22,9 28,4 34,11 40,7 46,12 52,8 58,11 64,9" />
    </svg>
  );
}

// =================================================================
// V1 — LIVE DASHBOARD
// =================================================================
function PV1() {
  const D = window.ROOMS_DATA;
  const running = D.processes.filter((p) => p.state === "Running");
  const stopped = D.processes.filter((p) => p.state !== "Running");
  const profileCount = D.profilesByRepo.reduce((a, r) => a + r.profiles.length, 0);

  return (
    <window.LNRoomShell room="processes"
      right={(<div style={{ display: "flex", gap: 8 }}>
        <PBtn>Refresh</PBtn>
        <PBtn primary>+ Launch profile</PBtn>
      </div>)}
    >
      <div style={{ height: "100%", overflow: "auto", padding: "18px 22px 32px" }}>
        {/* Stat strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 18 }}>
          {[
            ["Running",     `${running.length}`,                 "green"],
            ["Stopped",     `${stopped.length}`],
            ["Profiles",    `${profileCount}`],
            ["Mean uptime", "24m 09s"],
          ].map(([k, v, tone], i) => (
            <div key={i} style={{ padding: 14, border: `1px solid ${P_LN.border}`, borderRadius: 10, background: P_LN.surface }}>
              <div style={{ font: `12px ${P_LN.font}`, color: P_LN.faint }}>{k}</div>
              <div style={{ font: `600 22px ${P_LN.font}`, color: tone === "green" ? P_LN.green : P_LN.ink, marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Running services - live cards */}
        <PSection>Running services</PSection>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          {running.map((p) => (
            <div key={p.id} style={{ border: `1px solid ${P_LN.border}`, borderRadius: 12, background: P_LN.surface, overflow: "hidden" }}>
              <div style={{ padding: "12px 14px", borderBottom: `1px solid ${P_LN.border}`, display: "flex", alignItems: "center", gap: 10 }}>
                <PDot tone="green" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: `500 13px ${P_LN.font}`, color: P_LN.ink }}>{p.profile}</div>
                  <div style={{ font: `${P_LN.mono}`, fontSize: 11, color: P_LN.faint }}>{p.repo}</div>
                </div>
                <MiniSpark tone="green" />
              </div>
              <div style={{ padding: "10px 14px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, borderBottom: `1px solid ${P_LN.border}` }}>
                <Fact label="Uptime" value={p.uptime} mono />
                <Fact label="CPU"    value={`${p.cpu}%`} mono />
                <Fact label="Mem"    value={`${p.mem}MB`} mono />
              </div>
              <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ font: `${P_LN.mono}`, fontSize: 11, color: P_LN.brand, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.url}</span>
                <PBtn small>Open</PBtn>
                <PBtn small>Logs</PBtn>
                <PBtn small danger>Stop</PBtn>
              </div>
              <LogTail lines={p.log.slice(-4)} height={86} dense />
            </div>
          ))}
        </div>

        {/* Launch profiles by repo */}
        <div style={{ marginTop: 24 }}>
          <PSection right={<PGhost>Edit launch.json</PGhost>}>Launch profiles</PSection>
          {D.profilesByRepo.map((g) => (
            <div key={g.repo} style={{ marginBottom: 12, border: `1px solid ${P_LN.border}`, borderRadius: 10, background: P_LN.surface, overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", borderBottom: `1px solid ${P_LN.border}` }}>
                <span style={{ font: `${P_LN.mono}`, fontSize: 12, color: P_LN.ink }}>{g.repo}</span>
                <span style={{ font: `11px ${P_LN.font}`, color: P_LN.faint }}>{g.profiles.length} profile{g.profiles.length === 1 ? "" : "s"}</span>
              </div>
              {g.profiles.map((p, i) => (
                <div key={p.id} style={{ padding: "10px 14px", display: "grid", gridTemplateColumns: "16px 1fr 160px 100px 120px", gap: 12, alignItems: "center", borderTop: i ? `1px solid ${P_LN.border}` : "none", opacity: p.launchable ? 1 : 0.55 }}>
                  <PDot tone={p.active ? "green" : "dim"} />
                  <div>
                    <div style={{ font: `500 13px ${P_LN.font}`, color: P_LN.ink }}>{p.name}</div>
                    <div style={{ font: `${P_LN.mono}`, fontSize: 11, color: P_LN.faint }}>{p.launcher}</div>
                  </div>
                  <span style={{ font: `12px ${P_LN.font}`, color: P_LN.dim }}>{p.env}</span>
                  <span style={{ font: `${P_LN.mono}`, fontSize: 11, color: P_LN.brand, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.url || "—"}</span>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                    {p.active ? <PBtn small>Running</PBtn> : p.launchable ? <PBtn small primary>Start</PBtn> : <PBtn small>Unavailable</PBtn>}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </window.LNRoomShell>
  );

  function Fact({ label, value, mono }) {
    return (
      <div>
        <div style={{ font: `11px ${P_LN.font}`, color: P_LN.faint }}>{label}</div>
        <div style={{ font: mono ? `${P_LN.mono}` : `${P_LN.font}`, fontSize: 13, color: P_LN.ink, marginTop: 2 }}>{value}</div>
      </div>
    );
  }
}

// =================================================================
// V2 — TWO-PANE WITH FULL LOG
// =================================================================
function PV2() {
  const D = window.ROOMS_DATA;
  // build a unified list: every profile + its current process state
  const items = D.profilesByRepo.flatMap((g) => g.profiles.map((p) => {
    const proc = D.processes.find((pr) => pr.profile === p.name);
    return { ...p, state: proc?.state || (p.active ? "Running" : "Stopped"), uptime: proc?.uptime || "—", log: proc?.log || [] };
  }));
  const selected = items.find((i) => i.name === "Renderer · dev") || items[0];

  return (
    <window.LNRoomShell room="processes"
      right={<PBtn>Refresh services</PBtn>}
    >
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", height: "100%", minHeight: 0 }}>
        {/* List */}
        <div style={{ borderRight: `1px solid ${P_LN.border}`, background: P_LN.bg, overflow: "auto" }}>
          {D.profilesByRepo.map((g) => (
            <div key={g.repo}>
              <div style={{ padding: "10px 14px 4px", font: `${P_LN.mono}`, fontSize: 11, color: P_LN.faint, letterSpacing: "0.04em", borderTop: `1px solid ${P_LN.border}` }}>{g.repo}</div>
              {g.profiles.map((p) => {
                const sel = p.name === selected.name;
                const tone = p.active ? "green" : p.launchable ? "dim" : "amber";
                return (
                  <div key={p.id} data-no-pan style={{
                    padding: "8px 14px", display: "flex", alignItems: "center", gap: 8,
                    background: sel ? P_LN.surface2 : "transparent",
                    borderLeft: `2px solid ${sel ? P_LN.brand : "transparent"}`,
                    cursor: "pointer",
                  }}>
                    <PDot tone={tone} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ font: `500 13px ${P_LN.font}`, color: sel ? P_LN.ink : P_LN.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                      <div style={{ font: `${P_LN.mono}`, fontSize: 11, color: P_LN.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.launcher}</div>
                    </div>
                    {p.active ? <PBadge tone="green" soft>live</PBadge> : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Detail */}
        <div style={{ display: "grid", gridTemplateRows: "auto auto 1fr", overflow: "hidden", minWidth: 0 }}>
          <div style={{ padding: "18px 22px 12px", borderBottom: `1px solid ${P_LN.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <PDot tone={stateTone(selected.state)} />
              <span style={{ font: `600 16px ${P_LN.font}`, color: P_LN.ink }}>{selected.name}</span>
              <PBadge tone={stateTone(selected.state)}>{selected.state}</PBadge>
              <div style={{ flex: 1 }} />
              <PBtn>Open URL</PBtn>
              <PBtn>Restart</PBtn>
              <PBtn danger>Stop</PBtn>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginTop: 14 }}>
              <Fact2 label="Launcher" value={selected.launcher} />
              <Fact2 label="Project" value={selected.project} />
              <Fact2 label="Environment" value={selected.env} />
              <Fact2 label="URL" value={selected.url || "—"} tone="brand" />
              <Fact2 label="Uptime" value={selected.uptime} mono />
            </div>
          </div>

          <div style={{ padding: "12px 22px", borderBottom: `1px solid ${P_LN.border}`, display: "flex", alignItems: "center", gap: 16, font: `12px ${P_LN.font}`, color: P_LN.dim }}>
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ width: 6, height: 6, borderRadius: 50, background: P_LN.green }} />stdout</span>
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ width: 6, height: 6, borderRadius: 50, background: P_LN.amber }} />stderr</span>
            <div style={{ flex: 1 }} />
            <input data-no-pan placeholder="Filter log…" style={{ padding: "4px 8px", background: P_LN.surface, border: `1px solid ${P_LN.border}`, borderRadius: 6, color: P_LN.ink, font: `12px ${P_LN.mono}`, outline: "none", width: 200 }} />
            <PGhost>Wrap</PGhost>
            <PGhost>Copy</PGhost>
            <PGhost>Clear</PGhost>
          </div>

          <div style={{ overflow: "hidden", minHeight: 0 }}>
            <div style={{
              height: "100%", overflow: "auto",
              background: "#04060a", padding: "12px 22px",
              font: `12px/1.6 ${P_LN.mono}`, color: P_LN.dim,
            }}>
              {/* Expanded log */}
              {[
                "▲ vite v5.4.2 dev server running at:",
                "  ➜ Local:   http://localhost:5173/",
                "  ➜ Network: http://10.0.0.4:5173/",
                "  ✓ ready in 412 ms",
                "[hmr] updated MissionChangesRoom.tsx",
                "[hmr] updated MissionShell.tsx",
                "[hmr] updated MissionDetailsRoom.tsx",
                "[hmr] updated MissionRecoveryBanner.tsx (removed)",
                "[hmr] updated RecoveryInline.tsx (added)",
                "[hmr] full reload triggered: src/types/mission.ts",
                "  ✓ recompile in 224 ms",
                "GET /missions/LH-417 → 200 (18ms)",
                "GET /missions/LH-417/review → 200 (44ms)",
                "POST /missions/LH-417/services → 200 (9ms)",
                "GET /missions/LH-417/state → 200 (12ms)",
                "[vite] page reload src/components/missions/MissionShell.tsx",
                "  ✓ ready in 119 ms",
              ].map((l, i) => {
                const tone = l.startsWith("▲") ? P_LN.brand
                  : l.includes("✓") ? P_LN.green
                  : l.includes("removed") ? P_LN.red
                  : l.includes("added") ? P_LN.green
                  : P_LN.dim;
                return <div key={i} style={{ color: tone, whiteSpace: "pre" }}>{l}</div>;
              })}
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: P_LN.green, marginTop: 6 }}>
                <span>›</span><span style={{ width: 8, height: 14, background: P_LN.green, animation: "blink 1.1s infinite" }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </window.LNRoomShell>
  );

  function Fact2({ label, value, mono, tone }) {
    return (
      <div>
        <div style={{ font: `11px ${P_LN.font}`, color: P_LN.faint }}>{label}</div>
        <div style={{ font: `${mono ? P_LN.mono : P_LN.font}`, fontSize: 12, color: tone === "brand" ? P_LN.brand : P_LN.ink, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      </div>
    );
  }
}

// =================================================================
// V3 — TABLE-FIRST + DRAWER
// =================================================================
function PV3() {
  const D = window.ROOMS_DATA;
  const rows = D.profilesByRepo.flatMap((g) => g.profiles.map((p) => {
    const proc = D.processes.find((pr) => pr.profile === p.name);
    return {
      ...p, repo: g.repo,
      state: proc?.state || (p.active ? "Running" : "Stopped"),
      uptime: proc?.uptime || "—",
      cpu: proc?.cpu ?? null,
      mem: proc?.mem ?? null,
      log: proc?.log || [],
    };
  }));
  const expandedId = "renderer-dev";

  return (
    <window.LNRoomShell room="processes"
      right={(<div style={{ display: "flex", gap: 8 }}>
        <PBtn>Filter</PBtn>
        <PBtn>Group</PBtn>
        <PBtn primary>Start all dev</PBtn>
      </div>)}
    >
      <div style={{ height: "100%", overflow: "auto" }}>
        {/* Table header */}
        <div style={{ padding: "10px 22px", borderBottom: `1px solid ${P_LN.border}`, display: "grid", gridTemplateColumns: "16px 1fr 140px 100px 100px 110px 130px", gap: 12, font: `${P_LN.mono}`, fontSize: 11, color: P_LN.faint, letterSpacing: "0.04em" }}>
          <span></span><span>SERVICE</span><span>REPO</span><span>ENV</span><span>STATE</span><span>UPTIME · CPU</span><span></span>
        </div>
        {rows.map((p) => {
          const isExp = p.id === expandedId;
          const tone = stateTone(p.state);
          return (
            <React.Fragment key={p.id}>
              <div data-no-pan style={{
                padding: "10px 22px", display: "grid", gridTemplateColumns: "16px 1fr 140px 100px 100px 110px 130px", gap: 12, alignItems: "center",
                borderBottom: `1px solid ${P_LN.border}`,
                background: isExp ? P_LN.surface : "transparent",
                opacity: p.launchable ? 1 : 0.6,
              }}>
                <span style={{ font: "10px sans-serif", color: P_LN.faint }}>{isExp ? "▾" : "▸"}</span>
                <div>
                  <div style={{ font: `500 13px ${P_LN.font}`, color: P_LN.ink }}>{p.name}</div>
                  <div style={{ font: `${P_LN.mono}`, fontSize: 11, color: P_LN.faint }}>{p.launcher}</div>
                </div>
                <span style={{ font: `12px ${P_LN.font}`, color: P_LN.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.repo}</span>
                <span style={{ font: `12px ${P_LN.font}`, color: P_LN.dim }}>{p.env}</span>
                <PBadge tone={tone}>{p.state}</PBadge>
                <div style={{ font: `${P_LN.mono}`, fontSize: 11, color: P_LN.dim, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span>{p.uptime}</span>
                  {p.cpu != null ? <span style={{ color: P_LN.faint }}>{p.cpu}% · {p.mem}MB</span> : null}
                </div>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {p.url ? <PBtn small>Open</PBtn> : null}
                  {p.state === "Running"
                    ? <PBtn small danger>Stop</PBtn>
                    : p.launchable ? <PBtn small primary>Start</PBtn> : <PBtn small>Unavail</PBtn>}
                </div>
              </div>

              {isExp ? (
                <div style={{ background: P_LN.surface, borderBottom: `1px solid ${P_LN.border}`, padding: "14px 22px 18px 50px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
                    {[
                      ["URL", p.url, "brand"],
                      ["Project path", p.project],
                      ["Environment", p.env],
                    ].map(([k, v, tone]) => (
                      <div key={k} style={{ padding: 10, background: P_LN.bg, border: `1px solid ${P_LN.border}`, borderRadius: 8 }}>
                        <div style={{ font: `11px ${P_LN.font}`, color: P_LN.faint }}>{k}</div>
                        <div style={{ font: `${P_LN.mono}`, fontSize: 12, color: tone === "brand" ? P_LN.brand : P_LN.ink, marginTop: 2 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{ font: `600 11px ${P_LN.font}`, color: P_LN.faint, letterSpacing: "0.08em", textTransform: "uppercase" }}>Recent stdout</span>
                    <div style={{ flex: 1 }} />
                    <PGhost>Pop out logs</PGhost>
                  </div>
                  <LogTail lines={p.log} height={150} />
                </div>
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
    </window.LNRoomShell>
  );
}

window.ProcessesRoom = { V1: PV1, V2: PV2, V3: PV3 };
