// V1 Split-diff · V2 Stacked groups · V3 PR-style summary
// All three drop into <LNRoomShell room="changes">.
const { Btn, GhostBtn, Badge, StatusDot, SectionLabel } = window.LNAtoms;
const LN_C = window.LN;

// ---------- shared bits ----------
function StatusChip({ status }) {
  const c = status === "A" ? LN_C.green : status === "D" ? LN_C.red : LN_C.brand;
  return <span style={{ width: 18, height: 18, borderRadius: 4, background: `${c}22`, color: c, display: "grid", placeItems: "center", font: `600 11px ${LN_C.mono}`, flexShrink: 0 }}>{status}</span>;
}
function Delta({ add, del, compact }) {
  return (
    <span style={{ display: "inline-flex", gap: 6, font: `${LN_C.mono}`, fontSize: 11, alignItems: "center" }}>
      <span style={{ color: LN_C.green }}>+{add}</span>
      <span style={{ color: LN_C.red }}>−{del}</span>
      {!compact ? (
        <span style={{ display: "inline-flex", gap: 2, marginLeft: 2 }}>
          {Array.from({ length: 5 }).map((_, i) => {
            const total = add + del || 1;
            const ratio = add / total;
            const fill = i < Math.round(ratio * 5) ? LN_C.green : i < 5 ? LN_C.red : LN_C.faint;
            return <span key={i} style={{ width: 6, height: 8, background: fill, borderRadius: 1 }} />;
          })}
        </span>
      ) : null}
    </span>
  );
}
function PatchLine({ line }) {
  const colorMap = {
    meta: LN_C.faint,
    ctx:  LN_C.dim,
    add:  LN_C.green,
    del:  LN_C.red,
  };
  const bgMap = {
    add: "rgba(76,183,130,0.08)",
    del: "rgba(229,72,77,0.08)",
  };
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "32px 1fr", font: `12px/1.55 ${LN_C.mono}`,
      color: colorMap[line.kind] || LN_C.dim, background: bgMap[line.kind] || "transparent",
      paddingLeft: 8,
    }}>
      <span style={{ color: LN_C.faint, textAlign: "right", paddingRight: 10, userSelect: "none" }}>
        {line.kind === "add" ? "+" : line.kind === "del" ? "−" : line.kind === "meta" ? "" : " "}
      </span>
      <span style={{ whiteSpace: "pre" }}>{line.text}</span>
    </div>
  );
}

