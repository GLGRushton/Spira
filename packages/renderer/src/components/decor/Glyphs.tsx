import type { CSSProperties, ReactNode } from "react";

interface BaseGlyphProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}

export function YevonSpiral({ size = 28, color = "currentColor", strokeWidth = 1.2, className, style }: BaseGlyphProps) {
  // Three-arm logarithmic spiral. Drawn as three rotated copies of one path.
  const arm = "M0 0 C 4 -1.2, 8 -3.6, 9.6 -7.8 C 10.8 -11.5, 9.4 -14.6, 6.4 -15.4";
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="-18 -18 36 36"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="0" cy="0" r="1.5" fill={color} stroke="none" />
      <g transform="rotate(0)" opacity="0.92">
        <path d={arm} />
      </g>
      <g transform="rotate(120)" opacity="0.92">
        <path d={arm} />
      </g>
      <g transform="rotate(240)" opacity="0.92">
        <path d={arm} />
      </g>
      <circle cx="0" cy="0" r="14" stroke={color} strokeOpacity="0.32" strokeWidth={strokeWidth * 0.7} />
    </svg>
  );
}

interface BevelleArchProps extends BaseGlyphProps {
  width?: number;
}

export function BevelleArch({
  width = 240,
  color = "var(--gold-warm)",
  strokeWidth = 1.2,
  className,
  style,
}: BevelleArchProps) {
  const height = Math.max(14, Math.round(width * 0.06));
  return (
    <svg
      className={className}
      style={style}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d={`M2 ${height - 2} Q${width / 2} -2 ${width - 2} ${height - 2}`} />
      <circle cx={width / 2} cy={height * 0.18} r={1.6} fill={color} stroke="none" />
      <path d={`M${width * 0.18} ${height - 1} L${width * 0.82} ${height - 1}`} strokeOpacity="0.42" />
    </svg>
  );
}

export function BevelleTripleArch({
  width = 320,
  color = "var(--gold-warm)",
  strokeWidth = 1.1,
  className,
  style,
}: BevelleArchProps) {
  const height = Math.max(80, Math.round(width * 0.34));
  const cx = width / 2;
  return (
    <svg
      className={className}
      style={style}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path
        d={`M${width * 0.04} ${height} Q${cx} ${height * 0.04} ${width * 0.96} ${height}`}
        strokeOpacity="0.54"
      />
      <path
        d={`M${width * 0.16} ${height} Q${cx} ${height * 0.18} ${width * 0.84} ${height}`}
        strokeOpacity="0.78"
      />
      <path
        d={`M${width * 0.28} ${height} Q${cx} ${height * 0.32} ${width * 0.72} ${height}`}
        strokeOpacity="1"
      />
      <circle cx={cx} cy={height * 0.16} r={1.8} fill={color} stroke="none" opacity="0.86" />
      <line x1={cx} y1={0} x2={cx} y2={height} strokeOpacity="0.06" />
    </svg>
  );
}

interface SphereGridNodeProps extends BaseGlyphProps {
  state?: "idle" | "active" | "hover" | "muted";
  fillOpacity?: number;
}

export function SphereGridNode({
  size = 56,
  state = "idle",
  className,
  style,
  fillOpacity,
}: SphereGridNodeProps) {
  const stroke =
    state === "active" ? "var(--gold-bright)" : state === "hover" ? "var(--gold-warm)" : "var(--gold-deep)";
  const innerOpacity = fillOpacity ?? (state === "active" ? 0.92 : state === "hover" ? 0.55 : 0.32);
  const haloOpacity = state === "active" ? 0.38 : state === "hover" ? 0.18 : 0.08;
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="-50 -50 100 100"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`sgn-fill-${state}`} cx="0.5" cy="0.4">
          <stop offset="0" stopColor="var(--gold-bright)" stopOpacity={innerOpacity} />
          <stop offset="0.62" stopColor="var(--gold-warm)" stopOpacity={innerOpacity * 0.6} />
          <stop offset="1" stopColor="var(--hull-deep)" stopOpacity={innerOpacity * 0.2} />
        </radialGradient>
      </defs>
      <circle cx="0" cy="0" r="44" fill="var(--gold-bright)" opacity={haloOpacity} />
      <circle cx="0" cy="0" r="34" fill={`url(#sgn-fill-${state})`} />
      <circle cx="0" cy="0" r="34" fill="none" stroke={stroke} strokeWidth="1.4" />
      <circle cx="0" cy="0" r="28" fill="none" stroke="var(--gold-deep)" strokeWidth="0.6" strokeOpacity="0.5" />
      <circle cx="0" cy="0" r="6" fill="var(--marble-ivory)" opacity={state === "active" ? 0.96 : 0.7} />
    </svg>
  );
}

