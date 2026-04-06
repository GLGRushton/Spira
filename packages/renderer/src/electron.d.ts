import type { ElectronApi } from "@spira/shared";

declare global {
  interface Window {
    electronAPI: ElectronApi;
  }
}
