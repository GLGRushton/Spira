import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SpiraMemoryDatabase } from "@spira/memory-db";
import type { Logger } from "pino";
import { setUnrefTimeout } from "../util/timers.js";
import { generateWeeklyDigest } from "./weekly-digest-generator.js";

/**
 * Weekly mission digest scheduler.
 *
 * Pure generator + writer wrapper around `generateWeeklyDigest`. Runs once per `intervalMs`
 * (default 7 days), pulling the closed runs in the trailing window and writing the digest
 * to `<workspaceRoot>/reports/weekly-mission-digest-<date>.md`. Operator can also trigger
 * a digest on-demand via `runNow()` from an admin button without changing the schedule.
 *
 * Last-run timestamp lives in-memory; on backend restart the scheduler aligns to its
 * configured interval rather than reconstructing missed runs (intentional — a missed
 * digest can be regenerated on demand if anyone notices).
 */

export const DEFAULT_DIGEST_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;
export const DEFAULT_DIGEST_RUN_ON_START_MS = 5 * 60_000; // 5 min after boot

export interface WeeklyDigestSchedulerOptions {
  intervalMs?: number;
  runOnStartMs?: number;
  windowMs?: number;
  now?: () => number;
}

export interface WeeklyDigestSchedulerHandle {
  stop: () => void;
  /** Generate + write a digest immediately. Returns the path on success or null on skip. */
  runNow: () => Promise<string | null>;
}

const writeDigest = async (
  memoryDb: SpiraMemoryDatabase,
  windowMs: number,
  now: () => number,
  logger: Logger,
): Promise<string | null> => {
  const workspaceRoot = memoryDb.getProjectWorkspaceRoot();
  if (!workspaceRoot) {
    logger.debug("Skipping weekly digest: no workspace root configured");
    return null;
  }
  const generatedAt = now();
  const windowEndMs = generatedAt;
  const windowStartMs = windowEndMs - windowMs;
  const runs = memoryDb
    .listTicketRuns()
    .filter((run) => run.status === "done" && run.updatedAt >= windowStartMs && run.updatedAt <= windowEndMs);
  if (runs.length === 0) {
    logger.debug({ windowStartMs, windowEndMs }, "Skipping weekly digest: no closed runs in window");
    return null;
  }
  const events = memoryDb.listMissionEventsForRunWindow({
    runStatus: "done",
    windowStartMs,
    windowEndMs,
    perRunLimit: 500,
  });
  const pendingCandidates = memoryDb.listRepoIntelligence({
    includeUnapproved: true,
    source: "learned",
    limit: 500,
  });
  const { filename, markdown } = generateWeeklyDigest({
    runs,
    events,
    pendingCandidates,
    windowStartMs,
    windowEndMs,
    generatedAt,
  });
  const reportsDir = path.join(workspaceRoot, "reports");
  const targetPath = path.join(reportsDir, filename);
  try {
    await mkdir(reportsDir, { recursive: true });
    // Use { flag: "w" } so re-running on the same day overwrites — digests are deterministic
    // for their window so collisions are not interesting to preserve.
    await writeFile(targetPath, markdown, { encoding: "utf8" });
    logger.info({ targetPath, runCount: runs.length }, "Wrote weekly mission digest");
    return targetPath;
  } catch (error) {
    logger.warn({ err: error, targetPath }, "Failed to write weekly mission digest");
    return null;
  }
};

export const startWeeklyDigestScheduler = (
  memoryDb: SpiraMemoryDatabase,
  logger: Logger,
  options: WeeklyDigestSchedulerOptions = {},
): WeeklyDigestSchedulerHandle => {
  const intervalMs = options.intervalMs ?? DEFAULT_DIGEST_INTERVAL_MS;
  const runOnStartMs = options.runOnStartMs ?? DEFAULT_DIGEST_RUN_ON_START_MS;
  const windowMs = options.windowMs ?? DEFAULT_DIGEST_INTERVAL_MS;
  const now = options.now ?? Date.now;

  const runNow = (): Promise<string | null> => writeDigest(memoryDb, windowMs, now, logger);

  const initialTimer = setUnrefTimeout(() => {
    void runNow();
  }, runOnStartMs);
  const intervalTimer = setInterval(() => {
    void runNow();
  }, intervalMs);
  intervalTimer.unref?.();

  return {
    stop: () => {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    },
    runNow,
  };
};
