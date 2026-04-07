import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UserSettings } from "@spira/shared";
import type { IpcMainEvent, IpcMainInvokeEvent, Tray } from "electron";
import { BrowserWindow, app, ipcMain } from "electron";
import WebSocket from "ws";
import { setupAutoUpdater } from "./auto-update.js";
import { BackendLifecycle } from "./backend-lifecycle.js";
import { setupIpcBridge } from "./ipc-bridge.js";
import { createTray } from "./tray.js";
import { createWindow } from "./window.js";

const BACKEND_PORT = 9720;
const WINDOW_CONTROL_CHANNEL = "spira:window-control";
const CONNECTION_STATUS_GET_CHANNEL = "connection-status:get";
const SETTINGS_GET_CHANNEL = "settings:get";
const SETTINGS_SET_CHANNEL = "settings:set";
const EXTERNAL_BACKEND_READY_TIMEOUT_MS = 30_000;
const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const repoRoot = path.resolve(currentDir, "../../..");

type SettingsStoreData = Partial<UserSettings>;
type SettingsStoreInstance = {
  readonly store: SettingsStoreData;
  set(data: SettingsStoreData): void;
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
let isQuitting = false;
let shutdownPromise: Promise<void> | null = null;
let currentConnectionStatus: "connecting" | "connected" | "disconnected" = "connecting";

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

const getDefaultSettings = (): UserSettings => ({
  voiceEnabled: true,
  wakeWordEnabled: true,
  ttsProvider: process.env.ELEVENLABS_API_KEY?.trim() ? "elevenlabs" : "piper",
  whisperModel: "base.en",
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID?.trim() ?? "",
  theme: "ffx",
});

const useExternalBackend = (): boolean => process.env.SPIRA_EXTERNAL_BACKEND === "1";

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

  cleanupBridge?.();
  cleanupBridge = setupIpcBridge(mainWindow, BACKEND_PORT, {
    onConnectionStatusChange: (status) => {
      currentConnectionStatus = status;
    },
  });
};

const handleGetSettings = () => ({
  ...getDefaultSettings(),
  ...(settingsStore?.store ?? {}),
});
const handleGetConnectionStatus = () => currentConnectionStatus;

const VALID_SETTINGS_KEYS: ReadonlySet<keyof UserSettings> = new Set([
  "voiceEnabled",
  "wakeWordEnabled",
  "ttsProvider",
  "whisperModel",
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
      (sanitised as Record<string, unknown>)[key] = (data as Record<string, unknown>)[key];
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
    cleanupBridge?.();
    cleanupBridge = null;
    tray?.destroy();
    tray = null;
    ipcMain.off(WINDOW_CONTROL_CHANNEL, handleWindowControl);
    ipcMain.removeHandler(CONNECTION_STATUS_GET_CHANNEL);
    ipcMain.removeHandler(SETTINGS_GET_CHANNEL);
    ipcMain.removeHandler(SETTINGS_SET_CHANNEL);
  })().finally(() => {
    shutdownPromise = null;
  });

  await shutdownPromise;
};

ipcMain.on(WINDOW_CONTROL_CHANNEL, handleWindowControl);

void app.whenReady().then(() => {
  loadEnvFromFile();
  settingsStore = new ElectronStore<SettingsStoreData>({ name: "spira-settings" }) as SettingsStoreInstance;
  ipcMain.handle(CONNECTION_STATUS_GET_CHANNEL, handleGetConnectionStatus);
  ipcMain.handle(SETTINGS_GET_CHANNEL, handleGetSettings);
  ipcMain.handle(SETTINGS_SET_CHANNEL, handleSetSettings);

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
      mainWindow.webContents.send("spira:connection-status", "disconnected");
      currentConnectionStatus = "disconnected";
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