// =================================================================
// V1 — SPLIT DIFF: file tree on the left, focused diff on the right.
// =================================================================
function CHV1() {
  const D = window.ROOMS_DATA;
  const allRepos = D.repos;
  const totalAdd = allRepos.reduce((a, r) => a + r.add, 0);
  const totalDel = allRepos.reduce((a, r) => a + r.del, 0);
  const totalFiles = allRepos.reduce((a, r) => a + r.files.length, 0);

  return (
    <window.LNRoomShell
      room="changes"
      right={(
        <div style={{ display: "flex", gap: 8 }}>
          <Btn>Show all</Btn>
          <Btn>Refresh</Btn>
        </div>
      )}
      headerExtra={(
        <div style={{ display: "flex", alignItems: "center", gap: 14, font: `12px ${LN_C.font}`, color: LN_C.dim }}>
          <span style={{ font: LN_C.mono, fontSize: 12 }}>{totalFiles} files</span>
          <Delta add={totalAdd} del={totalDel} compact />
        </div>
      )}
    >
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", height: "100%", minHeight: 0 }}>
        {/* File tree */}
        <div style={{ borderRight: `1px solid ${LN_C.border}`, background: LN_C.bg, overflow: "auto" }}>
          <div style={{ padding: "12px 14px 8px", display: "flex", gap: 8, alignItems: "center" }}>
            <input data-no-pan placeholder="Filter files" style={{
              flex: 1, padding: "5px 9px", background: LN_C.surface2, border: `1px solid ${LN_C.border}`,
              borderRadius: 6, color: LN_C.ink, font: `12px ${LN_C.font}`, outline: "none",
            }} />
          </div>
          {D.submodules.map((sm) => (
            <div key={sm.name}>
              <RepoHeader title={sm.name} sub="managed submodule" add={sm.add} del={sm.del} tone="brand" />
              {sm.files.map((f, i) => (
                <FileRow key={i} f={f} selected={false} />
              ))}
            </div>
          ))}
          {allRepos.map((r) => (
            <div key={r.path}>
              <RepoHeader title={r.path} sub={r.branch} add={r.add} del={r.del} />
              {r.files.length === 0 ? (
                <div style={{ padding: "8px 14px 12px 22px", font: `12px ${LN_C.font}`, color: LN_C.faint }}>No tracked diff.</div>
              ) : null}
              {r.files.map((f, i) => (
                <FileRow key={i} f={f} selected={r.path === "packages/renderer" && i === 0} />
              ))}
            </div>
          ))}
        </div>

        {/* Diff viewer */}
        <div style={{ display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0 }}>
          <div style={{ padding: "10px 18px", borderBottom: `1px solid ${LN_C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
            <StatusChip status="M" />
            <div>
              <div style={{ font: `${LN_C.mono}`, fontSize: 12, color: LN_C.ink }}>packages/renderer/src/components/missions/rooms/MissionChangesRoom.tsx</div>
              <div style={{ font: `11px ${LN_C.font}`, color: LN_C.faint, marginTop: 2 }}>3 hunks · modified</div>
            </div>
            <div style={{ flex: 1 }} />
            <Delta add={42} del={38} />
            <Btn small>Unified</Btn>
            <Btn small>Open</Btn>
          </div>
          <div style={{ overflow: "auto", padding: "10px 0 16px", background: LN_C.surface }}>
            {D.repos[0].patch.map((l, i) => <PatchLine key={i} line={l} />)}
            <div style={{ padding: "20px 16px 8px 16px", font: `11px ${LN_C.font}`, color: LN_C.faint }}>2 more hunks below · scroll or press ⌘+J</div>
          </div>
        </div>
      </div>
    </window.LNRoomShell>
  );

  function RepoHeader({ title, sub, add, del, tone }) {
    return (
      <div style={{ padding: "10px 14px 6px", display: "flex", alignItems: "center", gap: 8, borderTop: `1px solid ${LN_C.border}` }}>
        <span style={{ color: LN_C.faint, font: "10px sans-serif" }}>▾</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: `${LN_C.mono}`, fontSize: 12, color: tone === "brand" ? LN_C.brand : LN_C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
          <div style={{ font: `11px ${LN_C.font}`, color: LN_C.faint }}>{sub}</div>
        </div>
        {add + del > 0 ? <Delta add={add} del={del} compact /> : <span style={{ font: LN_C.mono, fontSize: 11, color: LN_C.faint }}>clean</span>}
      </div>
    );
  }
  function FileRow({ f, selected }) {
    return (
      <div data-no-pan style={{
        padding: "5px 14px 5px 22px",
        display: "flex", alignItems: "center", gap: 8,
        background: selected ? LN_C.brandSoft : "transparent",
        borderLeft: selected ? `2px solid ${LN_C.brand}` : "2px solid transparent",
        cursor: "pointer",
      }}>
        <StatusChip status={f.status} />
        <span style={{ flex: 1, font: `${LN_C.mono}`, fontSize: 12, color: selected ? LN_C.ink : LN_C.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", direction: "rtl", textAlign: "left" }}>{f.path}</span>
        <Delta add={f.add} del={f.del} compact />
      </div>
    );
  }
}

// =================================================================
// V2 — STACKED GROUPS: repo accordions, inline-expanded hunks.
// =================================================================
function CHV2() {
  const D = window.ROOMS_DATA;

  return (
    <window.LNRoomShell
      room="changes"
      right={(
        <div style={{ display: "flex", gap: 8 }}>
          <Btn>Show changed only</Btn>
          <Btn>Refresh review</Btn>
        </div>
      )}
    >
      <div style={{ height: "100%", overflow: "auto", padding: "18px 22px 32px" }}>
        {/* Managed submodule */}
        {D.submodules.map((sm) => (
          <article key={sm.name} style={{ marginBottom: 18, border: `1px solid ${LN_C.border}`, borderRadius: 10, background: LN_C.surface, overflow: "hidden" }}>
            <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${LN_C.border}` }}>
              <span style={{ font: "10px sans-serif", color: LN_C.faint }}>▾</span>
              <Badge tone="brand">Managed submodule</Badge>
              <span style={{ font: `500 13px ${LN_C.font}` }}>{sm.name}</span>
              <span style={{ font: LN_C.mono, fontSize: 12, color: LN_C.faint }}>{sm.branch}</span>
              <div style={{ flex: 1 }} />
              <span style={{ font: `11px ${LN_C.font}`, color: LN_C.faint }}>1 parent needs alignment</span>
              <Delta add={sm.add} del={sm.del} />
            </div>
            {sm.files.map((f, i) => (
              <FileRowInline key={i} f={f} first={i === 0} />
            ))}
          </article>
        ))}
        {/* Repos */}
        {D.repos.filter((r) => r.files.length > 0).map((r) => (
          <article key={r.path} style={{ marginBottom: 18, border: `1px solid ${LN_C.border}`, borderRadius: 10, background: LN_C.surface, overflow: "hidden" }}>
            <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${LN_C.border}` }}>
              <span style={{ font: "10px sans-serif", color: LN_C.faint }}>▾</span>
              <span style={{ font: `${LN_C.mono}`, fontSize: 13, color: LN_C.ink }}>{r.path}</span>
              <span style={{ font: LN_C.mono, fontSize: 12, color: LN_C.faint }}>{r.branch}</span>
              <div style={{ flex: 1 }} />
              <span style={{ font: `11px ${LN_C.font}`, color: LN_C.faint }}>{r.files.length} file{r.files.length === 1 ? "" : "s"}</span>
              <Delta add={r.add} del={r.del} />
            </div>
            {r.files.map((f, i) => (
              <FileRowInline key={i} f={f} first={i === 0} expanded={r.path === "packages/renderer" && i === 0} />
            ))}
          </article>
        ))}
        {/* Empty repo card */}
        <article style={{ border: `1px dashed ${LN_C.border}`, borderRadius: 10, padding: "12px 14px", color: LN_C.faint, font: `12px ${LN_C.font}` }}>
          <span style={{ font: LN_C.mono, fontSize: 12, color: LN_C.dim }}>packages/mcp-windows-ui</span> — no tracked diff in this managed repo.
        </article>
      </div>
    </window.LNRoomShell>
  );

  function FileRowInline({ f, first, expanded }) {
    const D = window.ROOMS_DATA;
    return (
      <>
        <div data-no-pan style={{
          padding: "8px 14px 8px 16px",
          display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 12, alignItems: "center",
          borderTop: first ? "none" : `1px solid ${LN_C.border}`,
          cursor: "pointer",
        }}>
          <span style={{ color: LN_C.faint, font: "9px sans-serif" }}>{expanded ? "▾" : "▸"}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <StatusChip status={f.status} />
            <span style={{ font: `${LN_C.mono}`, fontSize: 12, color: LN_C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.path}</span>
          </span>
          <span style={{ font: `11px ${LN_C.font}`, color: LN_C.faint }}>{f.hunks} hunk{f.hunks === 1 ? "" : "s"}</span>
          <Delta add={f.add} del={f.del} compact />
        </div>
        {expanded ? (
          <div style={{ borderTop: `1px solid ${LN_C.border}`, background: LN_C.surface2, padding: "6px 0 10px" }}>
            {D.repos[0].patch.slice(0, 9).map((l, i) => <PatchLine key={i} line={l} />)}
          </div>
        ) : null}
      </>
    );
  }
}

// =================================================================
// V3 — PR-STYLE SUMMARY: stat strip + flat changed-files list.
// =================================================================
function CHV3() {
  const D = window.ROOMS_DATA;
  const totalAdd = D.repos.reduce((a, r) => a + r.add, 0) + D.submodules.reduce((a, s) => a + s.add, 0);
  const totalDel = D.repos.reduce((a, r) => a + r.del, 0) + D.submodules.reduce((a, s) => a + s.del, 0);
  const totalFiles = D.repos.reduce((a, r) => a + r.files.length, 0) + D.submodules.reduce((a, s) => a + s.files.length, 0);

  const flat = [
    ...D.submodules.flatMap((s) => s.files.map((f) => ({ ...f, repo: s.name, sub: true }))),
    ...D.repos.flatMap((r) => r.files.map((f) => ({ ...f, repo: r.path, sub: false }))),
  ];

  return (
    <window.LNRoomShell
      room="changes"
      right={(
        <div style={{ display: "flex", gap: 8 }}>
          <Btn>Refresh</Btn>
          <Btn primary>Continue to actions →</Btn>
        </div>
      )}
    >
      <div style={{ height: "100%", overflow: "auto" }}>
        {/* Stat strip */}
        <div style={{ padding: "18px 22px 16px", borderBottom: `1px solid ${LN_C.border}`, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
          {[
            ["Files changed", String(totalFiles)],
            ["Additions",      `+${totalAdd}`, "green"],
            ["Deletions",      `−${totalDel}`, "red"],
            ["Repos",          `${D.repos.filter(r => r.files.length).length} of ${D.repos.length}`],
            ["Submodules",     `${D.submodules.length}`],
          ].map(([k, v, tone], i) => (
            <div key={i}>
              <div style={{ font: `12px ${LN_C.font}`, color: LN_C.faint }}>{k}</div>
              <div style={{ font: `600 22px ${LN_C.font}`, marginTop: 4, color: tone === "green" ? LN_C.green : tone === "red" ? LN_C.red : LN_C.ink, letterSpacing: "-0.01em" }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{ padding: "16px 22px 32px" }}>
          <SectionLabel right={(
            <span style={{ display: "flex", gap: 8 }}>
              <Btn small>Group by repo</Btn>
              <Btn small>Hide clean</Btn>
            </span>
          )}>Changed files</SectionLabel>
          <div style={{ border: `1px solid ${LN_C.border}`, borderRadius: 10, overflow: "hidden", background: LN_C.surface }}>
            <div style={{ padding: "8px 14px", display: "grid", gridTemplateColumns: "30px 1fr 120px 90px 80px", gap: 12, font: `${LN_C.mono}`, fontSize: 11, color: LN_C.faint, letterSpacing: "0.04em", borderBottom: `1px solid ${LN_C.border}` }}>
              <span>STA</span><span>PATH</span><span>REPO</span><span>HUNKS</span><span>DELTA</span>
            </div>
            {flat.map((f, i) => (
              <div key={i} style={{ padding: "8px 14px", display: "grid", gridTemplateColumns: "30px 1fr 120px 90px 80px", gap: 12, alignItems: "center", borderTop: i ? `1px solid ${LN_C.border}` : "none", cursor: "pointer" }}>
                <StatusChip status={f.status} />
                <span style={{ font: `${LN_C.mono}`, fontSize: 12, color: LN_C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.path}</span>
                <span style={{ font: `12px ${LN_C.font}`, color: f.sub ? LN_C.brand : LN_C.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.sub ? "↳ " : ""}{f.repo}</span>
                <span style={{ font: LN_C.mono, fontSize: 11, color: LN_C.faint }}>{f.hunks}</span>
                <Delta add={f.add} del={f.del} compact />
              </div>
            ))}
          </div>

          {/* Pre-expanded preview of the first file */}
          <div style={{ marginTop: 20 }}>
            <SectionLabel>Preview · MissionChangesRoom.tsx</SectionLabel>
            <div style={{ border: `1px solid ${LN_C.border}`, borderRadius: 10, background: LN_C.surface, overflow: "hidden" }}>
              <div style={{ padding: "8px 14px", borderBottom: `1px solid ${LN_C.border}`, display: "flex", gap: 10, alignItems: "center", font: `12px ${LN_C.font}`, color: LN_C.dim }}>
                <span style={{ font: LN_C.mono, fontSize: 12, color: LN_C.ink }}>MissionChangesRoom.tsx</span>
                <span>·</span>
                <span>hunk 1 of 3</span>
                <div style={{ flex: 1 }} />
                <GhostBtn>Open full diff →</GhostBtn>
              </div>
              <div style={{ padding: "8px 0" }}>
                {D.repos[0].patch.slice(0, 9).map((l, i) => <PatchLine key={i} line={l} />)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </window.LNRoomShell>
  );
}

window.ChangesRoom = { V1: CHV1, V2: CHV2, V3: CHV3 };
