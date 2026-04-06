import type { ClientMessage } from "@spira/shared";
import type { App, BrowserWindow, Tray as ElectronTray, IpcMainEvent } from "electron";
import { Menu, Tray, ipcMain, nativeImage } from "electron";

const TRAY_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let tray: ElectronTray | null = null;
let mainWindowRef: BrowserWindow | null = null;
let appRef: App | null = null;
let micMuted = false;

const showWindow = () => {
  const mainWindow = mainWindowRef;
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
};

const sendToBackend = (message: ClientMessage) => {
  ipcMain.emit("spira:to-backend", {} as IpcMainEvent, message);
};

const syncMenu = () => {
  if (!tray || !appRef) {
    return;
  }

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show Spira",
        click: showWindow,
      },
      {
        label: "Mute Mic",
        type: "checkbox",
        checked: micMuted,
        click: (item) => {
          micMuted = item.checked;
          sendToBackend(micMuted ? { type: "voice:mute" } : { type: "voice:unmute" });
          syncMenu();
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          appRef?.quit();
        },
      },
    ]),
  );
};

export function updateTrayMuteState(muted: boolean): void {
  micMuted = muted;
  syncMenu();
}

export function createTray(mainWindow: BrowserWindow, app: App): ElectronTray {
  mainWindowRef = mainWindow;
  appRef = app;

  if (tray) {
    syncMenu();
    return tray;
  }

  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL).resize({ width: 16, height: 16 });
  tray = new Tray(icon);

  tray.setToolTip("Spira");
  tray.on("double-click", showWindow);
  syncMenu();

  return tray;
}
