import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useShinraStatusContext } from "../../hooks/useShinraStatusContext.js";
import styles from "./PyrefleField.module.css";

const POPULATION = 14;
const REGEN_INTERVAL_MS = 2400;

interface Mote {
  id: number;
  x: number;
  y: number;
  driftX: number;
  driftY: number;
  size: number;
  duration: number;
  delay: number;
  born: number;
}

const presenceTints: Record<string, { tint: string; near: string; far: string }> = {
  idle: {
    tint: "rgba(245, 218, 156, 0.66)",
    near: "rgba(245, 218, 156, 0.4)",
    far: "rgba(245, 218, 156, 0.18)",
  },
  listening: {
    tint: "rgba(191, 240, 230, 0.78)",
    near: "rgba(146, 227, 218, 0.42)",
    far: "rgba(146, 227, 218, 0.18)",
  },
  transcribing: {
    tint: "rgba(191, 240, 230, 0.78)",
    near: "rgba(146, 227, 218, 0.42)",
    far: "rgba(146, 227, 218, 0.18)",
  },
  thinking: {
    tint: "rgba(212, 191, 240, 0.78)",
    near: "rgba(184, 158, 216, 0.4)",
    far: "rgba(184, 158, 216, 0.16)",
  },
  speaking: {
    tint: "rgba(245, 218, 156, 0.86)",
    near: "rgba(245, 218, 156, 0.5)",
    far: "rgba(245, 218, 156, 0.24)",
  },
  error: {
    tint: "rgba(168, 58, 58, 0.74)",
    near: "rgba(168, 58, 58, 0.34)",
    far: "rgba(94, 24, 24, 0.18)",
  },
};

const tintFor = (phase: string): { tint: string; near: string; far: string } =>
  presenceTints[phase] ?? presenceTints.idle;

const seedMote = (id: number): Mote => {
  const x = Math.random() * 100;
  const y = 70 + Math.random() * 30;
  const driftX = (Math.random() - 0.5) * 80;
  const driftY = -(70 + Math.random() * 90);
  const size = 3 + Math.random() * 4;
  const duration = 12 + Math.random() * 10;
  const delay = Math.random() * 1.4;
  return { id, x, y, driftX, driftY, size, duration, delay, born: Date.now() };
};

export function PyrefleField() {
  const { context } = useShinraStatusContext();
  const tint = useMemo(() => tintFor(context.phase), [context.phase]);
  const [motes, setMotes] = useState<Mote[]>(() =>
    Array.from({ length: POPULATION }, (_, i) => seedMote(i)),
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    let nextId = POPULATION;
    const intervalId = window.setInterval(() => {
      setMotes((current) => {
        const now = Date.now();
        const survivors = current.filter((mote) => now - mote.born < (mote.duration + mote.delay) * 1000);
        const need = POPULATION - survivors.length;
        const additions = Array.from({ length: need }, () => seedMote(nextId++));
        return [...survivors, ...additions];
      });
    }, REGEN_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <div className={styles.field} aria-hidden="true">
      {motes.map((mote) => {
        const style = {
          "--mote-x": `${mote.x}vw`,
          "--mote-y": `${mote.y}vh`,
          "--mote-drift-x": `${mote.driftX}px`,
          "--mote-drift-y": `${mote.driftY}px`,
          "--mote-size": `${mote.size}px`,
          "--mote-duration": `${mote.duration}s`,
          "--mote-delay": `${mote.delay}s`,
          "--mote-tint": tint.tint,
          "--mote-glow-near": tint.near,
          "--mote-glow-far": tint.far,
        } as CSSProperties;
        return <span key={mote.id} className={styles.pyrefly} style={style} />;
      })}
    </div>
  );
}
