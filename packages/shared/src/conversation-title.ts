const MAX_TITLE_WORDS = 3;
const ACRONYM_MAX_LENGTH = 5;
const LEADING_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "i",
  "me",
  "my",
  "you",
  "your",
  "we",
  "our",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "do",
  "does",
  "did",
  "can",
  "could",
  "would",
  "should",
  "please",
  "hey",
  "hi",
  "hello",
  "yo",
  "what",
  "why",
  "how",
  "when",
  "where",
  "which",
  "who",
]);

const normalizeWhitespace = (value: string): string => value.trim().replace(/\s+/gu, " ");

const cleanToken = (token: string): string => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

const formatToken = (token: string): string => {
  if (token.length <= ACRONYM_MAX_LENGTH && token === token.toUpperCase()) {
    return token;
  }

  return `${token[0]?.toUpperCase() ?? ""}${token.slice(1).toLowerCase()}`;
};

export const summarizeConversationTitle = (content: string): string | null => {
  const normalized = normalizeWhitespace(content);
  if (!normalized) {
    return null;
  }

  const cleanedTokens = normalized.split(" ").map(cleanToken).filter(Boolean);
  if (cleanedTokens.length === 0) {
    return null;
  }

  const meaningfulTokens = [...cleanedTokens];
  while (meaningfulTokens.length > 0 && LEADING_STOPWORDS.has(meaningfulTokens[0]?.toLowerCase() ?? "")) {
    meaningfulTokens.shift();
  }

  const selectedTokens = (meaningfulTokens.length > 0 ? meaningfulTokens : cleanedTokens)
    .slice(0, MAX_TITLE_WORDS)
    .map(formatToken);

  return selectedTokens.length > 0 ? selectedTokens.join(" ") : null;
};
