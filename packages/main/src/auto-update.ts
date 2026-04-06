import type { BrowserWindow } from "electron";
import { app } from "electron";
import { autoUpdater } from "electron-updater";

function logAutoUpdateError(context: string, error: unknown): void {
  const details = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  console.error({ context, error: details }, "Auto-updater error");
}

export function setupAutoUpdater(mainWindow: BrowserWindow): void {
  autoUpdater.autoDownload = false;

  autoUpdater.on("update-available", (info) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:available", info);
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:downloaded", info);
    }
  });

  autoUpdater.on("error", (error) => {
    logAutoUpdateError("update:event", error);
  });

  if (process.env.NODE_ENV === "production" || app.isPackaged) {
    void autoUpdater.checkForUpdates().catch((error) => {
      logAutoUpdateError("update:check", error);
    });
  }
}
