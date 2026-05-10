// V2 — LINEAR: clean, professional, modern SaaS. Dark surface w/ purple accent.
const LN = {
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
  amber: "#d99850",
  red: "#e5484d",
  blue: "#5cb8ff",
  font: '"Inter", system-ui, -apple-system, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
};

function LNChrome({ children, active }) {
  const items = [
    { id: "bridge", label: "Bridge", count: null, icon: "M" },
    { id: "deck", label: "Workspace", count: 7, icon: "W" },
    { id: "pickup", label: "Inbox", count: 12, icon: "I" },
    { id: "mission", label: "Active mission", count: null, icon: "A" },
    { id: "settings", label: "Settings", count: null, icon: "S" },
  ];
  return (
    <div style={{ width: "100%", height: "100%", background: LN.bg, color: LN.ink, font: `13px/1.5 ${LN.font}`, display: "grid", gridTemplateColumns: "232px 1fr" }}>
      <aside style={{ borderRight: `1px solid ${LN.border}`, background: LN.surface, display: "grid", gridTemplateRows: "auto auto 1fr auto", overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: `linear-gradient(135deg, ${LN.brand}, #8a52d6)`, display: "grid", placeItems: "center", color: "#fff", font: `700 12px ${LN.font}` }}>S</div>
          <div style={{ flex: 1, font: `600 13px ${LN.font}` }}>Spira</div>
          <div style={{ font: `10px ${LN.mono}`, color: LN.faint, padding: "2px 6px", border: `1px solid ${LN.border}`, borderRadius: 4 }}>⌘K</div>
        </div>
        <div style={{ padding: "0 8px 4px" }}>
          {items.map((n) => {
            const sel = active === n.id;
            return (
              <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 6, background: sel ? LN.surface3 : "transparent", color: sel ? LN.ink : LN.dim, cursor: "pointer", marginBottom: 1 }}>
                <div style={{ width: 16, height: 16, borderRadius: 4, background: sel ? LN.brand : LN.surface3, display: "grid", placeItems: "center", color: sel ? "#fff" : LN.faint, font: `600 9px ${LN.font}` }}>{n.icon}</div>
                <span style={{ flex: 1, font: `500 13px ${LN.font}` }}>{n.label}</span>
                {n.count != null ? <span style={{ font: `${LN.mono}`, fontSize: 11, color: LN.faint }}>{n.count}</span> : null}
              </div>
            );
          })}
        </div>
        <div style={{ overflow: "auto", padding: "8px 8px 8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 8px 4px" }}>
            <span style={{ font: `600 11px ${LN.font}`, color: LN.faint, letterSpacing: "0.04em" }}>Stations</span>
            <span style={{ font: `${LN.mono}`, fontSize: 11, color: LN.faint }}>4</span>
          </div>
          {window.SPIRA_DATA.stations.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: s.state === "idle" ? LN.faint : LN.green, boxShadow: s.state === "idle" ? "none" : `0 0 6px ${LN.green}` }} />
              <span style={{ font: `500 12px ${LN.font}`, color: s.state === "idle" ? LN.faint : LN.ink }}>{s.label}</span>
              <span style={{ flex: 1, font: `12px ${LN.font}`, color: LN.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</span>
              <span style={{ font: `${LN.mono}`, fontSize: 10, color: LN.faint }}>{s.elapsed}</span>
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
      <main style={{ display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>{children}</main>
    </div>
  );
}

function LNHeader({ crumbs, title, right }) {
  return (
    <div style={{ borderBottom: `1px solid ${LN.border}`, padding: "10px 22px", background: LN.bg }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, font: `12px ${LN.font}`, color: LN.faint }}>
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <span>/</span> : null}
            <span style={{ color: i === crumbs.length - 1 ? LN.ink : LN.faint }}>{c}</span>
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", marginTop: 6 }}>
        <div style={{ font: `600 18px ${LN.font}`, letterSpacing: "-0.01em" }}>{title}</div>
        <div style={{ flex: 1 }} />
        {right}
      </div>
    </div>
  );
}

function LNBtn({ children, primary, onClick }) {
  return (
    <button data-no-pan onClick={onClick} style={{ padding: "6px 10px", border: `1px solid ${primary ? LN.brand : LN.border}`, background: primary ? LN.brand : LN.surface2, color: primary ? "#fff" : LN.ink, font: `500 12px ${LN.font}`, borderRadius: 6, cursor: "pointer" }}>{children}</button>
  );
}

