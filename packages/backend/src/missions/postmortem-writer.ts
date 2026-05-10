import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Atomic-create a post-mortem markdown file under `<workspaceRoot>/reports/`. Used by
 * both the mission close path and the WorkSession close path so the EEXIST/skip semantics
 * stay identical.
 *
 * Returns a discriminated result so callers can tell "didn't write because the workspace
 * isn't configured" apart from "didn't write because a file already exists" apart from
 * "wrote it cleanly". Renderer / future viewer reads the path for the success case.
 */

export type AtomicWritePostmortemResult =
  | { status: "no-workspace" }
  | { status: "exists"; path: string }
  | { status: "written"; path: string };

export interface AtomicWritePostmortemInput {
  /** Workspace root (project directory). Null short-circuits to `no-workspace`. */
  workspaceRoot: string | null;
  /** Filename to create under `<workspaceRoot>/reports/`. */
  filename: string;
  markdown: string;
}

export const atomicWritePostmortem = async (
  input: AtomicWritePostmortemInput,
): Promise<AtomicWritePostmortemResult> => {
  if (!input.workspaceRoot) {
    return { status: "no-workspace" };
  }
  const reportsDir = path.join(input.workspaceRoot, "reports");
  const targetPath = path.join(reportsDir, input.filename);
  await mkdir(reportsDir, { recursive: true });
  try {
    await writeFile(targetPath, input.markdown, { encoding: "utf8", flag: "wx" });
    return { status: "written", path: targetPath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return { status: "exists", path: targetPath };
    }
    throw error;
  }
};
