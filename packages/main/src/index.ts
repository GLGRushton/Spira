import { createRequire } from "node:module";
import type { UserSettings } from "@spira/shared";
import type { IpcMainEvent, IpcMainInvokeEvent, Tray } from "electron";
import { BrowserWindow, app, ipcMain } from "electron";
import { setupAutoUpdater } from "./auto-update.js";
import { BackendLifecycle } from "./backend-lifecycle.js";
import { setupIpcBridge } from "./ipc-bridge.js";
import { createTray } from "./tray.js";
import { createWindow } from "./window.js";

const BACKEND_PORT = 9720;
const WINDOW_CONTROL_CHANNEL = "spira:window-control";
const SETTINGS_GET_CHANNEL = "settings:get";
const SETTINGS_SET_CHANNEL = "settings:set";
const require = createRequire(import.meta.url);

type SettingsStoreData = Partial<UserSettings>;
type SettingsStoreInstance = {
  readonly store: SettingsStoreData;
  set(data: SettingsStoreData): void;
};

const ElectronStore = require("electron-store") as {
  new <T extends Record<string, unknown> = Record<string, unknown>>(options: { name: string }): {
    readonly store: T;
    set(data: Partial<T>): void;
  };
};

let lifecycle: BackendLifecycle | null = null;
let mainWindow: BrowserWindow | null = null;
let cleanupBridge: (() => void) | null = null;
let tray: Tray | null = null;
let settingsStore: SettingsStoreInstance | null = null;
let isQuitting = false;
let shutdownPromise: Promise<void> | null = null;

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
  cleanupBridge = setupIpcBridge(mainWindow, BACKEND_PORT);
};

const handleGetSettings = () => settingsStore?.store ?? {};

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
    ipcMain.removeHandler(SETTINGS_GET_CHANNEL);
    ipcMain.removeHandler(SETTINGS_SET_CHANNEL);
  })().finally(() => {
    shutdownPromise = null;
  });

  await shutdownPromise;
};

ipcMain.on(WINDOW_CONTROL_CHANNEL, handleWindowControl);

void app.whenReady().then(() => {
  settingsStore = new ElectronStore<SettingsStoreData>({ name: "spira-settings" }) as SettingsStoreInstance;
  ipcMain.handle(SETTINGS_GET_CHANNEL, handleGetSettings);
  ipcMain.handle(SETTINGS_SET_CHANNEL, handleSetSettings);
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

  if (BrowserWindow.getAllWindows().length === 0 && lifecycle?.isReady) {
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
