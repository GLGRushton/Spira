import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderToolDefinition, ProviderToolResultObject } from "../provider/types.js";
import type { StationSessionArtifactKind, StationSessionStorage } from "./station-session-storage.js";

const DEFAULT_INITIAL_WAIT_SECONDS = 30;
const MAX_VIEW_BYTES = 50 * 1024;
const MAX_OUTPUT_CHARS = 20_000;
const SKIPPED_DIRECTORY_NAMES = new Set([".git", "node_modules", "dist", "build", "coverage"]);
const TEXT_FILE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".md",
  ".ps1",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const toSuccess = (value: unknown): ProviderToolResultObject => ({
  resultType: "success",
  textResultForLlm: typeof value === "string" ? value : JSON.stringify(value, null, 2),
});

const toFailure = (message: string): ProviderToolResultObject => ({
  resultType: "failure",
  error: message,
  textResultForLlm: message,
});

const getString = (value: unknown): string | null => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized : null;
};

const getBoolean = (value: unknown, fallback = false): boolean => (typeof value === "boolean" ? value : fallback);

const getNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const normalizeLineEndings = (value: string): string => value.replace(/\r\n/g, "\n");

const clampOutput = (value: string, maxChars = MAX_OUTPUT_CHARS): string =>
  value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeInputSequence = (input: string): string =>
  input
    .replace(/\{enter\}/g, "\n")
    .replace(/\{backspace\}/g, "\b")
    .replace(/\{tab\}/g, "\t");

const isHiddenEntry = (name: string): boolean => name.startsWith(".");

const splitLines = (value: string): string[] => normalizeLineEndings(value).split("\n");

const withLineNumbers = (lines: string[], startLine = 1): string =>
  lines.map((line, index) => `${startLine + index}. ${line}`).join("\n");

const asRange = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length !== 2) {
    return null;
  }
  const start = getNumber(value[0]);
  const end = getNumber(value[1]);
  if (start === null || end === null) {
    return null;
  }
  return [Math.max(1, Math.trunc(start)), Math.trunc(end)];
};

const ensureParentDirectory = async (targetPath: string): Promise<void> => {
  await mkdir(path.dirname(targetPath), { recursive: true });
};

const isWithinRoot = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const resolveWorkspacePath = (root: string, requestedPath: string): string => {
  const resolved = path.resolve(path.isAbsolute(requestedPath) ? requestedPath : path.join(root, requestedPath));
  if (!isWithinRoot(root, resolved)) {
    throw new Error(`Path ${resolved} is outside the working directory ${root}.`);
  }
  return resolved;
};

const normalizeSearchRoots = (root: string, value: unknown): string[] => {
  if (typeof value === "string" && value.trim()) {
    return [resolveWorkspacePath(root, value)];
  }
  if (Array.isArray(value)) {
    const resolved = value
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => resolveWorkspacePath(root, entry));
    if (resolved.length > 0) {
      return resolved;
    }
  }
  return [root];
};

const shouldTreatAsTextFile = (filePath: string): boolean => {
  const extension = path.extname(filePath).toLowerCase();
  return TEXT_FILE_EXTENSIONS.has(extension) || extension.length === 0;
};

const formatDirectoryTree = async (targetPath: string, depth = 0, maxDepth = 2): Promise<string[]> => {
  const entries = await readdir(targetPath, { withFileTypes: true });
  const visibleEntries = entries
    .filter((entry) => !isHiddenEntry(entry.name))
    .sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name));
  const lines: string[] = [];
  for (const entry of visibleEntries) {
    const prefix = depth === 0 ? "" : `${"  ".repeat(depth)}- `;
    const fullPath = path.join(targetPath, entry.name);
    lines.push(`${prefix}${entry.name}${entry.isDirectory() ? "\\" : ""}`);
    if (entry.isDirectory() && depth < maxDepth - 1) {
      lines.push(...(await formatDirectoryTree(fullPath, depth + 1, maxDepth)));
    }
  }
  return lines;
};

