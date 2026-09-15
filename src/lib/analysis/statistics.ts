import type {
  CohortChoice,
  CohortPredicate,
  CohortTier,
  ComparisonRow,
  ComparisonRowInput,
  ComparisonDirection,
  DistributionSummary,
  NumericCohort,
  NumericComparison,
  NumericInput
} from './types';

/** Zero is data. Only absent and non-finite values are excluded. */
export function finiteNumber(value: NumericInput): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function finiteValues(values: readonly NumericInput[]): number[] {
  return values.filter(finiteNumber);
}

function safeMinimumSampleSize(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;
}

function quantileFromSorted(sorted: readonly number[], percentile: number): number {
  if (sorted.length === 1) return sorted[0] as number;

  const position = (sorted.length - 1) * percentile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] as number;
  const upper = sorted[upperIndex] as number;
  return lower + (upper - lower) * (position - lowerIndex);
}

/** Linear-interpolated quantile. Returns `null` for an empty cohort. */
export function quantile(values: readonly NumericInput[], percentile: number): number | null {
  const sorted = finiteValues(values).sort((a, b) => a - b);
  if (sorted.length === 0 || !Number.isFinite(percentile)) return null;
  return quantileFromSorted(sorted, Math.min(1, Math.max(0, percentile)));
}

export function summarizeDistribution(
  values: readonly NumericInput[]
): DistributionSummary | null {
  const sorted = finiteValues(values).sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    sampleSize: sorted.length,
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
    mean: total / sorted.length,
    p10: quantileFromSorted(sorted, 0.1),
    lowerQuartile: quantileFromSorted(sorted, 0.25),
    median: quantileFromSorted(sorted, 0.5),
    upperQuartile: quantileFromSorted(sorted, 0.75),
    p90: quantileFromSorted(sorted, 0.9)
  };
}

function unavailableComparison(
  value: number | null,
  distribution: DistributionSummary | null,
  unavailableReason: NumericComparison['unavailableReason']
): NumericComparison {
  return {
    value,
    distribution,
    band: 'insufficient-data',
    direction: 'neutral',
    unavailableReason,
    lowerCount: 0,
    equalCount: 0,
    higherCount: 0,
    percentile: null
  };
}

/**
 * Places one value in neutral descriptive bands. It makes no claim about
 * balance or desirability; callers supply the cohort and decide how to label it.
 */
export function compareNumericValue(
  value: NumericInput,
  observations: readonly NumericInput[],
  minimumSampleSize = 1
): NumericComparison {
  const numericValue = finiteNumber(value) ? value : null;
  const values = finiteValues(observations);
  const distribution = summarizeDistribution(values);

  if (numericValue === null) {
    return unavailableComparison(null, distribution, 'missing-value');
  }
  if (distribution === null) {
    return unavailableComparison(numericValue, null, 'empty-cohort');
  }
  if (distribution.sampleSize < safeMinimumSampleSize(minimumSampleSize)) {
    return unavailableComparison(numericValue, distribution, 'small-cohort');
  }

  let band: NumericComparison['band'];
  let direction: ComparisonDirection;
  if (numericValue < distribution.min) {
    band = 'outside-observed-range';
    direction = 'low';
  } else if (numericValue > distribution.max) {
    band = 'outside-observed-range';
    direction = 'high';
  } else if (numericValue < distribution.p10) {
    band = 'unusual';
    direction = 'low';
  } else if (numericValue > distribution.p90) {
    band = 'unusual';
    direction = 'high';
  } else if (numericValue === distribution.median) {
    band = 'at-median';
    direction = 'neutral';
  } else if (
    numericValue >= distribution.lowerQuartile &&
    numericValue <= distribution.upperQuartile
  ) {
    band = 'typical';
    direction = numericValue < distribution.median ? 'low' : 'high';
  } else if (numericValue < distribution.median) {
    band = 'below-median';
    direction = 'low';
  } else {
    band = 'above-median';
    direction = 'high';
  }

  let lowerCount = 0;
  let equalCount = 0;
  let higherCount = 0;
  for (const observation of values) {
    if (observation < numericValue) lowerCount += 1;
    else if (observation > numericValue) higherCount += 1;
    else equalCount += 1;
  }

  return {
    value: numericValue,
    distribution,
    band,
    direction,
    unavailableReason: null,
    lowerCount,
    equalCount,
    higherCount,
    percentile: ((lowerCount + equalCount / 2) / values.length) * 100
  };
}

