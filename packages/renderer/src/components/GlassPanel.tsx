import type { ReactNode } from "react";
import styles from "./GlassPanel.module.css";

interface GlassPanelProps {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  padding?: "sm" | "md" | "lg";
  variant?: "default" | "quiet";
}

export function GlassPanel({
  children,
  className,
  glow = false,
  padding = "md",
  variant = "default",
}: GlassPanelProps) {
  const classes = [
    styles.panel,
    styles[padding],
    variant === "quiet" ? styles.quiet : "",
    glow && variant !== "quiet" ? styles.glow : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return <section className={classes}>{children}</section>;
}
