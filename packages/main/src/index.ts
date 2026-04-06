import { BrowserWindow, app } from "electron";
import { BackendLifecycle } from "./backend-lifecycle.js";
import { setupIpcBridge } from "./ipc-bridge.js";
import { createWindow } from "./window.js";

const BACKEND_PORT = 9720;

let lifecycle: BackendLifecycle | null = null;
let mainWindow: BrowserWindow | null = null;
let cleanupBridge: (() => void) | null = null;

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
  cleanupBridge?.();
  cleanupBridge = null;
  lifecycle?.stop();
});
