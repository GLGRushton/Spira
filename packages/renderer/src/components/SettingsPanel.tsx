import {
  RUNTIME_CONFIG_KEYS,
  type RuntimeConfigEntrySummary,
  type RuntimeConfigKey,
  type RuntimeConfigSummary,
  type TtsProvider,
  WAKE_WORD_PROVIDERS,
  type WakeWordProviderSetting,
} from "@spira/shared";
import { useEffect, useState } from "react";
import { useMcpStore } from "../stores/mcp-store.js";
import { useSettingsStore } from "../stores/settings-store.js";
import styles from "./SettingsPanel.module.css";

const YOUTRACK_RUNTIME_CONFIG_KEYS: RuntimeConfigKey[] = ["youTrackBaseUrl", "youTrackToken"];
const YOUTRACK_RUNTIME_CONFIG_KEY_SET = new Set<RuntimeConfigKey>(YOUTRACK_RUNTIME_CONFIG_KEYS);
const MISSION_GIT_RUNTIME_CONFIG_KEYS: RuntimeConfigKey[] = ["missionGitHubToken"];
const MISSION_GIT_RUNTIME_CONFIG_KEY_SET = new Set<RuntimeConfigKey>(MISSION_GIT_RUNTIME_CONFIG_KEYS);
const OTHER_RUNTIME_CONFIG_KEYS = RUNTIME_CONFIG_KEYS.filter(
  (key) => !YOUTRACK_RUNTIME_CONFIG_KEY_SET.has(key) && !MISSION_GIT_RUNTIME_CONFIG_KEY_SET.has(key),
);

