/**
 * Helpers shared by the settings-pane admin editors (proof rules, repo profiles,
 * validation profiles). Kept tiny on purpose — extract more only when a fourth editor
 * arrives and the same shape repeats again.
 */

/**
 * Split a textarea value (comma- or newline-separated entries) into a clean string array.
 * Empty entries are dropped; surrounding whitespace is trimmed.
 */
export const splitList = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
