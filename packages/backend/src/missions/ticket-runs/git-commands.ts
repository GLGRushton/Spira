import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SpiraError } from "../../util/errors.js";
import {
  DEFAULT_GIT_COMMAND_MAX_BUFFER_BYTES,
  DEFAULT_GIT_COMMAND_TIMEOUT_MS,
  GITHUB_CREDENTIAL_PROMPT_DISABLED_PATTERN,
  GITHUB_HTTP_EXTRAHEADER_CONFIG_KEY,
  GIT_FAILURE_NOISE_PATTERNS,
  LONG_RUNNING_GIT_COMMAND_TIMEOUT_MS,
} from "./constants.js";
import type { GitCommandRunner } from "./types.js";

const execFileAsync = promisify(execFile);

export const buildGitHubHttpAuthArgs = (token: string): string[] => {
  const authHeader = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `${GITHUB_HTTP_EXTRAHEADER_CONFIG_KEY}=AUTHORIZATION: basic ${authHeader}`];
};

export const isGitHubCredentialPromptFailure = (error: unknown): boolean => {
  const text =
    error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : typeof error === "string" ? error : "";
  return text.length > 0 && GITHUB_CREDENTIAL_PROMPT_DISABLED_PATTERN.test(text);
};

const collectNestedGitErrorText = (error: unknown, seen = new Set<object>()): string[] => {
  if (typeof error === "string") {
    return [error];
  }

  if (!(error instanceof Error) && (typeof error !== "object" || error === null)) {
    return [];
  }

  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(error.message);
  }

  if (typeof error === "object" && error !== null) {
    if (seen.has(error)) {
      return parts;
    }
    seen.add(error);

    const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : null;
    const stdout = "stdout" in error && typeof error.stdout === "string" ? error.stdout : null;
    if (stderr) {
      parts.push(stderr);
    }
    if (stdout) {
      parts.push(stdout);
    }

    if ("cause" in error && error.cause !== undefined) {
      parts.push(...collectNestedGitErrorText(error.cause, seen));
    }
  }

  return parts;
};

export const extractGitFailureDetail = (error: unknown): string | null => {
  const lines = collectNestedGitErrorText(error)
    .flatMap((part) => part.split(/\r?\n/u))
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("at "))
    .filter((line) => !GIT_FAILURE_NOISE_PATTERNS.some((pattern) => pattern.test(line)));

  if (lines.length === 0) {
    return null;
  }

  const uniqueLines = [...new Set(lines)];
  const emphasizedLines = uniqueLines.filter(
    (line) =>
      /^(?:fatal|remote|error|warning|hint):/iu.test(line) ||
      /(authentication failed|repository not found|access denied|permission denied|terminal prompts disabled|could not read username|cannot prompt|not a git repository|no url found for submodule path|did not contain)/iu.test(
        line,
      ),
  );
  const detail = (emphasizedLines.length > 0 ? emphasizedLines : uniqueLines)
    .slice(0, 3)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
  return detail.length > 0 ? detail : null;
};

const stripInlineGitConfigs = (args: readonly string[]): string[] => {
  const normalized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "-c") {
      index += 1;
      continue;
    }
    normalized.push(args[index] ?? "");
  }
  return normalized;
};

const resolveGitCommandTimeoutMs = (args: readonly string[]): number => {
  const normalizedArgs = stripInlineGitConfigs(args);
  const command = normalizedArgs[0];
  const subcommand = normalizedArgs[1];
  if (
    (command === "submodule" && subcommand === "update") ||
    (command === "worktree" && (subcommand === "add" || subcommand === "remove" || subcommand === "prune")) ||
    command === "fetch" ||
    command === "push"
  ) {
    return LONG_RUNNING_GIT_COMMAND_TIMEOUT_MS;
  }
  return DEFAULT_GIT_COMMAND_TIMEOUT_MS;
};

export const defaultGitCommandRunner: GitCommandRunner = async (cwd, args) => {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      env: {
        ...process.env,
        GCM_INTERACTIVE: "Never",
        GIT_TERMINAL_PROMPT: "0",
      },
      maxBuffer: DEFAULT_GIT_COMMAND_MAX_BUFFER_BYTES,
      timeout: resolveGitCommandTimeoutMs(args),
      windowsHide: true,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const sanitizedArgs = args.map((arg) =>
      /^http(?:\..+)?\.extraheader=AUTHORIZATION:\s+/iu.test(arg)
        ? `${arg.slice(0, arg.indexOf("AUTHORIZATION:"))}AUTHORIZATION: [REDACTED]`
        : arg,
    );
    const timedOut =
      typeof error === "object" &&
      error !== null &&
      "killed" in error &&
      (error as { killed?: unknown }).killed === true;
    throw new SpiraError(
      "TICKET_RUN_GIT_ERROR",
      `${timedOut ? "Git command timed out" : "Git command failed"} in ${cwd}: git ${sanitizedArgs.join(" ")}`,
      error,
    );
  }
};
