import { motion } from "framer-motion";
import { useAudioStore } from "../stores/audio-store.js";
import { useSettingsStore } from "../stores/settings-store.js";
import { getStation, useStationStore } from "../stores/station-store.js";
import styles from "./VoiceIndicator.module.css";

export function VoiceIndicator() {
  const activeStationId = useStationStore((store) => store.activeStationId);
  const assistantState = useStationStore((store) => getStation(store, activeStationId).state);
  const audioLevel = useAudioStore((store) => store.audioLevel);
  const wakeWordEnabled = useSettingsStore((store) => store.wakeWordEnabled);
  const setWakeWordEnabled = useSettingsStore((store) => store.setWakeWordEnabled);
  const isListening = assistantState === "listening" || assistantState === "transcribing";

  const handleToggle = () => {
    const nextEnabled = !wakeWordEnabled;
    setWakeWordEnabled(nextEnabled);
    window.electronAPI.updateSettings({ wakeWordEnabled: nextEnabled });
  };

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.label}>Wake Link</div>
          <div className={styles.state}>{wakeWordEnabled ? (isListening ? "Listening" : "Standby") : "Offline"}</div>
        </div>
        <button
          type="button"
          aria-label="Toggle voice input"
          aria-pressed={wakeWordEnabled}
          className={`${styles.toggle} ${wakeWordEnabled ? styles.active : ""}`}
          onClick={handleToggle}
        >
          {wakeWordEnabled ? "On" : "Off"}
        </button>
      </div>
      <div className={styles.meter}>
        <motion.div
          className={`${styles.fill} ${isListening ? styles.pulse : ""}`}
          animate={{ width: `${Math.max(8, audioLevel * 100)}%`, opacity: wakeWordEnabled ? 1 : 0.3 }}
          transition={{ type: "spring", damping: 18, stiffness: 160 }}
        />
      </div>
    </section>
  );
}
