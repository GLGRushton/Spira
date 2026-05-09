import { spawn } from "node:child_process";
import { statfs } from "node:fs/promises";
import path from "node:path";
import { pathExists as pathExistsUtil } from "../util/fs.js";
import type { ResolvedMissionProofProfile } from "./proof-registry.js";

/**
 * Phase 2.2 — Proof preflight controller.
 *
 * Runs cheap, parallel readiness checks against a resolved proof profile *before* the
 * harness spawns. Failures surface as typed blockers with suggested remediations so the
 * operator can fix them without burning the proof's own (often 20+ minute) timeout.
 *
 * The controller is a pure function from "profile + clock" → "result"; no DB writes, no
 * bus emits. Callers in {@link runProof} persist the result into mission_events and the
 * per-run proof status.
 */

/**
 * Default per-check timeout. Checks run in parallel via Promise.allSettled, so the per-check
 * timeout *is* the wall-clock budget for the whole preflight pass — no separate budget timer
 * needed (an outer race would orphan in-flight child processes when it fired).
 */
const DEFAULT_CHECK_TIMEOUT_MS = 5_000;

/** Minimum free space we want before launching a proof (artifacts are typically 50-500 MB). */
const DEFAULT_MIN_FREE_DISK_BYTES = 1_024 * 1_024 * 1_024; // 1 GB

export type ProofPreflightSeverity = "blocker" | "warning";

export interface ProofPreflightFinding {
  /** Stable id so the renderer can de-dup repeat findings across reruns. */
  id: string;
  severity: ProofPreflightSeverity;
  /** Human-readable headline, e.g. "dotnet not found on PATH". */
  message: string;
  /** Optional remediation hint, e.g. "Install the .NET 8 SDK from https://dot.net/download." */
  remediation?: string;
}

export interface ProofPreflightResult {
  ok: boolean;
  blockers: ProofPreflightFinding[];
  warnings: ProofPreflightFinding[];
  elapsedMs: number;
  /** A short flat summary suitable for mission_events metadata.summary. */
  summary: string | null;
}

export interface RunProofPreflightOptions {
  checkTimeoutMs?: number;
  minFreeDiskBytes?: number;
  /** Optional injection point for tests to stub the spawn / fs calls. */
  hooks?: {
    binaryAvailable?: (binary: string) => Promise<boolean>;
    pathExists?: (target: string) => Promise<boolean>;
    freeDiskBytes?: (target: string) => Promise<number>;
  };
  envOverride?: NodeJS.ProcessEnv;
}

const binaryAvailableDefault = (binary: string, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    let settled = false;
    const child = spawn(binary, ["--version"], { stdio: "ignore", windowsHide: true });
    // The @types/node accessible to this package doesn't expose ChildProcess.on directly
    // (overlapping versions in pnpm); cast via EventEmitter to access listeners — same
    // workaround used in proof-runner.ts.
    const childEvents = child as unknown as NodeJS.EventEmitter;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve(false);
    }, timeoutMs);
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    childEvents.on("error", () => finish(false));
    childEvents.on("exit", (code: number | null) => finish(code === 0));
  });

const freeDiskBytesDefault = async (target: string): Promise<number> => {
  try {
    const stats = await statfs(target);
    return stats.bavail * stats.bsize;
  } catch {
    // statfs isn't available on every platform / Node version; on failure we report
    // "unknown" by returning a value above the threshold so the check is a no-op.
    return Number.POSITIVE_INFINITY;
  }
};

const withTimeout = async <T>(label: string, timeoutMs: number, work: Promise<T>): Promise<T | "timeout"> => {
  return Promise.race<T | "timeout">([
    work,
    new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), timeoutMs);
    }),
  ]);
};

interface PreflightContext {
  profile: ResolvedMissionProofProfile;
  hooks: Required<NonNullable<RunProofPreflightOptions["hooks"]>>;
  env: NodeJS.ProcessEnv;
  checkTimeoutMs: number;
  minFreeDiskBytes: number;
}

/**
 * Each check is `(ctx) => Promise<finding | null>`. Returning null means "passed";
 * returning a finding means a blocker or warning to surface. Checks are scheduled in
 * parallel; the controller respects {@link RunProofPreflightOptions.budgetMs} as an
 * overall cap.
 */
type PreflightCheck = (ctx: PreflightContext) => Promise<ProofPreflightFinding | null>;

const checkBinaryOnPath = (binary: string): PreflightCheck => async (ctx) => {
  const ok = await withTimeout(`binary:${binary}`, ctx.checkTimeoutMs, ctx.hooks.binaryAvailable(binary));
  if (ok === true) return null;
  return {
    id: `binary-missing:${binary}`,
    severity: "blocker",
    message: `\`${binary}\` is not on PATH (or did not respond within ${Math.round(ctx.checkTimeoutMs / 1000)}s).`,
    remediation: `Install \`${binary}\` and ensure it's on the PATH for this Spira process.`,
  };
};

const checkProjectRestored: PreflightCheck = async (ctx) => {
  // Resolve the project file inside the worktree, then check for adjacent .NET restore artifacts.
  const projectAbsolute = path.join(ctx.profile.workingDirectory, ctx.profile.projectRelativePath);
  const projectDir = path.dirname(projectAbsolute);
  const objAssetsPath = path.join(projectDir, "obj", "project.assets.json");
  const ok = await withTimeout("project-restored", ctx.checkTimeoutMs, ctx.hooks.pathExists(objAssetsPath));
  if (ok === true) return null;
  return {
    id: "dotnet-project-not-restored",
    severity: "blocker",
    message: "Proof project has not been restored.",
    remediation: `Run \`dotnet restore "${ctx.profile.projectRelativePath}"\` from \`${ctx.profile.workingDirectory}\` before retrying.`,
  };
};

