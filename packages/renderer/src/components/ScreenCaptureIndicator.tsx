import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";
import { useStationStore } from "../stores/station-store.js";
import { useVisionStore } from "../stores/vision-store.js";
import styles from "./ScreenCaptureIndicator.module.css";

const getLabel = (toolName: string | null, args: unknown): string => {
  if (toolName === "vision_capture_active_window") {
    return "Capturing active window";
  }

  if (toolName === "vision_capture_screen") {
    const monitorIndex =
      args && typeof args === "object" && "monitorIndex" in args && typeof args.monitorIndex === "number"
        ? args.monitorIndex
        : 0;
    return `Capturing screen ${monitorIndex}`;
  }

  if (toolName === "vision_read_screen") {
    const target =
      args && typeof args === "object" && "target" in args && typeof args.target === "string" ? args.target : "screen";
    return target === "screen" ? "Reading screen text" : "Reading active window text";
  }

  if (toolName === "vision_ocr") {
    return "Reading captured text";
  }

  return "Inspecting screen";
};

export function ScreenCaptureIndicator() {
  const activeStationId = useStationStore((store) => store.activeStationId);
  const activeCapture = useVisionStore(
    (store) => store.activeCaptures.filter((capture) => capture.stationId === activeStationId).at(-1) ?? null,
  );
  const activeToolName = activeCapture?.toolName ?? null;
  const activeToolArgs = activeCapture?.args;
  const label = useMemo(() => getLabel(activeToolName, activeToolArgs), [activeToolArgs, activeToolName]);

  return (
    <AnimatePresence initial={false}>
      {activeToolName ? (
        <motion.div
          className={styles.banner}
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.18 }}
        >
          <motion.span
            className={styles.pulse}
            animate={{ scale: [1, 1.2, 1], opacity: [0.65, 1, 0.65] }}
            transition={{ duration: 1.1, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          />
          <div className={styles.copy}>
            <span className={styles.eyebrow}>Vision activity</span>
            <strong>{label}</strong>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
