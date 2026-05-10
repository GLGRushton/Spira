import { type WorkSessionEventSummary, formatDuration } from "@spira/shared";
import { useEffect, useState } from "react";

interface WorkSessionNowPlayingStripProps {
  stationId: string;
  /** When false, the strip stays out of the DOM entirely. Operator-controlled in settings. */
  enabled?: boolean;
  /** Polling cadence in ms; default 5s. Polling kept conservative to keep IPC quiet. */
  pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;

const describeEvent = (event: WorkSessionEventSummary): { title: string; detail: string | null } => {
  switch (event.eventType) {
    case "worksession-started":
      return { title: "WorkSession started", detail: null };
    case "worksession-phase-entered":
      return { title: `Phase: ${event.phase}`, detail: "(entered)" };
    case "worksession-phase-completed":
      return { title: `Phase complete: ${event.phase}`, detail: null };
    case "worksession-validation-recorded": {
      const meta = event.metadata as { command?: string; success?: boolean } | null;
      return {
        title: meta?.success ? "Validation passed" : "Validation failed",
        detail: meta?.command ?? null,
      };
    }
    case "worksession-stalled":
      return { title: "Stalled", detail: (event.metadata as { reason?: string } | null)?.reason ?? null };
    case "worksession-preflight-started":
      return { title: "Preflight running", detail: null };
    case "worksession-preflight-finished": {
      const meta = event.metadata as { ok?: boolean; summary?: string | null } | null;
      return {
        title: meta?.ok ? "Preflight ok" : "Preflight blocked",
        detail: meta?.summary ?? null,
      };
    }
    case "worksession-closed":
      return { title: "WorkSession closed", detail: (event.metadata as { outcome?: string } | null)?.outcome ?? null };
    default:
      return { title: event.eventType.replace(/-/g, " "), detail: null };
  }
};

/**
 * Optional, off-by-default strip that surfaces the latest WorkSession event for a
 * station. Polls the backend at a slow cadence; the operator toggles the row in
 * settings (storage key kept here so the strip stays self-contained).
 */
export function WorkSessionNowPlayingStrip({ stationId, enabled = false, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS }: WorkSessionNowPlayingStripProps) {
  const [latest, setLatest] = useState<WorkSessionEventSummary | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) {
      setLatest(null);
      return;
    }
    let cancelled = false;
    const fetchLatest = async () => {
      try {
        const events = await window.electronAPI.listWorkSessionEventsByStation(stationId, 1);
        if (cancelled) return;
        setLatest(events[0] ?? null);
      } catch {
        if (!cancelled) setLatest(null);
      }
    };
    void fetchLatest();
    const interval = setInterval(() => void fetchLatest(), pollIntervalMs);
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearInterval(tick);
    };
  }, [enabled, stationId, pollIntervalMs]);

  if (!enabled || !latest) return null;
  const { title, detail } = describeEvent(latest);
  const elapsed = Math.max(0, now - latest.occurredAt);

  return (
    <div role="status" aria-live="polite" style={{ padding: "6px 12px", fontSize: 12, opacity: 0.85 }}>
      <strong>{title}</strong>
      {detail ? <span> · {detail}</span> : null}
      <span> · {formatDuration(elapsed, "elapsed")}</span>
    </div>
  );
}
