import type { ClientMessage, ConnectionStatus, ServerMessage } from "@spira/shared";
import type { BrowserWindow, IpcMainEvent } from "electron";
import { ipcMain } from "electron";
import WebSocket from "ws";

export function setupIpcBridge(win: BrowserWindow, backendPort: number): () => void {
  const socket = new WebSocket(`ws://127.0.0.1:${backendPort}`);
  const pending: string[] = [];
  let socketReady = false;

  const emitConnectionStatus = (status: ConnectionStatus) => {
    if (!win.isDestroyed()) {
      win.webContents.send("spira:connection-status", status);
    }
  };

  emitConnectionStatus("connecting");

  socket.once("open", () => {
    socketReady = true;
    emitConnectionStatus("connected");
    for (const message of pending) {
      socket.send(message);
    }
    pending.length = 0;
  });

  const handleRendererMessage = (_event: IpcMainEvent, message: ClientMessage) => {
    const serialized = JSON.stringify(message);
    if (socketReady && socket.readyState === WebSocket.OPEN) {
      socket.send(serialized);
    } else {
      pending.push(serialized);
    }
  };

  const forwardToRenderer = (message: ServerMessage) => {
    if (!win.isDestroyed()) {
      win.webContents.send("spira:from-backend", message);
    }
  };

  ipcMain.on("spira:to-backend", handleRendererMessage);

  socket.on("message", (raw) => {
    let parsed: ServerMessage;
    try {
      parsed = JSON.parse(raw.toString()) as ServerMessage;
    } catch {
      return;
    }
    forwardToRenderer(parsed);
  });

  socket.on("error", (error) => {
    emitConnectionStatus("disconnected");
    forwardToRenderer({ type: "error", code: "BACKEND_SOCKET_ERROR", message: error.message });
  });

  socket.on("close", () => {
    socketReady = false;
    emitConnectionStatus("disconnected");
    ipcMain.off("spira:to-backend", handleRendererMessage);
  });

  return () => {
    ipcMain.off("spira:to-backend", handleRendererMessage);
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  };
}
