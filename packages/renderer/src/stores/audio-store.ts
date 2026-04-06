import { create } from "zustand";

interface AudioStore {
  audioLevel: number;
  ttsAmplitude: number;
  setAudioLevel: (value: number) => void;
  setTtsAmplitude: (value: number) => void;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export const useAudioStore = create<AudioStore>((set) => ({
  audioLevel: 0,
  ttsAmplitude: 0,
  setAudioLevel: (value) => {
    set({ audioLevel: clamp(value) });
  },
  setTtsAmplitude: (value) => {
    set({ ttsAmplitude: clamp(value) });
  },
}));
