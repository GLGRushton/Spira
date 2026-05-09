import { spawn } from "node:child_process";
import path from "node:path";
import type { ValidationProfileRecord } from "@spira/memory-db";
import type { TicketRunSummary } from "@spira/shared";
import type { Logger } from "pino";

/**
 * Phase 4.1 — best-effort dependency warming after worktree setup.
 *
 * Runs registered `restore`-kind validation profiles for the impacted repos in the
 * background while classification/planning are in flight. The first validation pass
 * after warming finishes pays no cold cost; if warming itself fails, the mission
 * proceeds and the operator pays the original cold cost on demand (today's behaviour).
 *
 * Invariants:
 *  - Only profiles with kind === "restore" are run. Other kinds are operator-initiated.
 *  - One warming task per worktree (the highest-confidence restore profile wins).
 *  - Best-effort: no exception thrown for missing binaries / non-zero exit / timeouts.
 *  - Per-worktree wall-clock cap of {@link DEFAULT_WARMING_TIMEOUT_MS}; spawned children
 *    are killed on timeout to avoid orphans.
 */

const DEFAULT_WARMING_TIMEOUT_MS = 10 * 60_000;

export type DependencyWarmingStatus = "ok" | "skipped" | "failed";

export interface DependencyWarmingResult {
  repoRelativePath: string;
  profileId: string;
  profileLabel: string;
  command: string;
  workingDirectory: string;
  status: DependencyWarmingStatus;
  durationMs: number;
  exitCode: number | null;
  error: string | null;
}

export interface WarmRunDependenciesInput {
  run: TicketRunSummary;
  validationProfiles: readonly ValidationProfileRecord[];
  logger: Logger;
  now?: () => number;
  timeoutMs?: number;
  /** Test seam: spawn a child with the given command + args + cwd. Defaults to node:child_process. */
  spawnCommand?: SpawnCommand;
  /**
   * Optional callback fired *before* a warming task starts (so the caller can record an
   * `workspace-dependencies-warming-started` mission event). Sync; do not await.
   */
  onTaskStarted?: (task: DependencyWarmingTask) => void;
  /**
   * Optional callback fired *after* a warming task settles (so the caller can record an
   * `workspace-dependencies-warming-finished` mission event and surface lastObservedRuntimeMs).
   */
  onTaskFinished?: (result: DependencyWarmingResult) => void;
}

export interface DependencyWarmingTask {
  repoRelativePath: string;
  profileId: string;
  profileLabel: string;
  command: string;
  workingDirectory: string;
}

export interface SpawnCommandOptions {
  cwd: string;
  timeoutMs: number;
}

export interface SpawnCommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** Captured stderr for the failed-task reason; capped at ~2 KB so it stays loggable. */
  stderrTail: string;
  timedOut: boolean;
}

export type SpawnCommand = (
  command: string,
  args: readonly string[],
  options: SpawnCommandOptions,
) => Promise<SpawnCommandResult>;

const STDERR_TAIL_BYTES = 2_048;

const defaultSpawnCommand: SpawnCommand = (command, args, options) =>
  new Promise<SpawnCommandResult>((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
      windowsHide: true,
    });

    let stderrBuffer = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Already exited.
      }
    }, options.timeoutMs);

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrBuffer += chunk;
      if (stderrBuffer.length > STDERR_TAIL_BYTES) {
        stderrBuffer = stderrBuffer.slice(stderrBuffer.length - STDERR_TAIL_BYTES);
      }
    });

    const finalize = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      clearTimeout(timer);
      resolve({ exitCode, signal, stderrTail: stderrBuffer.trim(), timedOut });
    };

    // Cast follows the proof-runner.ts pattern: child_process types don't expose `.on`
    // on the narrowed ChildProcessByStdio variant, but the runtime always does.
    const emitter = child as unknown as NodeJS.EventEmitter;
    emitter.on("error", (error: NodeJS.ErrnoException) => {
      stderrBuffer = `${stderrBuffer}\n${error.message}`.trim();
      finalize(null, null);
    });
    emitter.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      finalize(code, signal);
    });
  });

