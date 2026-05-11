import styles from "./Sparkline.module.css";

interface SparklineProps {
  values: readonly number[];
  width?: number;
  height?: number;
  maxValue?: number;
  tone?: "default" | "warm" | "muted";
  ariaLabel?: string;
}

export function Sparkline({
  values,
  width = 72,
  height = 22,
  maxValue,
  tone = "default",
  ariaLabel,
}: SparklineProps) {
  const toneClass =
    tone === "warm" ? styles.warm : tone === "muted" ? styles.muted : styles.default;

  if (values.length === 0) {
    return (
      <svg
        className={`${styles.sparkline} ${toneClass}`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel ?? "No samples yet"}
      >
        <line
          x1={0}
          y1={height - 1}
          x2={width}
          y2={height - 1}
          className={styles.baseline}
        />
      </svg>
    );
  }

  const peak = maxValue ?? Math.max(...values, 1);
  const effectivePeak = peak <= 0 ? 1 : peak;
  const stepX = values.length === 1 ? width : width / (values.length - 1);
  const points = values
    .map((value, index) => {
      const x = index * stepX;
      const clamped = Math.max(0, Math.min(effectivePeak, value));
      const y = height - 2 - (clamped / effectivePeak) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className={`${styles.sparkline} ${toneClass}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? `Sparkline of last ${values.length} samples, peak ${Math.round(peak)}`}
    >
      <line
        x1={0}
        y1={height - 1}
        x2={width}
        y2={height - 1}
        className={styles.baseline}
      />
      <polyline points={points} className={styles.line} />
    </svg>
  );
}
