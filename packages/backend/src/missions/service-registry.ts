import type { Dirent } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { MissionServiceSnapshot, TicketRunSummary } from "@spira/shared";
import type { Logger } from "pino";
import { ConfigError } from "../util/errors.js";
import type { SpiraEventBus } from "../util/event-bus.js";
import { MissionServicePool, type MissionServicePoolProfile } from "./service-pool.js";
import type { TicketRunService } from "./ticket-runs.js";

const DISCOVERY_MAX_DEPTH = 8;
const LAUNCH_SETTINGS_FILE_NAME = "launchSettings.json";
const PROPERTIES_DIRECTORY_NAME = "properties";
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".idea",
  ".next",
  ".nuxt",
  ".turbo",
  ".vs",
  "bin",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "obj",
  "out",
]);

interface LaunchSettingsProfile {
  commandName?: unknown;
  launchUrl?: unknown;
  applicationUrl?: unknown;
  environmentVariables?: unknown;
}

interface LaunchSettingsDocument {
  iisSettings?: {
    iisExpress?: {
      applicationUrl?: unknown;
      sslPort?: unknown;
    };
  };
  profiles?: Record<string, LaunchSettingsProfile>;
}

interface DiscoveryState {
  runKey: string;
  profiles: MissionServicePoolProfile[];
  updatedAt: number;
}

export interface MissionServiceRegistryOptions {
  ticketRunService: Pick<TicketRunService, "getRun">;
  logger: Logger;
  bus?: SpiraEventBus;
  now?: () => number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const normalizePathEntry = (entry: string): string => entry.trim().replace(/^"(.*)"$/u, "$1");

const dedupe = (values: string[]): string[] => [...new Set(values)];

const parseUrlList = (value: unknown): string[] => {
  if (typeof value !== "string") {
    return [];
  }

  return dedupe(
    value
      .split(";")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
};

const buildProfileId = (repoRelativePath: string, projectRelativePath: string, profileName: string): string =>
  `${repoRelativePath}::${projectRelativePath}::${profileName}`;

const buildRunKey = (run: TicketRunSummary): string =>
  run.worktrees
    .map((worktree) => `${worktree.repoRelativePath}:${worktree.worktreePath}`)
    .sort((left, right) => left.localeCompare(right))
    .join("|");

const combineLaunchUrl = (urls: string[], launchUrl: unknown): string | null => {
  if (typeof launchUrl === "string" && launchUrl.trim().length > 0) {
    const trimmedLaunchUrl = launchUrl.trim();
    if (/^https?:\/\//iu.test(trimmedLaunchUrl)) {
      return trimmedLaunchUrl;
    }

    const baseUrl = urls[0];
    if (!baseUrl) {
      return trimmedLaunchUrl;
    }

    try {
      return new URL(trimmedLaunchUrl.replace(/^\/+/u, ""), `${baseUrl.replace(/\/?$/u, "/")}`).toString();
    } catch {
      return trimmedLaunchUrl;
    }
  }

  return urls[0] ?? null;
};

const getEnvironmentName = (environmentVariables: NodeJS.ProcessEnv): string | null =>
  environmentVariables.ASPNETCORE_ENVIRONMENT?.trim() || environmentVariables.DOTNET_ENVIRONMENT?.trim() || null;

const toEnvironmentVariables = (value: unknown): NodeJS.ProcessEnv => {
  if (!isRecord(value)) {
    return {};
  }

  const environmentVariables: NodeJS.ProcessEnv = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue === "string" && rawValue.length > 0) {
      environmentVariables[key] = rawValue;
    }
  }
  return environmentVariables;
};

const shouldDescendIntoDirectory = (directoryName: string): boolean =>
  !IGNORED_DIRECTORY_NAMES.has(directoryName) && !directoryName.startsWith(".");

const getNestedGitEntry = (entries: Dirent[]): boolean =>
  entries.some((entry) => entry.name === ".git" && (entry.isFile() || entry.isDirectory()));

const normalizeCommandName = (value: unknown): "project" | "iisexpress" | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "project") {
    return "project";
  }
  if (normalized === "iisexpress") {
    return "iisexpress";
  }
  return null;
};

export class MissionServiceRegistry {
  private readonly now: () => number;
  private readonly discoveryByRunId = new Map<string, DiscoveryState>();
  private readonly pendingDiscoveryByRunId = new Map<string, Promise<DiscoveryState>>();
  private readonly pool: MissionServicePool;