const tokenizeCommand = (command: string): { binary: string; args: string[] } | null => {
  const trimmed = command.trim();
  if (!trimmed) return null;
  // Naïve whitespace split — restore commands are simple `pnpm install`-shaped invocations.
  // If a registered profile uses shell features (env vars, redirects, &&) we skip warming
  // for it; the operator can still run it manually.
  const parts = trimmed.split(/\s+/);
  const binary = parts[0];
  if (!binary) return null;
  if (/[<>|&;`$()]/.test(trimmed)) return null;
  return { binary, args: parts.slice(1) };
};

const pickRestoreProfileForWorktree = (
  worktreeRelativePath: string,
  validationProfiles: readonly ValidationProfileRecord[],
): ValidationProfileRecord | null => {
  const candidates = validationProfiles.filter((profile) => {
    if (profile.kind !== "restore") return false;
    if (profile.repoRelativePath === null) return true;
    return profile.repoRelativePath === worktreeRelativePath;
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((best, candidate) => {
    if (best.repoRelativePath === null && candidate.repoRelativePath !== null) return candidate;
    if (best.repoRelativePath !== null && candidate.repoRelativePath === null) return best;
    if (candidate.confidence > best.confidence) return candidate;
    if (candidate.confidence === best.confidence && candidate.updatedAt > best.updatedAt) return candidate;
    return best;
  });
};

/**
 * Warm dependencies for every worktree that has a registered `restore` profile. Returns
 * one result per attempted task. Exceptions are caught and surfaced as `status: "failed"`
 * results — this function never throws.
 */
export const warmRunDependencies = async (input: WarmRunDependenciesInput): Promise<DependencyWarmingResult[]> => {
  const spawnFn = input.spawnCommand ?? defaultSpawnCommand;
  const now = input.now ?? Date.now;
  const timeoutMs = input.timeoutMs ?? DEFAULT_WARMING_TIMEOUT_MS;

  const tasks = input.run.worktrees
    .map((worktree) => {
      const profile = pickRestoreProfileForWorktree(worktree.repoRelativePath, input.validationProfiles);
      if (!profile) return null;
      const tokens = tokenizeCommand(profile.command);
      if (!tokens) {
        input.logger.debug(
          { runId: input.run.runId, profileId: profile.id, command: profile.command },
          "Skipping dependency warming for unsupported (shell-style) command",
        );
        return null;
      }
      const workingDirectory = path.isAbsolute(profile.workingDirectory)
        ? profile.workingDirectory
        : path.join(worktree.worktreePath, profile.workingDirectory);
      return {
        worktreeRelativePath: worktree.repoRelativePath,
        profile,
        binary: tokens.binary,
        args: tokens.args,
        workingDirectory,
      };
    })
    .filter((task): task is NonNullable<typeof task> => task !== null);

  if (tasks.length === 0) return [];

  const results = await Promise.all(
    tasks.map(async (task): Promise<DependencyWarmingResult> => {
      const startedAt = now();
      const taskInfo: DependencyWarmingTask = {
        repoRelativePath: task.worktreeRelativePath,
        profileId: task.profile.id,
        profileLabel: task.profile.label,
        command: task.profile.command,
        workingDirectory: task.workingDirectory,
      };
      try {
        input.onTaskStarted?.(taskInfo);
      } catch (error) {
        input.logger.warn(
          { err: error, runId: input.run.runId, profileId: task.profile.id },
          "Dependency warming onTaskStarted hook threw",
        );
      }

      let outcome: SpawnCommandResult;
      try {
        outcome = await spawnFn(task.binary, task.args, {
          cwd: task.workingDirectory,
          timeoutMs,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failed: DependencyWarmingResult = {
          repoRelativePath: task.worktreeRelativePath,
          profileId: task.profile.id,
          profileLabel: task.profile.label,
          command: task.profile.command,
          workingDirectory: task.workingDirectory,
          status: "failed",
          durationMs: now() - startedAt,
          exitCode: null,
          error: message,
        };
        try {
          input.onTaskFinished?.(failed);
        } catch (hookError) {
          input.logger.warn(
            { err: hookError, runId: input.run.runId, profileId: task.profile.id },
            "Dependency warming onTaskFinished hook threw",
          );
        }
        return failed;
      }

      const durationMs = now() - startedAt;
      const status: DependencyWarmingStatus =
        outcome.timedOut || outcome.exitCode === null || outcome.exitCode !== 0 ? "failed" : "ok";
      const error =
        status === "failed"
          ? outcome.timedOut
            ? `Warming timed out after ${Math.round(timeoutMs / 1000)}s`
            : (outcome.stderrTail || `exited with code ${outcome.exitCode ?? "unknown"}`)
          : null;
      const result: DependencyWarmingResult = {
        repoRelativePath: task.worktreeRelativePath,
        profileId: task.profile.id,
        profileLabel: task.profile.label,
        command: task.profile.command,
        workingDirectory: task.workingDirectory,
        status,
        durationMs,
        exitCode: outcome.exitCode,
        error,
      };
      try {
        input.onTaskFinished?.(result);
      } catch (hookError) {
        input.logger.warn(
          { err: hookError, runId: input.run.runId, profileId: task.profile.id },
          "Dependency warming onTaskFinished hook threw",
        );
      }
      return result;
    }),
  );

  return results;
};
