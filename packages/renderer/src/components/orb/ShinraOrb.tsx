import type { CSSProperties } from "react";
import { useMemo } from "react";
import { useAudioStore } from "../../stores/audio-store.js";
import { getStation, useStationStore } from "../../stores/station-store.js";
import styles from "./ShinraOrb.module.css";

const PYREFLY_COUNT = 24;

const congregationPresets = {
  idle: {
    pulseSeconds: 4.4,
    driftSeconds: 14,
    opacity: 0.54,
    spread: 1,
  },
  listening: {
    pulseSeconds: 1.7,
    driftSeconds: 9.5,
    opacity: 0.78,
    spread: 0.82,
  },
  transcribing: {
    pulseSeconds: 1.1,
    driftSeconds: 8,
    opacity: 0.74,
    spread: 0.9,
  },
  thinking: {
    pulseSeconds: 1.45,
    driftSeconds: 6.8,
    opacity: 0.82,
    spread: 0.72,
  },
  speaking: {
    pulseSeconds: 1.02,
    driftSeconds: 7.2,
    opacity: 0.9,
    spread: 1.08,
  },
  error: {
    pulseSeconds: 0.68,
    driftSeconds: 5.6,
    opacity: 0.62,
    spread: 1.28,
  },
} as const;

export function ShinraOrb() {
  const activeStationId = useStationStore((store) => store.activeStationId);
  const state = useStationStore((store) => getStation(store, activeStationId).state);
  const audioDrive = useAudioStore((store) => Math.max(store.audioLevel, store.ttsAmplitude));
  const preset = congregationPresets[state];

  const pyreflies = useMemo(
    () =>
      Array.from({ length: PYREFLY_COUNT }, (_, index) => {
        const angle = (Math.PI * 2 * index) / PYREFLY_COUNT;
        const ring = index % 4;
        const radius = (24 + ring * 14 + (index % 2 === 0 ? 5 : -3)) * preset.spread;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius * (0.72 + ring * 0.04);

        return {
          key: `pyrefly-${index}`,
          style: {
            "--mote-x": `${x.toFixed(2)}px`,
            "--mote-y": `${y.toFixed(2)}px`,
            "--mote-size": `${5 + (index % 5)}px`,
            "--mote-delay": `${(index % 9) * 0.23}s`,
            "--mote-duration": `${5.8 + ring * 1.1 + (index % 3) * 0.4}s`,
            "--mote-drift-x": `${(((index % 4) - 1.5) * 8).toFixed(1)}px`,
            "--mote-drift-y": `${((ring - 1.5) * -10).toFixed(1)}px`,
          } as CSSProperties,
        };
      }),
    [preset.spread],
  );

  const wrapperStyle = {
    "--pulse-duration": `${preset.pulseSeconds}s`,
    "--drift-duration": `${preset.driftSeconds}s`,
    "--audio-drive": audioDrive.toFixed(3),
    "--mote-opacity": preset.opacity.toFixed(2),
  } as CSSProperties;

  return (
    <div className={`${styles.wrapper} ${styles[state]}`} style={wrapperStyle} aria-hidden="true">
      <div className={styles.voidGlow} />
      <div className={styles.farplaneHalo} />
      <div className={styles.congregation}>
        <div className={styles.innerField} />
        <div className={styles.focusCore} />
        <div className={styles.memoryVeil} />
        <span className={styles.scanline} />
        <span className={`${styles.voiceWave} ${styles.voiceWavePrimary}`} />
        <span className={`${styles.voiceWave} ${styles.voiceWaveSecondary}`} />
        {pyreflies.map((pyrefly) => (
          <span key={pyrefly.key} className={styles.pyrefly} style={pyrefly.style} />
        ))}
      </div>
    </div>
  );
}
