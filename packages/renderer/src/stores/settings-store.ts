import {
  type TtsProvider,
  type UserSettings,
  type WakeWordProviderSetting,
  normalizeTtsProvider,
  normalizeWakeWordProvider,
} from "@spira/shared";
import { create } from "zustand";

export interface SettingsState extends UserSettings {}

interface SettingsStore extends SettingsState {
  toggleSpeech: () => void;
  setVoiceEnabled: (enabled: boolean) => void;
  toggleWakeWord: () => void;
  setWakeWordEnabled: (enabled: boolean) => void;
  setYouTrackEnabled: (enabled: boolean) => void;
  setTtsProvider: (provider: TtsProvider) => void;
  setWhisperModel: (model: SettingsState["whisperModel"]) => void;
  setWakeWordProvider: (provider: WakeWordProviderSetting) => void;
  setOpenWakeWordThreshold: (threshold: number) => void;
  setElevenLabsVoiceId: (voiceId: string) => void;
  applySettings: (settings: Partial<SettingsState>) => void;
}

const DEFAULT_SETTINGS: SettingsState = {
  voiceEnabled: true,
  wakeWordEnabled: true,
  youTrackEnabled: false,
  ttsProvider: "kokoro",
  whisperModel: "base.en",
  wakeWordProvider: "openwakeword",
  openWakeWordThreshold: 0.5,
  elevenLabsVoiceId: "",
  theme: "ffx",
};

const toPersistedSettings = (state: SettingsState): SettingsState => ({
  voiceEnabled: state.voiceEnabled,
  wakeWordEnabled: state.wakeWordEnabled,
  youTrackEnabled: state.youTrackEnabled,
  ttsProvider: state.ttsProvider,
  whisperModel: state.whisperModel,
  wakeWordProvider: state.wakeWordProvider,
  openWakeWordThreshold: state.openWakeWordThreshold,
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
  toggleSpeech: () => {
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
  toggleWakeWord: () => {
    const nextSettings = {
      ...toPersistedSettings(get()),
      wakeWordEnabled: !get().wakeWordEnabled,
    };
    set({ wakeWordEnabled: nextSettings.wakeWordEnabled });
    persistSettings(nextSettings);
  },
  setWakeWordEnabled: (enabled) => {
    const nextSettings = {
      ...toPersistedSettings(get()),
      wakeWordEnabled: enabled,
    };
    set({ wakeWordEnabled: enabled });
    persistSettings(nextSettings);
  },
  setYouTrackEnabled: (enabled) => {
    const nextSettings = {
      ...toPersistedSettings(get()),
      youTrackEnabled: enabled,
    };
    set({ youTrackEnabled: enabled });
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
  setWhisperModel: (whisperModel) => {
    const nextSettings = {
      ...toPersistedSettings(get()),
      whisperModel,
    };
    set({ whisperModel });
    persistSettings(nextSettings);
  },
  setWakeWordProvider: (wakeWordProvider) => {
    const nextSettings = {
      ...toPersistedSettings(get()),
      wakeWordProvider,
    };
    set({ wakeWordProvider });
    persistSettings(nextSettings);
  },
  setOpenWakeWordThreshold: (openWakeWordThreshold) => {
    const nextSettings = {
      ...toPersistedSettings(get()),
      openWakeWordThreshold,
    };
    set({ openWakeWordThreshold });
    persistSettings(nextSettings);
  },
  setElevenLabsVoiceId: (elevenLabsVoiceId) => {
    const nextSettings = {
      ...toPersistedSettings(get()),
      elevenLabsVoiceId,
    };
    set({ elevenLabsVoiceId });
    persistSettings(nextSettings);
  },
  applySettings: (settings) => {
    const normalizedSettings = {
      ...settings,
      ...(typeof settings.ttsProvider === "string" ? { ttsProvider: normalizeTtsProvider(settings.ttsProvider) } : {}),
      ...(typeof settings.wakeWordProvider === "string"
        ? { wakeWordProvider: normalizeWakeWordProvider(settings.wakeWordProvider) }
        : {}),
    };
    const nextSettings = {
      ...toPersistedSettings(get()),
      ...normalizedSettings,
    };
    set(nextSettings);
  },
}));

if (typeof window !== "undefined") {
  void window.electronAPI
    .getSettings()
    .then((settings) => {
      useSettingsStore.getState().applySettings(settings);
      window.electronAPI.updateSettings(settings);
    })
    .catch((error) => {
      console.error("[Spira:settings-load]", error);
    });
}
