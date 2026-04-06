import { motion } from "framer-motion";
import { useAssistantStore } from "../stores/assistant-store.js";
import { useAudioStore } from "../stores/audio-store.js";
import { useSettingsStore } from "../stores/settings-store.js";
import styles from "./VoiceIndicator.module.css";

export function VoiceIndicator() {
  const assistantState = useAssistantStore((store) => store.state);
  const audioLevel = useAudioStore((store) => store.audioLevel);
  const voiceEnabled = useSettingsStore((store) => store.voiceEnabled);
  const toggleVoice = useSettingsStore((store) => store.toggleVoice);
  const isListening = assistantState === "listening" || assistantState === "transcribing";

  const handleToggle = () => {
    toggleVoice();
    window.electronAPI.toggleVoice();
  };

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.label}>Voice Link</div>
          <div className={styles.state}>{voiceEnabled ? (isListening ? "Listening" : "Standby") : "Muted"}</div>
        </div>
        <button
          type="button"
          aria-label="Toggle voice input"
          aria-pressed={voiceEnabled}
          className={`${styles.toggle} ${voiceEnabled ? styles.active : ""}`}
          onClick={handleToggle}
        >
          {voiceEnabled ? "On" : "Off"}
        </button>
      </div>
      <div className={styles.meter}>
        <motion.div
          className={`${styles.fill} ${isListening ? styles.pulse : ""}`}
          animate={{ width: `${Math.max(8, audioLevel * 100)}%`, opacity: voiceEnabled ? 1 : 0.3 }}
          transition={{ type: "spring", damping: 18, stiffness: 160 }}
        />
      </div>
    </section>
  );
}
