import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ConversationRecord as ArchivedConversation,
  ConversationMessageRecord as ArchivedConversationMessage,
  ConversationSummary as ArchivedConversationSummary,
  SpiraMemoryDatabase,
} from "@spira/memory-db";
import { SPIRA_MEMORY_DB_PATH_ENV, getSpiraMemoryDbPath } from "@spira/memory-db/path";
import {
  type CancelTicketRunWorkResult,
  type CommitTicketRunResult,
  type CompleteTicketRunResult,
  type ConnectionStatus,
  type ContinueTicketRunWorkResult,
  type ConversationMessage,
  type ConversationSearchMatch,
  type CreateTicketRunPullRequestResult,
  DEFAULT_YOUTRACK_STATE_MAPPING,
  type GenerateTicketRunCommitDraftResult,
  type MissionServiceSnapshot,
  type ProjectRepoMappingsSnapshot,
  RUNTIME_CONFIG_KEYS,
  type RendererFatalPayload,
  type RetryTicketRunSyncResult,
  type RuntimeConfigApplyResult,
  type RuntimeConfigKey,
  type RuntimeConfigSummary,
  type RuntimeConfigUpdate,
  type SetTicketRunCommitDraftResult,
  type StartTicketRunResult,
  type StartTicketRunWorkResult,
  type StoredConversation,
  type StoredConversationSummary,
  type SyncTicketRunRemoteResult,
  type TicketRunGitStateResult,
  type TicketRunSnapshot,
  type UpgradeProposal,
  type UserSettings,
  type YouTrackProjectSummary,
  type YouTrackStateMapping,
  type YouTrackStatusSummary,
  type YouTrackTicketSummary,
  normalizeTtsProvider,
  normalizeWakeWordProvider,
} from "@spira/shared";
import type { IpcMainEvent, IpcMainInvokeEvent, OpenDialogOptions, Tray } from "electron";
import { BrowserWindow, app, dialog, ipcMain, safeStorage, shell } from "electron";
import WebSocket from "ws";
import { setupAutoUpdater } from "./auto-update.js";
import { BackendLifecycle } from "./backend-lifecycle.js";
import { type IpcBridgeHandle, setupIpcBridge } from "./ipc-bridge.js";
import { SpiraUiControlBridge } from "./spira-ui-control-bridge.js";
import { createTray } from "./tray.js";
import { UpgradeOrchestrator } from "./upgrade-orchestrator.js";
import { createWindow } from "./window.js";

const BACKEND_PORT = 9720;
const WINDOW_CONTROL_CHANNEL = "spira:window-control";
const CONNECTION_STATUS_GET_CHANNEL = "connection-status:get";
const SETTINGS_GET_CHANNEL = "settings:get";
const SETTINGS_SET_CHANNEL = "settings:set";
const RECENT_CONVERSATION_GET_CHANNEL = "conversation:recent:get";
const CONVERSATIONS_LIST_CHANNEL = "conversation:list";
const CONVERSATION_GET_CHANNEL = "conversation:get";
const CONVERSATION_SEARCH_CHANNEL = "conversation:search";
const CONVERSATION_MARK_VIEWED_CHANNEL = "conversation:mark-viewed";
const CONVERSATION_ARCHIVE_CHANNEL = "conversation:archive";
const YOUTRACK_STATUS_GET_CHANNEL = "youtrack:status:get";
const YOUTRACK_TICKETS_LIST_CHANNEL = "youtrack:tickets:list";
const YOUTRACK_PROJECTS_SEARCH_CHANNEL = "youtrack:projects:search";
const YOUTRACK_STATE_MAPPING_SET_CHANNEL = "youtrack:state-mapping:set";
const PROJECT_REPO_MAPPINGS_GET_CHANNEL = "projects:mappings:get";
const PROJECT_WORKSPACE_ROOT_SET_CHANNEL = "projects:workspace-root:set";
const PROJECT_REPO_MAPPING_SET_CHANNEL = "projects:mapping:set";
const TICKET_RUNS_GET_CHANNEL = "missions:runs:get";
const TICKET_RUN_START_CHANNEL = "missions:ticket-run:start";
const TICKET_RUN_SYNC_CHANNEL = "missions:ticket-run:sync";
const TICKET_RUN_WORK_START_CHANNEL = "missions:ticket-run:work:start";
const TICKET_RUN_WORK_CONTINUE_CHANNEL = "missions:ticket-run:work:continue";
const TICKET_RUN_WORK_CANCEL_CHANNEL = "missions:ticket-run:work:cancel";
const TICKET_RUN_COMPLETE_CHANNEL = "missions:ticket-run:complete";
const TICKET_RUN_GIT_STATE_CHANNEL = "missions:ticket-run:git-state:get";
const TICKET_RUN_COMMIT_DRAFT_GENERATE_CHANNEL = "missions:ticket-run:commit-draft:generate";
const TICKET_RUN_COMMIT_DRAFT_SET_CHANNEL = "missions:ticket-run:commit-draft:set";
const TICKET_RUN_COMMIT_CHANNEL = "missions:ticket-run:commit";
const TICKET_RUN_PUBLISH_CHANNEL = "missions:ticket-run:publish";
const TICKET_RUN_PUSH_CHANNEL = "missions:ticket-run:push";
const TICKET_RUN_PULL_REQUEST_CREATE_CHANNEL = "missions:ticket-run:pull-request:create";
const TICKET_RUN_SERVICES_GET_CHANNEL = "missions:ticket-run:services:get";
const TICKET_RUN_SERVICE_START_CHANNEL = "missions:ticket-run:service:start";
const TICKET_RUN_SERVICE_STOP_CHANNEL = "missions:ticket-run:service:stop";
const DIRECTORY_PICK_CHANNEL = "dialog:pick-directory";
const OPEN_EXTERNAL_CHANNEL = "shell:open-external";
const RUNTIME_CONFIG_GET_CHANNEL = "runtime-config:get";
const RUNTIME_CONFIG_SET_CHANNEL = "runtime-config:set";
const UPGRADE_RESPONSE_CHANNEL = "upgrade:respond";
const RENDERER_FATAL_CHANNEL = "renderer:fatal";
const EXTERNAL_BACKEND_READY_TIMEOUT_MS = 30_000;
const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const repoRoot = path.resolve(currentDir, "../../..");