  constructor(private readonly options: MissionServiceRegistryOptions) {
    this.now = options.now ?? Date.now;
    this.pool = new MissionServicePool({
      logger: options.logger,
      now: this.now,
      onUpdate: (runId) => {
        void this.emitRunSnapshot(runId);
      },
    });
  }

  async getSnapshot(runId: string): Promise<MissionServiceSnapshot> {
    const run = this.options.ticketRunService.getRun(runId);
    await this.ensureDiscovery(run);
    return this.buildSnapshot(runId);
  }

  async startService(runId: string, profileId: string): Promise<MissionServiceSnapshot> {
    const run = this.options.ticketRunService.getRun(runId);
    let discovery = await this.ensureDiscovery(run);
    let profile = discovery.profiles.find((candidate) => candidate.profileId === profileId);
    if (!profile) {
      discovery = await this.ensureDiscovery(run, { force: true });
      profile = discovery.profiles.find((candidate) => candidate.profileId === profileId);
    }
    if (!profile) {
      throw new ConfigError(`Mission service profile ${profileId} was not found in ${run.ticketId}.`);
    }

    if (!profile.isLaunchable || !profile.launchPlan) {
      throw new ConfigError(profile.unavailableReason ?? `${profile.profileName} is unavailable.`);
    }

    await this.pool.start(runId, profile);
    return this.buildSnapshot(runId);
  }

  async stopService(runId: string, serviceId: string): Promise<MissionServiceSnapshot> {
    this.options.ticketRunService.getRun(runId);
    await this.pool.stop(runId, serviceId);
    return this.buildSnapshot(runId);
  }

  async stopRunServices(runId: string): Promise<void> {
    await this.pool.stopRun(runId);
    this.pool.clearRun(runId);
    this.discoveryByRunId.delete(runId);
    this.pendingDiscoveryByRunId.delete(runId);
  }

  async dispose(): Promise<void> {
    await this.pool.dispose();
  }

  private async emitRunSnapshot(runId: string): Promise<void> {
    if (!this.options.bus) {
      return;
    }

    try {
      this.options.bus.emit("missions:ticket-run:services-changed", this.buildSnapshot(runId));
    } catch (error) {
      this.options.logger.warn({ err: error, runId }, "Failed to publish mission service snapshot");
    }
  }

  private buildSnapshot(runId: string): MissionServiceSnapshot {
    const discovery = this.discoveryByRunId.get(runId);
    const processes = this.pool.getRunProcesses(runId);
    const updatedAt = Math.max(discovery?.updatedAt ?? 0, ...processes.map((process) => process.updatedAt), this.now());

    return {
      runId,
      profiles:
        discovery?.profiles.map(({ launchPlan: _launchPlan, ...profile }) => ({
          ...profile,
          urls: [...profile.urls],
        })) ?? [],
      processes,
      updatedAt,
    };
  }

  private async ensureDiscovery(
    run: TicketRunSummary,
    options: {
      force?: boolean;
    } = {},
  ): Promise<DiscoveryState> {
    const runKey = buildRunKey(run);
    const current = this.discoveryByRunId.get(run.runId);
    if (!options.force && current && current.runKey === runKey) {
      return current;
    }

    const pending = this.pendingDiscoveryByRunId.get(run.runId);
    if (pending) {
      return pending;
    }

    const discoveryPromise = (async () => {
      const dotnetExecutable = await this.resolveDotnetExecutable();
      const profiles = await this.discoverProfiles(run, dotnetExecutable);
      const nextState: DiscoveryState = {
        runKey,
        profiles,
        updatedAt: this.now(),
      };
      this.discoveryByRunId.set(run.runId, nextState);
      return nextState;
    })();
    this.pendingDiscoveryByRunId.set(run.runId, discoveryPromise);
    try {
      return await discoveryPromise;
    } finally {
      if (this.pendingDiscoveryByRunId.get(run.runId) === discoveryPromise) {
        this.pendingDiscoveryByRunId.delete(run.runId);
      }
    }
  }