interface SphereGridConnectorProps {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  active?: boolean;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}

export function SphereGridConnector({
  fromX,
  fromY,
  toX,
  toY,
  active = false,
  className,
  style,
  strokeWidth = 1.1,
}: SphereGridConnectorProps) {
  const color = active ? "var(--gold-warm)" : "var(--gold-deep)";
  const opacity = active ? 0.9 : 0.4;
  return (
    <line
      className={className}
      style={style}
      x1={fromX}
      y1={fromY}
      x2={toX}
      y2={toY}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeOpacity={opacity}
      strokeLinecap="round"
    />
  );
}

interface CloisterPedestalProps {
  width?: number;
  height?: number;
  glyph?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function CloisterPedestal({
  width = 280,
  height = 56,
  glyph,
  className,
  style,
}: CloisterPedestalProps) {
  const halfW = width / 2;
  const innerWidth = width * 0.84;
  const tier1Width = width * 0.92;
  return (
    <div className={className} style={{ position: "relative", width, height, ...style }} aria-hidden="true">
      <svg
        width={width}
        height={height}
        viewBox={`-${halfW} 0 ${width} ${height}`}
        style={{ position: "absolute", inset: 0 }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="pedestal-stone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--hull-edge)" />
            <stop offset="1" stopColor="var(--hull-deep)" />
          </linearGradient>
          <linearGradient id="pedestal-rim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--gold-bright)" stopOpacity="0.86" />
            <stop offset="1" stopColor="var(--gold-deep)" stopOpacity="0.42" />
          </linearGradient>
          <radialGradient id="pedestal-glow" cx="0.5" cy="0.4">
            <stop offset="0" stopColor="var(--gold-bright)" stopOpacity="0.34" />
            <stop offset="1" stopColor="var(--gold-bright)" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Underglow */}
        <ellipse cx="0" cy={height * 0.7} rx={width * 0.6} ry={height * 0.55} fill="url(#pedestal-glow)" />
        {/* Lower tier (largest, octagonal) */}
        <polygon
          points={[
            -tier1Width / 2 + 14,
            height * 0.18,
            tier1Width / 2 - 14,
            height * 0.18,
            tier1Width / 2,
            height * 0.42,
            tier1Width / 2,
            height * 0.84,
            tier1Width / 2 - 14,
            height,
            -tier1Width / 2 + 14,
            height,
            -tier1Width / 2,
            height * 0.84,
            -tier1Width / 2,
            height * 0.42,
          ].join(" ")}
          fill="url(#pedestal-stone)"
          stroke="url(#pedestal-rim)"
          strokeWidth="1.2"
        />
        {/* Inscription line */}
        <line
          x1={-innerWidth / 2 + 14}
          y1={height * 0.5}
          x2={innerWidth / 2 - 14}
          y2={height * 0.5}
          stroke="var(--gold-warm)"
          strokeOpacity="0.42"
          strokeWidth="0.8"
        />
        {/* Top step */}
        <rect
          x={-innerWidth / 2 + 22}
          y={height * 0.04}
          width={innerWidth - 44}
          height={height * 0.18}
          fill="var(--hull-edge)"
          stroke="var(--gold-warm)"
          strokeOpacity="0.62"
          strokeWidth="1"
        />
      </svg>
      {glyph ? (
        <div
          style={{
            position: "absolute",
            top: "10%",
            left: "50%",
            transform: "translateX(-50%)",
            color: "var(--gold-bright)",
            opacity: 0.86,
            display: "grid",
            placeItems: "center",
          }}
        >
          {glyph}
        </div>
      ) : null}
    </div>
  );
}

interface HymnInscriptionProps {
  text?: string;
  variant?: "watermark" | "epitaph";
  className?: string;
  style?: CSSProperties;
}

export function HymnInscription({
  text = "Ieyui · Nobomeno · Renmiri · Yojuyogo",
  variant = "watermark",
  className,
  style,
}: HymnInscriptionProps) {
  const base: CSSProperties = {
    fontFamily: "var(--font-hymn)",
    color: "var(--hymn-soft)",
    pointerEvents: "none",
    userSelect: "none",
    whiteSpace: "nowrap",
    letterSpacing: variant === "watermark" ? "0.06em" : "0.08em",
    textShadow: "0 0 12px rgba(184, 158, 216, 0.18)",
  };
  const opacity = variant === "watermark" ? 0.06 : 0.32;
  const fontSize = variant === "watermark" ? "min(6vw, 64px)" : "20px";
  return (
    <div
      className={className}
      style={{ ...base, opacity, fontSize, ...style }}
      aria-hidden="true"
    >
      {text}
    </div>
  );
}

interface EngravedDividerProps {
  width?: string | number;
  className?: string;
  style?: CSSProperties;
}

export function EngravedDivider({ width = "100%", className, style }: EngravedDividerProps) {
  return (
    <div
      className={className}
      style={{
        position: "relative",
        width,
        height: 14,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
      aria-hidden="true"
    >
      <span
        style={{
          position: "absolute",
          left: 0,
          right: "calc(50% + 14px)",
          height: 1,
          background:
            "linear-gradient(90deg, transparent, rgba(168, 133, 74, 0.62) 30%, rgba(245, 218, 156, 0.78) 100%)",
        }}
      />
      <YevonSpiral size={14} color="var(--gold-warm)" strokeWidth={1.1} />
      <span
        style={{
          position: "absolute",
          left: "calc(50% + 14px)",
          right: 0,
          height: 1,
          background:
            "linear-gradient(270deg, transparent, rgba(168, 133, 74, 0.62) 30%, rgba(245, 218, 156, 0.78) 100%)",
        }}
      />
    </div>
  );
}

interface AirshipSilhouetteProps {
  className?: string;
  style?: CSSProperties;
  opacity?: number;
}

export function AirshipSilhouette({ className, style, opacity = 0.08 }: AirshipSilhouetteProps) {
  return (
    <svg
      className={className}
      style={{ pointerEvents: "none", opacity, ...style }}
      width="100%"
      height="100%"
      viewBox="0 0 1200 600"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="airship-hull" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--gold-warm)" stopOpacity="0.6" />
          <stop offset="1" stopColor="var(--gold-deep)" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      {/* Upper fins */}
      <path
        d="M280 200 Q360 140 520 130 Q820 120 940 170 Q990 192 1010 220 L1006 232 Q920 192 720 188 Q500 188 320 232 Z"
        fill="url(#airship-hull)"
        opacity="0.5"
      />
      {/* Hull body */}
      <path
        d="M180 320 Q220 230 420 226 L760 226 Q940 232 1040 290 Q1080 320 1080 348 Q1060 388 1010 412 Q900 446 720 452 L460 452 Q300 446 220 408 Q170 380 162 352 Z"
        fill="url(#airship-hull)"
      />
      {/* Lower keel */}
      <path
        d="M260 410 Q280 470 360 484 Q620 506 820 488 Q900 478 920 448 Q920 460 880 472 Q700 504 460 490 Q340 480 300 460 Z"
        fill="url(#airship-hull)"
        opacity="0.66"
      />
      {/* Engine glows */}
      <circle cx="930" cy="332" r="22" fill="var(--gold-bright)" opacity="0.56" />
      <circle cx="1012" cy="358" r="14" fill="var(--gold-bright)" opacity="0.4" />
      <circle cx="172" cy="346" r="14" fill="var(--gold-bright)" opacity="0.34" />
      {/* Bridge porthole */}
      <ellipse cx="306" cy="320" rx="42" ry="22" fill="var(--marble-ivory)" opacity="0.2" />
      <ellipse cx="306" cy="320" rx="42" ry="22" fill="none" stroke="var(--gold-warm)" strokeWidth="1.4" />
      {/* Inscription line */}
      <line x1="380" y1="332" x2="940" y2="332" stroke="var(--gold-warm)" strokeWidth="0.6" strokeOpacity="0.4" />
    </svg>
  );
}

export function RoomInteriorBridge({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path d="M14 84 L14 56 Q14 42 30 38 L70 38 Q86 42 86 56 L86 84 Z" fill="var(--hull-mid)" stroke="var(--gold-deep)" strokeWidth="1" />
      <path d="M22 56 Q50 30 78 56" fill="none" stroke="var(--gold-warm)" strokeWidth="1" />
      <circle cx="50" cy="60" r="9" fill="var(--gold-bright)" opacity="0.86" />
      <circle cx="50" cy="60" r="14" fill="none" stroke="var(--gold-warm)" strokeWidth="0.7" strokeOpacity="0.6" />
      <line x1="38" y1="84" x2="38" y2="68" stroke="var(--gold-deep)" strokeWidth="1" />
      <line x1="62" y1="84" x2="62" y2="68" stroke="var(--gold-deep)" strokeWidth="1" />
    </svg>
  );
}

export function RoomInteriorArmoury({ size = 64, count = 0 }: { size?: number; count?: number }) {
  const racks = Math.min(6, Math.max(0, count));
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="10" y="14" width="80" height="74" fill="var(--hull-mid)" stroke="var(--gold-deep)" strokeWidth="1" />
      <line x1="10" y1="84" x2="90" y2="84" stroke="var(--gold-warm)" strokeWidth="1" />
      {Array.from({ length: 6 }, (_, i) => {
        const x = 18 + i * 12;
        const lit = i < racks;
        return (
          <g key={`rack-${x}`}>
            <line x1={x} y1="20" x2={x} y2="80" stroke={lit ? "var(--gold-bright)" : "var(--gold-deep)"} strokeWidth="1.2" strokeOpacity={lit ? 0.92 : 0.4} />
            <circle cx={x} cy="20" r="2" fill={lit ? "var(--gold-bright)" : "var(--gold-deep)"} opacity={lit ? 0.96 : 0.4} />
          </g>
        );
      })}
    </svg>
  );
}

export function RoomInteriorCloister({ size = 64, agents = 0 }: { size?: number; agents?: number }) {
  const figs = Math.min(6, Math.max(0, agents));
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="38" fill="var(--hull-mid)" stroke="var(--gold-deep)" strokeWidth="1" />
      <circle cx="50" cy="50" r="14" fill="var(--gold-warm)" opacity="0.32" />
      <circle cx="50" cy="50" r="14" fill="none" stroke="var(--gold-warm)" strokeWidth="0.8" />
      {Array.from({ length: 6 }, (_, i) => {
        const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2;
        const x = 50 + Math.cos(angle) * 28;
        const y = 50 + Math.sin(angle) * 28;
        const lit = i < figs;
        return (
          <circle
            key={`bunk-${x.toFixed(2)}-${y.toFixed(2)}`}
            cx={x}
            cy={y}
            r="3"
            fill={lit ? "var(--gold-bright)" : "var(--gold-deep)"}
            opacity={lit ? 0.92 : 0.32}
          />
        );
      })}
    </svg>
  );
}

