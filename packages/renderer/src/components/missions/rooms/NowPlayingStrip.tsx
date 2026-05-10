import type {
  TicketRunMissionEventSummary,
  TicketRunMissionPhase,
  TicketRunPhaseBudgetSnapshot,
} from "@spira/shared";
import { useEffect, useState } from "react";
import { useMissionRunsStore } from "../../../stores/mission-runs-store.js";
import styles from "./MissionDetailsRoom.module.css";

/**
 * Stable empty-array sentinel for the live-events selector. A fresh `[]` literal in the
 * selector returns a new reference on every call, which Zustand's default Object.is
 * comparator interprets as a state change → schedules a re-render → re-runs the selector
 * → another fresh `[]` → infinite loop. The sentinel keeps the reference stable when the
 * run has no live events yet.
 */
const EMPTY_LIVE_EVENTS: readonly TicketRunMissionEventSummary[] = [];

interface NowPlayingStripProps {
  runId: string;
  /** Phase 6.4 — optional per-phase budget envelope; renders a "typical X-Y" hint when present. */
  phaseBudget?: TicketRunPhaseBudgetSnapshot;
  /** Current mission phase used to look up the matching budget entry. */
  currentPhase?: TicketRunMissionPhase;
}

const formatBudgetWindow = (lowMs: number, highMs: number): string => {
  const formatMinutes = (ms: number) => {
    if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;
    return `${Math.round(ms / 60_000)} min`;
  };
  if (lowMs === highMs) return `typical ${formatMinutes(lowMs)}`;
  return `typical ${formatMinutes(lowMs)}–${formatMinutes(highMs)}`;
};

interface NowPlayingState {
  variant: "idle" | "active" | "awaiting";
  title: string;
  detail: string | null;
  pulsing: boolean;
  /** Reference timestamp used to render an "X ago" or "X elapsed" label. */
  referenceMs: number | null;
}

/** Truncate a long string with an ellipsis so the strip stays single-line. */
const truncate = (value: string, max = 80): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

const formatRelative = (deltaMs: number): string => {
  if (deltaMs < 1_000) {
    return "just now";
  }
  if (deltaMs < 60_000) {
    return `${Math.floor(deltaMs / 1_000)}s ago`;
  }
  if (deltaMs < 3_600_000) {
    return `${Math.floor(deltaMs / 60_000)}m ago`;
  }
  return `${Math.floor(deltaMs / 3_600_000)}h ago`;
};

