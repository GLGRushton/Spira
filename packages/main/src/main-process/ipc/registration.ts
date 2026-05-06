import type { IpcMain } from "electron";

export type IpcInvokeHandler = Parameters<IpcMain["handle"]>[1];
export type IpcInvokeHandlerMap = Record<string, IpcInvokeHandler>;

export const registerIpcInvokeHandlers = (ipc: Pick<IpcMain, "handle">, handlers: IpcInvokeHandlerMap): void => {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipc.handle(channel, handler);
  }
};

export const unregisterIpcInvokeHandlers = (
  ipc: Pick<IpcMain, "removeHandler">,
  handlers: IpcInvokeHandlerMap,
): void => {
  for (const channel of Object.keys(handlers)) {
    ipc.removeHandler(channel);
  }
};
