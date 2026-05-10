import * as net from "node:net";
import path from "node:path";
import { pathExists } from "../../util/fs.js";
import { binaryAvailable } from "../../util/spawn.js";

/**
 * WorkSession preflight.
 *
 * Cheap parallel checks that should hold *before* the WorkSession kicks off its
 * `validate` phase. Designed to fail fast with concrete remediations instead of
 * letting the model burn cycles guessing why a validation hangs. Builtin checks:
 *  - `node_modules` present at the workspace root (tells us pnpm install hasn't run)
 *  - the dev port (default 9720) is free if the WorkSession plans to run a dev server
 *  - a node binary is on PATH (sanity)
 *
 * All checks run in parallel via `Promise.allSettled` with per-check timeouts. The
 * controller never throws — outcomes surface as a structured `WorkSessionPreflightResult`
 * the caller turns into either a "you're good" event or a stalled-reason on the snapshot.
 */

export interface WorkSessionPreflightBlocker {
  /** Stable id for telemetry / replay. */
  id: string;
  message: string;
  remediation: string;
}

export interface WorkSessionPreflightWarning {
  id: string;
  message: string;
}

export interface WorkSessionPreflightResult {
  ok: boolean;
  blockers: WorkSessionPreflightBlocker[];
  warnings: WorkSessionPreflightWarning[];
  elapsedMs: number;
  /** Brief reason summary (joined blocker messages) for the audit-trail event. */
  summary: string | null;
}

export interface WorkSessionPreflightHooks {
  binaryAvailable?: (binary: string) => Promise<boolean>;
  pathExists?: (target: string) => Promise<boolean>;
  /** Returns true if the port is in use, false if free, null if the probe was inconclusive (timeout). */
  portInUse?: (port: number) => Promise<boolean | null>;
  now?: () => number;
}

export interface WorkSessionPreflightInput {
  /** Repo root (workspaceRoot). Skipped silently when null. */
  workspaceRoot: string | null;
  /** Optional dev-server port the WorkSession will need free; null = skip the port check. */
  devServerPort?: number | null;
  hooks?: WorkSessionPreflightHooks;
}

const DEFAULT_CHECK_TIMEOUT_MS = 5_000;

const defaultBinaryAvailable = (binary: string): Promise<boolean> =>
  binaryAvailable(binary, { timeoutMs: DEFAULT_CHECK_TIMEOUT_MS });

const defaultPortInUse = (port: number): Promise<boolean | null> => {
  // Test bindability. If we can bind to localhost:port, it's free. Returns null when
  // the bind attempt times out — caller treats unknown as a warning rather than "free".
  return new Promise<boolean | null>((resolve) => {
    const server = net.createServer();
    const timer = setTimeout(() => {
      try { server.close(); } catch { /* already closed */ }
      resolve(null);
    }, DEFAULT_CHECK_TIMEOUT_MS);
    const emitter = server as unknown as NodeJS.EventEmitter;
    emitter.once("error", () => {
      clearTimeout(timer);
      resolve(true);
    });
    emitter.once("listening", () => {
      clearTimeout(timer);
      server.close(() => resolve(false));
    });
    server.listen(port, "127.0.0.1");
  });
};

export const runWorkSessionPreflight = async (
  input: WorkSessionPreflightInput,
): Promise<WorkSessionPreflightResult> => {
  const hooks = input.hooks ?? {};
  const now = hooks.now ?? Date.now;
  const binaryAvailable = hooks.binaryAvailable ?? defaultBinaryAvailable;
  const exists = hooks.pathExists ?? pathExists;
  const portInUse = hooks.portInUse ?? defaultPortInUse;
  const startedAt = now();

  const checks: Promise<{ blocker?: WorkSessionPreflightBlocker; warning?: WorkSessionPreflightWarning } | null>[] = [];

  // node binary on PATH
  checks.push(
    binaryAvailable("node")
      .then((ok) =>
        ok
          ? null
          : {
              blocker: {
                id: "binary-missing:node",
                message: "node was not found on PATH",
                remediation: "Install Node.js 22+ and ensure it's on PATH for this shell.",
              },
            },
      )
      .catch(() => null),
  );

  // node_modules present at the workspace root
  if (input.workspaceRoot) {
    const root = input.workspaceRoot;
    checks.push(
      exists(path.join(root, "node_modules"))
        .then((present) =>
          present
            ? null
            : {
                blocker: {
                  id: "deps-not-installed",
                  message: "node_modules is missing at the workspace root",
                  remediation: "Run `pnpm install` (or your project's restore command) before WorkSession validation.",
                },
              },
        )
        .catch(() => null),
    );
  }

  // optional port-in-use check; null result (timeout) surfaces as a warning, not a blocker.
  if (typeof input.devServerPort === "number") {
    const port = input.devServerPort;
    checks.push(
      portInUse(port)
        .then((busy) => {
          if (busy === null) {
            return {
              warning: {
                id: `port-probe-inconclusive:${port}`,
                message: `Could not determine whether localhost:${port} is free (probe timed out).`,
              },
            };
          }
          return busy
            ? {
                blocker: {
                  id: `port-in-use:${port}`,
                  message: `localhost:${port} is already in use`,
                  remediation: `Stop whatever is bound to :${port} or pick a different dev-server port before validating.`,
                },
              }
            : null;
        })
        .catch(() => null),
    );
  }

  const settled = await Promise.allSettled(checks);
  const blockers: WorkSessionPreflightBlocker[] = [];
  const warnings: WorkSessionPreflightWarning[] = [];
  for (const outcome of settled) {
    if (outcome.status !== "fulfilled" || !outcome.value) continue;
    if (outcome.value.blocker) blockers.push(outcome.value.blocker);
    if (outcome.value.warning) warnings.push(outcome.value.warning);
  }
  const elapsedMs = now() - startedAt;
  const ok = blockers.length === 0;
  return {
    ok,
    blockers,
    warnings,
    elapsedMs,
    summary: ok ? null : blockers.map((entry) => entry.message).join("; "),
  };
};
