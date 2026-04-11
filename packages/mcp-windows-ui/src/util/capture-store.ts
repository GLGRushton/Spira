import { createCaptureFileStore } from "@spira/mcp-util/temp-files";

const captureFileStore = createCaptureFileStore("spira-windows-ui");

export const {
  cleanupCaptureDirectory,
  createCapturePath,
  getCaptureDirectory,
  isManagedCapturePath,
  pruneStaleCaptureFiles,
  removeCaptureFile,
} = captureFileStore;
