import type { ElectronApi, ServerMessage } from "@spira/shared";
import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

const electronAPI: ElectronApi = {
  send(message) {
    ipcRenderer.send("spira:to-backend", message);
  },
  onMessage(handler) {
    const listener = (_event: IpcRendererEvent, message: ServerMessage) => {
      handler(message);
    };

    ipcRenderer.on("spira:from-backend", listener);
    return () => {
      ipcRenderer.off("spira:from-backend", listener);
    };
  },
  onStateChange(handler) {
    return electronAPI.onMessage((message) => {
      if (message.type === "state:change") {
        handler(message.state);
      }
    });
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
