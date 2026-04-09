import { basename } from "node:path";

export interface CommandLaunchCandidate {
  kind: "command";
  name: string;
  path: string;
}

export interface StartAppLaunchCandidate {
  kind: "start-app";
  name: string;
  appId: string;
}

export type LaunchCandidate = CommandLaunchCandidate | StartAppLaunchCandidate;

export interface RankedLaunchCandidate {
  candidate: LaunchCandidate;
  score: number;
  exactMatch: boolean;
}

const normalize = (value: string): string =>
  value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const tokenize = (value: string): string[] => normalize(value).split(" ").filter(Boolean);

const damerauLevenshteinDistance = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }

  if (!left.length) {
    return right.length;
  }

  if (!right.length) {
    return left.length;
  }

  const previousPrevious = new Array<number>(right.length + 1).fill(0);
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1).fill(0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      let best = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );

      if (
        leftIndex > 1 &&
        rightIndex > 1 &&
        left[leftIndex - 1] === right[rightIndex - 2] &&
        left[leftIndex - 2] === right[rightIndex - 1]
      ) {
        best = Math.min(best, previousPrevious[rightIndex - 2] + 1);
      }

      current[rightIndex] = best;
    }

    for (let rightIndex = 0; rightIndex <= right.length; rightIndex += 1) {
      previousPrevious[rightIndex] = previous[rightIndex];
      previous[rightIndex] = current[rightIndex];
    }
  }

  return previous[right.length];
};

const diceCoefficient = (left: string, right: string): number => {
  if (!left.length || !right.length) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  const makeBigrams = (value: string): string[] => {
    if (value.length < 2) {
      return [value];
    }

    const grams: string[] = [];
    for (let index = 0; index < value.length - 1; index += 1) {
      grams.push(value.slice(index, index + 2));
    }
    return grams;
  };

  const leftBigrams = makeBigrams(left);
  const rightBigrams = makeBigrams(right);
  const rightCounts = new Map<string, number>();
  for (const gram of rightBigrams) {
    rightCounts.set(gram, (rightCounts.get(gram) ?? 0) + 1);
  }

  let intersection = 0;
  for (const gram of leftBigrams) {
    const count = rightCounts.get(gram) ?? 0;
    if (count <= 0) {
      continue;
    }

    intersection += 1;
    rightCounts.set(gram, count - 1);
  }

  return (2 * intersection) / (leftBigrams.length + rightBigrams.length);
};

const tokenOverlap = (left: string, right: string): number => {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
};

const candidateLabels = (candidate: LaunchCandidate): string[] =>
  candidate.kind === "command" ? [candidate.name, basename(candidate.path)] : [candidate.name, candidate.appId];

const scoreLabel = (query: string, label: string): { score: number; exactMatch: boolean } => {
  const normalizedQuery = normalize(query);
  const normalizedLabel = normalize(label);

  if (!normalizedQuery || !normalizedLabel) {
    return { score: 0, exactMatch: false };
  }

  if (normalizedQuery === normalizedLabel) {
    return { score: 1, exactMatch: true };
  }

  if (normalizedLabel.includes(normalizedQuery) || normalizedQuery.includes(normalizedLabel)) {
    return { score: 0.92, exactMatch: false };
  }

  const compactQuery = normalizedQuery.replaceAll(" ", "");
  const compactLabel = normalizedLabel.replaceAll(" ", "");
  const editSimilarity =
    1 - damerauLevenshteinDistance(compactQuery, compactLabel) / Math.max(compactQuery.length, compactLabel.length);
  const score =
    diceCoefficient(compactQuery, compactLabel) * 0.45 +
    editSimilarity * 0.4 +
    tokenOverlap(normalizedQuery, normalizedLabel) * 0.15;
  return { score, exactMatch: false };
};

export function rankLaunchCandidates(query: string, candidates: LaunchCandidate[]): RankedLaunchCandidate[] {
  return candidates
    .map((candidate) => {
      const rankedLabels = candidateLabels(candidate).map((label) => scoreLabel(query, label));
      const best = rankedLabels.reduce((current, next) => (next.score > current.score ? next : current), {
        score: 0,
        exactMatch: false,
      });

      return {
        candidate,
        score: best.score,
        exactMatch: best.exactMatch,
      };
    })
    .sort((left, right) => right.score - left.score);
}

export function pickBestLaunchCandidate(
  query: string,
  candidates: LaunchCandidate[],
  minimumScore = 0.55,
): RankedLaunchCandidate | null {
  const ranked = rankLaunchCandidates(query, candidates);
  const best = ranked[0];
  if (!best || best.score < minimumScore) {
    return null;
  }

  return best;
}