  private async discoverProfiles(
    run: TicketRunSummary,
    dotnetExecutable: string | null,
  ): Promise<MissionServicePoolProfile[]> {
    const profiles: MissionServicePoolProfile[] = [];
    for (const worktree of [...run.worktrees].sort((left, right) =>
      left.repoRelativePath.localeCompare(right.repoRelativePath),
    )) {
      const launchSettingsPaths = await this.findLaunchSettingsFiles(worktree.worktreePath);
      for (const launchSettingsPath of launchSettingsPaths) {
        profiles.push(...(await this.readLaunchSettingsProfiles(worktree, launchSettingsPath, dotnetExecutable)));
      }
    }

    return profiles.sort((left, right) => {
      const repoComparison = left.repoRelativePath.localeCompare(right.repoRelativePath);
      if (repoComparison !== 0) {
        return repoComparison;
      }

      const projectComparison = left.projectRelativePath.localeCompare(right.projectRelativePath);
      if (projectComparison !== 0) {
        return projectComparison;
      }

      return left.profileName.localeCompare(right.profileName);
    });
  }

  private async findLaunchSettingsFiles(worktreePath: string): Promise<string[]> {
    const results: string[] = [];

    const walk = async (currentPath: string, depth: number): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await readdir(currentPath, { withFileTypes: true });
      } catch {
        return;
      }

      if (depth > 0 && getNestedGitEntry(entries)) {
        return;
      }

      const launchSettingsEntry = entries.find(
        (entry) => entry.isFile() && entry.name.toLowerCase() === LAUNCH_SETTINGS_FILE_NAME.toLowerCase(),
      );
      if (launchSettingsEntry && path.basename(currentPath).toLowerCase() === PROPERTIES_DIRECTORY_NAME) {
        results.push(path.join(currentPath, launchSettingsEntry.name));
      }

      if (depth >= DISCOVERY_MAX_DEPTH) {
        return;
      }