type SettingsStoreData = Partial<UserSettings>;
type SettingsStoreInstance = {
  readonly store: SettingsStoreData;
  set(data: SettingsStoreData): void;
};
type RuntimeConfigStoreData = Partial<Record<RuntimeConfigKey, string | null>>;
type EncryptedRuntimeConfigStoreData = Partial<Record<RuntimeConfigKey, string | null>>;
type RuntimeConfigStoreInstance = {
  readonly store: EncryptedRuntimeConfigStoreData;
  set(data: EncryptedRuntimeConfigStoreData): void;
};

const { default: ElectronStore } = (await import("electron-store")) as {
  default: {
    new <T extends Record<string, unknown> = Record<string, unknown>>(options: { name: string }): {
      readonly store: T;
      set(data: Partial<T>): void;
    };
  };
};

let lifecycle: BackendLifecycle | null = null;
let mainWindow: BrowserWindow | null = null;
let bridge: IpcBridgeHandle | null = null;
let tray: Tray | null = null;
let settingsStore: SettingsStoreInstance | null = null;
let archiveDb: SpiraMemoryDatabase | null = null;
let runtimeConfigStore: RuntimeConfigStoreInstance | null = null;
let upgradeOrchestrator: UpgradeOrchestrator | null = null;
let uiControlBridge: SpiraUiControlBridge | null = null;
let isQuitting = false;
let shutdownPromise: Promise<void> | null = null;
let currentConnectionStatus: ConnectionStatus = "connecting";
let rendererReadySequence = 0;
const rendererReadyWaiters = new Set<{
  afterSequence: number;
  timer: NodeJS.Timeout;
  resolve: () => void;
  reject: (error: Error) => void;
}>();

const clearRendererReadyWaiter = (waiter: {
  afterSequence: number;
  timer: NodeJS.Timeout;
  resolve: () => void;
  reject: (error: Error) => void;
}) => {
  clearTimeout(waiter.timer);
  rendererReadyWaiters.delete(waiter);
};

const notifyRendererReady = () => {
  rendererReadySequence += 1;
  for (const waiter of Array.from(rendererReadyWaiters)) {
    if (rendererReadySequence > waiter.afterSequence) {
      clearRendererReadyWaiter(waiter);
      waiter.resolve();
    }
  }
};

const rejectRendererReadyWaiters = (error: Error) => {
  for (const waiter of Array.from(rendererReadyWaiters)) {
    clearRendererReadyWaiter(waiter);
    waiter.reject(error);
  }
};

const waitForNextRendererReady = (afterSequence: number, timeoutMs: number): Promise<void> => {
  if (rendererReadySequence > afterSequence) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const waiter = {
      afterSequence,
      timer: setTimeout(() => {
        clearRendererReadyWaiter(waiter);
        reject(new Error("Timed out waiting for Spira to finish loading the refreshed UI."));
      }, timeoutMs),
      resolve,
      reject,
    };
    rendererReadyWaiters.add(waiter);
  });
};

const isMemoryDbAbiMismatch = (error: unknown): error is Error =>
  error instanceof Error &&
  error.message.includes("better_sqlite3.node") &&
  error.message.includes("compiled against a different Node.js version") &&
  error.message.includes("NODE_MODULE_VERSION");

const usesSplitRuntimeDevBackend = (): boolean => {
  if (app.isPackaged) {
    return false;
  }

  const backendExecPath = process.env.SPIRA_BACKEND_EXEC_PATH?.trim();
  if (!backendExecPath) {
    return false;
  }

  return backendExecPath.toLowerCase() !== process.execPath.toLowerCase();
};

const openArchiveDatabase = async (databasePath: string): Promise<SpiraMemoryDatabase | null> => {
  if (usesSplitRuntimeDevBackend()) {
    return null;
  }

  try {
    const { SpiraMemoryDatabase } = await import("@spira/memory-db");
    return SpiraMemoryDatabase.open(databasePath);
  } catch (error) {
    if (isMemoryDbAbiMismatch(error)) {
      console.error(
        "Conversation archive is unavailable in Electron because better-sqlite3 was built for a different runtime ABI. Rebuild the native module for Electron to restore archive access.",
        error,
      );
      return null;
    }

    throw error;
  }
};

const loadEnvFromFile = () => {
  try {
    process.loadEnvFile(path.join(repoRoot, ".env"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
};

const normalizeThreshold = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(1, Math.max(0, value));
};

const RUNTIME_CONFIG_METADATA: Record<RuntimeConfigKey, { envKey: string; label: string; description: string }> = {
  githubToken: {
    envKey: "GITHUB_TOKEN",
    label: "GitHub token",
    description: "Used for GitHub-authenticated Copilot flows when available.",
  },
  missionGitHubToken: {
    envKey: "MISSION_GITHUB_TOKEN",
    label: "Mission GitHub PAT",
    description: "Used for mission commits, publish, push, and deriving the GitHub author identity.",
  },
  elevenLabsApiKey: {
    envKey: "ELEVENLABS_API_KEY",
    label: "ElevenLabs API key",
    description: "Required for ElevenLabs cloud speech synthesis.",
  },
  picovoiceAccessKey: {
    envKey: "PICOVOICE_ACCESS_KEY",
    label: "Picovoice access key",
    description: "Required when Porcupine wake-word detection is selected.",
  },
  nexusModsApiKey: {
    envKey: "NEXUS_MODS_API_KEY",
    label: "Nexus Mods API key",
    description: "Enables authenticated Nexus Mods downloads in the MCP toolset.",
  },
  youTrackBaseUrl: {
    envKey: "YOUTRACK_BASE_URL",
    label: "YouTrack base URL",
    description: "Base URL for your YouTrack instance, such as https://example.youtrack.cloud.",
  },
  youTrackToken: {
    envKey: "YOUTRACK_TOKEN",
    label: "YouTrack permanent token",
    description: "Used for native YouTrack authentication and assigned-ticket intake.",
  },
};

const normalizeRuntimeConfigValue = (value: unknown): string | null | undefined => {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const encryptRuntimeConfigValue = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure storage is unavailable on this system.");
  }

  return safeStorage.encryptString(value).toString("base64");
};

const decryptRuntimeConfigValue = (value: unknown): string | null | undefined => {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim() === "" || !safeStorage.isEncryptionAvailable()) {
    return undefined;
  }

  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  } catch {
    return undefined;
  }
};