export function RoomInteriorOperations({ size = 64, stations = 1 }: { size?: number; stations?: number }) {
  const needles = Math.min(5, Math.max(1, stations));
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="58" r="34" fill="var(--hull-mid)" stroke="var(--gold-deep)" strokeWidth="1" />
      <path d="M16 58 A34 34 0 0 1 84 58" fill="none" stroke="var(--gold-warm)" strokeWidth="1" />
      {Array.from({ length: needles }, (_, i) => {
        const t = needles === 1 ? 0.5 : i / (needles - 1);
        const angle = Math.PI - t * Math.PI;
        const x = 50 + Math.cos(angle) * 26;
        const y = 58 - Math.sin(angle) * 26;
        return <line key={`needle-${t.toFixed(3)}`} x1="50" y1="58" x2={x} y2={y} stroke="var(--gold-bright)" strokeWidth="1.2" />;
      })}
      <circle cx="50" cy="58" r="3" fill="var(--gold-bright)" />
    </svg>
  );
}

export function RoomInteriorPilgrimage({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="22" y="18" width="60" height="68" rx="2" fill="var(--hull-mid)" stroke="var(--gold-deep)" strokeWidth="1" />
      <rect x="22" y="18" width="60" height="14" fill="var(--gold-warm)" opacity="0.34" />
      <rect x="22" y="18" width="60" height="14" fill="none" stroke="var(--gold-warm)" strokeWidth="0.8" />
      <line x1="30" y1="44" x2="74" y2="44" stroke="var(--gold-warm)" strokeWidth="0.8" strokeOpacity="0.7" />
      <line x1="30" y1="54" x2="74" y2="54" stroke="var(--gold-warm)" strokeWidth="0.8" strokeOpacity="0.5" />
      <line x1="30" y1="64" x2="62" y2="64" stroke="var(--gold-warm)" strokeWidth="0.8" strokeOpacity="0.4" />
      <circle cx="76" cy="22" r="3" fill="var(--gold-bright)" />
    </svg>
  );
}

