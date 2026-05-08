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
  type ConnectionStatus,
  type ConversationMessage,
  type ConversationSearchMatch,
  DEFAULT_YOUTRACK_STATE_MAPPING,
  RUNTIME_CONFIG_KEYS,
  type RendererFatalPayload,
  type RuntimeConfigApplyResult,
  type RuntimeConfigKey,
  type RuntimeConfigSummary,
  type RuntimeConfigUpdate,
  type StoredConversation,
  type StoredConversationSummary,
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
import { type BackendExitInfo, BackendLifecycle } from "./backend-lifecycle.js";
import { type IpcBridgeHandle, setupIpcBridge } from "./ipc-bridge.js";
import { IPC_CHANNELS } from "./main-process/ipc/channels.js";
import { createMissionIpcHandlers } from "./main-process/ipc/missions-handlers.js";
import {
  type IpcInvokeHandlerMap,
  registerIpcInvokeHandlers,
  unregisterIpcInvokeHandlers,
} from "./main-process/ipc/registration.js";
import {
  coerceStoredRuntimeConfigValue,
  getAllowedRuntimeConfigValues,
  normalizeRuntimeConfigValue,
} from "./runtime-config-utils.js";
import { SpiraUiControlBridge } from "./spira-ui-control-bridge.js";
import { createTray } from "./tray.js";
import { UpgradeOrchestrator } from "./upgrade-orchestrator.js";
import { createWindow } from "./window.js";

const BACKEND_PORT = 9720;
const FATAL_SHUTDOWN_TIMEOUT_MS = 10_000;
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
let fatalShutdownTriggered = false;
let currentConnectionStatus: ConnectionStatus = "connecting";
let rendererReadySequence = 0;
const missionIpcHandlers = createMissionIpcHandlers(() => bridge);
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

const RUNTIME_CONFIG_METADATA: Record<
  RuntimeConfigKey,
  { envKey: string; label: string; description: string; secret: boolean }
