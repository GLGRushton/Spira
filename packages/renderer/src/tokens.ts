export const tokens = {
  colors: {
    bg: { primary: "#0a0e27", secondary: "#111638", tertiary: "#1a2048" },
    accent: { teal: "#00d4aa", cyan: "#00e5ff", gold: "#cc9900", purple: "#7c3aed" },
    text: { primary: "#e8eaf6", secondary: "#8892b0", muted: "#4a5568" },
    border: { default: "#1e2d4a", glow: "#00d4aa33" },
    state: {
      idle: "#00d4aa",
      thinking: "#7c3aed",
      listening: "#00e5ff",
      transcribing: "#00e5ff",
      speaking: "#cc9900",
      error: "#ef4444",
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
    sm: 8,
    md: 12,
    lg: 18,
    pill: 999,
  },
  animation: {
    fast: 0.16,
    normal: 0.24,
    slow: 0.4,
    orbLerp: 0.12,
  },
  layout: {
    titleBarHeight: 32,
    sidebarWidth: 240,
    panelGap: 16,
  },
  shadow: {
    glow: "0 0 32px rgba(0, 212, 170, 0.18)",
    panel: "0 16px 48px rgba(5, 10, 30, 0.35)",
  },
} as const;

export type Tokens = typeof tokens;