export function SettingsPanel() {
  const servers = useMcpStore((store) => store.servers);
  const speechEnabled = useSettingsStore((store) => store.voiceEnabled);
  const wakeWordEnabled = useSettingsStore((store) => store.wakeWordEnabled);
  const ttsProvider = useSettingsStore((store) => store.ttsProvider);
  const whisperModel = useSettingsStore((store) => store.whisperModel);
  const wakeWordProvider = useSettingsStore((store) => store.wakeWordProvider);
  const openWakeWordThreshold = useSettingsStore((store) => store.openWakeWordThreshold);
  const elevenLabsVoiceId = useSettingsStore((store) => store.elevenLabsVoiceId);
  const setVoiceEnabled = useSettingsStore((store) => store.setVoiceEnabled);
  const setWakeWordEnabled = useSettingsStore((store) => store.setWakeWordEnabled);
  const setTtsProvider = useSettingsStore((store) => store.setTtsProvider);
  const setWhisperModel = useSettingsStore((store) => store.setWhisperModel);
  const setWakeWordProvider = useSettingsStore((store) => store.setWakeWordProvider);
  const setOpenWakeWordThreshold = useSettingsStore((store) => store.setOpenWakeWordThreshold);
  const setElevenLabsVoiceId = useSettingsStore((store) => store.setElevenLabsVoiceId);
  const [elevenLabsVoiceIdDraft, setElevenLabsVoiceIdDraft] = useState(elevenLabsVoiceId);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigSummary | null>(null);
  const [runtimeConfigDrafts, setRuntimeConfigDrafts] = useState<Partial<Record<RuntimeConfigKey, string>>>({});
  const [runtimeConfigNotice, setRuntimeConfigNotice] = useState<string | null>(null);
  const [activeRuntimeConfigKey, setActiveRuntimeConfigKey] = useState<RuntimeConfigKey | null>(null);

  useEffect(() => {
    setElevenLabsVoiceIdDraft(elevenLabsVoiceId);
  }, [elevenLabsVoiceId]);

  useEffect(() => {
    void window.electronAPI.getRuntimeConfig().then((summary) => {
      setRuntimeConfig(summary);
    });
  }, []);

  const handleWakeWordToggle = () => {
    const nextEnabled = !wakeWordEnabled;
    setWakeWordEnabled(nextEnabled);
    window.electronAPI.updateSettings({ wakeWordEnabled: nextEnabled });
  };

  const handleSpeechToggle = () => {
    const nextEnabled = !speechEnabled;
    setVoiceEnabled(nextEnabled);
    window.electronAPI.updateSettings({ voiceEnabled: nextEnabled });
  };

  const handleProviderChange = (provider: TtsProvider) => {
    setTtsProvider(provider);
    window.electronAPI.updateSettings({ ttsProvider: provider });
  };

  const handleWhisperModelChange = (model: "tiny.en" | "base.en" | "small.en") => {
    setWhisperModel(model);
    window.electronAPI.updateSettings({ whisperModel: model });
  };

  const handleWakeWordProviderChange = (provider: WakeWordProviderSetting) => {
    setWakeWordProvider(provider);
    window.electronAPI.updateSettings({ wakeWordProvider: provider });
  };

  const handleThresholdChange = (threshold: number) => {
    const roundedThreshold = Number(threshold.toFixed(2));
    setOpenWakeWordThreshold(roundedThreshold);
    window.electronAPI.updateSettings({ openWakeWordThreshold: roundedThreshold });
  };

  const handleElevenLabsVoiceIdChange = (voiceId: string) => {
    setElevenLabsVoiceIdDraft(voiceId);
  };

  const commitElevenLabsVoiceId = () => {
    if (elevenLabsVoiceIdDraft === elevenLabsVoiceId) {
      return;
    }

    setElevenLabsVoiceId(elevenLabsVoiceIdDraft);
    window.electronAPI.updateSettings({ elevenLabsVoiceId: elevenLabsVoiceIdDraft });
  };

  const handleServerToggle = (serverId: string, enabled: boolean) => {
    window.electronAPI.setMcpServerEnabled(serverId, enabled);
  };

  const describeRuntimeConfigSource = (entry: RuntimeConfigEntrySummary): string => {
    switch (entry.source) {
      case "stored":
        return "Stored in Spira";
      case "environment":
        return "Inherited from environment";
      case "cleared":
        return "Cleared in Spira";
      case "unset":
        return "Not configured";
    }
  };

  const updateRuntimeConfig = async (key: RuntimeConfigKey, value: string | null) => {
    setActiveRuntimeConfigKey(key);
    setRuntimeConfigNotice(null);
    try {
      const result = await window.electronAPI.setRuntimeConfig({ [key]: value });
      setRuntimeConfig(result.summary);
      setRuntimeConfigDrafts((current) => ({ ...current, [key]: "" }));
      setRuntimeConfigNotice(
        result.appliedToBackend
          ? "Secure runtime settings saved. Shinra restarted the embedded backend to apply them."
          : "Secure runtime settings saved. The next backend restart will pick them up.",
      );
    } catch (error) {
      console.error("Failed to update secure runtime configuration", error);
      setRuntimeConfigNotice("Failed to update secure runtime configuration.");
    } finally {
      setActiveRuntimeConfigKey(null);
    }
  };

  const handleRuntimeConfigDraftChange = (key: RuntimeConfigKey, value: string) => {
    setRuntimeConfigNotice(null);
    setRuntimeConfigDrafts((current) => ({ ...current, [key]: value }));
  };

  const renderRuntimeConfigCards = (keys: RuntimeConfigKey[]) =>
    keys.map((key) => {
      if (!runtimeConfig) {
        return null;
      }

      const entry = runtimeConfig[key];
      const draft = runtimeConfigDrafts[entry.key] ?? "";
      const isBusy = activeRuntimeConfigKey === entry.key;
      return (
        <div key={entry.key} className={styles.secretCard}>
          <div className={styles.secretMeta}>
            <div>
              <span className={styles.label}>{entry.label}</span>
              <span className={styles.caption}>{entry.description}</span>
            </div>
            <span
              className={`${styles.statusBadge} ${entry.configured ? styles.statusConfigured : styles.statusUnset}`}
            >
              {describeRuntimeConfigSource(entry)}
            </span>
          </div>
          <div className={styles.secretControls}>
            <input
              className={styles.textInput}
              type="password"
              value={draft}
              autoComplete="off"
              spellCheck={false}
              placeholder={entry.configured ? "Enter a replacement value" : "Enter a value"}
              onChange={(event) => handleRuntimeConfigDraftChange(entry.key, event.target.value)}
            />
            <div className={styles.secretActions}>
              <button
                type="button"
                className={styles.ghostButton}
                disabled={isBusy || !draft.trim()}
                onClick={() => updateRuntimeConfig(entry.key, draft)}
              >
                Save
              </button>
              <button
                type="button"
                className={styles.dangerButton}
                disabled={isBusy || entry.source === "unset" || entry.source === "cleared"}
                onClick={() => updateRuntimeConfig(entry.key, null)}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      );
    });

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
            <span className={styles.label}>Wake listening</span>
            <span className={styles.caption}>Keep Shinra listening for the wake word.</span>
          </div>
          <button
            type="button"
            className={`${styles.toggle} ${wakeWordEnabled ? styles.toggleActive : ""}`}
            onClick={handleWakeWordToggle}
          >
            {wakeWordEnabled ? "Listening" : "Off"}
          </button>
        </div>
        <div className={styles.row}>
          <div>
            <span className={styles.label}>Spoken replies</span>
            <span className={styles.caption}>Let Shinra speak confirmations and responses aloud.</span>
          </div>
          <button
            type="button"
            className={`${styles.toggle} ${speechEnabled ? styles.toggleActive : ""}`}
            onClick={handleSpeechToggle}
          >
            {speechEnabled ? "Speaking" : "Silent"}
          </button>
        </div>
        <div className={styles.row}>
          <div>
            <label className={styles.label} htmlFor="tts-provider-select">
              TTS provider
            </label>
            <span className={styles.caption}>Switch between cloud and high-quality local playback.</span>
          </div>
          <select
            id="tts-provider-select"
            className={styles.select}
            value={ttsProvider}
            onChange={(event) => handleProviderChange(event.target.value as TtsProvider)}
          >
            <option value="elevenlabs">ElevenLabs</option>
            <option value="kokoro">Kokoro</option>
          </select>
        </div>
        <div className={styles.row}>
          <div>
            <label className={styles.label} htmlFor="whisper-model-select">
              Whisper model
            </label>
            <span className={styles.caption}>Choose speed vs. transcription quality for voice capture.</span>
          </div>
          <select
            id="whisper-model-select"
            className={styles.select}
            value={whisperModel}
            onChange={(event) => handleWhisperModelChange(event.target.value as "tiny.en" | "base.en" | "small.en")}
          >
            <option value="tiny.en">tiny.en</option>
            <option value="base.en">base.en</option>
            <option value="small.en">small.en</option>
          </select>
        </div>
        <div className={styles.row}>
          <div>
            <label className={styles.label} htmlFor="wake-word-provider-select">
              Wake-word provider
            </label>
            <span className={styles.caption}>Switch between openWakeWord, Porcupine, or push-to-talk only mode.</span>
          </div>
          <select
            id="wake-word-provider-select"
            className={styles.select}
            value={wakeWordProvider}
            onChange={(event) => handleWakeWordProviderChange(event.target.value as WakeWordProviderSetting)}
          >
            {WAKE_WORD_PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.row}>
          <div>
            <label className={styles.label} htmlFor="openwakeword-threshold">
              openWakeWord threshold
            </label>
            <span className={styles.caption}>Tune wake-word sensitivity when openWakeWord is active.</span>
          </div>
          <div className={styles.thresholdControl}>
            <input
              id="openwakeword-threshold"
              className={styles.rangeInput}
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={openWakeWordThreshold}
              disabled={wakeWordProvider !== "openwakeword"}
              onChange={(event) => handleThresholdChange(Number(event.target.value))}
            />
            <span className={styles.rangeValue}>{openWakeWordThreshold.toFixed(2)}</span>
          </div>
        </div>
        <div className={styles.row}>
          <div>
            <label className={styles.label} htmlFor="elevenlabs-voice-id">
              ElevenLabs voice ID
            </label>
            <span className={styles.caption}>Set the default voice to use when ElevenLabs is selected.</span>
          </div>
          <input
            id="elevenlabs-voice-id"
            className={styles.textInput}
            type="text"
            value={elevenLabsVoiceIdDraft}
            onChange={(event) => handleElevenLabsVoiceIdChange(event.target.value)}
            onBlur={commitElevenLabsVoiceId}
            placeholder="Voice ID"
          />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Armoury</h2>
            <p>Toggle local MCP servers on or off here. Changes take effect immediately.</p>
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
                  checked={server.enabled}
                  disabled={server.state === "starting"}
                  title={server.state === "starting" ? "Server update in progress" : undefined}
                  onChange={(event) => handleServerToggle(server.id, event.target.checked)}
                />
              </label>
            ))
          )}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Secure runtime config</h2>
            <p>
              Store backend-only secrets in the main process. Missions uses the YouTrack URL and token configured here.
            </p>
          </div>
        </div>
        {runtimeConfigNotice ? <div className={styles.notice}>{runtimeConfigNotice}</div> : null}
        {runtimeConfig ? (
          <div className={styles.configGroups}>
            <div className={styles.configGroup}>
              <div className={styles.groupHeader}>
                <span className={styles.label}>YouTrack credentials</span>
                <span className={styles.caption}>This is the only YouTrack setup that stays in Settings.</span>
              </div>
              <div className={styles.keyGrid}>{renderRuntimeConfigCards(YOUTRACK_RUNTIME_CONFIG_KEYS)}</div>
            </div>
            <div className={styles.configGroup}>
              <div className={styles.groupHeader}>
                <span className={styles.label}>Mission git credentials</span>
                <span className={styles.caption}>
                  This PAT is dedicated to mission commits, publish, push, and GitHub author lookup.
                </span>
              </div>
              <div className={styles.keyGrid}>{renderRuntimeConfigCards(MISSION_GIT_RUNTIME_CONFIG_KEYS)}</div>
            </div>
            <div className={styles.configGroup}>
              <div className={styles.groupHeader}>
                <span className={styles.label}>Other secure keys</span>
                <span className={styles.caption}>
                  Everything else here powers the rest of Spira&apos;s backend integrations.
                </span>
              </div>
              <div className={styles.keyGrid}>{renderRuntimeConfigCards(OTHER_RUNTIME_CONFIG_KEYS)}</div>
            </div>
          </div>
        ) : (
          <div className={styles.empty}>Loading secure runtime configuration…</div>
        )}
      </section>
    </div>
  );
}
