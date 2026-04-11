import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const DEFAULT_MAX_CAPTURE_AGE_MS = 15 * 60 * 1000;

export interface CaptureFileStore {
  createCapturePath(prefix: string): Promise<string>;
  getCaptureDirectory(): string;
  isManagedCapturePath(imagePath: string): boolean;
  removeCaptureFile(imagePath: string): Promise<void>;
  cleanupCaptureDirectory(): Promise<void>;
  pruneStaleCaptureFiles(maxAgeMs?: number): Promise<void>;
}

export const createCaptureFileStore = (directoryName: string): CaptureFileStore => {
  const captureDirectory = join(tmpdir(), directoryName);

  return {
    async createCapturePath(prefix: string): Promise<string> {
      await mkdir(captureDirectory, { recursive: true });
      return join(captureDirectory, `${prefix}-${randomUUID()}.png`);
    },
    getCaptureDirectory(): string {
      return captureDirectory;
    },
    isManagedCapturePath(imagePath: string): boolean {
      const normalizedCaptureDirectory = `${resolve(captureDirectory)}${sep}`;
      return resolve(imagePath).startsWith(normalizedCaptureDirectory);
    },
    async removeCaptureFile(imagePath: string): Promise<void> {
      await unlink(imagePath).catch(() => {});
    },
    async cleanupCaptureDirectory(): Promise<void> {
      await rm(captureDirectory, { recursive: true, force: true }).catch(() => {});
    },
    async pruneStaleCaptureFiles(maxAgeMs = DEFAULT_MAX_CAPTURE_AGE_MS): Promise<void> {
      const now = Date.now();
      const entries = await readdir(captureDirectory, { withFileTypes: true }).catch(() => []);

      await Promise.all(
        entries.map(async (entry) => {
          const entryPath = join(captureDirectory, entry.name);
          if (entry.isDirectory()) {
            await rm(entryPath, { recursive: true, force: true }).catch(() => {});
            return;
          }

          const details = await stat(entryPath).catch(() => null);
          if (!details || now - details.mtimeMs <= maxAgeMs) {
            return;
          }

          await unlink(entryPath).catch(() => {});
        }),
      );
    },
  };
};
