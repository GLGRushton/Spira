/**
 * Numeric helpers shared across the learning loop and the per-phase budget computation.
 *
 * `percentile` uses linear interpolation between the bracketing samples and rounds the
 * result to the nearest integer (since callers store millisecond budgets as ints).
 *
 * `median` is `percentile(values, 0.5)` against a defensively-sorted copy. Returns null
 * for empty inputs so callers can distinguish "no observations" from "observed zero".
 */

export const percentile = (sortedValues: readonly number[], fraction: number): number => {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0]!;
  const rank = (sortedValues.length - 1) * fraction;
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex]!;
  const weight = rank - lowerIndex;
  return Math.round(sortedValues[lowerIndex]! * (1 - weight) + sortedValues[upperIndex]! * weight);
};

export const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return percentile(sorted, 0.5);
};
