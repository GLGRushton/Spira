import { spawn } from "node:child_process";

/**
 * Spawn a child process with a wall-clock timeout, capture a bounded stderr tail, and
 * resolve a structured outcome. Never throws — runtime errors (binary missing, EACCES,
 * etc.) surface as `{ exitCode: null, stderrTail: "<error message>" }`.
 *
 * The cast to NodeJS.EventEmitter is the standard workaround for the @types/node
 * ChildProcessByStdio variant not exposing `.on` directly under pnpm overlap.
 */

export interface SpawnWithTimeoutOptions {
  cwd?: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  /** Bytes to retain from stderr. Default 2 KB. */
  stderrTailBytes?: number;
  /**
   * If provided, stdout is piped (not ignored) and chunks are forwarded here. Lets callers
   * tee the output to a file or per-line consumer without re-implementing the spawn loop.
   */
  onStdout?: (chunk: Buffer) => void;
  /**
   * If provided, stderr chunks are forwarded here in addition to being captured for the
   * tail. Use to tee stderr to disk while still keeping a bounded in-memory copy.
   */
  onStderr?: (chunk: Buffer) => void;
  /**
   * If true, surface child-process spawn errors (e.g. ENOENT) by rejecting instead of
   * resolving with `{ exitCode: null, ... }`. Defaults to false (best-effort semantics).
   */
  rejectOnError?: boolean;
}

export interface SpawnWithTimeoutResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderrTail: string;
  timedOut: boolean;
}

const DEFAULT_STDERR_TAIL_BYTES = 2_048;

export const spawnWithTimeout = (
  command: string,
  args: readonly string[],
  options: SpawnWithTimeoutOptions,
): Promise<SpawnWithTimeoutResult> =>
  new Promise<SpawnWithTimeoutResult>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", options.onStdout ? "pipe" : "ignore", "pipe"],
      shell: false,
      windowsHide: true,
    });

    const tailBytes = options.stderrTailBytes ?? DEFAULT_STDERR_TAIL_BYTES;
    let stderrBuffer = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // already exited
      }
    }, options.timeoutMs);

    if (options.onStdout) {
      child.stdout?.on("data", (chunk: Buffer) => options.onStdout?.(chunk));
    }

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderrBuffer += text;
      if (stderrBuffer.length > tailBytes) {
        stderrBuffer = stderrBuffer.slice(stderrBuffer.length - tailBytes);
      }
      options.onStderr?.(chunk);
    });

    const finalize = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      clearTimeout(timer);
      resolve({ exitCode, signal, stderrTail: stderrBuffer.trim(), timedOut });
    };

    const emitter = child as unknown as NodeJS.EventEmitter;
    emitter.on("error", (error: NodeJS.ErrnoException) => {
      if (options.rejectOnError) {
        clearTimeout(timer);
        reject(error);
        return;
      }
      stderrBuffer = `${stderrBuffer}\n${error.message}`.trim();
      finalize(null, null);
    });
    emitter.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      finalize(code, signal);
    });
  });

/**
 * Probe whether a binary is available on PATH by running `<binary> --version`. Returns
 * false on any non-zero exit, missing-binary error, or timeout.
 */
export const binaryAvailable = async (
  binary: string,
  options: { timeoutMs?: number } = {},
): Promise<boolean> => {
  const result = await spawnWithTimeout(binary, ["--version"], {
    timeoutMs: options.timeoutMs ?? 5_000,
  });
  return result.exitCode === 0 && !result.timedOut;
};