function LNBadge({ tone, children }) {
  const map = { brand: LN.brand, green: LN.green, amber: LN.amber, red: LN.red, blue: LN.blue, dim: LN.faint };
  const c = map[tone] || LN.faint;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", border: `1px solid ${c}33`, background: `${c}1a`, color: c, font: `500 11px ${LN.font}`, borderRadius: 999 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: c }} />{children}</span>;
}

function LNBridge() {
  const D = window.SPIRA_DATA.bridge;
  return (
    <LNChrome active="bridge">
      <LNHeader crumbs={["Spira", "Bridge", "LH-417"]} title="Mission recovery"
        right={<div style={{ display: "flex", gap: 8 }}><LNBadge tone="green">Voice on</LNBadge><LNBadge tone="amber">Pass 2/3</LNBadge><LNBtn>Share</LNBtn><LNBtn primary>Promote</LNBtn></div>}/>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", overflow: "hidden" }}>
        <div style={{ overflow: "auto", padding: "20px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
          {D.messages.map((m, i) => {
            if (m.role === "tool") {
              return (
                <div key={i} style={{ padding: "8px 12px", background: LN.surface, border: `1px solid ${LN.border}`, borderRadius: 8, font: `${LN.mono}`, fontSize: 12, color: LN.dim, display: "flex", gap: 8 }}>
                  <span style={{ color: LN.brand }}>↳</span>
                  <span style={{ color: LN.ink }}>{m.tool}</span>
                  <span>{m.path}</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ color: LN.green }}>200 ok</span>
                  <span style={{ color: LN.faint }}>{m.time}</span>
                </div>
              );
            }
            const you = m.role === "user";
            return (
              <div key={i} style={{ display: "flex", gap: 12 }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: you ? "linear-gradient(135deg, #d96d4c, #d99850)" : `linear-gradient(135deg, ${LN.brand}, #8a52d6)`, display: "grid", placeItems: "center", font: `600 11px ${LN.font}`, flexShrink: 0 }}>{you ? "KA" : "S"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ font: `600 13px ${LN.font}` }}>{you ? "K. Ardal" : "Shinra"}</span>
                    <span style={{ font: `12px ${LN.font}`, color: LN.faint }}>{m.time}</span>
                  </div>
                  <div style={{ font: `13px/1.5 ${LN.font}`, color: LN.ink, marginTop: 2 }}>{m.text}</div>
                </div>
              </div>
            );
          })}
          <div style={{ marginTop: 8, padding: "10px 14px", border: `1px solid ${LN.border}`, borderRadius: 10, background: LN.surface, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: LN.green, animation: "pulse 1.6s infinite" }} />
            <span style={{ font: `13px ${LN.font}`, color: LN.dim }}>Promote LH-417 to ready and send the validate logs—</span>
            <span style={{ width: 1.5, height: 14, background: LN.ink, animation: "blink 1.1s infinite" }} />
            <div style={{ flex: 1 }} />
            <LNBadge tone="dim">⌘ Enter</LNBadge>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {D.suggestions.map((s) => (<button key={s} data-no-pan style={{ padding: "5px 10px", border: `1px solid ${LN.border}`, background: LN.surface, color: LN.dim, font: `12px ${LN.font}`, borderRadius: 6, cursor: "pointer" }}>{s}</button>))}
          </div>
        </div>
        <aside style={{ borderLeft: `1px solid ${LN.border}`, padding: 18, background: LN.surface, overflow: "auto" }}>
          <div style={{ font: `600 11px ${LN.font}`, color: LN.faint, letterSpacing: "0.04em" }}>PROPERTIES</div>
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "100px 1fr", rowGap: 10, font: `13px ${LN.font}` }}>
            <span style={{ color: LN.faint }}>Status</span><LNBadge tone="amber">In progress</LNBadge>
            <span style={{ color: LN.faint }}>Priority</span><LNBadge tone="red">Urgent</LNBadge>
            <span style={{ color: LN.faint }}>Assignee</span><span>Shinra</span>
            <span style={{ color: LN.faint }}>Pass</span><span>2 of 3</span>
            <span style={{ color: LN.faint }}>Elapsed</span><span style={{ font: `${LN.mono}` }}>24m 17s</span>
            <span style={{ color: LN.faint }}>Repo</span><span>renderer</span>
          </div>
          <div style={{ marginTop: 18, font: `600 11px ${LN.font}`, color: LN.faint, letterSpacing: "0.04em" }}>VOICE</div>
          <div style={{ marginTop: 8, padding: 12, border: `1px solid ${LN.border}`, borderRadius: 8, background: LN.surface2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: LN.green }} />
              <span style={{ font: `500 13px ${LN.font}` }}>Listening</span>
              <div style={{ flex: 1 }} />
              <span style={{ font: `${LN.mono}`, fontSize: 11, color: LN.faint }}>"hey shinra"</span>
            </div>
          </div>
        </aside>
      </div>
    </LNChrome>
  );
}