const getStoredRuntimeConfig = (): RuntimeConfigStoreData => {
  const encrypted = runtimeConfigStore?.store ?? {};
  const normalized: RuntimeConfigStoreData = {};
  for (const key of RUNTIME_CONFIG_KEYS) {
    const decrypted = decryptRuntimeConfigValue(encrypted[key]);
    if (decrypted !== undefined) {
      normalized[key] = decrypted;
    }
  }

  return normalized;
};

const getEffectiveRuntimeValue = (key: RuntimeConfigKey): string | undefined => {
  const storedValue = getStoredRuntimeConfig()[key];
  if (storedValue === null) {
    return undefined;
  }

  if (typeof storedValue === "string" && storedValue.trim()) {
    return storedValue.trim();
  }

  const envValue = process.env[RUNTIME_CONFIG_METADATA[key].envKey];
  return typeof envValue === "string" && envValue.trim() ? envValue.trim() : undefined;
};

const getBackendEnvOverrides = (): Record<string, string> => {
  const overrides: Record<string, string> = {
    [SPIRA_MEMORY_DB_PATH_ENV]: getSpiraMemoryDbPath(app.getPath("userData")),
  };
  for (const key of RUNTIME_CONFIG_KEYS) {
    const envKey = RUNTIME_CONFIG_METADATA[key].envKey;
    const storedValue = getStoredRuntimeConfig()[key];
    if (storedValue === null) {
      overrides[envKey] = "";
      continue;
    }

    if (typeof storedValue === "string" && storedValue.trim()) {
      overrides[envKey] = storedValue.trim();
    }
  }

  return overrides;
};

const getRuntimeConfigSummary = (): RuntimeConfigSummary =>
  Object.fromEntries(
    RUNTIME_CONFIG_KEYS.map((key) => {
      const storedValue = getStoredRuntimeConfig()[key];
      const envValue = process.env[RUNTIME_CONFIG_METADATA[key].envKey];
      const source =
        storedValue === null
          ? "cleared"
          : typeof storedValue === "string" && storedValue.trim()
            ? "stored"
            : typeof envValue === "string" && envValue.trim()
              ? "environment"
              : "unset";

      return [
        key,
        {
          key,
          label: RUNTIME_CONFIG_METADATA[key].label,
          description: RUNTIME_CONFIG_METADATA[key].description,
          configured: source === "stored" || source === "environment",
          source,
          secret: true,
        },
      ];
    }),
  ) as RuntimeConfigSummary;

const getDefaultSettings = (): UserSettings => ({
  ...(() => {
    const threshold = normalizeThreshold(Number(process.env.OPENWAKEWORD_THRESHOLD ?? "0.5"));
    return {
      openWakeWordThreshold: threshold ?? 0.5,
    };
  })(),
  voiceEnabled: true,
  wakeWordEnabled: true,
  youTrackEnabled: false,
  ttsProvider: getEffectiveRuntimeValue("elevenLabsApiKey") ? "elevenlabs" : "kokoro",
  whisperModel: "base.en",
  wakeWordProvider: normalizeWakeWordProvider(process.env.WAKE_WORD_PROVIDER),
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID?.trim() ?? "",
  theme: "ffx",
});

const normalizeStoredSettings = (settings: SettingsStoreData): SettingsStoreData => {
  return {
    ...settings,
    ...(typeof settings.ttsProvider === "string" ? { ttsProvider: normalizeTtsProvider(settings.ttsProvider) } : {}),
    ...(typeof settings.wakeWordProvider === "string"
      ? { wakeWordProvider: normalizeWakeWordProvider(settings.wakeWordProvider) }
      : {}),
    ...(normalizeThreshold(settings.openWakeWordThreshold) !== undefined
      ? { openWakeWordThreshold: normalizeThreshold(settings.openWakeWordThreshold) }
      : {}),
  };
};

const useExternalBackend = (): boolean => process.env.SPIRA_EXTERNAL_BACKEND === "1";
const getRendererBuildId = (): string =>
  process.env.SPIRA_BUILD_ID?.trim() || (app.isPackaged ? app.getVersion() : "dev");

const emitConnectionStatus = (status: ConnectionStatus) => {
  currentConnectionStatus = status;
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("spira:connection-status", status);
};

const emitUpgradeProposal = (proposal: UpgradeProposal) => {
  const decision = upgradeOrchestrator?.handleProposal(proposal) ?? {
    accepted: false,
    reason: "Upgrade orchestrator is unavailable.",
  };
  lifecycle?.send({
    type: "upgrade:proposal-response",
    proposalId: proposal.proposalId,
    accepted: decision.accepted,
    reason: decision.reason,
  });
};

type WindowControlAction = "minimize" | "maximize" | "close";

const handleWindowControl = (event: IpcMainEvent, action: WindowControlAction) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender);
  if (!targetWindow) {
    return;
  }

  switch (action) {
    case "minimize":
      targetWindow.minimize();
      return;
    case "maximize":
      if (targetWindow.isMaximized()) {
        targetWindow.unmaximize();
      } else {
        targetWindow.maximize();
      }
      return;
    case "close":
      targetWindow.close();
      return;
    default:
      return;
  }
};

const ensureWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
    mainWindow.on("close", (event) => {
      if (!isQuitting) {
        event.preventDefault();
        mainWindow?.hide();
      }
    });
    mainWindow.on("closed", () => {
      bridge?.dispose();
      bridge = null;
      mainWindow = null;
    });
    tray = createTray(mainWindow, app);
    setupAutoUpdater(mainWindow);
  }

  if (!bridge) {
    bridge = setupIpcBridge(mainWindow, BACKEND_PORT, {
      onBackendHello: () => {
        upgradeOrchestrator?.reemitPendingProposal();
      },
      onConnectionStatusChange: (status) => {
        currentConnectionStatus = status;
      },
      onRendererReady: () => {
        notifyRendererReady();
      },
      rendererBuildId: getRendererBuildId(),
      isUpgrading: () => upgradeOrchestrator?.isRestartInProgress() ?? false,
    });
  }
};