export function RoomInteriorSphereGrid({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      {[
        [50, 22],
        [30, 38],
        [70, 38],
        [22, 58],
        [50, 56],
        [78, 58],
        [38, 78],
        [62, 78],
      ].map(([x, y], i) => (
        <circle key={`sgnode-${x}-${y}`} cx={x} cy={y} r="3" fill="var(--gold-warm)" opacity={0.5 + (i % 3) * 0.18} />
      ))}
      <line x1="50" y1="22" x2="30" y2="38" stroke="var(--gold-deep)" strokeWidth="0.6" strokeOpacity="0.7" />
      <line x1="50" y1="22" x2="70" y2="38" stroke="var(--gold-deep)" strokeWidth="0.6" strokeOpacity="0.7" />
      <line x1="30" y1="38" x2="22" y2="58" stroke="var(--gold-deep)" strokeWidth="0.6" strokeOpacity="0.7" />
      <line x1="30" y1="38" x2="50" y2="56" stroke="var(--gold-deep)" strokeWidth="0.6" strokeOpacity="0.7" />
      <line x1="70" y1="38" x2="78" y2="58" stroke="var(--gold-deep)" strokeWidth="0.6" strokeOpacity="0.7" />
      <line x1="70" y1="38" x2="50" y2="56" stroke="var(--gold-deep)" strokeWidth="0.6" strokeOpacity="0.7" />
      <line x1="50" y1="56" x2="38" y2="78" stroke="var(--gold-deep)" strokeWidth="0.6" strokeOpacity="0.7" />
      <line x1="50" y1="56" x2="62" y2="78" stroke="var(--gold-deep)" strokeWidth="0.6" strokeOpacity="0.7" />
      <line x1="22" y1="58" x2="38" y2="78" stroke="var(--gold-deep)" strokeWidth="0.6" strokeOpacity="0.7" />
      <line x1="78" y1="58" x2="62" y2="78" stroke="var(--gold-deep)" strokeWidth="0.6" strokeOpacity="0.7" />
    </svg>
  );
}
