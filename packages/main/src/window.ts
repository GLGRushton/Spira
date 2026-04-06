import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow } from "electron";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const isDevelopment = process.env.NODE_ENV !== "production";

export function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: "#0a0e27",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(currentDir, "preload.js"),
    },
  });

  if (isDevelopment) {
    void window.loadURL("http://localhost:5173");
  } else {
    void window.loadFile(path.join(currentDir, "../renderer/index.html"));
  }

  return window;
}
