// FFX X palette — The Cloister Above. Mirrors values in global.css for any
// component that consumes tokens through TS rather than CSS variables.
export const tokens = {
  colors: {
    hull: { deep: "#080d22", mid: "#121a3a", edge: "#1d2750", rim: "#2a3358" },
    gold: { bright: "#f5da9c", warm: "#e0c489", deep: "#a8854a", shadow: "#5e4720" },
    crystal: { mist: "#bff0e6", glow: "#92e3da", deep: "#3d7a76" },
    marble: { ivory: "#f1e6cc", warm: "#d8c8a3" },
    hymn: { soft: "#b89ed8", bright: "#d4bff0" },
    sin: { blood: "#a83a3a", deep: "#5e1818" },
    state: {
      idle: "#92e3da",
      thinking: "#b89ed8",
      listening: "#bff0e6",
      transcribing: "#bff0e6",
      speaking: "#f5da9c",
      error: "#a83a3a",
    },
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  radius: {
    tablet: 4,
    sm: 6,
    md: 10,
    lg: 14,
    glass: 16,
    pill: 999,
  },
  animation: {
    fast: 0.16,
    normal: 0.24,
    slow: 0.4,
    orbLerp: 0.12,
    swayDuration: 11,
    hymnPeriod: 7,
  },
  layout: {
    titleBarHeight: 38,
    sidebarWidth: 248,
    panelGap: 16,
  },
  shadow: {
    panel: "0 18px 48px rgba(4, 6, 18, 0.5)",
    glow: "0 0 36px rgba(245, 218, 156, 0.18)",
    aura: "0 0 44px rgba(245, 218, 156, 0.12)",
    pyrefly: "0 0 14px rgba(245, 218, 156, 0.5), 0 0 28px rgba(245, 218, 156, 0.22)",
    crystal: "0 0 28px rgba(146, 227, 218, 0.16)",
    pedestal: "0 18px 38px rgba(4, 6, 18, 0.62), 0 0 32px rgba(168, 133, 74, 0.24)",
  },
} as const;

export type Tokens = typeof tokens;
