import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const CAPTURE_DIRECTORY = join(tmpdir(), "spira-vision");
const DEFAULT_MAX_CAPTURE_AGE_MS = 15 * 60 * 1000;

export async function createCapturePath(prefix: string): Promise<string> {
  await mkdir(CAPTURE_DIRECTORY, { recursive: true });
  return join(CAPTURE_DIRECTORY, `${prefix}-${randomUUID()}.png`);
}

export function getCaptureDirectory(): string {
  return CAPTURE_DIRECTORY;
}

export function isManagedCapturePath(imagePath: string): boolean {
  const normalizedCaptureDirectory = `${resolve(CAPTURE_DIRECTORY)}${sep}`;
  return resolve(imagePath).startsWith(normalizedCaptureDirectory);
}

export async function removeCaptureFile(imagePath: string): Promise<void> {
  await unlink(imagePath).catch(() => {});
}

export async function cleanupCaptureDirectory(): Promise<void> {
  await rm(CAPTURE_DIRECTORY, { recursive: true, force: true }).catch(() => {});
}

export async function pruneStaleCaptureFiles(maxAgeMs = DEFAULT_MAX_CAPTURE_AGE_MS): Promise<void> {
  const now = Date.now();
  const entries = await readdir(CAPTURE_DIRECTORY, { withFileTypes: true }).catch(() => []);

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(CAPTURE_DIRECTORY, entry.name);
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
}