const handleRendererFatal = (_event: IpcMainEvent, payload: RendererFatalPayload) => {
  const summary = `[Spira:renderer:${payload.phase}] ${payload.title} - ${payload.message}`;
  if (payload.details) {
    console.error(summary, payload.details);
  } else {
    console.error(summary);
  }

  rejectRendererReadyWaiters(new Error(payload.message));
};

const handleGetSettings = () => ({
  ...getDefaultSettings(),
  ...normalizeStoredSettings(settingsStore?.store ?? {}),
});
const handleGetConnectionStatus = () => currentConnectionStatus;
const getYouTrackEnabledSetting = (): boolean =>
  Boolean(normalizeStoredSettings(settingsStore?.store ?? {}).youTrackEnabled);
const buildLocalYouTrackStatus = (enabled = getYouTrackEnabledSetting()): YouTrackStatusSummary => {
  const baseUrl = getEffectiveRuntimeValue("youTrackBaseUrl") ?? null;
  const configured = Boolean(baseUrl && getEffectiveRuntimeValue("youTrackToken"));
  if (!enabled) {
    return {
      enabled,
      configured,
      state: "disabled",
      baseUrl,
      account: null,
      stateMapping: structuredClone(DEFAULT_YOUTRACK_STATE_MAPPING),
      availableStates: [],
      message: configured
        ? "YouTrack integration is configured but currently disabled."
        : "Enable YouTrack after adding an instance URL and permanent token.",
    };
  }

  if (!configured) {
    return {
      enabled,
      configured,
      state: "missing-config",
      baseUrl,
      account: null,
      stateMapping: structuredClone(DEFAULT_YOUTRACK_STATE_MAPPING),
      availableStates: [],
      message: "Add a YouTrack base URL and permanent token to connect Spira natively.",
    };
  }

  return {
    enabled,
    configured,
    state: "error",
    baseUrl,
    account: null,
    stateMapping: structuredClone(DEFAULT_YOUTRACK_STATE_MAPPING),
    availableStates: [],
    message: "The embedded backend is unavailable, so YouTrack status could not be refreshed.",
  };
};
const handleGetYouTrackStatus = async (_event: IpcMainInvokeEvent): Promise<YouTrackStatusSummary> =>
  (await bridge?.getYouTrackStatus(getYouTrackEnabledSetting())) ?? buildLocalYouTrackStatus();
const handleListYouTrackTickets = async (
  _event: IpcMainInvokeEvent,
  input?: { limit?: number },
): Promise<YouTrackTicketSummary[]> =>
  (await bridge?.listYouTrackTickets(getYouTrackEnabledSetting(), input?.limit)) ?? [];
const handleSearchYouTrackProjects = async (
  _event: IpcMainInvokeEvent,
  input?: { query?: string; limit?: number },
): Promise<YouTrackProjectSummary[]> =>
  (await bridge?.searchYouTrackProjects(getYouTrackEnabledSetting(), input?.query ?? "", input?.limit)) ?? [];
const handleSetYouTrackStateMapping = async (
  _event: IpcMainInvokeEvent,
  input?: { mapping?: YouTrackStateMapping },
): Promise<YouTrackStatusSummary> => {
  if (!input?.mapping) {
    throw new Error("YouTrack state mapping is required.");
  }

  return (
    (await bridge?.setYouTrackStateMapping(getYouTrackEnabledSetting(), input.mapping)) ?? buildLocalYouTrackStatus()
  );
};
const buildLocalProjectRepoMappingsSnapshot = (): ProjectRepoMappingsSnapshot => ({
  workspaceRoot: null,
  repos: [],
  mappings: [],
});
const buildLocalTicketRunSnapshot = (): TicketRunSnapshot => ({
  runs: [],
});
const buildLocalMissionServiceSnapshot = (runId: string): MissionServiceSnapshot => ({
  runId,
  profiles: [],
  processes: [],
  updatedAt: Date.now(),
});
const handleGetProjectRepoMappings = async (_event: IpcMainInvokeEvent): Promise<ProjectRepoMappingsSnapshot> =>
  (await bridge?.getProjectRepoMappings()) ?? buildLocalProjectRepoMappingsSnapshot();
const handleSetProjectWorkspaceRoot = async (
  _event: IpcMainInvokeEvent,
  input?: { workspaceRoot?: string | null },
): Promise<ProjectRepoMappingsSnapshot> =>
  (await bridge?.setProjectWorkspaceRoot(input?.workspaceRoot ?? null)) ?? buildLocalProjectRepoMappingsSnapshot();
const handleSetProjectRepoMapping = async (
  _event: IpcMainInvokeEvent,
  input?: { projectKey?: string; repoRelativePaths?: string[] },
): Promise<ProjectRepoMappingsSnapshot> => {
  if (!input?.projectKey) {
    throw new Error("Project key is required.");
  }

  return (
    (await bridge?.setProjectRepoMapping(input.projectKey, input.repoRelativePaths ?? [])) ??
    buildLocalProjectRepoMappingsSnapshot()
  );
};
const handleGetTicketRuns = async (_event: IpcMainInvokeEvent): Promise<TicketRunSnapshot> =>
  (await bridge?.getTicketRuns()) ?? buildLocalTicketRunSnapshot();
