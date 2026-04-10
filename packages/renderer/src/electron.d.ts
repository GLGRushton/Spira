import type { ElectronApi, RendererFatalPayload, SpiraUiBridgeCommand, SpiraUiBridgeResult } from "@spira/shared";

declare global {
  interface Window {
    electronAPI: ElectronApi;
    __spiraRendererBoot?: {
      markReady: () => void;
      showFailure: (payload: RendererFatalPayload) => void;
      isReady: () => boolean;
    };
    __spiraUiControl?: {
      handleRequest: (command: SpiraUiBridgeCommand) => Promise<SpiraUiBridgeResult>;
    };
  }
}
