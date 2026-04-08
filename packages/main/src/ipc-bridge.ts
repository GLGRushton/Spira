import { type ClientMessage, type ConnectionStatus, PROTOCOL_VERSION, type ServerMessage } from "@spira/shared";
import type { BrowserWindow, IpcMainEvent } from "electron";
import { ipcMain } from "electron";
import WebSocket from "ws";
import { updateTrayMuteState } from "./tray.js";

interface IpcBridgeOptions {
  onConnectionStatusChange?: (status: ConnectionStatus) => void;
  rendererBuildId?: string;
  isUpgrading?: () => boolean;
}

export function setupIpcBridge(win: BrowserWindow, backendPort: number, options: IpcBridgeOptions = {}): () => void {
  const pending: string[] = [];
  const rendererBuildId = options.rendererBuildId ?? "dev";
  const handshakeMessage = JSON.stringify({
    type: "handshake",
    protocolVersion: PROTOCOL_VERSION,
    rendererBuildId,
  } satisfies ClientMessage);

  let socket: WebSocket | null = null;
  let socketReady = false;
  let disposed = false;
  let reconnectAttempt = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let lastBackendGeneration: number | null = null;

  const emitConnectionStatus = (status: ConnectionStatus) => {
    options.onConnectionStatusChange?.(status);
    if (!win.isDestroyed()) {
      win.webContents.send("spira:connection-status", status);
    }
  };

  const handleRendererMessage = (_event: IpcMainEvent, message: ClientMessage) => {
    const serialized = JSON.stringify(message);
    if (socketReady && socket?.readyState === WebSocket.OPEN) {
      socket.send(serialized);
      return;
    }
    pending.push(serialized);
  };

  const forwardToRenderer = (message: ServerMessage) => {
    if (message.type === "voice:muted") {
      updateTrayMuteState(message.muted);
    }

    if (!win.isDestroyed()) {
      win.webContents.send("spira:from-backend", message);
    }
  };

  const clearReconnectTimer = () => {
    if (!reconnectTimer) {
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const scheduleReconnect = () => {
    if (disposed || win.isDestroyed()) {
      return;
    }

    clearReconnectTimer();
    const delay = Math.min(250 * 2 ** reconnectAttempt, 2_000);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (disposed || win.isDestroyed()) {
      return;
    }

    emitConnectionStatus("connecting");
    socketReady = false;
    socket = new WebSocket(`ws://127.0.0.1:${backendPort}`);

    socket.once("open", () => {
      socket?.send(handshakeMessage);
    });

    socket.on("message", (raw) => {
      let parsed: ServerMessage;
      try {
        parsed = JSON.parse(raw.toString()) as ServerMessage;
      } catch {
        return;
      }

      if (parsed.type === "backend:hello") {
        if (lastBackendGeneration !== null && parsed.generation !== lastBackendGeneration) {
          pending.length = 0;
        }
        lastBackendGeneration = parsed.generation;
        socketReady = true;
        reconnectAttempt = 0;
        emitConnectionStatus("connected");
        for (const message of pending) {
          socket?.send(message);
        }
        pending.length = 0;
      }

      forwardToRenderer(parsed);
    });

    socket.on("error", () => {
      socketReady = false;
    });

    socket.on("close", () => {
      socketReady = false;
      socket = null;
      if (disposed) {
        return;
      }
      emitConnectionStatus(options.isUpgrading?.() ? "upgrading" : "disconnected");
      scheduleReconnect();
    });
  };

  ipcMain.on("spira:to-backend", handleRendererMessage);
  connect();

  return () => {
    disposed = true;
    clearReconnectTimer();
    ipcMain.off("spira:to-backend", handleRendererMessage);
    socketReady = false;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.close();
    }
  };
}
