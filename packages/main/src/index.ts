import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ConversationRecord as ArchivedConversation,
  type ConversationMessageRecord as ArchivedConversationMessage,
  type ConversationSummary as ArchivedConversationSummary,
  type SpiraMemoryDatabase,
} from "@spira/memory-db";
import { SPIRA_MEMORY_DB_PATH_ENV, getSpiraMemoryDbPath } from "@spira/memory-db/path";
import {
  type ConnectionStatus,
  type ConversationMessage,
  type ConversationSearchMatch,
  RUNTIME_CONFIG_KEYS,
  type RuntimeConfigApplyResult,
  type RuntimeConfigKey,
  type RuntimeConfigSummary,
  type RuntimeConfigUpdate,
  type StoredConversation,
  type StoredConversationSummary,
  type UpgradeProposal,
  type UserSettings,
  normalizeTtsProvider,
  normalizeWakeWordProvider,
} from "@spira/shared";
import type { IpcMainEvent, IpcMainInvokeEvent, Tray } from "electron";
import { BrowserWindow, app, ipcMain, safeStorage } from "electron";
import WebSocket from "ws";
import { setupAutoUpdater } from "./auto-update.js";
import { BackendLifecycle } from "./backend-lifecycle.js";
import { setupIpcBridge } from "./ipc-bridge.js";
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
const RUNTIME_CONFIG_GET_CHANNEL = "runtime-config:get";
const RUNTIME_CONFIG_SET_CHANNEL = "runtime-config:set";
const UPGRADE_RESPONSE_CHANNEL = "upgrade:respond";
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
let cleanupBridge: (() => void) | null = null;
let tray: Tray | null = null;
let settingsStore: SettingsStoreInstance | null = null;
let archiveDb: SpiraMemoryDatabase | null = null;
let runtimeConfigStore: RuntimeConfigStoreInstance | null = null;
let upgradeOrchestrator: UpgradeOrchestrator | null = null;
let uiControlBridge: SpiraUiControlBridge | null = null;
let isQuitting = false;
let shutdownPromise: Promise<void> | null = null;
let currentConnectionStatus: ConnectionStatus = "connecting";

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
      cleanupBridge?.();
      cleanupBridge = null;
      mainWindow = null;
    });
    tray = createTray(mainWindow, app);
    setupAutoUpdater(mainWindow);
  }

  if (!cleanupBridge) {
    cleanupBridge = setupIpcBridge(mainWindow, BACKEND_PORT, {
      onBackendHello: () => {
        upgradeOrchestrator?.reemitPendingProposal();
      },
      onConnectionStatusChange: (status) => {
        currentConnectionStatus = status;
      },
      rendererBuildId: getRendererBuildId(),
      isUpgrading: () => upgradeOrchestrator?.isRestartInProgress() ?? false,
    });
  }
};

const handleGetSettings = () => ({
  ...getDefaultSettings(),
  ...normalizeStoredSettings(settingsStore?.store ?? {}),
});
const handleGetConnectionStatus = () => currentConnectionStatus;

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
const handleGetRecentConversation = (_event: IpcMainInvokeEvent): StoredConversation | null =>
  mapConversationRecord(archiveDb?.getMostRecentConversation() ?? null);
const handleListConversations = (
  _event: IpcMainInvokeEvent,
  input?: { limit?: number; offset?: number },
): StoredConversationSummary[] => {
  const limit = typeof input?.limit === "number" ? input.limit : 30;
  const offset = typeof input?.offset === "number" ? input.offset : 0;
  return archiveDb?.listConversations(limit, offset).map(mapConversationSummary) ?? [];
};
const handleGetConversation = (
  _event: IpcMainInvokeEvent,
  input?: { conversationId?: string },
): StoredConversation | null => {
  if (!input?.conversationId) {
    return null;
  }

  return mapConversationRecord(archiveDb?.getConversation(input.conversationId) ?? null);
};
const handleSearchConversations = (
  _event: IpcMainInvokeEvent,
  input?: { query?: string; limit?: number },
): ConversationSearchMatch[] => {
  if (!input?.query) {
    return [];
  }

  const limit = typeof input.limit === "number" ? input.limit : 20;
  return archiveDb?.searchConversationMessages(input.query, limit) ?? [];
};
const handleMarkConversationViewed = (_event: IpcMainInvokeEvent, input?: { conversationId?: string }) => {
  if (!input?.conversationId) {
    return;
  }

  archiveDb?.markConversationViewed(input.conversationId);
};
const handleArchiveConversation = (_event: IpcMainInvokeEvent, input?: { conversationId?: string }): boolean => {
  if (!input?.conversationId) {
    return false;
  }

  return archiveDb?.archiveConversation(input.conversationId) ?? false;
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
    cleanupBridge?.();
    cleanupBridge = null;
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
    ipcMain.removeHandler(RUNTIME_CONFIG_GET_CHANNEL);
    ipcMain.removeHandler(RUNTIME_CONFIG_SET_CHANNEL);
    ipcMain.removeHandler(UPGRADE_RESPONSE_CHANNEL);
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
  ipcMain.handle(RUNTIME_CONFIG_GET_CHANNEL, handleGetRuntimeConfig);
  ipcMain.handle(RUNTIME_CONFIG_SET_CHANNEL, handleSetRuntimeConfig);
  ipcMain.handle(UPGRADE_RESPONSE_CHANNEL, handleUpgradeResponse);

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
