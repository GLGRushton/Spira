import type { ReactNode } from "react";
import { BevelleArch } from "./Glyphs.js";
import styles from "./Plate.module.css";

export type PlateVariant = "tablet" | "cartouche" | "glass" | "parchment" | "pedestal";
export type PlatePadding = "none" | "sm" | "md" | "lg";

interface PlateProps {
  variant?: PlateVariant;
  children: ReactNode;
  padding?: PlatePadding;
  className?: string;
  active?: boolean;
  title?: string;
  as?: "section" | "article" | "div" | "aside";
}

export function Plate({
  variant = "tablet",
  children,
  padding = "md",
  className,
  active = false,
  title,
  as = "section",
}: PlateProps) {
  const Tag = as as "section";
  const classes = [
    styles.plate,
    styles[variant],
    styles[`padding-${padding}`],
    active ? styles.active : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Tag className={classes}>
      {title ? (
        <div className={styles.title}>
          <BevelleArch className={styles.titleArch} width={220} />
          <span className={styles.titleText}>{title}</span>
        </div>
      ) : null}
      {children}
    </Tag>
  );
}
