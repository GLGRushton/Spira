import type { ReactNode } from "react";
import { Plate, type PlatePadding } from "./decor/Plate.js";

interface GlassPanelProps {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  padding?: PlatePadding;
  variant?: "default" | "quiet";
}

export function GlassPanel({
  children,
  className,
  glow = false,
  padding = "md",
  variant = "default",
}: GlassPanelProps) {
  return (
    <Plate
      variant={variant === "quiet" ? "tablet" : "glass"}
      padding={padding}
      active={glow && variant !== "quiet"}
      className={className}
    >
      {children}
    </Plate>
  );
}
