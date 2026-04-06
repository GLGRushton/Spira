import type { IpcMainEvent } from "electron";
import { BrowserWindow, app, ipcMain } from "electron";
import { BackendLifecycle } from "./backend-lifecycle.js";
import { setupIpcBridge } from "./ipc-bridge.js";
import { createWindow } from "./window.js";

const BACKEND_PORT = 9720;
const WINDOW_CONTROL_CHANNEL = "spira:window-control";

let lifecycle: BackendLifecycle | null = null;
let mainWindow: BrowserWindow | null = null;
let cleanupBridge: (() => void) | null = null;

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
    mainWindow.on("closed", () => {
      cleanupBridge?.();
      cleanupBridge = null;
      mainWindow = null;
    });
  }

  cleanupBridge?.();
  cleanupBridge = setupIpcBridge(mainWindow, BACKEND_PORT);
};

ipcMain.on(WINDOW_CONTROL_CHANNEL, handleWindowControl);

void app.whenReady().then(() => {
  lifecycle = new BackendLifecycle(BACKEND_PORT);
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
      mainWindow.webContents.send("spira:connection-status", "disconnected");
    }
  });
  lifecycle.start();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && lifecycle?.isReady) {
    ensureWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  ipcMain.off(WINDOW_CONTROL_CHANNEL, handleWindowControl);
  cleanupBridge?.();
  cleanupBridge = null;
  lifecycle?.stop();
});
