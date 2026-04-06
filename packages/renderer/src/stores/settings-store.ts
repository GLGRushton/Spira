import type { UserSettings } from "@spira/shared";
import { create } from "zustand";

export interface SettingsState extends UserSettings {}

interface SettingsStore extends SettingsState {
  toggleVoice: () => void;
  setVoiceEnabled: (enabled: boolean) => void;
  setTtsProvider: (provider: "elevenlabs" | "piper") => void;
  applySettings: (settings: Partial<SettingsState>) => void;
}

const DEFAULT_SETTINGS: SettingsState = {
  voiceEnabled: true,
  wakeWordEnabled: true,
  ttsProvider: "piper",
  whisperModel: "base.en",
  elevenLabsVoiceId: "",
  theme: "ffx",
};

const toPersistedSettings = (state: SettingsState): SettingsState => ({
  voiceEnabled: state.voiceEnabled,
  wakeWordEnabled: state.wakeWordEnabled,
  ttsProvider: state.ttsProvider,
  whisperModel: state.whisperModel,
  elevenLabsVoiceId: state.elevenLabsVoiceId,
  theme: state.theme,
});

const persistSettings = (settings: Partial<SettingsState>): void => {
  if (typeof window === "undefined") {
    return;
  }

  void window.electronAPI.setSettings(settings).catch((error) => {
    console.error("[Spira:settings-persist]", error);
  });
};

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...DEFAULT_SETTINGS,
  toggleVoice: () => {
    const nextSettings = {
      ...toPersistedSettings(get()),
      voiceEnabled: !get().voiceEnabled,
    };
    set({ voiceEnabled: nextSettings.voiceEnabled });
    persistSettings(nextSettings);
  },
  setVoiceEnabled: (enabled) => {
    const nextSettings = {
      ...toPersistedSettings(get()),
      voiceEnabled: enabled,
    };
    set({ voiceEnabled: enabled });
    persistSettings(nextSettings);
  },
  setTtsProvider: (provider) => {
    const nextSettings = {
      ...toPersistedSettings(get()),
      ttsProvider: provider,
    };
    set({ ttsProvider: provider });
    persistSettings(nextSettings);
  },
  applySettings: (settings) => {
    const nextSettings = {
      ...toPersistedSettings(get()),
      ...settings,
    };
    set(nextSettings);
    persistSettings(nextSettings);
  },
}));

if (typeof window !== "undefined") {
  void window.electronAPI
    .getSettings()
    .then((settings) => {
      if (Object.keys(settings).length === 0) {
        return;
      }

      useSettingsStore.getState().applySettings(settings);
    })
    .catch((error) => {
      console.error("[Spira:settings-load]", error);
    });
}