const renderView = async (root: string, args: Record<string, unknown>): Promise<string> => {
  const requestedPath = getString(args.path);
  if (!requestedPath) {
    throw new Error("view requires a non-empty path.");
  }
  const targetPath = resolveWorkspacePath(root, requestedPath);
  const fileStat = await stat(targetPath);
  if (fileStat.isDirectory()) {
    const tree = await formatDirectoryTree(targetPath);
    return [`Directory: ${targetPath}`, ...tree].join("\n");
  }
  if (!fileStat.isFile()) {
    throw new Error(`Path ${targetPath} is not a regular file.`);
  }
  if (!shouldTreatAsTextFile(targetPath)) {
    return `Binary file: ${targetPath}`;
  }
  if (fileStat.size > MAX_VIEW_BYTES && !getBoolean(args.forceReadLargeFiles)) {
    throw new Error(`File ${targetPath} is larger than ${MAX_VIEW_BYTES} bytes. Use forceReadLargeFiles to read it.`);
  }
  const content = await readFile(targetPath, "utf8");
  const lines = splitLines(content);
  const viewRange = asRange(args.view_range);
  if (!viewRange) {
    return withLineNumbers(lines);
  }
  const [startLine, endLine] = viewRange;
  const effectiveEnd = endLine === -1 ? lines.length : Math.max(startLine, endLine);
  return withLineNumbers(lines.slice(startLine - 1, effectiveEnd), startLine);
};

const globSegmentToRegex = (segment: string): string => {
  let index = 0;
  let pattern = "";
  while (index < segment.length) {
    const char = segment[index];
    if (char === "*") {
      pattern += "[^\\\\/]*";
      index += 1;
      continue;
    }
    if (char === "?") {
      pattern += "[^\\\\/]";
      index += 1;
      continue;
    }
    if (char === "{") {
      const closeIndex = segment.indexOf("}", index + 1);
      if (closeIndex > index) {
        const body = segment.slice(index + 1, closeIndex);
        const parts = body.split(",").map((part) => globSegmentToRegex(part));
        pattern += `(?:${parts.join("|")})`;
        index = closeIndex + 1;
        continue;
      }
    }
    pattern += escapeRegExp(char);
    index += 1;
  }
  return pattern;
};

const globPatternToRegExp = (pattern: string): RegExp => {
  const normalized = pattern.replace(/[\\/]+/g, "/");
  let index = 0;
  let regex = "^";
  while (index < normalized.length) {
    if (normalized.startsWith("**/", index)) {
      regex += "(?:.*\\/)?";
      index += 3;
      continue;
    }
    if (normalized.startsWith("**", index)) {
      regex += ".*";
      index += 2;
      continue;
    }
    const char = normalized[index];
    if (char === "/") {
      regex += "[\\\\/]";
      index += 1;
      continue;
    }
    let segment = "";
    while (index < normalized.length && normalized[index] !== "/") {
      segment += normalized[index];
      index += 1;
    }
    regex += globSegmentToRegex(segment);
  }
  regex += "$";
  return new RegExp(regex, "i");
};

const shouldSkipDirectory = (name: string): boolean => isHiddenEntry(name) || SKIPPED_DIRECTORY_NAMES.has(name);