const handleGetTicketRunServices = async (
  _event: IpcMainInvokeEvent,
  input?: { runId?: string },
): Promise<MissionServiceSnapshot> => {
  if (!input?.runId) {
    throw new Error("Run id is required.");
  }

  return (await bridge?.getTicketRunServices(input.runId)) ?? buildLocalMissionServiceSnapshot(input.runId);
};
const handleStartTicketRunService = async (
  _event: IpcMainInvokeEvent,
  input?: { runId?: string; profileId?: string },
): Promise<MissionServiceSnapshot> => {
  if (!input?.runId) {
    throw new Error("Run id is required.");
  }
  if (!input.profileId) {
    throw new Error("Profile id is required.");
  }
  if (!bridge) {
    throw new Error("Backend bridge is unavailable.");
  }

  return bridge.startTicketRunService(input.runId, input.profileId);
};
const handleStopTicketRunService = async (
  _event: IpcMainInvokeEvent,
  input?: { runId?: string; serviceId?: string },
): Promise<MissionServiceSnapshot> => {
  if (!input?.runId) {
    throw new Error("Run id is required.");
  }
  if (!input.serviceId) {
    throw new Error("Service id is required.");
  }
  if (!bridge) {
    throw new Error("Backend bridge is unavailable.");
  }

  return bridge.stopTicketRunService(input.runId, input.serviceId);
};
const handleStartTicketRun = async (
  _event: IpcMainInvokeEvent,
  input?: { ticket?: { ticketId?: string; ticketSummary?: string; ticketUrl?: string; projectKey?: string } },
): Promise<StartTicketRunResult> => {
  const ticket = input?.ticket;
  if (!ticket?.ticketId || !ticket.ticketSummary || !ticket.ticketUrl || !ticket.projectKey) {
    throw new Error("Ticket id, summary, URL, and project key are required.");
  }

  if (!bridge) {
    throw new Error("Backend bridge is unavailable.");
  }

  return bridge.startTicketRun({
    ticketId: ticket.ticketId,
    ticketSummary: ticket.ticketSummary,
    ticketUrl: ticket.ticketUrl,
    projectKey: ticket.projectKey,
  });
};
const handleRetryTicketRunSync = async (
  _event: IpcMainInvokeEvent,
  input?: { runId?: string },
): Promise<RetryTicketRunSyncResult> => {
  if (!input?.runId) {
    throw new Error("Run id is required.");
  }

  if (!bridge) {
    throw new Error("Backend bridge is unavailable.");
  }

  return bridge.retryTicketRunSync(input.runId);
};
const handleStartTicketRunWork = async (
  _event: IpcMainInvokeEvent,
  input?: { runId?: string },
): Promise<StartTicketRunWorkResult> => {
  if (!input?.runId) {
    throw new Error("Run id is required.");
  }

  if (!bridge) {
    throw new Error("Backend bridge is unavailable.");
  }

  return bridge.startTicketRunWork(input.runId);
};
const handleContinueTicketRunWork = async (
  _event: IpcMainInvokeEvent,
  input?: { runId?: string; prompt?: string },
): Promise<ContinueTicketRunWorkResult> => {
  if (!input?.runId) {
    throw new Error("Run id is required.");
  }

  if (!bridge) {
    throw new Error("Backend bridge is unavailable.");
  }

  return bridge.continueTicketRunWork(input.runId, input.prompt);
};
const handleCancelTicketRunWork = async (
  _event: IpcMainInvokeEvent,
  input?: { runId?: string },
): Promise<CancelTicketRunWorkResult> => {
  if (!input?.runId) {
    throw new Error("Run id is required.");
  }

  if (!bridge) {
    throw new Error("Backend bridge is unavailable.");
  }

  return bridge.cancelTicketRunWork(input.runId);
};
const handleCompleteTicketRun = async (
  _event: IpcMainInvokeEvent,
  input?: { runId?: string },
): Promise<CompleteTicketRunResult> => {
  if (!input?.runId) {
    throw new Error("Run id is required.");
  }

  if (!bridge) {
    throw new Error("Backend bridge is unavailable.");
  }

  return bridge.completeTicketRun(input.runId);
};
const handleGetTicketRunGitState = async (
  _event: IpcMainInvokeEvent,
  input?: { runId?: string; repoRelativePath?: string },
): Promise<TicketRunGitStateResult> => {
  if (!input?.runId) {
    throw new Error("Run id is required.");
  }

  if (!bridge) {
    throw new Error("Backend bridge is unavailable.");
  }

  return bridge.getTicketRunGitState(input.runId, input.repoRelativePath);
};
const handleGenerateTicketRunCommitDraft = async (
  _event: IpcMainInvokeEvent,
  input?: { runId?: string; repoRelativePath?: string },
): Promise<GenerateTicketRunCommitDraftResult> => {
  if (!input?.runId) {
    throw new Error("Run id is required.");
  }

  if (!bridge) {
    throw new Error("Backend bridge is unavailable.");
  }

  return bridge.generateTicketRunCommitDraft(input.runId, input.repoRelativePath);
};
const handleSetTicketRunCommitDraft = async (
  _event: IpcMainInvokeEvent,
  input?: { runId?: string; message?: string; repoRelativePath?: string },
): Promise<SetTicketRunCommitDraftResult> => {
  if (!input?.runId) {
    throw new Error("Run id is required.");
  }
  if (typeof input.message !== "string") {
    throw new Error("Commit message draft is required.");
  }

  if (!bridge) {
    throw new Error("Backend bridge is unavailable.");
  }

  return bridge.setTicketRunCommitDraft(input.runId, input.message, input.repoRelativePath);
};
const handleCommitTicketRun = async (
  _event: IpcMainInvokeEvent,
  input?: { runId?: string; message?: string; repoRelativePath?: string },
): Promise<CommitTicketRunResult> => {
  if (!input?.runId) {
    throw new Error("Run id is required.");
  }
  if (typeof input.message !== "string") {
    throw new Error("Commit message is required.");
  }

  if (!bridge) {
    throw new Error("Backend bridge is unavailable.");
  }

  return bridge.commitTicketRun(input.runId, input.message, input.repoRelativePath);
};
const handlePublishTicketRun = async (
  _event: IpcMainInvokeEvent,
  input?: { runId?: string; repoRelativePath?: string },
): Promise<SyncTicketRunRemoteResult> => {
  if (!input?.runId) {
    throw new Error("Run id is required.");
  }

  if (!bridge) {
    throw new Error("Backend bridge is unavailable.");
  }

  return bridge.publishTicketRun(input.runId, input.repoRelativePath);
};
const handlePushTicketRun = async (
  _event: IpcMainInvokeEvent,
  input?: { runId?: string; repoRelativePath?: string },
): Promise<SyncTicketRunRemoteResult> => {
  if (!input?.runId) {
    throw new Error("Run id is required.");
  }

  if (!bridge) {
    throw new Error("Backend bridge is unavailable.");
  }

  return bridge.pushTicketRun(input.runId, input.repoRelativePath);
};
const handleCreateTicketRunPullRequest = async (
  _event: IpcMainInvokeEvent,
  input?: { runId?: string; repoRelativePath?: string },
): Promise<CreateTicketRunPullRequestResult> => {
  if (!input?.runId) {
    throw new Error("Run id is required.");
  }

  if (!bridge) {
    throw new Error("Backend bridge is unavailable.");
  }

  return bridge.createTicketRunPullRequest(input.runId, input.repoRelativePath);
};
const handlePickDirectory = async (_event: IpcMainInvokeEvent, input?: { title?: string }): Promise<string | null> => {
  const options: OpenDialogOptions = {
    title: input?.title ?? "Select workspace root",
    properties: ["openDirectory"],
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
};
const handleOpenExternal = async (_event: IpcMainInvokeEvent, input?: { url?: string }): Promise<void> => {
  if (!input?.url?.trim()) {
    throw new Error("URL is required.");
  }

  await shell.openExternal(input.url);
};

const mapConversationMessage = (message: ArchivedConversationMessage): ConversationMessage | null => {
  if (message.role !== "user" && message.role !== "assistant") {
    return null;
  }

  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    wasAborted: message.wasAborted,
    autoSpeak: message.autoSpeak,
    toolCalls: message.toolCalls.map((toolCall) => ({
      callId: toolCall.callId ?? undefined,
      name: toolCall.name,
      args: toolCall.args,
      result: toolCall.result,
      status: toolCall.status ?? undefined,
      details: toolCall.details ?? undefined,
    })),
  };
};

