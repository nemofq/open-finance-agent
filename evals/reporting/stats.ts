/** Noise measurement for `--repeat`: the tolerance is measured, not guessed. */

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Population standard deviation: the run is the whole sample, not an estimate of a larger one. */
export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance);
}

/** Suggested tolerance for the release gate: twice the spread of repeated runs. */
export function noiseTolerance(values: number[]): number {
  return 2 * standardDeviation(values);
}

export function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