const collectWorkspaceFiles = async (
  roots: string[],
  options: { globPattern?: string | null; fileType?: string | null } = {},
): Promise<string[]> => {
  const regex = options.globPattern ? globPatternToRegExp(options.globPattern) : null;
  const expectedExtension = options.fileType ? `.${options.fileType.replace(/^\./, "").toLowerCase()}` : null;
  const files: string[] = [];
  const visit = async (currentPath: string): Promise<void> => {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) {
          continue;
        }
        await visit(path.join(currentPath, entry.name));
        continue;
      }
      if (!entry.isFile() || isHiddenEntry(entry.name)) {
        continue;
      }
      const fullPath = path.join(currentPath, entry.name);
      if (expectedExtension && path.extname(entry.name).toLowerCase() !== expectedExtension) {
        continue;
      }
      if (regex) {
        const matches = roots.some((root) => regex.test(path.relative(root, fullPath).replace(/[\\/]+/g, "/")));
        if (!matches) {
          continue;
        }
      }
      files.push(fullPath);
    }
  };
  for (const root of roots) {
    await visit(root);
  }
  return files.sort((left, right) => left.localeCompare(right));
};

const renderGlob = async (root: string, args: Record<string, unknown>): Promise<unknown> => {
  const pattern = getString(args.pattern);
  if (!pattern) {
    throw new Error("glob requires a non-empty pattern.");
  }
  const roots = normalizeSearchRoots(root, args.paths);
  const matches = await collectWorkspaceFiles(roots, { globPattern: pattern });
  return {
    matches,
    count: matches.length,
  };
};

const renderRg = async (root: string, args: Record<string, unknown>): Promise<unknown> => {
  const pattern = getString(args.pattern);
  if (!pattern) {
    throw new Error("rg requires a non-empty pattern.");
  }
  const outputMode = getString(args.output_mode) ?? "files_with_matches";
  const roots = normalizeSearchRoots(root, args.paths);
  const globPattern = getString(args.glob);
  const fileType = getString(args.type);
  const headLimit = Math.max(1, Math.trunc(getNumber(args.head_limit) ?? 200));
  const showLineNumbers = getBoolean(args["-n"]);
  const before = Math.max(0, Math.trunc(getNumber(args["-B"]) ?? getNumber(args["-C"]) ?? 0));
  const after = Math.max(0, Math.trunc(getNumber(args["-A"]) ?? getNumber(args["-C"]) ?? 0));
  const flags = getBoolean(args["-i"]) ? "giu" : "gu";
  const files = await collectWorkspaceFiles(roots, { globPattern, fileType });
  if (outputMode === "files_with_matches") {
    const matches: string[] = [];
    for (const filePath of files) {
      const content = await readFile(filePath, "utf8");
      if (new RegExp(pattern, flags).test(normalizeLineEndings(content))) {
        matches.push(filePath);
        if (matches.length >= headLimit) {
          break;
        }
      }
    }
    return { files: matches, count: matches.length };
  }
  if (outputMode === "count") {
    const counts: Array<{ path: string; count: number }> = [];
    for (const filePath of files) {
      const content = normalizeLineEndings(await readFile(filePath, "utf8"));
      const matchCount = [...content.matchAll(new RegExp(pattern, flags))].length;
      if (matchCount > 0) {
        counts.push({ path: filePath, count: matchCount });
        if (counts.length >= headLimit) {
          break;
        }
      }
    }
    return { counts };
  }

  const matches: Array<{
    path: string;
    lineNumber?: number;
    line?: string;
    before?: string[];
    after?: string[];
  }> = [];
  for (const filePath of files) {
    const content = normalizeLineEndings(await readFile(filePath, "utf8"));
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!new RegExp(pattern, flags).test(line)) {
        continue;
      }
      matches.push({
        path: filePath,
        ...(showLineNumbers ? { lineNumber: index + 1 } : {}),
        line,
        ...(before > 0 ? { before: lines.slice(Math.max(0, index - before), index) } : {}),
        ...(after > 0 ? { after: lines.slice(index + 1, index + 1 + after) } : {}),
      });
      if (matches.length >= headLimit) {
        return { matches };
      }
    }
  }
  return { matches };
};

type ParsedPatch =
  | { type: "add"; path: string; lines: string[] }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; moveTo?: string; hunks: Array<{ lines: string[] }> };

