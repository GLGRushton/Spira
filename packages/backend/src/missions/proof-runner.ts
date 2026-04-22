import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { TicketRunProofArtifact, TicketRunProofRunStatus, TicketRunSummary } from "@spira/shared";
import type { Logger } from "pino";
import type { ResolvedMissionProofProfile } from "./proof-registry.js";

const DEFAULT_PROOF_TIMEOUT_MS = 20 * 60_000;

export interface RunMissionProofInput {
  run: TicketRunSummary;
  profile: ResolvedMissionProofProfile;
  proofRunId: string;
  logger: Logger;
  now?: () => number;
  timeoutMs?: number;
}

export interface RunMissionProofOutput {
  status: Exclude<TicketRunProofRunStatus, "running">;
  summary: string;
  startedAt: number;
  completedAt: number;
  exitCode: number | null;
  command: string;
  artifacts: TicketRunProofArtifact[];
}

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
};

const resolveMissionProofRoot = (run: TicketRunSummary): string => {
  const parentDirectories = [...new Set(run.worktrees.map((worktree) => path.dirname(worktree.worktreePath)))];
  const baseDirectory = parentDirectories[0] ?? run.worktrees[0]?.worktreePath;
  if (!baseDirectory) {
    throw new Error(`Mission ${run.ticketId} does not have a usable worktree for proof artifacts.`);
  }
  return path.join(baseDirectory, ".spira-proof");
};

const buildArtifact = (
  artifactId: string,
  kind: TicketRunProofArtifact["kind"],
  label: string,
  targetPath: string,
): TicketRunProofArtifact => ({
  artifactId,
  kind,
  label,
  path: targetPath,
  fileUrl: pathToFileURL(targetPath).toString(),
});

const detectArtifactKind = (targetPath: string): TicketRunProofArtifact["kind"] => {
  const extension = path.extname(targetPath).toLowerCase();
  if (extension === ".trx" || extension === ".xml" || extension === ".html") {
    return "report";
  }
  if (extension === ".webm") {
    return "video";
  }
  if (extension === ".png" || extension === ".jpg" || extension === ".jpeg") {
    return "screenshot";
  }
  if (extension === ".log" || extension === ".txt") {
    return "log";
  }
  if (extension === ".zip" && path.basename(targetPath).toLowerCase().includes("trace")) {
    return "trace";
  }
  return "other";
};

const collectFilesRecursive = async (
  rootPath: string,
  shouldIncludeDirectory: (directoryPath: string) => boolean,
): Promise<string[]> => {
  const pending = [rootPath];
  const files: string[] = [];
  while (pending.length > 0) {
    const currentPath = pending.pop();
    if (!currentPath) {
      continue;
    }
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") {
        continue;
      }
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (shouldIncludeDirectory(entryPath)) {
          files.push(entryPath);
        }
        pending.push(entryPath);
        continue;
      }
      files.push(entryPath);
    }
  }
  return files;
};

const collectFreshHarnessArtifacts = async (workingDirectory: string, startedAt: number): Promise<string[]> => {
  const collected = await collectFilesRecursive(
    workingDirectory,
    (directoryPath) => path.basename(directoryPath).toLowerCase() === ".test-artifacts",
  );
  const filtered: string[] = [];
  for (const targetPath of collected) {
    try {
      const info = await stat(targetPath);
      if (info.mtimeMs >= startedAt || targetPath.toLowerCase().includes(".test-artifacts")) {
        filtered.push(targetPath);
      }
    } catch {
      // Ignore transient artifacts that disappeared before we could record them.
    }
  }
  return filtered;
};

const collectResultsArtifacts = async (resultsDirectory: string): Promise<string[]> => {
  if (!(await pathExists(resultsDirectory))) {
    return [];
  }
  return collectFilesRecursive(resultsDirectory, () => false);
};

export async function runMissionProof(input: RunMissionProofInput): Promise<RunMissionProofOutput> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const proofRoot = resolveMissionProofRoot(input.run);
  const proofRunDirectory = path.join(proofRoot, input.proofRunId);
  const resultsDirectory = path.join(proofRunDirectory, "results");
  await mkdir(resultsDirectory, { recursive: true });

  const stdoutPath = path.join(proofRunDirectory, "stdout.log");
  const stderrPath = path.join(proofRunDirectory, "stderr.log");
  const stdoutStream = createWriteStream(stdoutPath, { encoding: "utf8" });
  const stderrStream = createWriteStream(stderrPath, { encoding: "utf8" });

  const loggerArg = `trx;LogFileName=mission-proof-${input.proofRunId}.trx`;
  const args = [...input.profile.args, "--logger", loggerArg, "--results-directory", resultsDirectory];
  const command = `${input.profile.command} ${args.join(" ")}`;

  input.logger.info(
    {
      runId: input.run.runId,
      proofRunId: input.proofRunId,
      profileId: input.profile.profileId,
      command,
    },
    "Running mission proof",
  );

  let timedOut = false;
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(input.profile.command, args, {
      cwd: input.profile.workingDirectory,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const childEvents = child as unknown as NodeJS.EventEmitter;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.timeoutMs ?? DEFAULT_PROOF_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdoutStream.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrStream.write(chunk);
    });
    childEvents.on("error", (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    });
    childEvents.on("close", (code: number | null) => {
      clearTimeout(timeout);
      resolve(code);
    });
  }).finally(async () => {
    await Promise.all([
      new Promise<void>((resolve) => stdoutStream.end(resolve)),
      new Promise<void>((resolve) => stderrStream.end(resolve)),
    ]);
  });

  const completedAt = now();
  const artifactPaths = [
    proofRunDirectory,
    stdoutPath,
    stderrPath,
    ...(await collectResultsArtifacts(resultsDirectory)),
    ...(await collectFreshHarnessArtifacts(input.profile.workingDirectory, startedAt)),
  ];
  const uniqueArtifactPaths = [...new Set(artifactPaths.filter((artifactPath) => artifactPath.length > 0))];
  const artifacts = uniqueArtifactPaths.flatMap((artifactPath, index) => {
    const basename = path.basename(artifactPath);
    const isDirectory = basename.toLowerCase() === ".test-artifacts" || artifactPath === proofRunDirectory;
    return [
      buildArtifact(
        `${input.proofRunId}:${index}`,
        isDirectory ? "folder" : detectArtifactKind(artifactPath),
        artifactPath === proofRunDirectory
          ? "Proof run directory"
          : basename.toLowerCase() === ".test-artifacts"
            ? "Harness artifact folder"
            : basename,
        artifactPath,
      ),
    ];
  });

  const summary =
    timedOut
      ? `${input.profile.label} timed out before it finished.`
      : exitCode === 0
        ? `${input.profile.label} passed and produced ${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}.`
        : `${input.profile.label} failed with exit code ${exitCode ?? "unknown"}.`;

  await writeFile(
    path.join(proofRunDirectory, "summary.json"),
    JSON.stringify(
      {
        runId: input.run.runId,
        proofRunId: input.proofRunId,
        profileId: input.profile.profileId,
        status: timedOut || exitCode !== 0 ? "failed" : "passed",
        summary,
        startedAt,
        completedAt,
        exitCode,
        command,
        artifacts,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    status: timedOut || exitCode !== 0 ? "failed" : "passed",
    summary,
    startedAt,
    completedAt,
    exitCode,
    command,
    artifacts: [
      ...artifacts,
      buildArtifact(`${input.proofRunId}:summary`, "report", "Proof summary", path.join(proofRunDirectory, "summary.json")),
    ],
  };
}