/** A stable, user-facing phrase for a comparison result. */
export function comparisonPhrase(comparison: NumericComparison): string {
  if (comparison.unavailableReason === 'missing-value') return 'No value to compare';
  if (comparison.unavailableReason === 'small-cohort') return 'Not enough comparable data';
  if (comparison.unavailableReason === 'empty-cohort') return 'No comparable data';

  if (comparison.band === 'outside-observed-range') {
    return comparison.direction === 'low'
      ? 'Below the observed official range'
      : 'Above the observed official range';
  }
  if (comparison.band === 'unusual') {
    return comparison.direction === 'low' ? 'Unusually low' : 'Unusually high';
  }
  if (comparison.band === 'at-median') return 'At the official median';
  if (comparison.band === 'typical') return 'Typical';
  if (comparison.band === 'below-median') return 'Below the official median';
  if (comparison.band === 'above-median') return 'Above the official median';
  return 'No comparable data';
}

/** Shapes a numeric comparison for a presentation layer without adding judgement. */
export function createComparisonRow(input: ComparisonRowInput): ComparisonRow {
  const comparison = compareNumericValue(
    input.value,
    input.observations,
    input.minimumSampleSize
  );
  const format = input.format ?? ((value: number) => String(value));
  const distribution = comparison.distribution;

  return {
    key: input.key,
    label: input.label,
    value: comparison.value,
    formattedValue: comparison.value === null ? '—' : format(comparison.value),
    statement: comparisonPhrase(comparison),
    band: comparison.band,
    direction: comparison.direction,
    cohortLabel: input.cohortLabel,
    cohortSize: distribution?.sampleSize ?? 0,
    min: distribution?.min ?? null,
    max: distribution?.max ?? null,
    lowerQuartile: distribution?.lowerQuartile ?? null,
    median: distribution?.median ?? null,
    upperQuartile: distribution?.upperQuartile ?? null,
    lowerCount: comparison.lowerCount,
    equalCount: comparison.equalCount,
    higherCount: comparison.higherCount,
    percentile: comparison.percentile,
    unavailableReason: comparison.unavailableReason
  };
}

export function filterCohort<T>(
  records: readonly T[],
  predicates: readonly CohortPredicate<T>[] = []
): T[] {
  return records.filter((record) => predicates.every((predicate) => predicate(record)));
}

export function createNumericCohort<T>(
  records: readonly T[],
  valueFor: (record: T) => NumericInput,
  predicates: readonly CohortPredicate<T>[] = []
): NumericCohort<T> {
  const matching = filterCohort(records, predicates);
  const values: number[] = [];
  let missingValueCount = 0;

  for (const record of matching) {
    const value = valueFor(record);
    if (finiteNumber(value)) values.push(value);
    else missingValueCount += 1;
  }

  return {
    records: matching,
    values,
    missingValueCount,
    distribution: summarizeDistribution(values)
  };
}

/**
 * Picks the first sufficiently populated tier. If none qualifies, it returns
 * the tier with the most usable values and marks it insufficient, so a caller
 * can explain the missing context instead of silently widening the cohort.
 */
export function chooseNumericCohort<T>(
  records: readonly T[],
  valueFor: (record: T) => NumericInput,
  tiers: readonly CohortTier<T>[],
  minimumSampleSize = 12
): CohortChoice<T> | null {
  if (tiers.length === 0) return null;

  const choices = tiers.map((tier, tierIndex) => ({
    ...createNumericCohort(records, valueFor, [tier.includes]),
    key: tier.key,
    label: tier.label,
    tierIndex,
    broadened: tierIndex > 0,
    sufficient: false
  }));

  const minimum = safeMinimumSampleSize(minimumSampleSize);
  const sufficient = choices.find((choice) => choice.values.length >= minimum);
  if (sufficient) return { ...sufficient, sufficient: true };

  return choices.reduce((best, choice) =>
    choice.values.length > best.values.length ? choice : best
  );
}