const mapConversationSummary = (summary: ArchivedConversationSummary): StoredConversationSummary => ({
  id: summary.id,
  title: summary.title,
  createdAt: summary.createdAt,
  updatedAt: summary.updatedAt,
  lastMessageAt: summary.lastMessageAt,
  lastViewedAt: summary.lastViewedAt,
  messageCount: summary.messageCount,
});

const mapConversationRecord = (conversation: ArchivedConversation | null): StoredConversation | null => {
  if (!conversation) {
    return null;
  }

  return {
    ...mapConversationSummary(conversation),
    messages: conversation.messages.flatMap((message) => {
      const mapped = mapConversationMessage(message);
      return mapped ? [mapped] : [];
    }),
  };
};
const handleGetRecentConversation = async (_event: IpcMainInvokeEvent): Promise<StoredConversation | null> => {
  if (archiveDb) {
    return mapConversationRecord(archiveDb.getMostRecentConversation() ?? null);
  }

  return (await bridge?.getRecentConversation()) ?? null;
};
const handleListConversations = (
  _event: IpcMainInvokeEvent,
  input?: { limit?: number; offset?: number },
): Promise<StoredConversationSummary[]> | StoredConversationSummary[] => {
  const limit = typeof input?.limit === "number" ? input.limit : 30;
  const offset = typeof input?.offset === "number" ? input.offset : 0;

  if (archiveDb) {
    return archiveDb.listConversations(limit, offset).map(mapConversationSummary);
  }

  return bridge?.listConversations(limit, offset) ?? [];
};
const handleGetConversation = (
  _event: IpcMainInvokeEvent,
  input?: { conversationId?: string },
): Promise<StoredConversation | null> | StoredConversation | null => {
  if (!input?.conversationId) {
    return null;
  }

  if (archiveDb) {
    return mapConversationRecord(archiveDb.getConversation(input.conversationId) ?? null);
  }

  return bridge?.getConversation(input.conversationId) ?? null;
};
const handleSearchConversations = (
  _event: IpcMainInvokeEvent,
  input?: { query?: string; limit?: number },
): Promise<ConversationSearchMatch[]> | ConversationSearchMatch[] => {
  if (!input?.query) {
    return [];
  }

  const limit = typeof input.limit === "number" ? input.limit : 20;

  if (archiveDb) {
    return archiveDb.searchConversationMessages(input.query, limit);
  }

  return bridge?.searchConversations(input.query, limit) ?? [];
};
const handleMarkConversationViewed = async (_event: IpcMainInvokeEvent, input?: { conversationId?: string }) => {
  if (!input?.conversationId) {
    return;
  }

  if (archiveDb) {
    archiveDb.markConversationViewed(input.conversationId);
    return;
  }

  await bridge?.markConversationViewed(input.conversationId);
};
const handleArchiveConversation = async (
  _event: IpcMainInvokeEvent,
  input?: { conversationId?: string },
): Promise<boolean> => {
  if (!input?.conversationId) {
    return false;
  }

  if (archiveDb) {
    return archiveDb.archiveConversation(input.conversationId);
  }

  return (await bridge?.archiveConversation(input.conversationId)) ?? false;
};
const handleGetRuntimeConfig = (): RuntimeConfigSummary => getRuntimeConfigSummary();
const handleSetRuntimeConfig = async (
  _event: IpcMainInvokeEvent,
  update: RuntimeConfigUpdate,
): Promise<RuntimeConfigApplyResult> => {
  if (!runtimeConfigStore || !update || typeof update !== "object" || Array.isArray(update)) {
    return {
      summary: getRuntimeConfigSummary(),
      appliedToBackend: false,
    };
  }

  const sanitised: RuntimeConfigStoreData = {};
  for (const key of Object.keys(update) as RuntimeConfigKey[]) {
    if (!RUNTIME_CONFIG_KEYS.includes(key)) {
      continue;
    }

    const normalizedValue = normalizeRuntimeConfigValue(update[key]);
    if (normalizedValue !== undefined) {
      sanitised[key] = normalizedValue;
    }
  }

  if (Object.keys(sanitised).length === 0) {
    return {
      summary: getRuntimeConfigSummary(),
      appliedToBackend: false,
    };
  }

  const encryptedUpdate = Object.fromEntries(
    Object.entries(sanitised).map(([key, value]) => [key, encryptRuntimeConfigValue(value ?? null)]),
  ) as EncryptedRuntimeConfigStoreData;
  runtimeConfigStore.set(encryptedUpdate);

  if (lifecycle) {
    lifecycle.setEnvOverrides(getBackendEnvOverrides());
  }

  if (useExternalBackend() || !lifecycle || upgradeOrchestrator?.isRestartInProgress()) {
    return {
      summary: getRuntimeConfigSummary(),
      appliedToBackend: false,
    };
  }

  await lifecycle.restart();
  return {
    summary: getRuntimeConfigSummary(),
    appliedToBackend: true,
  };
};
const handleUpgradeResponse = async (
  _event: IpcMainInvokeEvent,
  payload: { proposalId?: string; approved?: boolean },
) => {
  if (typeof payload?.proposalId !== "string" || typeof payload?.approved !== "boolean") {
    return;
  }

  await upgradeOrchestrator?.respondToProposal(payload.proposalId, payload.approved);
};