const formatElapsed = (deltaMs: number): string => {
  if (deltaMs < 1_000) {
    return "starting";
  }
  if (deltaMs < 60_000) {
    return `${Math.floor(deltaMs / 1_000)}s elapsed`;
  }
  if (deltaMs < 3_600_000) {
    const minutes = Math.floor(deltaMs / 60_000);
    const seconds = Math.floor((deltaMs % 60_000) / 1_000);
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s elapsed`;
  }
  const hours = Math.floor(deltaMs / 3_600_000);
  const minutes = Math.floor((deltaMs % 3_600_000) / 60_000);
  return `${hours}h ${minutes.toString().padStart(2, "0")}m elapsed`;
};

const summariseMetadata = (event: TicketRunMissionEventSummary, key: string): string | null => {
  const value = event.metadata?.[key];
  return typeof value === "string" ? value : null;
};

const summariseEvent = (
  event: TicketRunMissionEventSummary | null,
  awaitingPermission: TicketRunMissionEventSummary | null,
): NowPlayingState => {
  if (awaitingPermission) {
    const label = summariseMetadata(awaitingPermission, "label") ?? "a tool";
    return {
      variant: "awaiting",
      title: "Awaiting approval",
      detail: `Pass paused on ${truncate(label)}`,
      pulsing: true,
      referenceMs: awaitingPermission.occurredAt,
    };
  }
  if (!event) {
    return {
      variant: "idle",
      title: "Standing by",
      detail: "No live activity reported yet for this run.",
      pulsing: false,
      referenceMs: null,
    };
  }
  switch (event.eventType) {
    case "attempt-shell-command": {
      const command = summariseMetadata(event, "command") ?? "shell command";
      const status = summariseMetadata(event, "status");
      return {
        variant: status === "running" ? "active" : "idle",
        title: status === "running" ? "Running" : status === "passed" ? "Last shell command passed" : "Last shell command failed",
        detail: truncate(command),
        pulsing: status === "running",
        referenceMs: event.occurredAt,
      };
    }
    case "attempt-action": {
      const action = summariseMetadata(event, "action") ?? "Tool";
      const target = summariseMetadata(event, "target");
      const status = summariseMetadata(event, "status");
      return {
        variant: "active",
        title: action,
        detail: target ? truncate(target) : status ? `Last call ${status}` : null,
        pulsing: false,
        referenceMs: event.occurredAt,
      };
    }
    case "attempt-permission-resolved": {
      const result = summariseMetadata(event, "result") ?? "resolved";
      return {
        variant: "active",
        title: `Permission ${result}`,
        detail: "Pass resumed.",
        pulsing: false,
        referenceMs: event.occurredAt,
      };
    }
    case "attempt-started":
      return {
        variant: "active",
        title: "Pass started",
        detail: typeof event.metadata?.sequence === "number" ? `Pass ${event.metadata.sequence}` : null,
        pulsing: true,
        referenceMs: event.occurredAt,
      };
    case "proof-started":
      return {
        variant: "active",
        title: "Running proof",
        detail: summariseMetadata(event, "profileLabel") ?? "Mission proof in flight.",
        pulsing: true,
        referenceMs: event.occurredAt,
      };
    case "proof-finished":
      return {
        variant: "idle",
        title: "Proof finished",
        detail: summariseMetadata(event, "status"),
        pulsing: false,
        referenceMs: event.occurredAt,
      };
    case "validation-recorded":
      return {
        variant: "idle",
        title: "Validation recorded",
        detail: `${summariseMetadata(event, "kind") ?? "Validation"} · ${summariseMetadata(event, "status") ?? ""}`.trim(),
        pulsing: false,
        referenceMs: event.occurredAt,
      };
    default:
      return {
        variant: "idle",
        title: event.eventType.replace(/-/g, " "),
        detail: null,
        pulsing: false,
        referenceMs: event.occurredAt,
      };
  }
};

const findOpenAwaitingPermission = (
  events: readonly TicketRunMissionEventSummary[],
): TicketRunMissionEventSummary | null => {
  // Walk newest-to-oldest; if we see a "resolved" before its matching "awaiting", the gate has cleared.
  const resolvedRequestIds = new Set<string>();
  for (const event of events) {
    if (event.eventType === "attempt-permission-resolved") {
      const requestId = typeof event.metadata?.requestId === "string" ? event.metadata.requestId : null;
      if (requestId) {
        resolvedRequestIds.add(requestId);
      }
    }
    if (event.eventType === "attempt-awaiting-permission") {
      const requestId = typeof event.metadata?.requestId === "string" ? event.metadata.requestId : null;
      if (requestId && !resolvedRequestIds.has(requestId)) {
        return event;
      }
    }
  }
  return null;
};

/**
 * Phase 1.2 — A single-row strip that surfaces what the agent is doing right now.
 * Drives off the live event buffer pushed via Phase 1.1; ticks once a second so the
 * "X elapsed" label stays current without re-rendering anything else.
 */
export function NowPlayingStrip({ runId, phaseBudget, currentPhase }: NowPlayingStripProps) {
  const liveEvents = useMissionRunsStore((store) => store.liveEventsByRun[runId] ?? EMPTY_LIVE_EVENTS);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);

  const awaiting = findOpenAwaitingPermission(liveEvents);
  // The latest non-permission event drives "what just happened"; permission gating overlays it.
  const latest = liveEvents.find(
    (event) => event.eventType !== "attempt-awaiting-permission" && event.eventType !== "attempt-permission-resolved",
  ) ?? null;
  const state = summariseEvent(latest, awaiting);

  const className = [
    styles.nowPlayingStrip,
    state.variant === "idle" ? styles.nowPlayingStripIdle : "",
    state.variant === "awaiting" ? styles.nowPlayingStripAwaiting : "",
  ]
    .filter(Boolean)
    .join(" ");

  const dotClassName = [styles.nowPlayingDot, state.pulsing ? styles.nowPlayingDotPulsing : ""].filter(Boolean).join(" ");

  let metaLabel: string | null = null;
  if (state.referenceMs !== null) {
    const delta = Math.max(0, nowMs - state.referenceMs);
    metaLabel = state.pulsing ? formatElapsed(delta) : formatRelative(delta);
  }

  // Phase 6.4 — append a typical-window hint when we have a budget for the current phase.
  const budgetEntry = currentPhase
    ? phaseBudget?.entries.find((entry) => entry.phase === currentPhase)
    : undefined;
  const budgetLabel = budgetEntry ? formatBudgetWindow(budgetEntry.lowMs, budgetEntry.highMs) : null;

  return (
    <div className={className} role="status" aria-live="polite">
      <span className={dotClassName} aria-hidden="true" />
      <div className={styles.nowPlayingCopy}>
        <span className={styles.nowPlayingTitle}>{state.title}</span>
        {state.detail ? <span className={styles.nowPlayingDetail}>{state.detail}</span> : null}
      </div>
      {metaLabel ? <span className={styles.nowPlayingMeta}>{metaLabel}</span> : null}
      {budgetLabel ? <span className={styles.nowPlayingMeta}>· {budgetLabel}</span> : null}
    </div>
  );
}
