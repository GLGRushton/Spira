import type { OcrLine, OcrRectangle } from "@spira/shared";

export type TextMatchMode = "exact" | "contains" | "regex";

export interface OcrTextMatch {
  lineIndex: number;
  text: string;
  bounds: OcrRectangle;
}

export interface FindOcrTextMatchesOptions {
  query: string;
  match: TextMatchMode;
  region?: OcrRectangle;
}

const normalize = (value: string): string => value.trim().toLocaleLowerCase();

const intersectsRegion = (bounds: OcrRectangle, region?: OcrRectangle): boolean => {
  if (!region) {
    return true;
  }

  return !(
    bounds.x + bounds.width < region.x ||
    region.x + region.width < bounds.x ||
    bounds.y + bounds.height < region.y ||
    region.y + region.height < bounds.y
  );
};

const textMatches = (text: string, query: string, match: TextMatchMode): boolean => {
  if (match === "regex") {
    return new RegExp(query, "iu").test(text);
  }

  const normalizedText = normalize(text);
  const normalizedQuery = normalize(query);
  if (match === "exact") {
    return normalizedText === normalizedQuery;
  }

  return normalizedText.includes(normalizedQuery);
};

export function findOcrTextMatches(lines: OcrLine[], options: FindOcrTextMatchesOptions): OcrTextMatch[] {
  const matches: OcrTextMatch[] = [];

  lines.forEach((line, lineIndex) => {
    if (!line.bounds || !line.text || !intersectsRegion(line.bounds, options.region)) {
      return;
    }

    if (!textMatches(line.text, options.query, options.match)) {
      return;
    }

    matches.push({
      lineIndex,
      text: line.text,
      bounds: line.bounds,
    });
  });

  return matches;
}
