import { useCallback, useEffect, useRef } from "react";
import { useAudioStore } from "../stores/audio-store.js";
import { useSettingsStore } from "../stores/settings-store.js";

const TTS_PLAYBACK_RATE = 0.85;

export function SpeechController() {
  const setTtsAmplitude = useAudioStore((store) => store.setTtsAmplitude);
  const speechEnabled = useSettingsStore((store) => store.voiceEnabled);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const amplitudeFrameRef = useRef<number | null>(null);
  const playbackGenerationRef = useRef(0);

  const disposeAudioResources = useCallback(
    (
      audio: HTMLAudioElement | null,
      objectUrl: string | null,
      sourceNode: MediaElementAudioSourceNode | null,
      analyserNode: AnalyserNode | null,
    ) => {
      sourceNode?.disconnect();
      analyserNode?.disconnect();

      if (audio) {
        audio.pause();
        audio.src = "";
      }

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    },
    [],
  );

  const stopPlayback = useCallback(() => {
    playbackGenerationRef.current += 1;

    if (amplitudeFrameRef.current !== null) {
      window.cancelAnimationFrame(amplitudeFrameRef.current);
      amplitudeFrameRef.current = null;
    }

    setTtsAmplitude(0);
    disposeAudioResources(audioElementRef.current, objectUrlRef.current, sourceNodeRef.current, analyserRef.current);
    sourceNodeRef.current = null;
    analyserRef.current = null;
    audioElementRef.current = null;
    objectUrlRef.current = null;
  }, [disposeAudioResources, setTtsAmplitude]);

  const startAmplitudeLoop = useCallback(
    (generation: number) => {
      const analyser = analyserRef.current;
      const audio = audioElementRef.current;
      if (!analyser || !audio) {
        setTtsAmplitude(0);
        return;
      }

      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (
          playbackGenerationRef.current !== generation ||
          !audioElementRef.current ||
          audioElementRef.current.paused ||
          audioElementRef.current.ended
        ) {
          setTtsAmplitude(0);
          amplitudeFrameRef.current = null;
          return;
        }

        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (const value of data) {
          const sample = (value - 128) / 128;
          sumSquares += sample * sample;
        }

        setTtsAmplitude(Math.min(1, Math.sqrt(sumSquares / data.length) * 1.5));
        amplitudeFrameRef.current = window.requestAnimationFrame(tick);
      };

      amplitudeFrameRef.current = window.requestAnimationFrame(tick);
    },
    [setTtsAmplitude],
  );

  const playAudio = useCallback(
    async (audioBase64: string, mimeType: "audio/wav") => {
      if (!speechEnabled) {
        return;
      }

      const generation = playbackGenerationRef.current + 1;
      playbackGenerationRef.current = generation;

      if (amplitudeFrameRef.current !== null) {
        window.cancelAnimationFrame(amplitudeFrameRef.current);
        amplitudeFrameRef.current = null;
      }

      setTtsAmplitude(0);
      disposeAudioResources(audioElementRef.current, objectUrlRef.current, sourceNodeRef.current, analyserRef.current);
      sourceNodeRef.current = null;
      analyserRef.current = null;
      audioElementRef.current = null;
      objectUrlRef.current = null;

      const binary = Uint8Array.from(window.atob(audioBase64), (character) => character.charCodeAt(0));
      const blob = new Blob([binary], { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      let sourceNode: MediaElementAudioSourceNode | null = null;
      let analyserNode: AnalyserNode | null = null;

      audio.preload = "auto";
      audio.playbackRate = TTS_PLAYBACK_RATE;

      const AudioContextCtor =
        typeof window.AudioContext !== "undefined"
          ? window.AudioContext
          : ((window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? undefined);

      if (AudioContextCtor) {
        const audioContext = audioContextRef.current ?? new AudioContextCtor();
        audioContextRef.current = audioContext;
        await audioContext.resume();

        if (playbackGenerationRef.current !== generation) {
          disposeAudioResources(audio, objectUrl, sourceNode, analyserNode);
          return;
        }

        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 2048;
        sourceNode = audioContext.createMediaElementSource(audio);
        sourceNode.connect(analyserNode);
        analyserNode.connect(audioContext.destination);
      }

      if (playbackGenerationRef.current !== generation) {
        disposeAudioResources(audio, objectUrl, sourceNode, analyserNode);
        return;
      }

      objectUrlRef.current = objectUrl;
      audioElementRef.current = audio;
      sourceNodeRef.current = sourceNode;
      analyserRef.current = analyserNode;

      audio.addEventListener(
        "ended",
        () => {
          if (playbackGenerationRef.current === generation) {
            stopPlayback();
          }
        },
        { once: true },
      );
      audio.addEventListener(
        "error",
        () => {
          console.error("[Spira:tts:renderer] Failed to play synthesized audio", {
            error: audio.error,
            currentSrc: audio.currentSrc,
          });
          if (playbackGenerationRef.current === generation) {
            stopPlayback();
          }
        },
        { once: true },
      );

      await audio.play();
      if (playbackGenerationRef.current !== generation) {
        disposeAudioResources(audio, objectUrl, sourceNode, analyserNode);
        return;
      }

      startAmplitudeLoop(generation);
    },
    [disposeAudioResources, setTtsAmplitude, speechEnabled, startAmplitudeLoop, stopPlayback],
  );

  useEffect(() => {
    return window.electronAPI.onMessage((message) => {
      if (message.type !== "tts:audio") {
        return;
      }

      void playAudio(message.audioBase64, message.mimeType).catch((error) => {
        console.error("[Spira:tts:renderer] Failed to initialize audio playback", error);
        stopPlayback();
      });
    });
  }, [playAudio, stopPlayback]);

  useEffect(() => {
    if (speechEnabled) {
      return;
    }

    stopPlayback();
    window.electronAPI.send({ type: "tts:stop" });
  }, [speechEnabled, stopPlayback]);

  useEffect(() => {
    return () => {
      stopPlayback();
      window.electronAPI.send({ type: "tts:stop" });
    };
  }, [stopPlayback]);

  return null;
}