const VALID_SETTINGS_KEYS: ReadonlySet<keyof UserSettings> = new Set([
  "voiceEnabled",
  "wakeWordEnabled",
  "youTrackEnabled",
  "ttsProvider",
  "whisperModel",
  "wakeWordProvider",
  "openWakeWordThreshold",
  "elevenLabsVoiceId",
  "theme",
]);

const handleSetSettings = (_event: IpcMainInvokeEvent, data: SettingsStoreData) => {
  if (!settingsStore || !data || typeof data !== "object" || Array.isArray(data)) {
    return;
  }

  const sanitised: SettingsStoreData = {};
  for (const key of Object.keys(data)) {
    if (VALID_SETTINGS_KEYS.has(key as keyof UserSettings)) {
      const value = (data as Record<string, unknown>)[key];
      const normalizedValue =
        key === "ttsProvider" && typeof value === "string"
          ? normalizeTtsProvider(value)
          : key === "wakeWordProvider" && typeof value === "string"
            ? normalizeWakeWordProvider(value)
            : key === "openWakeWordThreshold"
              ? normalizeThreshold(value)
              : value;
      if (normalizedValue !== undefined) {
        (sanitised as Record<string, unknown>)[key] = normalizedValue;
      }
    }
  }
  if (Object.keys(sanitised).length > 0) {
    settingsStore.set(sanitised);
  }
};

const waitForExternalBackend = async (port: number): Promise<void> => {
  const deadline = Date.now() + EXTERNAL_BACKEND_READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await pingBackend(port)) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }

  throw new Error(`Timed out waiting for external backend on port ${port}`);
};

const pingBackend = (port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(false);
      }
    }, 3_000);

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeAllListeners();
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    };

    socket.once("open", () => {
      socket.send(JSON.stringify({ type: "ping" }));
    });

    socket.on("message", (raw) => {
      if (settled) {
        return;
      }

      let message: { type?: string };
      try {
        message = JSON.parse(raw.toString()) as { type?: string };
      } catch {
        settled = true;
        cleanup();
        resolve(false);
        return;
      }

      if (message.type !== "pong") {
        return;
      }

      settled = true;
      cleanup();
      resolve(true);
    });

    socket.once("error", () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(false);
    });

    socket.once("close", () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(false);
    });
  });
};

const shutdownApp = async (): Promise<void> => {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    await lifecycle?.stop();
    await uiControlBridge?.stop();
    uiControlBridge = null;
    bridge?.dispose();
    bridge = null;
    tray?.destroy();
    tray = null;
    ipcMain.off(WINDOW_CONTROL_CHANNEL, handleWindowControl);
    ipcMain.removeHandler(CONNECTION_STATUS_GET_CHANNEL);
    ipcMain.removeHandler(SETTINGS_GET_CHANNEL);
    ipcMain.removeHandler(SETTINGS_SET_CHANNEL);
    ipcMain.removeHandler(RECENT_CONVERSATION_GET_CHANNEL);
    ipcMain.removeHandler(CONVERSATIONS_LIST_CHANNEL);
    ipcMain.removeHandler(CONVERSATION_GET_CHANNEL);
    ipcMain.removeHandler(CONVERSATION_SEARCH_CHANNEL);
    ipcMain.removeHandler(CONVERSATION_MARK_VIEWED_CHANNEL);
    ipcMain.removeHandler(CONVERSATION_ARCHIVE_CHANNEL);
    ipcMain.removeHandler(YOUTRACK_STATUS_GET_CHANNEL);
    ipcMain.removeHandler(YOUTRACK_TICKETS_LIST_CHANNEL);
    ipcMain.removeHandler(YOUTRACK_PROJECTS_SEARCH_CHANNEL);
    ipcMain.removeHandler(YOUTRACK_STATE_MAPPING_SET_CHANNEL);
    ipcMain.removeHandler(PROJECT_REPO_MAPPINGS_GET_CHANNEL);
    ipcMain.removeHandler(PROJECT_WORKSPACE_ROOT_SET_CHANNEL);
    ipcMain.removeHandler(PROJECT_REPO_MAPPING_SET_CHANNEL);
    ipcMain.removeHandler(DIRECTORY_PICK_CHANNEL);
    ipcMain.removeHandler(RUNTIME_CONFIG_GET_CHANNEL);
    ipcMain.removeHandler(RUNTIME_CONFIG_SET_CHANNEL);
    ipcMain.removeHandler(UPGRADE_RESPONSE_CHANNEL);
    ipcMain.off(RENDERER_FATAL_CHANNEL, handleRendererFatal);
    rejectRendererReadyWaiters(new Error("Renderer readiness wait cancelled during shutdown."));
    archiveDb?.close();
    archiveDb = null;
  })().finally(() => {
    shutdownPromise = null;
  });

  await shutdownPromise;
};

ipcMain.on(WINDOW_CONTROL_CHANNEL, handleWindowControl);

