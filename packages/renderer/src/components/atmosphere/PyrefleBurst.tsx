import type { CSSProperties } from "react";
import { useId, useMemo } from "react";
import styles from "./PyrefleBurst.module.css";

interface PyrefleBurstProps {
  count?: number;
  /** Center of the burst as a CSS length (default: "50% 50%"). */
  targetX?: string;
  targetY?: string;
  /** Tint of each spark — defaults to gold. */
  tint?: string;
  /** Burst lifetime in seconds (per spark, before stagger). */
  duration?: number;
  /** Maximum offset from the target each spark starts at (in px). */
  spread?: number;
  /** Re-mount key to retrigger the animation (parent should bump on event). */
  triggerKey?: string | number;
  className?: string;
}

interface Spark {
  id: number;
  fromX: number;
  fromY: number;
  size: number;
  delay: number;
}

const seedSparks = (count: number, spread: number): Spark[] =>
  Array.from({ length: count }, (_, i) => {
    const angle = Math.random() * Math.PI * 2;
    const radius = spread * (0.6 + Math.random() * 0.6);
    return {
      id: i,
      fromX: Math.cos(angle) * radius,
      fromY: Math.sin(angle) * radius,
      size: 4 + Math.random() * 4,
      delay: Math.random() * 0.45,
    };
  });

export function PyrefleBurst({
  count = 12,
  targetX = "50%",
  targetY = "50%",
  tint = "rgba(245, 218, 156, 0.86)",
  duration = 1.2,
  spread = 220,
  triggerKey,
  className,
}: PyrefleBurstProps) {
  const reactId = useId();
  // biome-ignore lint/correctness/useExhaustiveDependencies: triggerKey intentionally invalidates the seed.
  const sparks = useMemo(() => seedSparks(count, spread), [count, spread, triggerKey]);

  return (
    <div className={`${styles.burst} ${className ?? ""}`} aria-hidden="true">
      {sparks.map((spark) => {
        const style = {
          "--burst-target-x": targetX,
          "--burst-target-y": targetY,
          "--spark-from-x": `${spark.fromX}px`,
          "--spark-from-y": `${spark.fromY}px`,
          "--spark-size": `${spark.size}px`,
          "--spark-delay": `${spark.delay}s`,
          "--spark-duration": `${duration}s`,
          "--spark-tint": tint,
        } as CSSProperties;
        return <span key={`${reactId}-${spark.id}`} className={styles.spark} style={style} />;
      })}
    </div>
  );
}