const parsePatch = (patch: string): ParsedPatch[] => {
  const lines = normalizeLineEndings(patch).split("\n");
  if (lines[0] !== "*** Begin Patch") {
    throw new Error("Patch must begin with *** Begin Patch");
  }
  const operations: ParsedPatch[] = [];
  let index = 1;
  while (index < lines.length) {
    const line = lines[index];
    if (line === "*** End Patch") {
      return operations;
    }
    if (line.startsWith("*** Add File: ")) {
      const filePath = line.slice("*** Add File: ".length).trim();
      index += 1;
      const content: string[] = [];
      while (index < lines.length && lines[index] !== "*** End Patch" && !lines[index].startsWith("*** ")) {
        const contentLine = lines[index];
        if (!contentLine.startsWith("+")) {
          throw new Error(`Added file ${filePath} contains an invalid line: ${contentLine}`);
        }
        content.push(contentLine.slice(1));
        index += 1;
      }
      operations.push({ type: "add", path: filePath, lines: content });
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      operations.push({ type: "delete", path: line.slice("*** Delete File: ".length).trim() });
      index += 1;
      continue;
    }
    if (line.startsWith("*** Update File: ")) {
      const filePath = line.slice("*** Update File: ".length).trim();
      index += 1;
      let moveTo: string | undefined;
      if (lines[index]?.startsWith("*** Move to: ")) {
        moveTo = lines[index].slice("*** Move to: ".length).trim();
        index += 1;
      }
      const hunks: Array<{ lines: string[] }> = [];
      let currentHunk: string[] | null = null;
      while (index < lines.length && lines[index] !== "*** End Patch") {
        const currentLine = lines[index];
        if (currentLine === "*** End of File") {
          index += 1;
          continue;
        }
        if (currentLine.startsWith("*** ")) {
          break;
        }
        if (currentLine === "@@" || currentLine.startsWith("@@ ")) {
          if (currentHunk) {
            hunks.push({ lines: currentHunk });
          }
          currentHunk = [];
          index += 1;
          continue;
        }
        if (!currentHunk) {
          currentHunk = [];
        }
        currentHunk.push(currentLine);
        index += 1;
      }
      if (currentHunk) {
        hunks.push({ lines: currentHunk });
      }
      operations.push({ type: "update", path: filePath, moveTo, hunks });
      continue;
    }
    throw new Error(`Unsupported patch line: ${line}`);
  }
  throw new Error("Patch is missing *** End Patch");
};

const findHunkStart = (sourceLines: string[], oldLines: string[], startIndex: number): number => {
  if (oldLines.length === 0) {
    return startIndex;
  }
  for (let index = startIndex; index <= sourceLines.length - oldLines.length; index += 1) {
    const matches = oldLines.every((line, offset) => sourceLines[index + offset] === line);
    if (matches) {
      return index;
    }
  }
  return -1;
};

const applyPatchToContent = (content: string, hunks: Array<{ lines: string[] }>): string => {
  const sourceLines = splitLines(content);
  const workingLines = [...sourceLines];
  let searchStart = 0;
  for (const hunk of hunks) {
    const oldLines = hunk.lines
      .filter((line) => line.startsWith(" ") || line.startsWith("-"))
      .map((line) => line.slice(1));
    const newLines = hunk.lines
      .filter((line) => line.startsWith(" ") || line.startsWith("+"))
      .map((line) => line.slice(1));
    const startIndex = findHunkStart(workingLines, oldLines, searchStart);
    if (startIndex < 0) {
      throw new Error("Failed to apply patch hunk because the expected context was not found.");
    }
    workingLines.splice(startIndex, oldLines.length, ...newLines);
    searchStart = startIndex + newLines.length;
  }
  return `${workingLines.join("\n")}${content.endsWith("\n") ? "\n" : ""}`;
};

