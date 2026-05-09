import { access } from "node:fs/promises";

/**
 * Resolve true when the path exists and is accessible. ENOENT/ENOTDIR resolve false; any
 * other access error (e.g. EPERM) is rethrown so callers can decide how to treat it.
 *
 * Use this for "is this fixture file present?" type checks. For "open this file" flows
 * prefer the operate-then-handle-error pattern (TOCTOU) over a pre-check.
 */
export const pathExists = async (target: string): Promise<boolean> => {
  try {
    await access(target);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
};
