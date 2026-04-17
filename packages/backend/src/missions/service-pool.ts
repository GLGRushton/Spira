import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { EventEmitter } from "node:events";
import { promisify } from "node:util";
import type {
  MissionServiceChildProcessSummary,
  MissionServiceLogLine,
  MissionServiceLogSource,
  MissionServiceProcessSummary,
  MissionServiceProfileSummary,
} from "@spira/shared";
import { ConfigError } from "../util/errors.js";

const execFileAsync = promisify(execFile);
const MAX_LOG_LINES = 80;
const PROCESS_TREE_POLL_INTERVAL_MS = 2_000;
const START_SETTLE_DELAY_MS = 250;
const STOP_TIMEOUT_MS = 8_000;

export interface MissionServiceLaunchPlan {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface MissionServicePoolProfile extends MissionServiceProfileSummary {
  launchPlan: MissionServiceLaunchPlan | null;
}

export interface MissionServicePoolOptions {
  logger: {
    info: (payload: object, message: string) => void;
    warn: (payload: object, message: string) => void;
  };
  now?: () => number;
  onUpdate?: (runId: string) => void;
}

interface MissionServiceHandle {
  serviceId: string;
  runId: string;
  profile: MissionServicePoolProfile;
  child: ChildProcess & EventEmitter;
  summary: MissionServiceProcessSummary;
  logs: MissionServiceLogLine[];
  logRemainders: Record<MissionServiceLogSource, string>;
  processTreePoll: NodeJS.Timeout | null;
  processTreeRefreshPromise: Promise<void> | null;
  stopPromise: Promise<void> | null;
}

interface RawProcessRecord {
  pid: number;
  parentPid: number;
  name: string | null;
  commandLine: string | null;
}

const ACTIVE_STATES = new Set<MissionServiceProcessSummary["state"]>(["starting", "running", "stopping"]);

const compareProcesses = (left: MissionServiceProcessSummary, right: MissionServiceProcessSummary): number => {
  const leftActive = ACTIVE_STATES.has(left.state) ? 1 : 0;
  const rightActive = ACTIVE_STATES.has(right.state) ? 1 : 0;
  if (leftActive !== rightActive) {
    return rightActive - leftActive;
  }

  return (right.startedAt ?? right.updatedAt) - (left.startedAt ?? left.updatedAt);
};

const isProcessMissingError = (error: unknown): boolean => {
  const stderr =
    typeof (error as { stderr?: unknown })?.stderr === "string" ? (error as { stderr: string }).stderr : "";
  const stdout =
    typeof (error as { stdout?: unknown })?.stdout === "string" ? (error as { stdout: string }).stdout : "";
  const message = error instanceof Error ? error.message : "";
  return /not found|no running instance|cannot find the process|process .* not found/iu.test(
    `${message}\n${stderr}\n${stdout}`,
  );
};

const killWindowsProcessTree = async (pid: number): Promise<void> => {
  try {
    await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  } catch (error) {
    if (isProcessMissingError(error)) {
      return;
    }

    throw error;
  }
};

const killPosixProcessGroup = (pid: number): void => {
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return;
    }

    throw error;
  }
};

const PROCESS_LIST_MAX_BUFFER = 4 * 1024 * 1024;

const buildChildProcessSummaries = (
  processRecords: RawProcessRecord[],
  rootPid: number,
): MissionServiceChildProcessSummary[] => {
  const childrenByParent = new Map<number, RawProcessRecord[]>();
  for (const record of processRecords) {
    const siblings = childrenByParent.get(record.parentPid) ?? [];
    siblings.push(record);
    childrenByParent.set(record.parentPid, siblings);
  }

  const descendants: MissionServiceChildProcessSummary[] = [];
  const queue = [rootPid];
  const seen = new Set<number>(queue);
  while (queue.length > 0) {
    const parentPid = queue.shift();
    if (parentPid === undefined) {
      break;
    }

    const children = childrenByParent.get(parentPid) ?? [];
    children.sort((left, right) => left.pid - right.pid);
    for (const child of children) {
      if (seen.has(child.pid)) {
        continue;
      }
      seen.add(child.pid);
      queue.push(child.pid);
      descendants.push({
        pid: child.pid,
        parentPid: child.parentPid,
        name: child.name?.trim() || `PID ${child.pid}`,
        commandLine: child.commandLine?.trim() || null,
      });
    }
  }

  return descendants;
};