const applyPatchToWorkspace = async (root: string, patchText: string): Promise<unknown> => {
  const operations = parsePatch(patchText);
  const changedFiles: string[] = [];
  for (const operation of operations) {
    switch (operation.type) {
      case "add": {
        const targetPath = resolveWorkspacePath(root, operation.path);
        await ensureParentDirectory(targetPath);
        await writeFile(targetPath, `${operation.lines.join("\n")}\n`, "utf8");
        changedFiles.push(targetPath);
        break;
      }
      case "delete": {
        const targetPath = resolveWorkspacePath(root, operation.path);
        await rm(targetPath, { force: true });
        changedFiles.push(targetPath);
        break;
      }
      case "update": {
        const targetPath = resolveWorkspacePath(root, operation.path);
        const current = await readFile(targetPath, "utf8");
        const updated = applyPatchToContent(current, operation.hunks);
        await ensureParentDirectory(targetPath);
        await writeFile(targetPath, updated, "utf8");
        changedFiles.push(targetPath);
        if (operation.moveTo) {
          const movedPath = resolveWorkspacePath(root, operation.moveTo);
          await ensureParentDirectory(movedPath);
          await rename(targetPath, movedPath);
          changedFiles.push(movedPath);
        }
        break;
      }
    }
  }
  return { changedFiles };
};

type PowerShellSessionStatus = "running" | "completed" | "failed" | "stopped";

interface PowerShellSessionRecord {
  shellId: string;
  command: string;
  description: string;
  mode: "sync" | "async";
  detached: boolean;
  process: ChildProcessWithoutNullStreams | null;
  status: PowerShellSessionStatus;
  pid: number | null;
  output: string;
  startedAt: number;
  updatedAt: number;
  exitCode: number | null;
  hasUnreadOutput: boolean;
}

class PowerShellSessionManager {
  private readonly sessions = new Map<string, PowerShellSessionRecord>();

