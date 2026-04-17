export const MISSION_SERVICE_PROFILE_KINDS = ["project", "iisexpress"] as const;
export type MissionServiceProfileKind = (typeof MISSION_SERVICE_PROFILE_KINDS)[number];

export const MISSION_SERVICE_LAUNCHERS = ["dotnet-project", "translated-iisexpress"] as const;
export type MissionServiceLauncher = (typeof MISSION_SERVICE_LAUNCHERS)[number];

export const MISSION_SERVICE_PROCESS_STATES = ["starting", "running", "stopping", "stopped", "error"] as const;
export type MissionServiceProcessState = (typeof MISSION_SERVICE_PROCESS_STATES)[number];

export const MISSION_SERVICE_LOG_SOURCES = ["stdout", "stderr"] as const;
export type MissionServiceLogSource = (typeof MISSION_SERVICE_LOG_SOURCES)[number];

export interface MissionServiceLogLine {
  source: MissionServiceLogSource;
  line: string;
  timestamp: number;
}

export interface MissionServiceChildProcessSummary {
  pid: number;
  parentPid: number;
  name: string;
  commandLine: string | null;
}

export interface MissionServiceProfileSummary {
  profileId: string;
  profileName: string;
  kind: MissionServiceProfileKind;
  launcher: MissionServiceLauncher;
  repoRelativePath: string;
  worktreePath: string;
  projectName: string;
  projectRelativePath: string;
  launchSettingsRelativePath: string;
  urls: string[];
  launchUrl: string | null;
  environmentName: string | null;
  isLaunchable: boolean;
  unavailableReason: string | null;
}

export interface MissionServiceProcessSummary {
  serviceId: string;
  runId: string;
  profileId: string;
  profileName: string;
  kind: MissionServiceProfileKind;
  launcher: MissionServiceLauncher;
  repoRelativePath: string;
  worktreePath: string;
  projectName: string;
  projectRelativePath: string;
  urls: string[];
  launchUrl: string | null;
  state: MissionServiceProcessState;
  pid: number | null;
  startedAt: number | null;
  stoppedAt: number | null;
  updatedAt: number;
  exitCode: number | null;
  errorMessage: string | null;
  recentLogLines: MissionServiceLogLine[];
  childProcesses: MissionServiceChildProcessSummary[];
}

export interface MissionServiceSnapshot {
  runId: string;
  profiles: MissionServiceProfileSummary[];
  processes: MissionServiceProcessSummary[];
  updatedAt: number;
}