const parseWindowsProcessRecords = (stdout: string): RawProcessRecord[] => {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const processIdValue =
        typeof (entry as { ProcessId?: unknown }).ProcessId === "number"
          ? (entry as { ProcessId: number }).ProcessId
          : Number((entry as { ProcessId?: unknown }).ProcessId);
      const parentProcessIdValue =
        typeof (entry as { ParentProcessId?: unknown }).ParentProcessId === "number"
          ? (entry as { ParentProcessId: number }).ParentProcessId
          : Number((entry as { ParentProcessId?: unknown }).ParentProcessId);
      if (!Number.isInteger(processIdValue) || processIdValue <= 0 || !Number.isInteger(parentProcessIdValue)) {
        return null;
      }

      return {
        pid: processIdValue,
        parentPid: parentProcessIdValue,
        name: typeof (entry as { Name?: unknown }).Name === "string" ? (entry as { Name: string }).Name : null,
        commandLine:
          typeof (entry as { CommandLine?: unknown }).CommandLine === "string"
            ? (entry as { CommandLine: string }).CommandLine
            : null,
      } satisfies RawProcessRecord;
    })
    .filter((entry): entry is RawProcessRecord => entry !== null);
};

const parsePosixProcessRecords = (stdout: string): RawProcessRecord[] =>
  stdout
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/u);
      if (!match) {
        return null;
      }

      const pid = Number(match[1]);
      const parentPid = Number(match[2]);
      const commandLine = match[3]?.trim() || null;
      if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(parentPid)) {
        return null;
      }

      const executable = commandLine?.split(/\s+/u)[0] ?? "";
      return {
        pid,
        parentPid,
        name: executable ? (executable.split(/[\\/]/u).pop() ?? executable) : null,
        commandLine,
      } satisfies RawProcessRecord;
    })
    .filter((entry): entry is RawProcessRecord => entry !== null);

const listWindowsChildProcesses = async (rootPid: number): Promise<MissionServiceChildProcessSummary[]> => {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress",
    ],
    {
      maxBuffer: PROCESS_LIST_MAX_BUFFER,
      windowsHide: true,
    },
  );
  return buildChildProcessSummaries(parseWindowsProcessRecords(stdout), rootPid);
};

const listPosixChildProcesses = async (rootPid: number): Promise<MissionServiceChildProcessSummary[]> => {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,command="], {
    maxBuffer: PROCESS_LIST_MAX_BUFFER,
    windowsHide: true,
  });
  return buildChildProcessSummaries(parsePosixProcessRecords(stdout), rootPid);
};

const listChildProcesses = (rootPid: number): Promise<MissionServiceChildProcessSummary[]> =>
  process.platform === "win32" ? listWindowsChildProcesses(rootPid) : listPosixChildProcesses(rootPid);

const areChildProcessesEqual = (
  left: MissionServiceChildProcessSummary[],
  right: MissionServiceChildProcessSummary[],
): boolean =>
  left.length === right.length &&
  left.every((entry, index) => {
    const other = right[index];
    return (
      Boolean(other) &&
      entry.pid === other.pid &&
      entry.parentPid === other.parentPid &&
      entry.name === other.name &&
      entry.commandLine === other.commandLine
    );
  });

export class MissionServicePool {
  private readonly now: () => number;
  private readonly handles = new Map<string, MissionServiceHandle>();
  private readonly runServiceIds = new Map<string, Set<string>>();

  constructor(private readonly options: MissionServicePoolOptions) {
    this.now = options.now ?? Date.now;
  }

