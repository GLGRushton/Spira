import type { ReactNode } from "react";
import styles from "./GlassPanel.module.css";

interface GlassPanelProps {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  padding?: "sm" | "md" | "lg";
}

export function GlassPanel({ children, className, glow = false, padding = "md" }: GlassPanelProps) {
  const classes = [styles.panel, styles[padding], glow ? styles.glow : "", className ?? ""].filter(Boolean).join(" ");
  return <section className={classes}>{children}</section>;
}