  async start(args: Record<string, unknown>): Promise<unknown> {
    const command = getString(args.command);
    const description = getString(args.description);
    if (!command || !description) {
      throw new Error("powershell requires non-empty command and description fields.");
    }
    const mode = getString(args.mode) === "async" ? "async" : "sync";
    const initialWait = Math.max(1, Math.trunc(getNumber(args.initial_wait) ?? DEFAULT_INITIAL_WAIT_SECONDS));
    const requestedShellId = getString(args.shellId) ?? `shell-${randomUUID()}`;
    if (this.sessions.has(requestedShellId)) {
      throw new Error(`PowerShell session ${requestedShellId} already exists.`);
    }
    const detached = getBoolean(args.detach);
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        detached,
      },
    );
    if (detached) {
      child.unref();
    }
    const record: PowerShellSessionRecord = {
      shellId: requestedShellId,
      command,
      description,
      mode,
      detached,
      process: child,
      status: "running",
      pid: child.pid ?? null,
      output: "",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      exitCode: null,
      hasUnreadOutput: false,
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const onData = (chunk: string) => {
      record.output = clampOutput(`${record.output}${chunk}`);
      record.updatedAt = Date.now();
      record.hasUnreadOutput = true;
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const childEvents = child as ChildProcessWithoutNullStreams & NodeJS.EventEmitter;
    childEvents.on("close", (exitCode: number | null) => {
      record.status = exitCode === 0 ? "completed" : "failed";
      record.exitCode = exitCode ?? -1;
      record.updatedAt = Date.now();
      record.process = null;
      record.hasUnreadOutput = true;
    });
    childEvents.on("error", (error: Error) => {
      record.status = "failed";
      record.exitCode = -1;
      record.output = clampOutput(`${record.output}\n${error.message}`);
      record.updatedAt = Date.now();
      record.process = null;
      record.hasUnreadOutput = true;
    });
    this.sessions.set(requestedShellId, record);
    if (mode === "async") {
      if (initialWait > 0) {
        await this.delay(initialWait);
      }
      return this.serialize(record);
    }
    await this.waitForCompletionOrTimeout(record, initialWait);
    const serialized = this.serialize(record);
    if (record.status !== "running") {
      this.sessions.delete(record.shellId);
    }
    return serialized;
  }

  async read(shellId: string, delaySeconds: number): Promise<unknown> {
    const record = this.get(shellId);
    await this.delay(delaySeconds);
    return this.serialize(record);
  }

  async write(shellId: string, input: string, delaySeconds: number): Promise<unknown> {
    const record = this.get(shellId);
    if (!record.process || record.status !== "running") {
      throw new Error(`PowerShell session ${shellId} is not running.`);
    }
    record.process.stdin.write(normalizeInputSequence(input));
    record.updatedAt = Date.now();
    await this.delay(delaySeconds);
    return this.serialize(record);
  }

  stop(shellId: string): unknown {
    const record = this.get(shellId);
    record.process?.kill();
    record.process = null;
    record.status = "stopped";
    record.updatedAt = Date.now();
    record.hasUnreadOutput = true;
    return this.serialize(record);
  }

  list(): unknown {
    return {
      sessions: [...this.sessions.values()]
        .map((record) => ({
          shellId: record.shellId,
          command: record.command,
          description: record.description,
          mode: record.mode,
          status: record.status,
          pid: record.pid,
          hasUnreadOutput: record.hasUnreadOutput,
          startedAt: record.startedAt,
          updatedAt: record.updatedAt,
        }))
        .sort((left, right) => right.startedAt - left.startedAt),
    };
  }

  private get(shellId: string): PowerShellSessionRecord {
    const record = this.sessions.get(shellId);
    if (!record) {
      throw new Error(`PowerShell session ${shellId} was not found.`);
    }
    return record;
  }

  private async waitForCompletionOrTimeout(record: PowerShellSessionRecord, initialWait: number): Promise<void> {
    if (record.status !== "running") {
      return;
    }
    await Promise.race([
      new Promise<void>((resolve) => {
        const check = () => {
          if (record.status !== "running") {
            resolve();
            return;
          }
          setTimeout(check, 100);
        };
        check();
      }),
      this.delay(initialWait),
    ]);
  }

  private async delay(seconds: number): Promise<void> {
    if (seconds <= 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, seconds * 1000);
    });
  }

  private serialize(record: PowerShellSessionRecord): Record<string, unknown> {
    const serialized = {
      shellId: record.shellId,
      command: record.command,
      description: record.description,
      mode: record.mode,
      detached: record.detached,
      status: record.status,
      pid: record.pid,
      exitCode: record.exitCode,
      output: record.output.trim(),
      startedAt: record.startedAt,
      updatedAt: record.updatedAt,
      hasUnreadOutput: record.hasUnreadOutput,
    };
    record.hasUnreadOutput = false;
    return serialized;
  }
}

const powerShellSessions = new PowerShellSessionManager();

const buildSessionArtifactTool = (
  name: string,
  description: string,
  kind: StationSessionArtifactKind,
  storage: StationSessionStorage,
  mode: "get" | "set",
): ProviderToolDefinition =>
  mode === "get"
    ? {
        name,
        description,
        parameters: { type: "object", properties: {}, additionalProperties: false },
        skipPermission: true,
        handler: async () => toSuccess(storage.get(kind) ?? ""),
      }
    : {
        name,
        description,
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The content to store. Pass an empty string to clear the stored value.",
            },
          },
          required: ["content"],
          additionalProperties: false,
        },
        handler: async (args) => toSuccess({ content: storage.set(kind, getString(args.content) ?? "") }),
      };

