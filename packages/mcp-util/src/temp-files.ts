import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const DEFAULT_MAX_CAPTURE_AGE_MS = 15 * 60 * 1000;
const isMissingPathError = (error: unknown): boolean => (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";

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
      await unlink(imagePath).catch((error) => {
        if (!isMissingPathError(error)) {
          throw error;
        }
      });
    },
    async cleanupCaptureDirectory(): Promise<void> {
      await rm(captureDirectory, { recursive: true, force: true });
    },
    async pruneStaleCaptureFiles(maxAgeMs = DEFAULT_MAX_CAPTURE_AGE_MS): Promise<void> {
      const now = Date.now();
      const entries = await readdir(captureDirectory, { withFileTypes: true }).catch((error) => {
        if (isMissingPathError(error)) {
          return [];
        }
        throw error;
      });

      const results = await Promise.allSettled(
        entries.map(async (entry) => {
          const entryPath = join(captureDirectory, entry.name);
          if (entry.isDirectory()) {
            await rm(entryPath, { recursive: true, force: true });
            return;
          }

          const details = await stat(entryPath).catch((error) => {
            if (isMissingPathError(error)) {
              return null;
            }
            throw error;
          });
          if (!details || now - details.mtimeMs <= maxAgeMs) {
            return;
          }

          await unlink(entryPath).catch((error) => {
            if (!isMissingPathError(error)) {
              throw error;
            }
          });
        }),
      );

      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length > 0) {
        throw new AggregateError(
          failures.map((failure) => failure.reason),
          "Failed to prune one or more stale capture files.",
        );
      }
    },
  };
};