  async start(runId: string, profile: MissionServicePoolProfile): Promise<MissionServiceProcessSummary> {
    if (!profile.isLaunchable || !profile.launchPlan) {
      throw new ConfigError(
        profile.unavailableReason ?? `Mission service profile ${profile.profileName} is unavailable.`,
      );
    }

    const activeExisting = this.getRunProcesses(runId).find(
      (candidate) => candidate.profileId === profile.profileId && ACTIVE_STATES.has(candidate.state),
    );
    if (activeExisting) {
      throw new ConfigError(`${profile.profileName} is already running for this mission.`);
    }

    const serviceId = randomUUID();
    const startedAt = this.now();
    const child = spawn(profile.launchPlan.command, profile.launchPlan.args, {
      cwd: profile.launchPlan.cwd,
      env: {
        ...process.env,
        ...profile.launchPlan.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...(process.platform === "win32" ? {} : { detached: true }),
    }) as ChildProcess & EventEmitter;
    const handle: MissionServiceHandle = {
      serviceId,
      runId,
      profile,
      child,
      summary: {
        serviceId,
        runId,
        profileId: profile.profileId,
        profileName: profile.profileName,
        kind: profile.kind,
        launcher: profile.launcher,
        repoRelativePath: profile.repoRelativePath,
        worktreePath: profile.worktreePath,
        projectName: profile.projectName,
        projectRelativePath: profile.projectRelativePath,
        urls: [...profile.urls],
        launchUrl: profile.launchUrl,
        state: "starting",
        pid: child.pid ?? null,
        startedAt,
        stoppedAt: null,
        updatedAt: startedAt,
        exitCode: null,
        errorMessage: null,
        recentLogLines: [],
        childProcesses: [],
      },
      logs: [],
      logRemainders: {
        stdout: "",
        stderr: "",
      },
      processTreePoll: null,
      processTreeRefreshPromise: null,
      stopPromise: null,
    };

    this.handles.set(serviceId, handle);
    const serviceIds = this.runServiceIds.get(runId) ?? new Set<string>();
    serviceIds.add(serviceId);
    this.runServiceIds.set(runId, serviceIds);
    this.attachProcessListeners(handle);
    this.emitUpdate(runId);
    await this.waitForStartSettled(handle);
    return this.toSummary(handle);
  }

  getRunProcesses(runId: string): MissionServiceProcessSummary[] {
    const serviceIds = this.runServiceIds.get(runId);
    if (!serviceIds || serviceIds.size === 0) {
      return [];
    }

    return [...serviceIds]
      .map((serviceId) => this.handles.get(serviceId))
      .filter((handle): handle is MissionServiceHandle => Boolean(handle))
      .map((handle) => this.toSummary(handle))
      .sort(compareProcesses);
  }

  async stop(runId: string, serviceId: string): Promise<void> {
    const handle = this.handles.get(serviceId);
    if (!handle || handle.runId !== runId) {
      throw new ConfigError(`Mission service ${serviceId} was not found for run ${runId}.`);
    }

    await this.stopHandle(handle);
  }

  async stopRun(runId: string): Promise<void> {
    const handles = this.getRunHandles(runId).filter((handle) => ACTIVE_STATES.has(handle.summary.state));
    await Promise.all(handles.map((handle) => this.stopHandle(handle)));
  }

  clearRun(runId: string): void {
    const serviceIds = this.runServiceIds.get(runId);
    if (!serviceIds) {
      return;
    }

    for (const serviceId of serviceIds) {
      const handle = this.handles.get(serviceId);
      if (handle) {
        this.stopProcessTreePolling(handle);
      }
      this.handles.delete(serviceId);
    }
    this.runServiceIds.delete(runId);
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.runServiceIds.keys()].map((runId) => this.stopRun(runId)));
  }

  private getRunHandles(runId: string): MissionServiceHandle[] {
    const serviceIds = this.runServiceIds.get(runId);
    if (!serviceIds || serviceIds.size === 0) {
      return [];
    }

    return [...serviceIds]
      .map((serviceId) => this.handles.get(serviceId))
      .filter((handle): handle is MissionServiceHandle => Boolean(handle));
  }

  private attachProcessListeners(handle: MissionServiceHandle): void {
    handle.child.stdout?.setEncoding("utf8");
    handle.child.stdout?.on("data", (chunk: string) => {
      this.appendLogChunk(handle, "stdout", chunk);
    });

    handle.child.stderr?.setEncoding("utf8");
    handle.child.stderr?.on("data", (chunk: string) => {
      this.appendLogChunk(handle, "stderr", chunk);
    });

    handle.child.on("spawn", () => {
      const pid = handle.child.pid ?? null;
      handle.summary = {
        ...handle.summary,
        state: "running",
        pid,
        updatedAt: this.now(),
      };
      this.startProcessTreePolling(handle);
      this.options.logger.info(
        {
          runId: handle.runId,
          serviceId: handle.serviceId,
          profileId: handle.profile.profileId,
          pid,
          command: handle.profile.launchPlan?.command,
          args: handle.profile.launchPlan?.args,
        },
        "Started mission service process",
      );
      this.emitUpdate(handle.runId);
    });

    handle.child.on("error", (error: Error) => {
      this.flushLogRemainders(handle);
      handle.summary = {
        ...handle.summary,
        childProcesses: [],
        state: "error",
        stoppedAt: this.now(),
        updatedAt: this.now(),
        errorMessage: error.message,
      };
      this.stopProcessTreePolling(handle);
      this.options.logger.warn(
        {
          err: error,
          runId: handle.runId,
          serviceId: handle.serviceId,
          profileId: handle.profile.profileId,
        },
        "Mission service process failed to start",
      );
      this.emitUpdate(handle.runId);
    });

    handle.child.on("exit", (code: number | null) => {
      this.flushLogRemainders(handle);
      const finishedAt = this.now();
      const stoppedByUser = handle.summary.state === "stopping";
      handle.summary = {
        ...handle.summary,
        childProcesses: [],
        state: stoppedByUser || code === 0 ? "stopped" : "error",
        stoppedAt: finishedAt,
        updatedAt: finishedAt,
        exitCode: code,
        errorMessage:
          stoppedByUser || code === 0
            ? null
            : (handle.summary.errorMessage ?? `${handle.profile.profileName} exited with code ${code ?? "unknown"}.`),
      };
      this.stopProcessTreePolling(handle);
      this.options.logger.info(
        {
          runId: handle.runId,
          serviceId: handle.serviceId,
          profileId: handle.profile.profileId,
          exitCode: code,
          state: handle.summary.state,
        },
        "Mission service process exited",
      );
      this.emitUpdate(handle.runId);
    });
  }

  private appendLogChunk(handle: MissionServiceHandle, source: MissionServiceLogSource, chunk: string): void {
    const combined = `${handle.logRemainders[source]}${chunk}`;
    const normalized = combined.replace(/\r\n/gu, "\n");
    const parts = normalized.split("\n");
    handle.logRemainders[source] = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trimEnd();
      if (!trimmed) {
        continue;
      }

      handle.logs.push({
        source,
        line: trimmed,
        timestamp: this.now(),
      });
    }

    if (handle.logs.length > MAX_LOG_LINES) {
      handle.logs.splice(0, handle.logs.length - MAX_LOG_LINES);
    }

    handle.summary = {
      ...handle.summary,
      recentLogLines: [...handle.logs],
      updatedAt: this.now(),
    };
    this.emitUpdate(handle.runId);
  }

  private flushLogRemainders(handle: MissionServiceHandle): void {
    for (const source of ["stdout", "stderr"] as const) {
      const remainder = handle.logRemainders[source].trim();
      if (!remainder) {
        handle.logRemainders[source] = "";
        continue;
      }

      handle.logs.push({
        source,
        line: remainder,
        timestamp: this.now(),
      });
      handle.logRemainders[source] = "";
    }

    if (handle.logs.length > MAX_LOG_LINES) {
      handle.logs.splice(0, handle.logs.length - MAX_LOG_LINES);
    }

    handle.summary = {
      ...handle.summary,
      recentLogLines: [...handle.logs],
      updatedAt: this.now(),
    };
  }

  private async waitForStartSettled(handle: MissionServiceHandle): Promise<void> {
    if (handle.summary.state !== "starting") {
      return;
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, START_SETTLE_DELAY_MS);

      const settle = () => {
        cleanup();
        resolve();
      };

      const cleanup = () => {
        clearTimeout(timer);
        handle.child.removeListener("spawn", settle);
        handle.child.removeListener("error", settle);
      };

      handle.child.on("spawn", settle);
      handle.child.on("error", settle);
    });
  }

  private startProcessTreePolling(handle: MissionServiceHandle): void {
    this.stopProcessTreePolling(handle);
    void this.refreshChildProcesses(handle);
    handle.processTreePoll = setInterval(() => {
      void this.refreshChildProcesses(handle);
    }, PROCESS_TREE_POLL_INTERVAL_MS);
    handle.processTreePoll.unref?.();
  }

  private stopProcessTreePolling(handle: MissionServiceHandle): void {
    if (handle.processTreePoll) {
      clearInterval(handle.processTreePoll);
      handle.processTreePoll = null;
    }
  }

  private async refreshChildProcesses(handle: MissionServiceHandle): Promise<void> {
    if (handle.processTreeRefreshPromise) {
      await handle.processTreeRefreshPromise;
      return;
    }

    if (!ACTIVE_STATES.has(handle.summary.state)) {
      return;
    }

    const pid = handle.child.pid ?? handle.summary.pid;
    if (pid === null) {
      return;
    }

    handle.processTreeRefreshPromise = (async () => {
      try {
        const childProcesses = await listChildProcesses(pid);
        if (areChildProcessesEqual(handle.summary.childProcesses, childProcesses)) {
          return;
        }

        handle.summary = {
          ...handle.summary,
          childProcesses,
          updatedAt: this.now(),
        };
        this.emitUpdate(handle.runId);
      } catch (error) {
        if (!ACTIVE_STATES.has(handle.summary.state)) {
          return;
        }

        this.options.logger.warn(
          {
            err: error,
            runId: handle.runId,
            serviceId: handle.serviceId,
            pid,
          },
          "Failed to refresh mission service child processes",
        );
      } finally {
        handle.processTreeRefreshPromise = null;
      }
    })();

    await handle.processTreeRefreshPromise;
  }

  private async stopHandle(handle: MissionServiceHandle): Promise<void> {
    if (handle.stopPromise) {
      await handle.stopPromise;
      return;
    }

    if (!ACTIVE_STATES.has(handle.summary.state)) {
      return;
    }

    handle.summary = {
      ...handle.summary,
      state: "stopping",
      updatedAt: this.now(),
    };
    this.emitUpdate(handle.runId);

    handle.stopPromise = (async () => {
      try {
        const pid = handle.child.pid ?? handle.summary.pid;
        if (pid !== null) {
          if (process.platform === "win32") {
            await killWindowsProcessTree(pid);
          } else {
            killPosixProcessGroup(pid);
          }
        } else {
          handle.child.kill("SIGTERM");
        }

        await this.waitForExit(handle);
      } catch (error) {
        this.stopProcessTreePolling(handle);
        this.options.logger.warn(
          { err: error, runId: handle.runId, serviceId: handle.serviceId, pid: handle.summary.pid },
          "Failed to stop mission service process cleanly",
        );
        if (!ACTIVE_STATES.has(handle.summary.state)) {
          return;
        }

        handle.summary = {
          ...handle.summary,
          state: "error",
          stoppedAt: this.now(),
          updatedAt: this.now(),
          errorMessage: error instanceof Error ? error.message : "Failed to stop the mission service process.",
        };
        this.emitUpdate(handle.runId);
      } finally {
        handle.stopPromise = null;
      }
    })();

    await handle.stopPromise;
  }

  private async waitForExit(handle: MissionServiceHandle): Promise<void> {
    if (!ACTIVE_STATES.has(handle.summary.state)) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out while waiting for ${handle.profile.profileName} to stop.`));
      }, STOP_TIMEOUT_MS);

      const finish = () => {
        cleanup();
        resolve();
      };

      const cleanup = () => {
        clearTimeout(timer);
        handle.child.removeListener("exit", finish);
        handle.child.removeListener("error", finish);
      };

      handle.child.on("exit", finish);
      handle.child.on("error", finish);
    });
  }

  private toSummary(handle: MissionServiceHandle): MissionServiceProcessSummary {
    return {
      ...handle.summary,
      childProcesses: handle.summary.childProcesses.map((child) => ({ ...child })),
      recentLogLines: [...handle.summary.recentLogLines],
      urls: [...handle.summary.urls],
    };
  }

  private emitUpdate(runId: string): void {
    this.options.onUpdate?.(runId);
  }
}