export const createHostTools = (options: {
  workingDirectory: string;
  sessionStorage?: StationSessionStorage | null;
}): ProviderToolDefinition[] => {
  const tools: ProviderToolDefinition[] = [
    {
      name: "view",
      description:
        "View a file or directory inside the current working directory. Files are rendered with line numbers and directories list visible entries up to two levels deep.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or workspace-relative path to inspect." },
          view_range: {
            type: "array",
            items: { type: "number" },
            minItems: 2,
            maxItems: 2,
            description: "Optional 1-based inclusive line range [start, end]. Use -1 for end to mean EOF.",
          },
          forceReadLargeFiles: { type: "boolean" },
        },
        required: ["path"],
        additionalProperties: false,
      },
      skipPermission: true,
      handler: async (args) => {
        try {
          return toSuccess(await renderView(options.workingDirectory, args));
        } catch (error) {
          return toFailure(error instanceof Error ? error.message : "Failed to view the requested path.");
        }
      },
    },
    {
      name: "glob",
      description: "Find files by glob pattern inside the current working directory.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          paths: {
            oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
          },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
      skipPermission: true,
      handler: async (args) => {
        try {
          return toSuccess(await renderGlob(options.workingDirectory, args));
        } catch (error) {
          return toFailure(error instanceof Error ? error.message : "Failed to resolve the glob pattern.");
        }
      },
    },
    {
      name: "rg",
      description: "Search file contents with a regular expression inside the current working directory.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          paths: {
            oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
          },
          output_mode: { type: "string", enum: ["content", "files_with_matches", "count"] },
          glob: { type: "string" },
          type: { type: "string" },
          "-i": { type: "boolean" },
          "-n": { type: "boolean" },
          "-A": { type: "number" },
          "-B": { type: "number" },
          "-C": { type: "number" },
          head_limit: { type: "number" },
        },
        required: ["pattern"],
        additionalProperties: true,
      },
      skipPermission: true,
      handler: async (args) => {
        try {
          return toSuccess(await renderRg(options.workingDirectory, args));
        } catch (error) {
          return toFailure(error instanceof Error ? error.message : "Failed to execute the requested search.");
        }
      },
    },
    {
      name: "write_file",
      description: "Write or append text to a file inside the current working directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          append: { type: "boolean" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const requestedPath = getString(args.path);
          if (!requestedPath) {
            throw new Error("write_file requires a non-empty path.");
          }
          const targetPath = resolveWorkspacePath(options.workingDirectory, requestedPath);
          const content = typeof args.content === "string" ? args.content : JSON.stringify(args.content, null, 2);
          await ensureParentDirectory(targetPath);
          if (getBoolean(args.append)) {
            const current = await readFile(targetPath, "utf8").catch(() => "");
            await writeFile(targetPath, `${current}${content}`, "utf8");
          } else {
            await writeFile(targetPath, content, "utf8");
          }
          return toSuccess({ path: targetPath, bytesWritten: Buffer.byteLength(content, "utf8") });
        } catch (error) {
          return toFailure(error instanceof Error ? error.message : "Failed to write the requested file.");
        }
      },
    },
    {
      name: "apply_patch",
      description:
        "Apply a structured patch to files inside the current working directory using the standard *** Begin Patch / *** End Patch format.",
      parameters: {
        type: "object",
        properties: {
          patch: { type: "string" },
        },
        required: ["patch"],
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const patch = getString(args.patch);
          if (!patch) {
            throw new Error("apply_patch requires a non-empty patch string.");
          }
          return toSuccess(await applyPatchToWorkspace(options.workingDirectory, patch));
        } catch (error) {
          return toFailure(error instanceof Error ? error.message : "Failed to apply the requested patch.");
        }
      },
    },
    {
      name: "powershell",
      description:
        "Run a PowerShell command. Sync mode waits for initial output; async mode keeps the process available for later read, write, or stop operations.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          description: { type: "string" },
          shellId: { type: "string" },
          mode: { type: "string", enum: ["sync", "async"] },
          detach: { type: "boolean" },
          initial_wait: { type: "number" },
        },
        required: ["command", "description"],
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          return toSuccess(await powerShellSessions.start(args));
        } catch (error) {
          return toFailure(error instanceof Error ? error.message : "Failed to start the PowerShell command.");
        }
      },
    },
    {
      name: "read_powershell",
      description: "Read output from a previously started PowerShell session after an optional delay.",
      parameters: {
        type: "object",
        properties: {
          shellId: { type: "string" },
          delay: { type: "number" },
        },
        required: ["shellId", "delay"],
        additionalProperties: false,
      },
      skipPermission: true,
      handler: async (args) => {
        try {
          const shellId = getString(args.shellId);
          if (!shellId) {
            throw new Error("read_powershell requires shellId.");
          }
          const delay = Math.max(0, Math.trunc(getNumber(args.delay) ?? 0));
          return toSuccess(await powerShellSessions.read(shellId, delay));
        } catch (error) {
          return toFailure(error instanceof Error ? error.message : "Failed to read the PowerShell session.");
        }
      },
    },
    {
      name: "write_powershell",
      description: "Send text or key tokens such as {enter} to a running PowerShell session.",
      parameters: {
        type: "object",
        properties: {
          shellId: { type: "string" },
          input: { type: "string" },
          delay: { type: "number" },
        },
        required: ["shellId", "delay"],
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const shellId = getString(args.shellId);
          if (!shellId) {
            throw new Error("write_powershell requires shellId.");
          }
          const delay = Math.max(0, Math.trunc(getNumber(args.delay) ?? 0));
          return toSuccess(await powerShellSessions.write(shellId, typeof args.input === "string" ? args.input : "", delay));
        } catch (error) {
          return toFailure(error instanceof Error ? error.message : "Failed to write to the PowerShell session.");
        }
      },
    },
    {
      name: "stop_powershell",
      description: "Stop a running PowerShell session by shellId.",
      parameters: {
        type: "object",
        properties: {
          shellId: { type: "string" },
        },
        required: ["shellId"],
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const shellId = getString(args.shellId);
          if (!shellId) {
            throw new Error("stop_powershell requires shellId.");
          }
          return toSuccess(powerShellSessions.stop(shellId));
        } catch (error) {
          return toFailure(error instanceof Error ? error.message : "Failed to stop the PowerShell session.");
        }
      },
    },
    {
      name: "list_powershell",
      description: "List active and completed PowerShell sessions tracked by the host runtime.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      skipPermission: true,
      handler: async () => {
        try {
          return toSuccess(powerShellSessions.list());
        } catch (error) {
          return toFailure(error instanceof Error ? error.message : "Failed to list PowerShell sessions.");
        }
      },
    },
  ];

  if (options.sessionStorage) {
    tools.push(
      buildSessionArtifactTool(
        "spira_session_get_plan",
        "Read the durable plan stored for the current station session.",
        "plan",
        options.sessionStorage,
        "get",
      ),
      buildSessionArtifactTool(
        "spira_session_set_plan",
        "Write or clear the durable plan stored for the current station session.",
        "plan",
        options.sessionStorage,
        "set",
      ),
      buildSessionArtifactTool(
        "spira_session_get_scratchpad",
        "Read the durable scratchpad stored for the current station session.",
        "scratchpad",
        options.sessionStorage,
        "get",
      ),
      buildSessionArtifactTool(
        "spira_session_set_scratchpad",
        "Write or clear the durable scratchpad stored for the current station session.",
        "scratchpad",
        options.sessionStorage,
        "set",
      ),
      buildSessionArtifactTool(
        "spira_session_get_context",
        "Read structured durable context stored for the current station session.",
        "context",
        options.sessionStorage,
        "get",
      ),
      buildSessionArtifactTool(
        "spira_session_set_context",
        "Write or clear structured durable context stored for the current station session.",
        "context",
        options.sessionStorage,
        "set",
      ),
    );
  }

  return tools.map((tool) => ({
    ...tool,
    overridesBuiltInTool: true,
  }));
};
