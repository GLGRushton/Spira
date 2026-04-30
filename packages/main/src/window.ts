import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow } from "electron";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const isDevelopment = process.env.NODE_ENV !== "production";
const devServerUrl = "http://127.0.0.1:5173";
const devServerRetryDelayMs = 250;
const devServerAttemptTimeoutMs = 5_000;
const preloadPath = isDevelopment
  ? path.resolve(currentDir, "../dev-preload.cjs")
  : path.join(currentDir, "preload.js");

type LoadableWindow = Pick<BrowserWindow, "loadURL" | "show" | "isVisible" | "isDestroyed" | "webContents">;

const wait = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  return typeof error === "string" ? error : JSON.stringify(error);
};

export const createDevelopmentBootstrapUrl = (message: string, details?: string): string => {
  const safeMessage = JSON.stringify(message);
  const safeDetails = JSON.stringify(details ?? "");

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Spira</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 28px;
        background: radial-gradient(circle at top, rgba(0, 229, 255, 0.08), transparent 30%), #0a0e27;
        color: #e8eaf6;
        font-family: "Segoe UI", system-ui, sans-serif;
      }
      .panel {
        width: min(720px, 100%);
        border: 1px solid rgba(0, 229, 255, 0.16);
        border-radius: 18px;
        background: linear-gradient(180deg, rgba(18, 24, 56, 0.96), rgba(10, 14, 39, 0.98));
        box-shadow: 0 22px 60px rgba(4, 7, 22, 0.46);
        padding: 28px;
      }
      .eyebrow {
        display: block;
        margin-bottom: 10px;
        color: rgba(255, 255, 255, 0.72);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 28px;
        line-height: 1.15;
      }
      p {
        margin: 0;
        color: rgba(232, 234, 246, 0.88);
        font-size: 15px;
        line-height: 1.6;
      }
      pre {
        margin-top: 22px;
        overflow: auto;
        border-radius: 12px;
        background: rgba(6, 10, 24, 0.78);
        padding: 14px;
        color: rgba(232, 234, 246, 0.84);
        font-family: "Cascadia Code", "Consolas", monospace;
        font-size: 12px;
        line-height: 1.55;
        white-space: pre-wrap;
        word-break: break-word;
      }
      pre[hidden] {
        display: none;
      }
    </style>
  </head>
  <body>
    <section class="panel">
      <span class="eyebrow">Spira renderer</span>
      <h1>Loading Spira...</h1>
      <p id="message"></p>
      <pre id="details" hidden></pre>
    </section>
    <script>
      const message = ${safeMessage};
      const details = ${safeDetails};
      document.getElementById("message").textContent = message;
      const detailsNode = document.getElementById("details");
      if (details && details.trim()) {
        detailsNode.hidden = false;
        detailsNode.textContent = details;
      }
    </script>
  </body>
</html>`;

  return `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`;
};

export const loadUrlWithTimeout = async (
  window: Pick<LoadableWindow, "loadURL" | "webContents">,
  url: string,
  timeoutMs: number,
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      window.webContents.stop();
      reject(new Error(`Timed out loading ${url} after ${timeoutMs}ms.`));
    }, timeoutMs);

    void window.loadURL(url).then(
      () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve();
      },
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
};

const loadDevelopmentBootstrap = async (window: LoadableWindow, message: string, details?: string): Promise<void> => {
  await window.loadURL(createDevelopmentBootstrapUrl(message, details));
  if (!window.isVisible() && !window.isDestroyed()) {
    window.show();
  }
};

export async function loadDevelopmentRenderer(window: LoadableWindow): Promise<void> {
  let attempt = 1;
  await loadDevelopmentBootstrap(window, `Waiting for the development renderer at ${devServerUrl}.`);

  while (!window.isDestroyed()) {
    try {
      await loadUrlWithTimeout(window, devServerUrl, devServerAttemptTimeoutMs);
      return;
    } catch (error) {
      const details = `Attempt ${attempt} failed.\n\n${toErrorMessage(error)}`;
      console.error(`Development renderer attempt ${attempt} failed for ${devServerUrl}`, error);
      if (window.isDestroyed()) {
        return;
      }
      await loadDevelopmentBootstrap(window, `Still waiting for ${devServerUrl}. Retrying automatically...`, details);
      await wait(devServerRetryDelayMs);
      attempt += 1;
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

  if (!isDevelopment) {
    window.once("ready-to-show", () => {
      window.show();
    });
  }

  window.on("unresponsive", () => {
    console.error("Spira renderer became unresponsive.");
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("Spira renderer process exited unexpectedly.", details);
  });

  if (isDevelopment) {
    void loadDevelopmentRenderer(window).catch((error: unknown) => {
      console.error(`Failed to load development renderer from ${devServerUrl}`, error);
    });
  } else {
    void window.loadFile(path.join(currentDir, "../renderer/index.html"));
  }

  return window;
}