void app.whenReady().then(async () => {
  loadEnvFromFile();
  settingsStore = new ElectronStore<SettingsStoreData>({ name: "spira-settings" }) as SettingsStoreInstance;
  archiveDb = await openArchiveDatabase(getSpiraMemoryDbPath(app.getPath("userData")));
  runtimeConfigStore = new ElectronStore<RuntimeConfigStoreData>({
    name: "spira-runtime-config",
  }) as RuntimeConfigStoreInstance;
  uiControlBridge = new SpiraUiControlBridge(() => mainWindow, console);
  await uiControlBridge.start();
  ipcMain.handle(CONNECTION_STATUS_GET_CHANNEL, handleGetConnectionStatus);
  ipcMain.handle(SETTINGS_GET_CHANNEL, handleGetSettings);
  ipcMain.handle(SETTINGS_SET_CHANNEL, handleSetSettings);
  ipcMain.handle(RECENT_CONVERSATION_GET_CHANNEL, handleGetRecentConversation);
  ipcMain.handle(CONVERSATIONS_LIST_CHANNEL, handleListConversations);
  ipcMain.handle(CONVERSATION_GET_CHANNEL, handleGetConversation);
  ipcMain.handle(CONVERSATION_SEARCH_CHANNEL, handleSearchConversations);
  ipcMain.handle(CONVERSATION_MARK_VIEWED_CHANNEL, handleMarkConversationViewed);
  ipcMain.handle(CONVERSATION_ARCHIVE_CHANNEL, handleArchiveConversation);
  ipcMain.handle(YOUTRACK_STATUS_GET_CHANNEL, handleGetYouTrackStatus);
  ipcMain.handle(YOUTRACK_TICKETS_LIST_CHANNEL, handleListYouTrackTickets);
  ipcMain.handle(YOUTRACK_PROJECTS_SEARCH_CHANNEL, handleSearchYouTrackProjects);
  ipcMain.handle(YOUTRACK_STATE_MAPPING_SET_CHANNEL, handleSetYouTrackStateMapping);
  ipcMain.handle(PROJECT_REPO_MAPPINGS_GET_CHANNEL, handleGetProjectRepoMappings);
  ipcMain.handle(PROJECT_WORKSPACE_ROOT_SET_CHANNEL, handleSetProjectWorkspaceRoot);
  ipcMain.handle(PROJECT_REPO_MAPPING_SET_CHANNEL, handleSetProjectRepoMapping);
  ipcMain.handle(TICKET_RUNS_GET_CHANNEL, handleGetTicketRuns);
  ipcMain.handle(TICKET_RUN_SERVICES_GET_CHANNEL, handleGetTicketRunServices);
  ipcMain.handle(TICKET_RUN_SERVICE_START_CHANNEL, handleStartTicketRunService);
  ipcMain.handle(TICKET_RUN_SERVICE_STOP_CHANNEL, handleStopTicketRunService);
  ipcMain.handle(TICKET_RUN_START_CHANNEL, handleStartTicketRun);
  ipcMain.handle(TICKET_RUN_SYNC_CHANNEL, handleRetryTicketRunSync);
  ipcMain.handle(TICKET_RUN_WORK_START_CHANNEL, handleStartTicketRunWork);
  ipcMain.handle(TICKET_RUN_WORK_CONTINUE_CHANNEL, handleContinueTicketRunWork);
  ipcMain.handle(TICKET_RUN_WORK_CANCEL_CHANNEL, handleCancelTicketRunWork);
  ipcMain.handle(TICKET_RUN_COMPLETE_CHANNEL, handleCompleteTicketRun);
  ipcMain.handle(TICKET_RUN_GIT_STATE_CHANNEL, handleGetTicketRunGitState);
  ipcMain.handle(TICKET_RUN_COMMIT_DRAFT_GENERATE_CHANNEL, handleGenerateTicketRunCommitDraft);
  ipcMain.handle(TICKET_RUN_COMMIT_DRAFT_SET_CHANNEL, handleSetTicketRunCommitDraft);
  ipcMain.handle(TICKET_RUN_COMMIT_CHANNEL, handleCommitTicketRun);
  ipcMain.handle(TICKET_RUN_PUBLISH_CHANNEL, handlePublishTicketRun);
  ipcMain.handle(TICKET_RUN_PUSH_CHANNEL, handlePushTicketRun);
  ipcMain.handle(TICKET_RUN_PULL_REQUEST_CREATE_CHANNEL, handleCreateTicketRunPullRequest);
  ipcMain.handle(DIRECTORY_PICK_CHANNEL, handlePickDirectory);
  ipcMain.handle(OPEN_EXTERNAL_CHANNEL, handleOpenExternal);
  ipcMain.handle(RUNTIME_CONFIG_GET_CHANNEL, handleGetRuntimeConfig);
  ipcMain.handle(RUNTIME_CONFIG_SET_CHANNEL, handleSetRuntimeConfig);
  ipcMain.handle(UPGRADE_RESPONSE_CHANNEL, handleUpgradeResponse);
  ipcMain.on(RENDERER_FATAL_CHANNEL, handleRendererFatal);

  if (useExternalBackend()) {
    void waitForExternalBackend(BACKEND_PORT)
      .then(() => {
        ensureWindow();
      })
      .catch((error: unknown) => {
        currentConnectionStatus = "disconnected";
        console.error("External backend failed to start", error);
      });
    return;
  }

  lifecycle = new BackendLifecycle(BACKEND_PORT, {
    onFatal: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("spira:from-backend", {
          type: "error",
          code: "BACKEND_FATAL",
          message: "Backend failed to restart. Please restart Spira.",
        });
        mainWindow.webContents.send("spira:from-backend", { type: "state:change", state: "error" });
      }
    },
    onMessage: (message) => {
      if (message.type === "upgrade:propose") {
        emitUpgradeProposal(message.proposal);
      }
    },
  });
  lifecycle.setEnvOverrides(getBackendEnvOverrides());
  upgradeOrchestrator = new UpgradeOrchestrator({
    lifecycle,
    getWindow: () => mainWindow,
    emitConnectionStatus,
    getRendererReadySequence: () => rendererReadySequence,
    waitForNextRendererReady,
    relaunchApp: async () => {
      app.relaunch();
      isQuitting = true;
      await shutdownApp();
      app.exit(0);
    },
  });
  lifecycle.onReady(() => {
    ensureWindow();
  });
  lifecycle.onCrash(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("spira:from-backend", {
        type: "error",
        code: "BACKEND_CRASHED",
        message: "The backend process crashed.",
      });
      mainWindow.webContents.send("spira:from-backend", { type: "state:change", state: "error" });
      emitConnectionStatus("disconnected");
    }
  });
  lifecycle.start();
});

app.on("activate", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  if (BrowserWindow.getAllWindows().length === 0 && (useExternalBackend() || lifecycle?.isReady)) {
    ensureWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (isQuitting) {
    return;
  }

  event.preventDefault();
  isQuitting = true;
  void shutdownApp().finally(() => {
    app.quit();
  });
});
