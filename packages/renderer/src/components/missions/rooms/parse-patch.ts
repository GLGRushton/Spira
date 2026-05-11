export type PatchLineKind = "meta" | "hunk" | "add" | "del" | "ctx";

export interface PatchLine {
  kind: PatchLineKind;
  text: string;
}

export interface ParsedPatch {
  lines: PatchLine[];
  hunkCount: number;
}

const META_PREFIXES = ["diff --git", "index ", "--- ", "+++ ", "new file mode", "deleted file mode", "rename ", "similarity index", "Binary files", "old mode", "new mode"] as const;

function classifyLine(line: string): PatchLineKind {
  if (line.startsWith("@@")) {
    return "hunk";
  }
  if (line.startsWith("+++") || line.startsWith("---")) {
    return "meta";
  }
  if (line.startsWith("+")) {
    return "add";
  }
  if (line.startsWith("-")) {
    return "del";
  }
  for (const prefix of META_PREFIXES) {
    if (line.startsWith(prefix)) {
      return "meta";
    }
  }
  return "ctx";
}

export function parsePatch(patch: string): ParsedPatch {
  if (patch.length === 0) {
    return { lines: [], hunkCount: 0 };
  }
  const rawLines = patch.split(/\r?\n/u);
  // Git patches usually end with a trailing newline → drop the empty tail.
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }
  const lines: PatchLine[] = rawLines.map((text) => ({ kind: classifyLine(text), text }));
  const hunkCount = lines.reduce((count, line) => (line.kind === "hunk" ? count + 1 : count), 0);
  return { lines, hunkCount };
}

export function countHunks(patch: string): number {
  if (patch.length === 0) {
    return 0;
  }
  let count = 0;
  let index = patch.indexOf("\n@@");
  if (patch.startsWith("@@")) {
    count += 1;
  }
  while (index !== -1) {
    count += 1;
    index = patch.indexOf("\n@@", index + 1);
  }
  return count;
}
