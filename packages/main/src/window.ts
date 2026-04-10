import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow } from "electron";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const isDevelopment = process.env.NODE_ENV !== "production";
const devServerUrl = "http://localhost:5173";
const devServerRetryDelayMs = 250;
const devServerMaxAttempts = 80;
const preloadPath = isDevelopment
  ? path.resolve(currentDir, "../dev-preload.cjs")
  : path.join(currentDir, "preload.js");

async function loadDevelopmentRenderer(window: BrowserWindow): Promise<void> {
  for (let attempt = 1; attempt <= devServerMaxAttempts; attempt += 1) {
    if (window.isDestroyed()) {
      return;
    }

    try {
      await window.loadURL(devServerUrl);
      return;
    } catch (error) {
      if (attempt === devServerMaxAttempts) {
        throw error;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, devServerRetryDelayMs);
      });
    }
  }
}

export function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: "#0a0e27",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: !isDevelopment,
      preload: preloadPath,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  window.on("unresponsive", () => {
    console.error("Spira renderer became unresponsive.");
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("Spira renderer process exited unexpectedly.", details);
  });

  if (isDevelopment) {
    void loadDevelopmentRenderer(window).catch((error: unknown) => {
      console.error("Failed to load development renderer", error);
    });
  } else {
    void window.loadFile(path.join(currentDir, "../renderer/index.html"));
  }

  return window;
}
