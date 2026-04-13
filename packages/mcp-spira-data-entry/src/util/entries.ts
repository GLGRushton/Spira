export const normalizeIdentifier = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

export const describeSource = (source: "builtin" | "user" | undefined): "built-in" | "custom" =>
  (source ?? "builtin") === "user" ? "custom" : "built-in";
