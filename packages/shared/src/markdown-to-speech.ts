const FENCED_CODE_BLOCK_PATTERN = /```[\t ]*[\w-]*\r?\n([\s\S]*?)```/g;
const INLINE_CODE_PATTERN = /`([^`]+)`/g;
const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)/g;
const LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;
const AUTOLINK_PATTERN = /<((?:https?:\/\/|mailto:)[^>]+)>/g;
const HTML_TAG_PATTERN = /<\/?[^>]+>/g;
const TABLE_DIVIDER_PATTERN = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;
const HEADING_PATTERN = /^\s{0,3}#{1,6}\s+/;
const BLOCKQUOTE_PATTERN = /^\s{0,3}>\s?/;
const UNORDERED_LIST_PATTERN = /^(\s*)[-*+]\s+/;
const ORDERED_LIST_PATTERN = /^(\s*)\d+\.\s+/;
const TASK_LIST_PATTERN = /^\[([ xX])\]\s+/;
const CODE_SPAN_TOKEN_PREFIX = "SPIRACODESPAN";
const WORD_CHARACTER_CLASS = "\\p{L}\\p{N}";

function stripPairedDelimiters(text: string, delimiter: string): string {
  const escapedDelimiter = delimiter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(^|[^${WORD_CHARACTER_CLASS}])${escapedDelimiter}(\\S(?:.*?\\S)?)${escapedDelimiter}(?=[^${WORD_CHARACTER_CLASS}]|$)`,
    "gu",
  );
  return text.replace(pattern, "$1$2");
}

function protectCodeSpans(markdown: string): { text: string; restore: (value: string) => string } {
  const protectedSegments: string[] = [];
  const createToken = (content: string): string => {
    const token = `${CODE_SPAN_TOKEN_PREFIX}${protectedSegments.length}TOKEN`;
    protectedSegments.push(content);
    return token;
  };

  const withProtectedBlocks = markdown.replace(
    FENCED_CODE_BLOCK_PATTERN,
    (_match, code: string) => `${createToken(code.trimEnd())}\n`,
  );
  const text = withProtectedBlocks.replace(INLINE_CODE_PATTERN, (_match, code: string) => createToken(code));

  return {
    text,
    restore: (value: string) =>
      protectedSegments.reduce(
        (restored, segment, index) => restored.replaceAll(`${CODE_SPAN_TOKEN_PREFIX}${index}TOKEN`, segment),
        value,
      ),
  };
}

function normalizeLine(line: string): string | null {
  if (TABLE_DIVIDER_PATTERN.test(line)) {
    return null;
  }

  let normalized = line
    .replace(HEADING_PATTERN, "")
    .replace(BLOCKQUOTE_PATTERN, "")
    .replace(UNORDERED_LIST_PATTERN, "$1")
    .replace(ORDERED_LIST_PATTERN, "$1")
    .replace(TASK_LIST_PATTERN, "");

  if (normalized.includes("|")) {
    const cells = normalized
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);
    normalized = cells.join(", ");
  }

  return normalized.trim();
}

export function markdownToSpeechText(markdown: string): string {
  const { text: protectedMarkdown, restore } = protectCodeSpans(markdown);
  const withoutBlocks = protectedMarkdown
    .replace(IMAGE_PATTERN, (_match, alt: string) => alt.trim())
    .replace(LINK_PATTERN, "$1")
    .replace(AUTOLINK_PATTERN, "$1")
    .replace(HTML_TAG_PATTERN, "");

  const withoutFormatting = ["**", "__", "~~", "*", "_"].reduce(
    (value, delimiter) => stripPairedDelimiters(value, delimiter),
    withoutBlocks,
  );

  const normalizedLines = withoutFormatting
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => normalizeLine(line))
    .filter((line): line is string => line !== null);

  return restore(
    normalizedLines
      .filter(
        (line, index, lines) =>
          line.length > 0 ||
          (index > 0 && index < lines.length - 1 && lines[index - 1].length > 0 && lines[index + 1].length > 0),
      )
      .join("\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  );
}