function LNDeck() {
  const D = window.SPIRA_DATA;
  return (
    <LNChrome active="deck">
      <LNHeader crumbs={["Spira", "Workspace"]} title="Workspace" right={<div style={{ display: "flex", gap: 8 }}><LNBtn>Filter</LNBtn><LNBtn primary>+ New mission</LNBtn></div>}/>
      <div style={{ overflow: "auto", padding: "20px 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {[["Active","2","green"],["Ready","12","brand"],["Pass-rate","94%","green"],["Mean cycle","27m","blue"]].map(([k,v,t]) => (
            <div key={k} style={{ padding: 14, border: `1px solid ${LN.border}`, borderRadius: 10, background: LN.surface }}>
              <div style={{ font: `12px ${LN.font}`, color: LN.faint }}>{k}</div>
              <div style={{ font: `600 22px ${LN.font}`, color: LN.ink, marginTop: 4, letterSpacing: "-0.01em" }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 22, padding: "10px 14px", borderTop: `1px solid ${LN.border}`, borderBottom: `1px solid ${LN.border}`, display: "grid", gridTemplateColumns: "1fr 100px 100px 80px", gap: 14, font: `${LN.mono}`, fontSize: 11, color: LN.faint, letterSpacing: "0.04em" }}>
          <span>ROOM</span><span>STATE</span><span>ENTITIES</span><span>OPEN</span>
        </div>
        {D.rooms.map((r) => {
          const tone = r.state === "active" ? "green" : r.state === "warn" ? "red" : r.state === "queue" ? "amber" : "dim";
          return (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr 100px 100px 80px", gap: 14, padding: "12px 14px", borderBottom: `1px solid ${LN.border}`, alignItems: "center" }}>
              <div>
                <div style={{ font: `500 14px ${LN.font}`, color: LN.ink }}>{r.label}</div>
                <div style={{ font: `12px ${LN.font}`, color: LN.faint }}>{r.caption}</div>
              </div>
              <LNBadge tone={tone}>{r.state}</LNBadge>
              <span style={{ font: `${LN.mono}`, fontSize: 12, color: LN.dim }}>{r.count}</span>
              <span style={{ font: `${LN.mono}`, fontSize: 12, color: LN.brand, cursor: "pointer" }}>open →</span>
            </div>
          );
        })}
      </div>
    </LNChrome>
  );
}

function LNPickup() {
  const D = window.SPIRA_DATA.pickup;
  return (
    <LNChrome active="pickup">
      <LNHeader crumbs={["Spira", "Inbox"]} title="Inbox · 7 ready" right={<div style={{ display: "flex", gap: 8 }}><LNBtn>Filter</LNBtn><LNBtn>Group</LNBtn><LNBtn primary>Pick up next</LNBtn></div>}/>
      <div style={{ overflow: "auto" }}>
        <div style={{ padding: "8px 16px", borderBottom: `1px solid ${LN.border}`, font: `${LN.mono}`, fontSize: 11, color: LN.faint, letterSpacing: "0.04em", display: "grid", gridTemplateColumns: "60px 90px 1fr 120px 100px 60px 80px", gap: 12 }}>
          <span>PRI</span><span>ID</span><span>TITLE</span><span>REPO</span><span>STATE</span><span>PTS</span><span>OWNER</span>
        </div>
        {D.queue.map((q) => {
          const ptone = q.priority === "P1" ? "red" : q.priority === "P2" ? "amber" : "dim";
          const stMap = { "in-progress": "amber", "ready": "green", "blocked": "red" };
          return (
            <div key={q.id} style={{ padding: "10px 16px", borderBottom: `1px solid ${LN.border}`, display: "grid", gridTemplateColumns: "60px 90px 1fr 120px 100px 60px 80px", gap: 12, alignItems: "center" }}>
              <LNBadge tone={ptone}>{q.priority}</LNBadge>
              <span style={{ font: `${LN.mono}`, fontSize: 12, color: LN.dim }}>{q.id}</span>
              <div>
                <div style={{ font: `500 13px ${LN.font}`, color: LN.ink }}>{q.title}</div>
                <div style={{ font: `12px ${LN.font}`, color: LN.faint }}>{q.kind} · filed by {q.reporter}</div>
              </div>
              <span style={{ font: `12px ${LN.font}`, color: LN.dim }}>{q.repo}</span>
              <LNBadge tone={stMap[q.state]}>{q.state}</LNBadge>
              <span style={{ font: `${LN.mono}`, fontSize: 12, color: LN.dim }}>{q.points}</span>
              <span style={{ font: `12px ${LN.font}`, color: LN.faint }}>—</span>
            </div>
          );
        })}
      </div>
    </LNChrome>
  );
}

function LNMission() {
  const M = window.SPIRA_DATA.mission;
  return (
    <LNChrome active="mission">
      <LNHeader crumbs={["Spira", "Mission", M.id]} title={M.title} right={<div style={{ display: "flex", gap: 8 }}><LNBadge tone="amber">Pass 2/3</LNBadge><LNBadge tone="brand">Validate</LNBadge><LNBtn>Pause</LNBtn><LNBtn primary>Promote</LNBtn></div>}/>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", overflow: "hidden" }}>
        <div style={{ overflow: "auto", padding: "20px 28px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", border: `1px solid ${LN.border}`, borderRadius: 10, overflow: "hidden", background: LN.surface }}>
            {M.phases.map((p, i) => {
              const c = p.state === "complete" ? LN.green : p.state === "active" ? LN.brand : LN.faint;
              return (
                <div key={p.key} style={{ padding: 12, borderRight: i < 5 ? `1px solid ${LN.border}` : "none", background: p.state === "active" ? LN.brandSoft : "transparent" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: p.state === "complete" ? LN.green : "transparent", border: `2px solid ${c}`, display: "grid", placeItems: "center", color: "#fff", font: "9px sans-serif" }}>{p.state === "complete" ? "✓" : ""}</div>
                    <span style={{ font: `500 12px ${LN.font}`, color: c }}>{p.label}</span>
                  </div>
                  <div style={{ font: `${LN.mono}`, fontSize: 11, color: LN.faint, marginTop: 4 }}>{p.duration}</div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 22 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
              <span style={{ font: `600 13px ${LN.font}` }}>Validate</span>
              <span style={{ font: `12px ${LN.font}`, color: LN.faint }}>4 checks · 2 passed</span>
            </div>
            <div style={{ border: `1px solid ${LN.border}`, borderRadius: 10, overflow: "hidden", background: LN.surface }}>
              {M.validate.map((v, i) => {
                const tone = v.status === "passed" ? "green" : v.status === "running" ? "brand" : "dim";
                return (
                  <div key={v.kind} style={{ display: "grid", gridTemplateColumns: "150px 1fr 100px 70px", gap: 12, padding: "10px 14px", borderTop: i ? `1px solid ${LN.border}` : "none", alignItems: "center" }}>
                    <span style={{ font: `500 13px ${LN.font}` }}>{v.kind}</span>
                    <span style={{ font: `${LN.mono}`, fontSize: 12, color: LN.dim }}>{v.cmd}</span>
                    <LNBadge tone={tone}>{v.status}</LNBadge>
                    <span style={{ font: `${LN.mono}`, fontSize: 12, color: LN.faint, textAlign: "right" }}>{v.time}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ marginTop: 22 }}>
            <div style={{ font: `600 13px ${LN.font}`, marginBottom: 8 }}>Files changed</div>
            <div style={{ border: `1px solid ${LN.border}`, borderRadius: 10, overflow: "hidden", background: LN.surface }}>
              {M.files.map((f, i) => (
                <div key={f.path} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 14, padding: "8px 14px", borderTop: i ? `1px solid ${LN.border}` : "none", alignItems: "center" }}>
                  <span style={{ font: `${LN.mono}`, fontSize: 12, color: LN.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.path}</span>
                  <span style={{ font: `${LN.mono}`, fontSize: 12, color: LN.green }}>+{f.add}</span>
                  <span style={{ font: `${LN.mono}`, fontSize: 12, color: LN.red }}>−{f.del}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <aside style={{ borderLeft: `1px solid ${LN.border}`, padding: 18, background: LN.surface, overflow: "auto" }}>
          <div style={{ padding: 14, border: `1px solid ${LN.border}`, borderRadius: 10, background: LN.surface2 }}>
            <div style={{ font: `12px ${LN.font}`, color: LN.faint }}>Now running</div>
            <div style={{ font: `${LN.mono}`, fontSize: 13, color: LN.ink, marginTop: 4 }}>{M.nowPlaying.title}</div>
            <div style={{ font: `12px ${LN.font}`, color: LN.dim, marginTop: 4 }}>{M.nowPlaying.detail}</div>
            <div style={{ marginTop: 10, height: 4, background: LN.surface3, borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: "44%", height: "100%", background: LN.brand }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, font: `${LN.mono}`, fontSize: 11, color: LN.faint }}>
              <span>{M.nowPlaying.elapsed}</span><span>step 4 of 9</span>
            </div>
          </div>
          <div style={{ marginTop: 18, font: `600 11px ${LN.font}`, color: LN.faint, letterSpacing: "0.04em" }}>ACCEPTANCE CRITERIA</div>
          <div style={{ marginTop: 8 }}>
            {M.criteria.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: i < M.criteria.length - 1 ? `1px solid ${LN.border}` : "none" }}>
                <div style={{ width: 16, height: 16, borderRadius: 4, background: c.done ? LN.green : "transparent", border: `1.5px solid ${c.done ? LN.green : LN.borderHi}`, display: "grid", placeItems: "center", color: "#fff", font: "10px sans-serif", flexShrink: 0, marginTop: 1 }}>{c.done ? "✓" : ""}</div>
                <span style={{ font: `13px/1.4 ${LN.font}`, color: c.done ? LN.faint : LN.ink, textDecoration: c.done ? "line-through" : "none" }}>{c.text}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </LNChrome>
  );
}

function LNSettings() {
  const S = window.SPIRA_DATA.settings;
  return (
    <LNChrome active="settings">
      <LNHeader crumbs={["Spira", "Settings", "Voice"]} title="Settings" right={<LNBtn primary>Save changes</LNBtn>}/>
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", overflow: "hidden" }}>
        <aside style={{ borderRight: `1px solid ${LN.border}`, padding: "14px 8px", background: LN.bg }}>
          {S.sections.map((s, i) => (
            <div key={s.id} style={{ padding: "8px 12px", borderRadius: 6, marginBottom: 2, background: i === 0 ? LN.surface2 : "transparent", color: i === 0 ? LN.ink : LN.dim, font: `500 13px ${LN.font}` }}>{s.label}</div>
          ))}
        </aside>
        <div style={{ overflow: "auto", padding: "22px 28px" }}>
          <div style={{ font: `600 16px ${LN.font}`, letterSpacing: "-0.01em" }}>Voice & wake-word</div>
          <div style={{ font: `13px ${LN.font}`, color: LN.dim, marginTop: 4 }}>Configure how Spira hears and answers you.</div>
          <div style={{ marginTop: 22, display: "grid", gridTemplateColumns: "240px 1fr", gap: "16px 18px" }}>
            {[["Wake provider", S.voice.provider], ["Wake word", S.voice.wakeWord], ["Speech-to-text", S.voice.stt], ["Text-to-speech", S.voice.tts], ["Kokoro voice blend", S.voice.kokoroBlend]].map(([k, v]) => (
              <React.Fragment key={k}>
                <div>
                  <div style={{ font: `500 13px ${LN.font}` }}>{k}</div>
                  <div style={{ font: `12px ${LN.font}`, color: LN.faint }}>{k === "Wake word" ? "Phrase to start a session" : k === "Wake provider" ? "Engine that listens for the phrase" : "Default for new sessions"}</div>
                </div>
                <div style={{ padding: "8px 12px", border: `1px solid ${LN.border}`, borderRadius: 6, background: LN.surface, font: `${LN.mono}`, fontSize: 12, color: LN.ink }}>{v}</div>
              </React.Fragment>
            ))}
          </div>
          <div style={{ marginTop: 32, font: `600 16px ${LN.font}`, letterSpacing: "-0.01em" }}>API keys</div>
          <div style={{ marginTop: 12, border: `1px solid ${LN.border}`, borderRadius: 10, background: LN.surface }}>
            {S.keys.map((k, i) => (
              <div key={k.name} style={{ display: "grid", gridTemplateColumns: "1fr 200px 100px 80px", gap: 14, padding: "12px 16px", borderTop: i ? `1px solid ${LN.border}` : "none", alignItems: "center" }}>
                <span style={{ font: `${LN.mono}`, fontSize: 13, color: LN.ink }}>{k.name}</span>
                <span style={{ font: `${LN.mono}`, fontSize: 12, color: LN.faint }}>{k.state === "set" ? "•••• •••• ••••" : "—"}</span>
                <LNBadge tone={k.state === "set" ? "green" : "red"}>{k.state}</LNBadge>
                <button data-no-pan style={{ font: `12px ${LN.font}`, color: LN.brand, background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>Edit →</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </LNChrome>
  );
}

window.Linear = function ({ screen }) {
  if (screen === "bridge") return <LNBridge />;
  if (screen === "deck") return <LNDeck />;
  if (screen === "pickup") return <LNPickup />;
  if (screen === "mission") return <LNMission />;
  if (screen === "settings") return <LNSettings />;
  return null;
};
