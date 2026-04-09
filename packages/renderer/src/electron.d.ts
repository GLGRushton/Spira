import type { ElectronApi, SpiraUiBridgeCommand, SpiraUiBridgeResult } from "@spira/shared";

declare global {
  interface Window {
    electronAPI: ElectronApi;
    __spiraUiControl?: {
      handleRequest: (command: SpiraUiBridgeCommand) => Promise<SpiraUiBridgeResult>;
    };
  }
}
