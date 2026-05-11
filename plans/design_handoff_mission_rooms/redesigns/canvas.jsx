// Light DesignCanvas adapted for tall multi-section grid.
const { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback } = React;

const STORE_KEY = "spira-redesigns-canvas-v1";

function useCanvasState() {
  const [pan, setPan] = useState({ x: 80, y: 60 });
  const [zoom, setZoom] = useState(0.55);
  const [focusId, setFocusId] = useState(null);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (s) { setPan(s.pan); setZoom(s.zoom); }
    } catch {}
  }, []);
  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ pan, zoom }));
  }, [pan, zoom]);
  return { pan, setPan, zoom, setZoom, focusId, setFocusId };
}

function DesignCanvas({ children }) {
  const { pan, setPan, zoom, setZoom, focusId, setFocusId } = useCanvasState();
  const dragRef = useRef(null);
  const onMouseDown = (e) => {
    if (e.target.closest("[data-no-pan]")) return;
    dragRef.current = { x: e.clientX, y: e.clientY, pan };
  };
  const onMouseMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setPan({ x: dragRef.current.pan.x + dx, y: dragRef.current.pan.y + dy });
  };
  const onMouseUp = () => { dragRef.current = null; };
  const onWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    setZoom((z) => Math.max(0.18, Math.min(1.6, z * (1 + delta))));
  };

  const focused = focusId
    ? React.Children.toArray(children).flatMap((s) => React.Children.toArray(s.props.children)).find((a) => a.props.id === focusId)
    : null;

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#0b0d12", color: "#e5e7eb" }}
         onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onWheel={onWheel}>
      <div style={{ position: "absolute", inset: 0,
        backgroundImage: "radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)",
        backgroundSize: "32px 32px", backgroundPosition: `${pan.x}px ${pan.y}px` }} />
      <div style={{ transformOrigin: "0 0", transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        {React.Children.map(children, (s) => React.cloneElement(s, { onFocus: setFocusId }))}
      </div>
      <div data-no-pan style={{ position: "fixed", left: 16, bottom: 16, display: "flex", gap: 8, alignItems: "center",
        background: "rgba(20,22,30,0.88)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 12px",
        font: "12px ui-monospace, monospace", color: "#cbd5e1", backdropFilter: "blur(10px)" }}>
        <button onClick={() => setZoom((z) => Math.max(0.18, z * 0.85))} style={btnStyle}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(1.6, z * 1.15))} style={btnStyle}>+</button>
        <span style={{ opacity: 0.4 }}>·</span>
        <button onClick={() => { setPan({ x: 80, y: 60 }); setZoom(0.55); }} style={btnStyle}>fit</button>
        <span style={{ opacity: 0.4 }}>·</span>
        <span style={{ opacity: 0.6 }}>drag · ⌘/ctrl + scroll · double-click to focus</span>
      </div>
      {focused ? (
        <div data-no-pan style={{ position: "fixed", inset: 0, background: "rgba(8,10,16,0.92)", display: "grid", placeItems: "center", zIndex: 50 }}
             onClick={() => setFocusId(null)}>
          <div style={{ width: focused.props.width, height: focused.props.height, background: "transparent" }} onClick={(e) => e.stopPropagation()}>
            {focused.props.children}
          </div>
          <button onClick={() => setFocusId(null)} style={{ position: "fixed", top: 16, right: 16, ...btnStyle, padding: "8px 14px" }}>close</button>
        </div>
      ) : null}
    </div>
  );
}

const btnStyle = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "inherit", padding: "4px 10px", borderRadius: 6, cursor: "pointer", font: "inherit" };

function DCSection({ id, title, subtitle, accent, children, onFocus }) {
  return (
    <section style={{ marginBottom: 80 }} data-section={id}>
      <header style={{ marginBottom: 18, display: "flex", gap: 18, alignItems: "baseline", padding: "0 8px" }}>
        <div style={{ width: 8, height: 32, background: accent || "#888", borderRadius: 2 }} />
        <div>
          <div style={{ font: "600 11px ui-monospace, monospace", letterSpacing: "0.18em", textTransform: "uppercase", color: "#94a3b8" }}>{id}</div>
          <h2 style={{ margin: 0, font: "600 28px/1.1 ui-sans-serif, system-ui", color: "#f1f5f9" }}>{title}</h2>
          {subtitle ? <div style={{ marginTop: 6, font: "14px/1.5 ui-sans-serif, system-ui", color: "#94a3b8", maxWidth: 760 }}>{subtitle}</div> : null}
        </div>
      </header>
      <div style={{ display: "flex", gap: 20, flexWrap: "nowrap" }}>
        {React.Children.map(children, (a) => React.cloneElement(a, { onFocus }))}
      </div>
    </section>
  );
}

function DCArtboard({ id, label, width, height, children, onFocus }) {
  return (
    <div style={{ width, flex: "0 0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 4px 8px", color: "#94a3b8", font: "11px ui-monospace, monospace", letterSpacing: "0.08em" }}>
        <span>{label}</span>
        <span style={{ opacity: 0.6 }}>{width}×{height}</span>
      </div>
      <div onDoubleClick={() => onFocus && onFocus(id)}
           style={{ width, height, background: "#000", borderRadius: 4, overflow: "hidden", boxShadow: "0 30px 60px rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.06)", cursor: "zoom-in" }}>
        {children}
      </div>
    </div>
  );
}

window.RDC = { DesignCanvas, DCSection, DCArtboard };
