// V1 Pipeline cards · V2 Two-pane focus · V3 Workflow checklist
const A_LN = window.LN;
const { Btn: ABtn, GhostBtn: AGhost, Badge: ABadge, StatusDot: ADot, SectionLabel: ASection } = window.LNAtoms;

const STAGES = [
  { id: "diff",   label: "Diff" },
  { id: "commit", label: "Commit" },
  { id: "push",   label: "Push" },
  { id: "pr",     label: "PR" },
];
function stageIndex(stage) {
  return STAGES.findIndex((s) => s.id === stage);
}
function StageRail({ stage, blocked }) {
  const cur = stage === "clean" ? 4 : stageIndex(stage);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, marginTop: 12, position: "relative" }}>
      <div style={{ position: "absolute", top: 9, left: "12%", right: "12%", height: 2, background: A_LN.border }} />
      <div style={{ position: "absolute", top: 9, left: "12%", height: 2, background: blocked ? A_LN.amber : A_LN.brand, width: `${Math.max(0, Math.min(cur, 4)) * (76/4)}%`, transition: "width 0.3s" }} />
      {STAGES.map((s, i) => {
        const done = i < cur;
        const here = i === cur;
        const color = done ? A_LN.brand : here ? (blocked ? A_LN.amber : A_LN.brand) : A_LN.faint;
        return (
          <div key={s.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, position: "relative", zIndex: 1 }}>
            <div style={{
              width: 20, height: 20, borderRadius: "50%",
              background: done || here ? color : A_LN.surface,
              border: `2px solid ${color}`,
              display: "grid", placeItems: "center",
              color: done || here ? "#fff" : A_LN.faint,
              font: `600 10px ${A_LN.font}`,
            }}>{done ? "✓" : i + 1}</div>
            <span style={{ font: `${here ? 600 : 500} 11px ${A_LN.font}`, color: here ? A_LN.ink : done ? A_LN.dim : A_LN.faint }}>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// =================================================================
// V1 — PIPELINE CARDS
// =================================================================
function AV1() {
  const D = window.ROOMS_DATA;
  return (
    <window.LNRoomShell room="actions"
      right={(<div style={{ display: "flex", gap: 8 }}>
        <ABtn>Refresh</ABtn>
        <ABtn primary>Commit all</ABtn>
      </div>)}
    >
      <div style={{ height: "100%", overflow: "auto", padding: "18px 22px 32px" }}>
        {/* Managed submodules */}
        {D.submoduleActions.map((sm) => (
          <ActionCard
            key={sm.name}
            title={sm.name}
            kind="submodule"
            branch={sm.branch}
            stage={sm.stage}
            blocked={sm.needsAlignment}
            facts={[
              ["Branch", sm.branch],
              ["Canonical", sm.committedSha.slice(0, 10)],
              ["Source", sm.worktree],
            ]}
            hint={sm.needsAlignment ? "Parent repos still need to align to the canonical submodule commit. Use Align parents to restage." : "Submodule changes are waiting to be committed."}
            commitDraft={sm.commitDraft}
            primary={sm.needsAlignment ? "Align parents" : sm.pushAction === "publish" ? "Publish" : "Commit"}
          />
        ))}
        {/* Repos */}
        {D.repoActions.map((r) => (
          <ActionCard
            key={r.path}
            title={r.path}
            kind="repo"
            branch={r.branch}
            stage={r.stage}
            blocked={r.blockedBy.length > 0}
            facts={[
              ["Branch", r.branch],
              ["Upstream", r.upstream || "Not published"],
              ["Ahead / behind", `${r.ahead} / ${r.behind}`],
            ]}
            hint={
              r.blockedBy.length > 0 ? `Finish the managed submodule workflow first: ${r.blockedBy.join(", ")}.`
              : r.hasDiff ? "Changes are still waiting to be committed."
              : r.pushAction === "publish" ? "This branch is ready to publish to origin."
              : r.pushAction === "push" ? "This branch has local commits ready to push."
              : r.pr ? "Everything in this repo has reached the remote branch. Open the PR when ready."
              : "The branch is currently up to date."
            }
            commitDraft={r.commitDraft}
            pr={r.pr}
            primary={
              r.blockedBy.length > 0 ? "Blocked"
              : r.hasDiff ? "Commit"
              : r.pushAction === "publish" ? "Publish"
              : r.pushAction === "push" ? "Push"
              : r.pr ? "Open PR"
              : "Clean"
            }
          />
        ))}
      </div>
    </window.LNRoomShell>
  );

  function ActionCard({ title, kind, branch, stage, blocked, facts, hint, commitDraft, pr, primary }) {
    return (
      <article style={{ marginBottom: 16, border: `1px solid ${A_LN.border}`, borderRadius: 12, background: A_LN.surface, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", display: "grid", gridTemplateColumns: "1fr 320px", gap: 24, borderBottom: `1px solid ${A_LN.border}` }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {kind === "submodule" ? <ABadge tone="brand">Managed submodule</ABadge> : null}
              <span style={{ font: `${A_LN.mono}`, fontSize: 14, color: A_LN.ink }}>{title}</span>
              <span style={{ font: `${A_LN.mono}`, fontSize: 12, color: A_LN.faint }}>{branch}</span>
            </div>
            <div style={{ display: "flex", gap: 18, marginTop: 10 }}>
              {facts.map(([k, v]) => (
                <div key={k}>
                  <div style={{ font: `11px ${A_LN.font}`, color: A_LN.faint }}>{k}</div>
                  <div style={{ font: `${A_LN.mono}`, fontSize: 12, color: A_LN.ink, marginTop: 2 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <StageRail stage={stage} blocked={blocked} />
          </div>
        </div>
        <div style={{ padding: "14px 18px", display: "grid", gridTemplateColumns: "1fr 320px", gap: 24, alignItems: "stretch" }}>
          {/* Left: commit draft / pr area */}
          <div>
            {pr ? (
              <div>
                <ASection>Pull request</ASection>
                <div style={{ display: "flex", gap: 8 }}>
                  <ABtn primary>Open PR</ABtn>
                  <ABtn>Open draft PR</ABtn>
                </div>
              </div>
            ) : (
              <div>
                <ASection right={<AGhost>Regenerate</AGhost>}>Commit draft</ASection>
                <textarea data-no-pan defaultValue={commitDraft} placeholder="feat(LH-417): summary" style={{
                  width: "100%", minHeight: 84, padding: "10px 12px",
                  background: A_LN.bg, border: `1px solid ${A_LN.border}`, borderRadius: 8,
                  color: A_LN.ink, font: `${A_LN.mono}`, fontSize: 12, lineHeight: 1.55, resize: "none", outline: "none",
                }} />
              </div>
            )}
          </div>
          {/* Right: hint + primary */}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div style={{
              padding: "10px 12px",
              border: `1px solid ${blocked ? A_LN.amber + "44" : A_LN.border}`,
              background: blocked ? A_LN.amberSoft : A_LN.surface2,
              borderRadius: 8, font: `12px/1.5 ${A_LN.font}`, color: blocked ? A_LN.amber : A_LN.dim,
            }}>{hint}</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <ABtn>Skip</ABtn>
              <ABtn primary>{primary}</ABtn>
            </div>
          </div>
        </div>
      </article>
    );
  }
}

// =================================================================
// V2 — TWO-PANE FOCUS
// =================================================================
function AV2() {
  const D = window.ROOMS_DATA;
  const items = [
    ...D.submoduleActions.map((s) => ({ kind: "submodule", id: s.name, title: s.name, branch: s.branch, stage: s.stage, blocked: s.needsAlignment, draft: s.commitDraft, hasDiff: s.hasDiff, pr: null, pushAction: s.pushAction })),
    ...D.repoActions.map((r) => ({ kind: "repo", id: r.path, title: r.path, branch: r.branch, stage: r.stage, blocked: r.blockedBy.length > 0, draft: r.commitDraft, hasDiff: r.hasDiff, pr: r.pr, pushAction: r.pushAction })),
  ];
  const selected = items.find((i) => i.id === "packages/renderer") || items[1];

  return (
    <window.LNRoomShell room="actions"
      right={<ABtn>Refresh</ABtn>}
    >
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", height: "100%", minHeight: 0 }}>
        {/* List */}
        <div style={{ borderRight: `1px solid ${A_LN.border}`, background: A_LN.bg, overflow: "auto" }}>
          <div style={{ padding: "12px 14px 8px", font: `${A_LN.mono}`, fontSize: 11, color: A_LN.faint, letterSpacing: "0.04em", borderBottom: `1px solid ${A_LN.border}` }}>4 REPOS · 1 SUBMODULE</div>
          {items.map((it) => {
            const sel = it.id === selected.id;
            const stateTone = it.blocked ? "amber" : it.stage === "clean" ? "dim" : it.stage === "pr" ? "green" : "brand";
            const stateLabel = it.blocked ? "Blocked" : it.stage === "clean" ? "Clean" : it.stage === "commit" ? "Commit" : it.stage === "push" ? "Push" : "PR ready";
            return (
              <div key={it.id} data-no-pan style={{
                padding: "10px 14px", cursor: "pointer",
                background: sel ? A_LN.surface2 : "transparent",
                borderLeft: `2px solid ${sel ? A_LN.brand : "transparent"}`,
                borderBottom: `1px solid ${A_LN.border}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {it.kind === "submodule" ? <span style={{ font: "10px sans-serif", color: A_LN.brand }}>↳</span> : null}
                  <span style={{ flex: 1, font: `${A_LN.mono}`, fontSize: 12, color: sel ? A_LN.ink : A_LN.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.title}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <ABadge tone={stateTone} soft>{stateLabel}</ABadge>
                  <span style={{ font: `11px ${A_LN.font}`, color: A_LN.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>{it.branch}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail */}
        <div style={{ overflow: "auto", padding: "22px 28px 32px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ font: `${A_LN.mono}`, fontSize: 16, color: A_LN.ink }}>{selected.title}</span>
            <ABadge tone="amber">Commit</ABadge>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 16 }}>
            {[
              ["Branch", selected.branch],
              ["Upstream", "origin/" + selected.branch],
              ["Ahead / behind", "2 / 0"],
            ].map(([k, v]) => (
              <div key={k} style={{ padding: 12, border: `1px solid ${A_LN.border}`, borderRadius: 8, background: A_LN.surface }}>
                <div style={{ font: `11px ${A_LN.font}`, color: A_LN.faint }}>{k}</div>
                <div style={{ font: `${A_LN.mono}`, fontSize: 13, color: A_LN.ink, marginTop: 4 }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 22, padding: "12px 14px", border: `1px solid ${A_LN.amber}44`, background: A_LN.amberSoft, borderRadius: 8, font: `13px/1.5 ${A_LN.font}`, color: A_LN.amber, display: "flex", alignItems: "center", gap: 10 }}>
            <ADot tone="amber" />
            Finish the managed submodule workflow first: <strong>spira-mcp-cli</strong>.
          </div>

          <div style={{ marginTop: 22 }}>
            <ASection right={<AGhost>Regenerate from diff</AGhost>}>Commit draft</ASection>
            <textarea data-no-pan defaultValue={selected.draft} style={{
              width: "100%", minHeight: 120, padding: "12px 14px",
              background: A_LN.surface, border: `1px solid ${A_LN.border}`, borderRadius: 10,
              color: A_LN.ink, font: `${A_LN.mono}`, fontSize: 13, lineHeight: 1.55, resize: "none", outline: "none",
            }} />
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <ABtn>Discard</ABtn>
              <ABtn>Push (1 ahead)</ABtn>
              <ABtn primary>Commit</ABtn>
              <div style={{ flex: 1 }} />
              <span style={{ font: `11px ${A_LN.font}`, color: A_LN.faint, alignSelf: "center" }}>⌘ Enter</span>
            </div>
          </div>

          <div style={{ marginTop: 26 }}>
            <ASection>Recent commits on this branch</ASection>
            <div style={{ border: `1px solid ${A_LN.border}`, borderRadius: 10, background: A_LN.surface, overflow: "hidden" }}>
              {[
                ["8a2c39d", "fix(missions): tighten review snapshot dependency", "K. Ardal", "08:14"],
                ["c0481fa", "feat(missions): add inline recovery state",         "K. Ardal", "07:52"],
              ].map(([sha, msg, who, when], i) => (
                <div key={sha} style={{ padding: "10px 14px", display: "grid", gridTemplateColumns: "100px 1fr 120px 60px", gap: 12, alignItems: "center", borderTop: i ? `1px solid ${A_LN.border}` : "none" }}>
                  <span style={{ font: `${A_LN.mono}`, fontSize: 12, color: A_LN.brand }}>{sha}</span>
                  <span style={{ font: `12px ${A_LN.font}`, color: A_LN.ink }}>{msg}</span>
                  <span style={{ font: `12px ${A_LN.font}`, color: A_LN.dim }}>{who}</span>
                  <span style={{ font: `${A_LN.mono}`, fontSize: 11, color: A_LN.faint, textAlign: "right" }}>{when}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </window.LNRoomShell>
  );
}

// =================================================================
// V3 — WORKFLOW CHECKLIST
// =================================================================
function AV3() {
  const D = window.ROOMS_DATA;
  const rows = [
    ...D.submoduleActions.map((s) => ({
      kind: "submodule", id: s.name, title: s.name, branch: s.branch,
      stage: s.stage, blocked: s.needsAlignment,
      next: s.needsAlignment ? "Align parents to canonical commit" : s.hasDiff ? "Commit the draft below" : s.pushAction === "publish" ? "Publish branch to origin" : "—",
      expanded: true, draft: s.commitDraft, hasDiff: s.hasDiff, primary: s.needsAlignment ? "Align parents" : "Commit",
    })),
    ...D.repoActions.map((r) => ({
      kind: "repo", id: r.path, title: r.path, branch: r.branch,
      stage: r.stage, blocked: r.blockedBy.length > 0,
      next: r.blockedBy.length ? `Waiting on submodule: ${r.blockedBy.join(", ")}` : r.hasDiff ? "Commit the draft" : r.pushAction === "publish" ? "Publish branch" : r.pushAction === "push" ? "Push 1 commit" : r.pr ? "Open pull request" : "All clean — nothing to do",
      expanded: false, draft: r.commitDraft, hasDiff: r.hasDiff, primary: r.blockedBy.length ? "Blocked" : r.hasDiff ? "Commit" : r.pushAction === "publish" ? "Publish" : r.pushAction === "push" ? "Push" : r.pr ? "Open PR" : "—",
    })),
  ];

  return (
    <window.LNRoomShell room="actions"
      right={(<div style={{ display: "flex", gap: 8 }}>
        <ABtn>Refresh</ABtn>
        <ABtn primary>Run next step</ABtn>
      </div>)}
    >
      <div style={{ height: "100%", overflow: "auto", padding: "18px 22px 32px" }}>
        {/* Progress strip */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", border: `1px solid ${A_LN.border}`, borderRadius: 10, background: A_LN.surface, marginBottom: 16 }}>
          <ADot tone="brand" />
          <div style={{ flex: 1 }}>
            <div style={{ font: `500 13px ${A_LN.font}` }}>2 of 5 ready · 1 blocked · 1 pull-request pending</div>
            <div style={{ font: `12px ${A_LN.font}`, color: A_LN.faint, marginTop: 2 }}>Resolve submodule alignment to unblock packages/renderer.</div>
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {[true, true, false, false, false].map((d, i) => (
              <span key={i} style={{ width: 18, height: 4, borderRadius: 2, background: d ? A_LN.brand : A_LN.surface3 }} />
            ))}
            <span style={{ font: `${A_LN.mono}`, fontSize: 11, color: A_LN.faint, marginLeft: 6 }}>2 / 5</span>
          </div>
        </div>

        {/* Checklist */}
        <div style={{ border: `1px solid ${A_LN.border}`, borderRadius: 12, overflow: "hidden", background: A_LN.surface }}>
          {rows.map((row, i) => (
            <div key={row.id} style={{ borderTop: i ? `1px solid ${A_LN.border}` : "none" }}>
              <div data-no-pan style={{ padding: "14px 18px", display: "grid", gridTemplateColumns: "22px 1fr 220px 110px", gap: 14, alignItems: "center", cursor: "pointer" }}>
                <span style={{
                  width: 18, height: 18, borderRadius: 4,
                  background: row.blocked ? A_LN.amberSoft : row.stage === "clean" ? A_LN.greenSoft : "transparent",
                  border: `1.5px solid ${row.blocked ? A_LN.amber : row.stage === "clean" ? A_LN.green : A_LN.borderHi}`,
                  display: "grid", placeItems: "center", color: row.stage === "clean" ? A_LN.green : A_LN.amber, font: "10px sans-serif",
                }}>{row.stage === "clean" ? "✓" : row.blocked ? "!" : ""}</span>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {row.kind === "submodule" ? <ABadge tone="brand" soft>Submodule</ABadge> : null}
                    <span style={{ font: `${A_LN.mono}`, fontSize: 13, color: A_LN.ink }}>{row.title}</span>
                    <span style={{ font: `${A_LN.mono}`, fontSize: 12, color: A_LN.faint }}>{row.branch}</span>
                  </div>
                  <div style={{ font: `12px ${A_LN.font}`, color: row.blocked ? A_LN.amber : A_LN.dim, marginTop: 4 }}>
                    <span style={{ font: `500 11px ${A_LN.font}`, color: A_LN.faint, marginRight: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Next</span>
                    {row.next}
                  </div>
                </div>
                <div>
                  <MicroStageRail stage={row.stage} />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <ABtn primary={!row.blocked && row.primary !== "—"}>{row.primary}</ABtn>
                </div>
              </div>
              {row.expanded ? (
                <div style={{ padding: "0 18px 16px 54px", borderTop: `1px dashed ${A_LN.border}` }}>
                  <div style={{ marginTop: 12, padding: 12, border: `1px solid ${A_LN.border}`, borderRadius: 8, background: A_LN.bg }}>
                    <div style={{ font: `${A_LN.mono}`, fontSize: 12, color: A_LN.dim, whiteSpace: "pre-wrap" }}>{row.draft}</div>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </window.LNRoomShell>
  );

  function MicroStageRail({ stage }) {
    const cur = stage === "clean" ? 4 : stageIndex(stage);
    return (
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {STAGES.map((s, i) => (
          <React.Fragment key={s.id}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: i < cur ? A_LN.brand : i === cur ? A_LN.brand : A_LN.surface3,
              border: i === cur ? `2px solid ${A_LN.brand}` : "none",
            }} />
            {i < 3 ? <span style={{ flex: 1, height: 2, background: i < cur ? A_LN.brand : A_LN.surface3, minWidth: 18 }} /> : null}
          </React.Fragment>
        ))}
      </div>
    );
  }
}

window.ActionsRoom = { V1: AV1, V2: AV2, V3: AV3 };
