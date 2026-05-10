/**
 * Single duration formatter shared across the backend post-mortem generator and the
 * renderer's now-playing strip / aux deck / settings tabs.
 *
 * Each style preserves the exact rendering each call site used before consolidation:
 *  - "long":         post-mortem tables   "1 ms" / "1.0 s" / "12 min 34 s" / "1 h 5 min"
 *  - "minutes-only": validation runtime   "1 ms" / "1.0 s" / "12 min" / "12 min 34 s"  (rounded seconds)
 *  - "elapsed":      now-playing strip    "12s elapsed" / "1m 23s elapsed" / "1h 02m elapsed" / "starting"
 *  - "compact":      proof-run viewer     "12ms" / "1.2s" / "1m 23s"  (no spaces in seconds form)
 *  - "aux-deck":     in-flight tool dot   "12s" / "1m 23s"
 *
 * Rules of thumb:
 *  - Sub-millisecond durations are clamped to "<1 ms".
 *  - "long" + "minutes-only" + "compact" return "—" for non-finite input.
 *  - "elapsed" returns "starting" for sub-second deltas; the calling component drives the tick.
 */

export type DurationStyle = "long" | "minutes-only" | "elapsed" | "compact" | "aux-deck";

/**
 * ISO-style timestamp formatter that matches the post-mortem header format
 * (`YYYY-MM-DD HH:mm:ssZ`). Returns `—` for non-finite input. Used by both the backend
 * post-mortem generator and the renderer audit feed so the rendered timestamps match.
 */
export const formatIsoTimestamp = (ms: number | null | undefined): string => {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d{3}Z$/u, "Z");
};

export const formatDuration = (ms: number | null | undefined, style: DurationStyle): string => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) {
    if (style === "elapsed") return "starting";
    if (style === "aux-deck") return "0s";
    return "—";
  }
  const value = Math.max(0, ms);

  if (style === "long") {
    if (value < 1_000) return `${value} ms`;
    if (value < 60_000) return `${(value / 1_000).toFixed(1)} s`;
    if (value < 3_600_000) {
      const minutes = Math.floor(value / 60_000);
      const seconds = Math.floor((value % 60_000) / 1_000);
      return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
    }
    const hours = Math.floor(value / 3_600_000);
    const minutes = Math.floor((value % 3_600_000) / 60_000);
    return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
  }

  if (style === "minutes-only") {
    if (value < 1_000) return `${value} ms`;
    if (value < 60_000) return `${(value / 1_000).toFixed(1)} s`;
    const minutes = Math.floor(value / 60_000);
    const seconds = Math.round((value % 60_000) / 1_000);
    return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
  }

  if (style === "elapsed") {
    if (value < 1_000) return "starting";
    if (value < 60_000) return `${Math.floor(value / 1_000)}s elapsed`;
    if (value < 3_600_000) {
      const minutes = Math.floor(value / 60_000);
      const seconds = Math.floor((value % 60_000) / 1_000);
      return `${minutes}m ${seconds.toString().padStart(2, "0")}s elapsed`;
    }
    const hours = Math.floor(value / 3_600_000);
    const minutes = Math.floor((value % 3_600_000) / 60_000);
    return `${hours}h ${minutes.toString().padStart(2, "0")}m elapsed`;
  }

  if (style === "compact") {
    if (value < 1_000) return `${value}ms`;
    if (value < 60_000) return `${(value / 1_000).toFixed(1)}s`;
    const minutes = Math.floor(value / 60_000);
    const seconds = Math.round((value % 60_000) / 1_000);
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }

  // aux-deck: integer seconds; "<60" → "Ns", else "Nm Ms".
  const seconds = Math.floor(value / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
