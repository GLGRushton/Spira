import type { UserSettings } from "@spira/shared";
import { create } from "zustand";

interface SettingsStore {
  voiceEnabled: boolean;
  ttsProvider: "elevenlabs" | "piper";
  theme: "ffx";
  toggleVoice: () => void;
  setVoiceEnabled: (enabled: boolean) => void;
  setTtsProvider: (provider: "elevenlabs" | "piper") => void;
  applySettings: (settings: Partial<UserSettings>) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  voiceEnabled: true,
  ttsProvider: "piper",
  theme: "ffx",
  toggleVoice: () => {
    set((state) => ({ voiceEnabled: !state.voiceEnabled }));
  },
  setVoiceEnabled: (enabled) => {
    set({ voiceEnabled: enabled });
  },
  setTtsProvider: (provider) => {
    set({ ttsProvider: provider });
  },
  applySettings: (settings) => {
    set((state) => ({
      voiceEnabled: settings.voiceEnabled ?? state.voiceEnabled,
      ttsProvider: settings.ttsProvider ?? state.ttsProvider,
      theme: "ffx",
    }));
  },
}));
