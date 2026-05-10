import type { SpiraMemoryDatabase } from "@spira/memory-db";
import type { Logger } from "pino";
import { setUnrefTimeout } from "../util/timers.js";

/**
 * Daily retention sweep for mission_events + work_session_events.
 *
 * Both tables grow indefinitely otherwise; long-running deployments accumulate every
 * tool-call, every shell-command, every phase transition. Default 90-day window matches
 * the conversation-events window (rough analogy, not enforced) so the operator only has
 * one knob to remember.
 *
 * Caller starts the scheduler at backend boot and stops it on shutdown. The first sweep
 * runs `runOnStart` ms after start (default 60s) to give the DB time to settle, then
 * every `intervalMs` (default 24h).
 */

export const DEFAULT_RETENTION_DAYS = 90;
export const DEFAULT_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_RETENTION_RUN_ON_START_MS = 60_000;

export interface EventsRetentionOptions {
  retentionDays?: number;
  intervalMs?: number;
  runOnStartMs?: number;
  now?: () => number;
}

export interface EventsRetentionHandle {
  stop: () => void;
  /** Run a sweep immediately (e.g. from an admin UI button). Returns deletion counts. */
  sweep: () => { missionEvents: number; workSessionEvents: number };
}

const sweep = (
  memoryDb: SpiraMemoryDatabase,
  retentionDays: number,
  now: () => number,
  logger: Logger,
): { missionEvents: number; workSessionEvents: number } => {
  const cutoffMs = now() - retentionDays * 24 * 60 * 60 * 1_000;
  let missionEvents = 0;
  let workSessionEvents = 0;
  try {
    missionEvents = memoryDb.deleteMissionEventsOlderThan(cutoffMs);
  } catch (error) {
    logger.warn({ err: error }, "Mission events retention sweep failed");
  }
  try {
    workSessionEvents = memoryDb.deleteWorkSessionEventsOlderThan(cutoffMs);
  } catch (error) {
    logger.warn({ err: error }, "WorkSession events retention sweep failed");
  }
  if (missionEvents > 0 || workSessionEvents > 0) {
    logger.info(
      { retentionDays, missionEvents, workSessionEvents },
      "Events retention sweep removed rows",
    );
  }
  return { missionEvents, workSessionEvents };
};

export const startEventsRetentionScheduler = (
  memoryDb: SpiraMemoryDatabase,
  logger: Logger,
  options: EventsRetentionOptions = {},
): EventsRetentionHandle => {
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const intervalMs = options.intervalMs ?? DEFAULT_RETENTION_INTERVAL_MS;
  const runOnStartMs = options.runOnStartMs ?? DEFAULT_RETENTION_RUN_ON_START_MS;
  const now = options.now ?? Date.now;

  const runSweep = (): { missionEvents: number; workSessionEvents: number } =>
    sweep(memoryDb, retentionDays, now, logger);

  const initialTimer = setUnrefTimeout(runSweep, runOnStartMs);
  const intervalTimer = setInterval(runSweep, intervalMs);
  intervalTimer.unref?.();

  return {
    stop: () => {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    },
    sweep: runSweep,
  };
};