> = {
  modelProvider: {
    envKey: "SPIRA_MODEL_PROVIDER",
    label: "Model provider",
    description:
      'Selects the active provider adapter for Shinra turns, such as "copilot", "azure-openai", "azure-openai-escalation", "openai", or "openai-escalation".',
    secret: false,
  },
  githubToken: {
    envKey: "GITHUB_TOKEN",
    label: "GitHub token",
    description: "Used for GitHub-authenticated Copilot flows when available.",
    secret: true,
  },
  azureOpenAiApiKey: {
    envKey: "AZURE_OPENAI_API_KEY",
    label: "Azure OpenAI API key",
    description: "Used when the Azure OpenAI provider adapter is selected.",
    secret: true,
  },
  azureOpenAiEndpoint: {
    envKey: "AZURE_OPENAI_ENDPOINT",
    label: "Azure OpenAI endpoint",
    description: "The Azure OpenAI resource endpoint, such as https://example.openai.azure.com.",
    secret: false,
  },
  azureOpenAiDeployment: {
    envKey: "AZURE_OPENAI_DEPLOYMENT",
    label: "Azure OpenAI deployment",
    description: "The Azure OpenAI deployment name that backs Shinra's turns.",
    secret: false,
  },
  azureOpenAiEscalationDeployment: {
    envKey: "AZURE_OPENAI_ESCALATION_DEPLOYMENT",
    label: "Azure OpenAI escalation deployment",
    description:
      "The Azure OpenAI deployment used by the experimental escalation provider after it promotes a session.",
    secret: false,
  },
  azureOpenAiApiVersion: {
    envKey: "AZURE_OPENAI_API_VERSION",
    label: "Azure OpenAI API version",
    description: "The Azure OpenAI REST API version to target for chat completions and tool calls.",
    secret: false,
  },
  azureOpenAiModel: {
    envKey: "AZURE_OPENAI_MODEL",
    label: "Azure OpenAI model label",
    description:
      "Optional model label for telemetry and diagnostics when the deployment name is not descriptive enough.",
    secret: false,
  },
  azureOpenAiEscalationModel: {
    envKey: "AZURE_OPENAI_ESCALATION_MODEL",
    label: "Azure OpenAI escalation model label",
    description:
      "Optional telemetry label for the experimental Azure escalation deployment when its deployment name is not descriptive enough.",
    secret: false,
  },
  openAiApiKey: {
    envKey: "OPENAI_API_KEY",
    label: "OpenAI API key",
    description: "Used when the OpenAI provider adapter is selected.",
    secret: true,
  },
  openAiBaseUrl: {
    envKey: "OPENAI_BASE_URL",
    label: "OpenAI base URL",
    description: "Optional OpenAI-compatible base URL. Leave unset to use https://api.openai.com/v1.",
    secret: false,
  },
  openAiModel: {
    envKey: "OPENAI_MODEL",
    label: "OpenAI default model",
    description: "Default OpenAI model for Shinra turns when no explicit requested model is supplied.",
    secret: false,
  },
  openAiEscalationModel: {
    envKey: "OPENAI_ESCALATION_MODEL",
    label: "OpenAI escalation model",
    description: "The OpenAI model used by the experimental escalation provider after it promotes a session.",
    secret: false,
  },
  missionGitHubToken: {
    envKey: "MISSION_GITHUB_TOKEN",
    label: "Mission GitHub PAT",
    description:
      "Used for mission submodule hydration, commits, publish, push, and deriving the GitHub author identity.",
    secret: true,
  },
  elevenLabsApiKey: {
    envKey: "ELEVENLABS_API_KEY",
    label: "ElevenLabs API key",
    description: "Required for ElevenLabs cloud speech synthesis.",
    secret: true,
  },
  picovoiceAccessKey: {
    envKey: "PICOVOICE_ACCESS_KEY",
    label: "Picovoice access key",
    description: "Required when Porcupine wake-word detection is selected.",
    secret: true,
  },
  nexusModsApiKey: {
    envKey: "NEXUS_MODS_API_KEY",
    label: "Nexus Mods API key",
    description: "Enables authenticated Nexus Mods downloads in the MCP toolset.",
    secret: true,
  },
  youTrackBaseUrl: {
    envKey: "YOUTRACK_BASE_URL",
    label: "YouTrack base URL",
    description: "Base URL for your YouTrack instance, such as https://example.youtrack.cloud.",
    secret: false,
  },
  youTrackToken: {
    envKey: "YOUTRACK_TOKEN",
    label: "YouTrack permanent token",
    description: "Used for native YouTrack authentication and assigned-ticket intake.",
    secret: true,
  },
  sqlServerServer: {
    envKey: "SQL_SERVER_SERVER",
    label: "SQL Server host",
    description: 'SQL Server host or local alias. "." is accepted and normalized to a driver-safe local host.',
    secret: false,
  },
  sqlServerPort: {
    envKey: "SQL_SERVER_PORT",
    label: "SQL Server port",
    description: "Optional TCP port for SQL Server. Leave blank for the driver default.",
    secret: false,
  },
  sqlServerUsername: {
    envKey: "SQL_SERVER_USERNAME",
    label: "SQL Server username",
    description: "Dedicated SQL login for read-only MCP access.",
    secret: true,
  },
  sqlServerPassword: {
    envKey: "SQL_SERVER_PASSWORD",
    label: "SQL Server password",
    description: "Password for the dedicated SQL read-only login.",
    secret: true,
  },
  sqlServerEncrypt: {
    envKey: "SQL_SERVER_ENCRYPT",
    label: "Encrypt connection",
    description: "Set true or false to control SQL Server TLS encryption. Default: true.",
    secret: false,
  },
  sqlServerTrustServerCertificate: {
    envKey: "SQL_SERVER_TRUST_SERVER_CERTIFICATE",
    label: "Trust server certificate",
    description: "Set true or false when using self-signed SQL Server certificates. Default: false.",
    secret: false,
  },
  sqlServerAllowedDatabases: {
    envKey: "SQL_SERVER_ALLOWED_DATABASES",
    label: "Allowed databases",
    description: "Optional comma-separated database allowlist for the SQL Server MCP server.",
    secret: false,
  },
  sqlServerRowLimit: {
    envKey: "SQL_SERVER_ROW_LIMIT",
    label: "Row cap",
    description: "Maximum rows returned by SQL Server query calls. Default: 200.",
    secret: false,
  },
  sqlServerTimeoutMs: {
    envKey: "SQL_SERVER_TIMEOUT_MS",
    label: "Timeout cap (ms)",
    description: "Maximum SQL Server request time in milliseconds. Default: 10000.",
    secret: false,
  },
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
      normalized[key] = coerceStoredRuntimeConfigValue(key, decrypted);
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
    return storedValue;
  }

  const envValue = process.env[RUNTIME_CONFIG_METADATA[key].envKey];
  return typeof envValue === "string" && envValue.trim() ? envValue : undefined;
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
      overrides[envKey] = storedValue;
    }
  }

  return overrides;
};

