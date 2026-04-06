import { useState } from "react";
import { useMcpStore } from "../stores/mcp-store.js";
import { useSettingsStore } from "../stores/settings-store.js";
import styles from "./SettingsPanel.module.css";

export function SettingsPanel() {
  const servers = useMcpStore((store) => store.servers);
  const voiceEnabled = useSettingsStore((store) => store.voiceEnabled);
  const ttsProvider = useSettingsStore((store) => store.ttsProvider);
  const toggleVoice = useSettingsStore((store) => store.toggleVoice);
  const setTtsProvider = useSettingsStore((store) => store.setTtsProvider);
  const [showSecrets, setShowSecrets] = useState(false);

  const handleVoiceToggle = () => {
    toggleVoice();
    window.electronAPI.toggleVoice();
  };

  const handleProviderChange = (provider: "elevenlabs" | "piper") => {
    setTtsProvider(provider);
    window.electronAPI.updateSettings({ ttsProvider: provider });
  };

  const maskedKey = showSecrets ? "Configured in backend environment" : "••••••••••••••••";

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Voice</h2>
            <p>Manage speech capture and synthesis.</p>
          </div>
        </div>
        <div className={styles.row}>
          <div>
            <span className={styles.label}>Voice pipeline</span>
            <span className={styles.caption}>Toggle microphone capture and wake flow.</span>
          </div>
          <button
            type="button"
            className={`${styles.toggle} ${voiceEnabled ? styles.toggleActive : ""}`}
            onClick={handleVoiceToggle}
          >
            {voiceEnabled ? "Enabled" : "Disabled"}
          </button>
        </div>
        <div className={styles.row}>
          <div>
            <label className={styles.label} htmlFor="tts-provider-select">
              TTS provider
            </label>
            <span className={styles.caption}>Switch between cloud and local playback.</span>
          </div>
          <select
            id="tts-provider-select"
            className={styles.select}
            value={ttsProvider}
            onChange={(event) => handleProviderChange(event.target.value as "elevenlabs" | "piper")}
          >
            <option value="elevenlabs">ElevenLabs</option>
            <option value="piper">Piper</option>
          </select>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>MCP Servers</h2>
            <p>Server status is shown here. Changing availability requires restarting the app.</p>
          </div>
        </div>
        <div className={styles.serverList}>
          {servers.length === 0 ? (
            <div className={styles.empty}>No servers reported by the backend yet.</div>
          ) : (
            servers.map((server) => (
              <label key={server.id} className={styles.row}>
                <div>
                  <span className={styles.label}>{server.name}</span>
                  <span className={styles.caption}>
                    {server.toolCount} tools · {server.state}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={server.state !== "disconnected"}
                  disabled
                  title="Server management requires restart"
                />
              </label>
            ))
          )}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>API Keys</h2>
            <p>Renderer-safe placeholders for backend-managed credentials.</p>
          </div>
          <button type="button" className={styles.ghostButton} onClick={() => setShowSecrets((value) => !value)}>
            {showSecrets ? "Hide" : "Show"}
          </button>
        </div>
        <div className={styles.keyGrid}>
          <div className={styles.keyRow}>
            <span>GitHub Copilot token</span>
            <code>{maskedKey}</code>
          </div>
          <div className={styles.keyRow}>
            <span>{ttsProvider === "elevenlabs" ? "ElevenLabs key" : "Piper model path"}</span>
            <code>{maskedKey}</code>
          </div>
        </div>
      </section>
    </div>
  );
}