      for (const entry of entries) {
        if (!entry.isDirectory() || !shouldDescendIntoDirectory(entry.name)) {
          continue;
        }

        await walk(path.join(currentPath, entry.name), depth + 1);
      }
    };

    await walk(worktreePath, 0);
    return results.sort((left, right) => left.localeCompare(right));
  }

  private async readLaunchSettingsProfiles(
    worktree: TicketRunSummary["worktrees"][number],
    launchSettingsPath: string,
    dotnetExecutable: string | null,
  ): Promise<MissionServicePoolProfile[]> {
    let parsed: LaunchSettingsDocument;
    try {
      const raw = await readFile(launchSettingsPath, "utf8");
      parsed = JSON.parse(raw.replace(/^\uFEFF/u, "")) as LaunchSettingsDocument;
    } catch (error) {
      this.options.logger.warn({ err: error, launchSettingsPath }, "Failed to parse launchSettings.json");
      return [];
    }

    const launchSettingsRelativePath =
      path.relative(worktree.worktreePath, launchSettingsPath) || path.basename(launchSettingsPath);
    const projectRootPath = path.dirname(path.dirname(launchSettingsPath));
    const projectName = path.basename(projectRootPath);
    const projectFilePath = await this.resolveProjectFile(projectRootPath);
    const projectRelativePath = projectFilePath
      ? path.relative(worktree.worktreePath, projectFilePath) || path.basename(projectFilePath)
      : projectName;
    const profiles = isRecord(parsed.profiles) ? parsed.profiles : {};
    const iisExpressUrls = this.resolveIisExpressUrls(parsed);

    const results: MissionServicePoolProfile[] = [];
    for (const [profileName, profileValue] of Object.entries(profiles)) {
      const commandName = normalizeCommandName(profileValue.commandName);
      if (!commandName) {
        continue;
      }

      const environmentVariables = toEnvironmentVariables(profileValue.environmentVariables);
      const environmentName = getEnvironmentName(environmentVariables);
      const profileId = buildProfileId(worktree.repoRelativePath, projectRelativePath, profileName);

      if (commandName === "project") {
        const urls = parseUrlList(profileValue.applicationUrl);
        const unavailableReason = this.getProjectProfileUnavailableReason(projectFilePath, dotnetExecutable);
        results.push({
          profileId,
          profileName,
          kind: "project",
          launcher: "dotnet-project",
          repoRelativePath: worktree.repoRelativePath,
          worktreePath: worktree.worktreePath,
          projectName,
          projectRelativePath,
          launchSettingsRelativePath,
          urls,
          launchUrl: combineLaunchUrl(urls, profileValue.launchUrl),
          environmentName,
          isLaunchable: unavailableReason === null,
          unavailableReason,
          launchPlan:
            unavailableReason === null && dotnetExecutable && projectFilePath
              ? {
                  command: dotnetExecutable,
                  args: ["run", "--project", projectFilePath, "--launch-profile", profileName],
                  cwd: projectRootPath,
                  env: environmentVariables,
                }
              : null,
        });
        continue;
      }

      const translatedEnvironment: NodeJS.ProcessEnv = {
        ...environmentVariables,
      };
      if (iisExpressUrls.length > 0) {
        translatedEnvironment.ASPNETCORE_URLS = iisExpressUrls.join(";");
      }

      const sslPort = parsed.iisSettings?.iisExpress?.sslPort;
      if (typeof sslPort === "number" && Number.isFinite(sslPort) && sslPort > 0) {
        translatedEnvironment.ASPNETCORE_HTTPS_PORT = String(Math.trunc(sslPort));
      }

      const translatedUnavailableReason =
        this.getProjectProfileUnavailableReason(projectFilePath, dotnetExecutable) ??
        (iisExpressUrls.length === 0
          ? `IIS Express profile ${profileName} does not define any runnable application URLs.`
          : null);
      results.push({
        profileId,
        profileName,
        kind: "iisexpress",
        launcher: "translated-iisexpress",
        repoRelativePath: worktree.repoRelativePath,
        worktreePath: worktree.worktreePath,
        projectName,
        projectRelativePath,
        launchSettingsRelativePath,
        urls: iisExpressUrls,
        launchUrl: combineLaunchUrl(iisExpressUrls, profileValue.launchUrl),
        environmentName,
        isLaunchable: translatedUnavailableReason === null,
        unavailableReason: translatedUnavailableReason,
        launchPlan:
          translatedUnavailableReason === null && dotnetExecutable && projectFilePath
            ? {
                command: dotnetExecutable,
                args: ["run", "--project", projectFilePath, "--no-launch-profile"],
                cwd: projectRootPath,
                env: translatedEnvironment,
              }
            : null,
      });
    }

    return results;
  }

  private resolveIisExpressUrls(parsed: LaunchSettingsDocument): string[] {
    const rawUrls = parseUrlList(parsed.iisSettings?.iisExpress?.applicationUrl);
    const sslPort = parsed.iisSettings?.iisExpress?.sslPort;
    if (typeof sslPort === "number" && Number.isFinite(sslPort) && sslPort > 0) {
      rawUrls.push(`https://localhost:${Math.trunc(sslPort)}`);
    }
    return dedupe(rawUrls);
  }

  private getProjectProfileUnavailableReason(
    projectFilePath: string | null,
    dotnetExecutable: string | null,
  ): string | null {
    if (!projectFilePath) {
      return "No runnable .csproj file was found beside this launchSettings.json file.";
    }
    if (!dotnetExecutable) {
      return "dotnet was not found on PATH, so Spira cannot launch this profile.";
    }
    return null;
  }

  private async resolveProjectFile(projectRootPath: string): Promise<string | null> {
    let entries: Dirent[];
    try {
      entries = await readdir(projectRootPath, { withFileTypes: true });
    } catch {
      return null;
    }

    const projectFiles = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csproj"));
    if (projectFiles.length === 0) {
      return null;
    }

    if (projectFiles.length === 1) {
      return path.join(projectRootPath, projectFiles[0].name);
    }

    const preferredProjectName = `${path.basename(projectRootPath)}.csproj`.toLowerCase();
    const preferred = projectFiles.find((entry) => entry.name.toLowerCase() === preferredProjectName);
    return preferred ? path.join(projectRootPath, preferred.name) : null;
  }

  private async resolveDotnetExecutable(): Promise<string | null> {
    if (process.platform === "win32") {
      return (await this.resolveExecutable("dotnet.exe")) ?? this.resolveExecutable("dotnet");
    }

    return this.resolveExecutable("dotnet");
  }

  private async resolveExecutable(executableName: string): Promise<string | null> {
    const searchPaths = dedupe(
      (process.env.PATH ?? "")
        .split(path.delimiter)
        .map(normalizePathEntry)
        .filter((entry) => entry.length > 0),
    );

    for (const searchPath of searchPaths) {
      const candidate = path.join(searchPath, executableName);
      try {
        await access(candidate);
        return candidate;
      } catch {}
    }

    return null;
  }
}
