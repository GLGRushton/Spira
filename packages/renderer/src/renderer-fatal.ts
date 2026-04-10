import type { RendererFatalPayload } from "@spira/shared";

const MAX_DETAILS_LENGTH = 8_000;

const trimDetails = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.slice(0, MAX_DETAILS_LENGTH);
};

const describeUnknownError = (error: unknown): string | undefined => {
  if (error instanceof Error) {
    return error.message.trim() || undefined;
  }

  if (typeof error === "string") {
    const trimmed = error.trim();
    return trimmed || undefined;
  }

  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return String(error);
  }

  return undefined;
};

const buildErrorDetails = (error: unknown, componentStack?: string): string | undefined => {
  const sections: string[] = [];
  if (error instanceof Error) {
    sections.push(error.stack?.trim() || error.message.trim());
  } else {
    const description = describeUnknownError(error);
    if (description) {
      sections.push(description);
    }
  }

  const trimmedComponentStack = componentStack?.trim();
  if (trimmedComponentStack) {
    sections.push(`React component stack:\n${trimmedComponentStack}`);
  }

  return trimDetails(sections.join("\n\n"));
};

export const createRendererFatalPayload = (
  error: unknown,
  phase: "bootstrap" | "runtime",
  componentStack?: string,
): RendererFatalPayload => {
  const description = describeUnknownError(error);
  const details = buildErrorDetails(error, componentStack);
  return {
    phase,
    title: phase === "bootstrap" ? "Spira couldn't finish loading" : "Spira hit a UI failure",
    message:
      phase === "bootstrap"
        ? description
          ? `A renderer error stopped the interface before it finished loading: ${description}`
          : "A renderer error stopped the interface before it finished loading."
        : description
          ? `The interface encountered an unrecoverable error: ${description}`
          : "The interface encountered an unrecoverable error.",
    details,
  };
};