const getRuntimeConfigSummary = (): RuntimeConfigSummary =>
  Object.fromEntries(
    RUNTIME_CONFIG_KEYS.map((key) => {
      const metadata = RUNTIME_CONFIG_METADATA[key];
      const storedValue = getStoredRuntimeConfig()[key];
      const envValue = process.env[metadata.envKey];
      const currentValue = metadata.secret
        ? null
        : storedValue === null
          ? null
          : typeof storedValue === "string" && storedValue.trim()
            ? storedValue
            : typeof envValue === "string" && envValue.trim()
              ? envValue.trim()
              : null;
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
          label: metadata.label,
          description: metadata.description,
          configured: source === "stored" || source === "environment",
          source,
          secret: metadata.secret,
          currentValue,
          allowedValues: getAllowedRuntimeConfigValues(key),
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
  autoApprovePermissions: false,
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

const formatBackendExitDetails = (info: BackendExitInfo): string => {
  const parts: string[] = [];
  if (info.signal) {
    parts.push(`signal ${info.signal}`);
  }
  if (info.code !== null) {
    parts.push(`exit code ${info.code}`);
  }
  if (info.retryDelayMs !== null) {
    parts.push(`retry in ${info.retryDelayMs}ms`);
  }
  return parts.length > 0 ? parts.join(", ") : "no exit details available";
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

    const normalizedValue = normalizeRuntimeConfigValue(key, update[key]);
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
  "autoApprovePermissions",
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

const invokeHandlers = {
  [IPC_CHANNELS.connectionStatusGet]: handleGetConnectionStatus,
  [IPC_CHANNELS.settingsGet]: handleGetSettings,
  [IPC_CHANNELS.settingsSet]: handleSetSettings,
  [IPC_CHANNELS.conversation.recentGet]: handleGetRecentConversation,
  [IPC_CHANNELS.conversation.list]: handleListConversations,
  [IPC_CHANNELS.conversation.get]: handleGetConversation,
  [IPC_CHANNELS.conversation.search]: handleSearchConversations,
  [IPC_CHANNELS.conversation.markViewed]: handleMarkConversationViewed,
  [IPC_CHANNELS.conversation.archive]: handleArchiveConversation,
  [IPC_CHANNELS.youTrack.statusGet]: handleGetYouTrackStatus,
  [IPC_CHANNELS.youTrack.ticketsList]: handleListYouTrackTickets,
  [IPC_CHANNELS.youTrack.projectsSearch]: handleSearchYouTrackProjects,
  [IPC_CHANNELS.youTrack.stateMappingSet]: handleSetYouTrackStateMapping,
  ...missionIpcHandlers,
  [IPC_CHANNELS.dialog.pickDirectory]: handlePickDirectory,
  [IPC_CHANNELS.shell.openExternal]: handleOpenExternal,
  [IPC_CHANNELS.runtimeConfig.get]: handleGetRuntimeConfig,
  [IPC_CHANNELS.runtimeConfig.set]: handleSetRuntimeConfig,
  [IPC_CHANNELS.upgrade.response]: handleUpgradeResponse,
} satisfies IpcInvokeHandlerMap;

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
    ipcMain.off(IPC_CHANNELS.windowControl, handleWindowControl);
    unregisterIpcInvokeHandlers(ipcMain, invokeHandlers);
    ipcMain.off(IPC_CHANNELS.rendererFatal, handleRendererFatal);
    rejectRendererReadyWaiters(new Error("Renderer readiness wait cancelled during shutdown."));
    archiveDb?.close();
    archiveDb = null;
  })().finally(() => {
    shutdownPromise = null;
  });

  await shutdownPromise;
};

const handleFatalMainProcessError = (scope: "exception" | "rejection", error: unknown): void => {
  if (fatalShutdownTriggered) {
    return;
  }

  fatalShutdownTriggered = true;
  console.error(`Unhandled ${scope} in Spira main process. Shutting down.`, error);
  if (!app.isReady()) {
    process.exit(1);
    return;
  }

  isQuitting = true;
  const forceExitTimer = setTimeout(() => {
    app.exit(1);
  }, FATAL_SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref?.();
  void shutdownApp().finally(() => {
    clearTimeout(forceExitTimer);
    app.exit(1);
  });
};

process.on("uncaughtException", (error) => {
  handleFatalMainProcessError("exception", error);
});

process.on("unhandledRejection", (reason) => {
  handleFatalMainProcessError("rejection", reason);
});

ipcMain.on(IPC_CHANNELS.windowControl, handleWindowControl);

void app.whenReady().then(async () => {
  loadEnvFromFile();
  settingsStore = new ElectronStore<SettingsStoreData>({ name: "spira-settings" }) as SettingsStoreInstance;
  archiveDb = await openArchiveDatabase(getSpiraMemoryDbPath(app.getPath("userData")));
  runtimeConfigStore = new ElectronStore<RuntimeConfigStoreData>({
    name: "spira-runtime-config",
  }) as RuntimeConfigStoreInstance;
  uiControlBridge = new SpiraUiControlBridge(() => mainWindow, console);
  await uiControlBridge.start();
  registerIpcInvokeHandlers(ipcMain, invokeHandlers);
  ipcMain.on(IPC_CHANNELS.rendererFatal, handleRendererFatal);
  ensureWindow();

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
    onFatal: (info) => {
      emitConnectionStatus("disconnected");
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("spira:from-backend", {
          type: "error",
          code: "BACKEND_FATAL",
          message: "Backend failed to restart. Please restart Spira.",
          details: formatBackendExitDetails(info),
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
  lifecycle.onCrash((info) => {
    if (!info.willRetry) {
      return;
    }
    emitConnectionStatus("disconnected");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("spira:from-backend", {
        type: "error",
        code: "BACKEND_CRASHED",
        message: "The backend process crashed and is restarting.",
        details: formatBackendExitDetails(info),
      });
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
