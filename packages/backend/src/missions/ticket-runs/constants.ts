export const WORKTREE_DIRECTORY_NAME = ".spira-worktrees";
export const MAX_BRANCH_NAME_LENGTH = 63;
export const MAX_SLUG_LENGTH = 40;
export const MINUTE_MS = 60_000;
export const DEFAULT_GIT_COMMAND_TIMEOUT_MS = MINUTE_MS;
export const LONG_RUNNING_GIT_COMMAND_TIMEOUT_MS = 10 * MINUTE_MS;
export const DEFAULT_GIT_COMMAND_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
export const GITHUB_HTTP_EXTRAHEADER_CONFIG_KEY = "http.https://github.com/.extraheader";
export const GITHUB_CREDENTIAL_PROMPT_DISABLED_PATTERN =
  /Cannot prompt because user interactivity has been disabled|terminal prompts disabled|could not read Username for 'https:\/\/github\.com'/iu;
export const GIT_FAILURE_NOISE_PATTERNS = [
  /^Git command (?:failed|timed out) in .+?: git /iu,
  /^Command failed:\s*git\b/iu,
];