const checkFixturePresent = (relativePath: string, fixtureLabel: string): PreflightCheck => async (ctx) => {
  const fixtureAbsolute = path.join(ctx.profile.workingDirectory, relativePath);
  const ok = await withTimeout(`fixture:${relativePath}`, ctx.checkTimeoutMs, ctx.hooks.pathExists(fixtureAbsolute));
  if (ok === true) return null;
  return {
    id: `fixture-missing:${relativePath}`,
    severity: "blocker",
    message: `Required ${fixtureLabel} is missing at \`${relativePath}\`.`,
    remediation: "Restore the missing file from source control or rerun the harness's setup script.",
  };
};

const checkRunSettingsPresent: PreflightCheck = async (ctx) => {
  if (!ctx.profile.runSettingsRelativePath) {
    return null;
  }
  const settingsAbsolute = path.join(ctx.profile.workingDirectory, ctx.profile.runSettingsRelativePath);
  const ok = await withTimeout("runsettings", ctx.checkTimeoutMs, ctx.hooks.pathExists(settingsAbsolute));
  if (ok === true) return null;
  return {
    id: "runsettings-missing",
    severity: "warning",
    message: `\`${ctx.profile.runSettingsRelativePath}\` was advertised by the profile but is missing.`,
    remediation: "Either restore the runsettings file or update the proof profile to omit it.",
  };
};

const checkDiskSpace: PreflightCheck = async (ctx) => {
  const free = await withTimeout("disk-space", ctx.checkTimeoutMs, ctx.hooks.freeDiskBytes(ctx.profile.workingDirectory));
  if (free === "timeout" || free === Number.POSITIVE_INFINITY || free >= ctx.minFreeDiskBytes) {
    return null;
  }
  const formatGb = (bytes: number) => `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  return {
    id: "disk-space-low",
    severity: "warning",
    message: `Only ${formatGb(free)} free on the worktree volume (recommend ≥${formatGb(ctx.minFreeDiskBytes)} for proof artifacts).`,
    remediation: "Clear out old `.spira-proof/` directories or extend the volume.",
  };
};

/**
 * Pick the per-profile-kind checks. Today there's only one profile kind
 * (`playwright-dotnet-nunit`); new profile kinds add their own check sets here.
 */
const getProfileChecks = (profile: ResolvedMissionProofProfile): PreflightCheck[] => {
  switch (profile.kind) {
    case "playwright-dotnet-nunit":
      return [
        checkBinaryOnPath("dotnet"),
        checkProjectRestored,
        checkRunSettingsPresent,
        // The bypass-auth file is what proof-registry already gates discovery on; if discovery
        // succeeded the file existed. We re-check it here in case it was deleted between
        // discovery and run.
        checkFixturePresent(
          "LegApp.Admin.UI.Tests\\PageTests\\Bases\\IsolatedPageTestBase.cs",
          "Playwright bypass-auth fixture",
        ),
        checkDiskSpace,
      ];
    default:
      return [checkDiskSpace];
  }
};

/**
 * Run the configured preflight checks in parallel against a resolved profile, returning
 * blockers and warnings within the time budget. Errors raised by individual checks are
 * caught and surfaced as warnings — preflight should never throw.
 */
export const runProofPreflight = async (
  profile: ResolvedMissionProofProfile,
  options: RunProofPreflightOptions = {},
): Promise<ProofPreflightResult> => {
  const startedAt = Date.now();
  const checkTimeoutMs = options.checkTimeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const minFreeDiskBytes = options.minFreeDiskBytes ?? DEFAULT_MIN_FREE_DISK_BYTES;

  const ctx: PreflightContext = {
    profile,
    env: options.envOverride ?? process.env,
    checkTimeoutMs,
    minFreeDiskBytes,
    hooks: {
      binaryAvailable:
        options.hooks?.binaryAvailable ?? ((binary: string) => binaryAvailableDefault(binary, checkTimeoutMs)),
      pathExists: options.hooks?.pathExists ?? pathExistsUtil,
      freeDiskBytes: options.hooks?.freeDiskBytes ?? freeDiskBytesDefault,
    },
  };

  const checks = getProfileChecks(profile);
  // Each check enforces its own checkTimeoutMs (and binary checks kill their children on
  // timeout), so allSettled is safely bounded by the per-check timeout. No outer race —
  // an outer race would orphan in-flight child processes when it fired.
  const results = await Promise.allSettled(checks.map((check) => check(ctx)));

  const blockers: ProofPreflightFinding[] = [];
  const warnings: ProofPreflightFinding[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      const finding = result.value;
      if (!finding) continue;
      if (finding.severity === "blocker") {
        blockers.push(finding);
      } else {
        warnings.push(finding);
      }
    } else {
      // A check rejected — surface as a warning so we don't silently mask infrastructure issues.
      warnings.push({
        id: "preflight-check-error",
        severity: "warning",
        message: `A preflight check failed: ${(result.reason as Error)?.message ?? "unknown error"}`,
      });
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const summary =
    blockers.length === 0 && warnings.length === 0
      ? "All preflight checks passed."
      : `${blockers.length} blocker${blockers.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}: ${[...blockers, ...warnings].map((finding) => finding.message).slice(0, 3).join(" | ")}`;

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    elapsedMs,
    summary,
  };
};
