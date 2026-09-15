import type { AttackType } from '$lib/characters/types';
import {
  officialCatalogueRows,
  type OfficialAttackType,
  type OfficialCatalogueRow,
  type OfficialRosterType
} from './official';
import { chooseNumericCohort, createComparisonRow, finiteNumber } from './statistics';
import type {
  CharacterActionAnalysis,
  CohortChoice,
  CohortTier,
  ComparisonRow,
  NumericInput
} from './types';

export type OfficialComparisonMetric =
  | 'health'
  | 'move'
  | 'sidekick-health'
  | 'attack-capable-total'
  | 'defense-capable-total'
  | 'boost-average';

export interface OfficialComparisonRow extends ComparisonRow {
  key: OfficialComparisonMetric;
  cohortBroadened: boolean;
  cohortSufficient: boolean;
  comparable: OfficialComparable | null;
}

export interface OfficialComparable {
  id: string;
  name: string;
  setName: string;
  value: number;
  formattedValue: string;
}

export interface OfficialProfileMatch {
  id: string;
  name: string;
  setName: string;
  comparedMetrics: number;
}

export interface OfficialProfileMatchResult {
  cohortLabel: string;
  cohortBroadened: boolean;
  matches: OfficialProfileMatch[];
}

export interface OfficialComparisonOptions {
  rows?: readonly OfficialCatalogueRow[];
  minimumSampleSize?: number;
  /** Partial entries are excluded by default; their caveats are not metric-specific. */
  includePartialData?: boolean;
}

interface ComparableProfile {
  attackType: OfficialAttackType | null;
  rosterTypes: readonly OfficialRosterType[];
  rosterLabel: string;
}

interface ComparisonOptions {
  sidekickOnly?: boolean;
  comparable?: boolean;
}

interface SimilarityMetric {
  value: number;
  weight: number;
  valueFor: (row: OfficialCatalogueRow) => NumericInput;
}

function officialAttackType(attackType: AttackType): OfficialAttackType | null {
  if (attackType === 'melee' || attackType === 'ranged') return attackType;
  return null;
}

function comparableProfile(analysis: CharacterActionAnalysis): ComparableProfile {
  const primary = analysis.fighters.find((fighter) => fighter.kind === 'primary');
  const sidekick = analysis.fighters.find((fighter) => fighter.kind === 'sidekick');
  const hasAdditional = analysis.fighters.some((fighter) => fighter.kind === 'additional');

  if (hasAdditional) {
    return {
      attackType: primary ? officialAttackType(primary.attackType) : null,
      rosterTypes: ['team', 'transforming'],
      rosterLabel: 'teams and transforming heroes'
    };
  }
  if ((primary?.figureCount ?? 0) > 1) {
    return {
      attackType: primary ? officialAttackType(primary.attackType) : null,
      rosterTypes: ['team'],
      rosterLabel: 'team heroes'
    };
  }
  if (sidekick?.multiple) {
    return {
      attackType: primary ? officialAttackType(primary.attackType) : null,
      rosterTypes: ['hero-with-multiple-sidekicks'],
      rosterLabel: 'heroes with multiple sidekicks'
    };
  }
  if (sidekick) {
    return {
      attackType: primary ? officialAttackType(primary.attackType) : null,
      rosterTypes: ['hero-with-sidekick'],
      rosterLabel: 'heroes with a sidekick'
    };
  }
  return {
    attackType: primary ? officialAttackType(primary.attackType) : null,
    rosterTypes: ['solo'],
    rosterLabel: 'solo heroes'
  };
}

function rangeLabel(attackType: OfficialAttackType): string {
  if (attackType === 'melee') return 'melee heroes';
  if (attackType === 'ranged') return 'ranged heroes';
  if (attackType === 'hybrid') return 'hybrid-range heroes';
  return 'heroes without a recorded attack range';
}

function rosterMatches(
  row: OfficialCatalogueRow,
  rosterTypes: readonly OfficialRosterType[]
): boolean {
  return rosterTypes.includes(row.rosterType);
}

function comparisonTiers(
  profile: ComparableProfile,
  sidekickOnly: boolean
): CohortTier<OfficialCatalogueRow>[] {
  const hasRange = profile.attackType !== null;
  const hasSidekick = (row: OfficialCatalogueRow) => row.sidekickHealth !== null;
  const tiers: CohortTier<OfficialCatalogueRow>[] = [];

  if (sidekickOnly) {
    // Sidekick health is a per-figure stat. A custom roster can contain several
    // health-bearing copies, so its figure count must not confine it to the
    // official swarm roster (whose health values are predominantly 1).
    if (hasRange) {
      const attackType = profile.attackType as OfficialAttackType;
      tiers.push({
        key: 'range',
        label: `Official ${rangeLabel(attackType)} with a sidekick`,
        includes: (row) => row.primaryAttackType === attackType && hasSidekick(row)
      });
    }
    tiers.push({
      key: 'all-sidekicks',
      label: 'Official heroes with a sidekick',
      includes: hasSidekick
    });
    return tiers;
  }

  if (hasRange) {
    const attackType = profile.attackType as OfficialAttackType;
    tiers.push({
      key: 'range-and-roster',
      label: `Official ${rangeLabel(attackType).replace(/ heroes$/, '')} ${profile.rosterLabel}`,
      includes: (row) =>
        row.primaryAttackType === attackType &&
        rosterMatches(row, profile.rosterTypes)
    });
  }

  if (hasRange) {
    const attackType = profile.attackType as OfficialAttackType;
    tiers.push({
      key: 'range',
      label: `Official ${rangeLabel(attackType)}`,
      includes: (row) => row.primaryAttackType === attackType
    });
  }
  tiers.push({
    key: 'roster',
    label: `Official ${profile.rosterLabel}`,
    includes: (row) => rosterMatches(row, profile.rosterTypes)
  });
  tiers.push({
    key: 'all',
    label: 'Official heroes',
    includes: () => true
  });
  return tiers;
}

function comparisonFor(
  key: OfficialComparisonMetric,
  label: string,
  value: NumericInput,
  rows: readonly OfficialCatalogueRow[],
  valueFor: (row: OfficialCatalogueRow) => NumericInput,
  profile: ComparableProfile,
  minimumSampleSize: number,
  options: ComparisonOptions = {}
): OfficialComparisonRow {
  const format = key.endsWith('average') ? formatAverage : (candidate: number) => String(candidate);
  const cohort = chooseNumericCohort(
    rows,
    valueFor,
    comparisonTiers(profile, options.sidekickOnly ?? false),
    minimumSampleSize
  ) as CohortChoice<OfficialCatalogueRow>;
  const row = createComparisonRow({
    key,
    label,
    value,
    observations: cohort.values,
    cohortLabel: cohort.label,
    minimumSampleSize,
    format
  });

  const comparable =
    options.comparable === false || !finiteNumber(value)
      ? null
      : (cohort.records
          .map((candidate) => ({ candidate, value: valueFor(candidate) }))
          .filter(
            (entry): entry is { candidate: OfficialCatalogueRow; value: number } =>
              finiteNumber(entry.value)
          )
          .sort(
            (left, right) =>
              Math.abs(left.value - value) - Math.abs(right.value - value) ||
              left.candidate.name.localeCompare(right.candidate.name)
          )
          .map(({ candidate, value: comparableValue }) => ({
            id: candidate.id,
            name: candidate.name,
            setName: candidate.setName,
            value: comparableValue,
            formattedValue: format(comparableValue)
          }))[0] ?? null);

  return {
    ...row,
    key,
    cohortBroadened: cohort.broadened,
    cohortSufficient: cohort.sufficient,
    comparable
  };
}

function formatAverage(value: number): string {
  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function similarityMetrics(analysis: CharacterActionAnalysis): SimilarityMetric[] {
  const primary = analysis.fighters.find((fighter) => fighter.kind === 'primary');
  const sidekick = analysis.fighters.find((fighter) => fighter.kind === 'sidekick');
  const metrics: SimilarityMetric[] = [];
  const add = (
    value: NumericInput,
    weight: number,
    valueFor: SimilarityMetric['valueFor']
  ) => {
    if (finiteNumber(value)) metrics.push({ value, weight, valueFor });
  };

  add(primary?.health, 1, (row) => row.primaryHealth);
  add(primary?.move, 0.35, (row) => row.move);
  if (sidekick) add(sidekick.health, 0.75, (row) => row.sidekickHealth);
  add(analysis.symbols.attack.copyCount, 0.65, (row) => row.attackCopyCount);
  add(analysis.symbols.defense.copyCount, 0.65, (row) => row.defenseCopyCount);
  add(analysis.symbols.versatile.copyCount, 0.65, (row) => row.versatileCopyCount);
  add(analysis.symbols.scheme.copyCount, 0.5, (row) => row.schemeCopyCount);
  add(analysis.attackCapable.values.total, 1.25, (row) => row.attackCapableTotal);
  add(analysis.defenseCapable.values.total, 1.25, (row) => row.defenseCapableTotal);
  if (analysis.boost.complete && analysis.boost.customSymbol.copyCount === 0) {
    add(analysis.boost.numeric.average, 0.75, (row) => row.boostAverage);
  }
  return metrics;
}

function scoreProfiles(
  rows: readonly OfficialCatalogueRow[],
  metrics: readonly SimilarityMetric[]
): Array<{ row: OfficialCatalogueRow; score: number; comparedMetrics: number }> {
  const scales = metrics.map((metric) => {
    const values = rows.map(metric.valueFor).filter(finiteNumber);
    if (values.length < 2) return 1;
    return Math.max(...values) - Math.min(...values) || 1;
  });
  const minimumMetrics = Math.max(4, Math.ceil(metrics.length * 0.7));

  return rows
    .map((row) => {
      let distance = 0;
      let comparedWeight = 0;
      let comparedMetrics = 0;
      metrics.forEach((metric, index) => {
        const candidate = metric.valueFor(row);
        if (!finiteNumber(candidate)) return;
        distance += (Math.abs(metric.value - candidate) / (scales[index] ?? 1)) * metric.weight;
        comparedWeight += metric.weight;
        comparedMetrics += 1;
      });
      if (comparedMetrics < minimumMetrics || comparedWeight === 0) return null;
      const missingPenalty = ((metrics.length - comparedMetrics) / metrics.length) * 0.15;
      return { row, score: distance / comparedWeight + missingPenalty, comparedMetrics };
    })
    .filter(
      (entry): entry is { row: OfficialCatalogueRow; score: number; comparedMetrics: number } =>
        entry !== null
    )
    .sort((left, right) => left.score - right.score || left.row.name.localeCompare(right.row.name));
}

/**
 * Finds structural neighbours only. Ability text and matchup behaviour remain
 * intentionally outside a score that must never be presented as balance advice.
 */
export function findClosestOfficialProfiles(
  analysis: CharacterActionAnalysis,
  options: OfficialComparisonOptions = {}
): OfficialProfileMatchResult | null {
  if (
    analysis.combatSupport !== 'hero-symbols' ||
    analysis.copyCount !== 30 ||
    analysis.unanalysedReplacements.copyCount > 0 ||
    analysis.unclassifiedCombat.copyCount > 0 ||
    !analysis.attackCapable.complete ||
    !analysis.defenseCapable.complete
  ) {
    return null;
  }

  const rows = (options.rows ?? officialCatalogueRows).filter(
    (row) =>
      (options.includePartialData || row.dataStatus !== 'partial') &&
      row.deckCoverage === 'complete' &&
      row.deckModel !== 'choice-pool'
  );
  const metrics = similarityMetrics(analysis);
  if (metrics.length < 6) return null;

  const choices = comparisonTiers(comparableProfile(analysis), false).map((tier, tierIndex) => ({
    label: tier.label,
    broadened: tierIndex > 0,
    matches: scoreProfiles(rows.filter(tier.includes), metrics)
  }));
  const choice =
    choices.find((candidate) => candidate.matches.length >= 3) ??
    choices.reduce((best, candidate) =>
      candidate.matches.length > best.matches.length ? candidate : best
    );
  if (choice.matches.length === 0) return null;

  return {
    cohortLabel: choice.label,
    cohortBroadened: choice.broadened,
    matches: choice.matches.slice(0, 3).map(({ row, comparedMetrics }) => ({
      id: row.id,
      name: row.name,
      setName: row.setName,
      comparedMetrics
    }))
  };
}

/**
 * Builds cautious official-context rows for a hero. These remain descriptive;
 * callers must not convert their bands into Set Health severities.
 */
export function compareCharacterWithOfficial(
  analysis: CharacterActionAnalysis,
  options: OfficialComparisonOptions = {}
): OfficialComparisonRow[] {
  if (analysis.combatSupport !== 'hero-symbols') return [];

  const requestedMinimum = options.minimumSampleSize ?? 12;
  const minimumSampleSize = Number.isFinite(requestedMinimum)
    ? Math.max(1, Math.trunc(requestedMinimum))
    : 12;
  const rows = (options.rows ?? officialCatalogueRows).filter(
    (row) => options.includePartialData || row.dataStatus !== 'partial'
  );
  const profile = comparableProfile(analysis);
  const primary = analysis.fighters.find((fighter) => fighter.kind === 'primary');
  const sidekick = analysis.fighters.find((fighter) => fighter.kind === 'sidekick');
  const deckRows = rows.filter(
    (row) => row.deckCoverage === 'complete' && row.deckModel !== 'choice-pool'
  );
  const deckIsFullyInterpretable = analysis.unanalysedReplacements.copyCount === 0;
  const comparisons: OfficialComparisonRow[] = [
    comparisonFor(
      'health',
      'Health',
      primary?.health,
      rows,
      (row) => row.primaryHealth,
      profile,
      minimumSampleSize
    ),
    comparisonFor(
      'move',
      'Move',
      primary?.move,
      rows,
      (row) => row.move,
      profile,
      minimumSampleSize,
      { comparable: false }
    )
  ];

  if (sidekick) {
    comparisons.push(
      comparisonFor(
        'sidekick-health',
        'Sidekick health',
        sidekick.health,
        rows,
        (row) => row.sidekickHealth,
        profile,
        minimumSampleSize,
        { sidekickOnly: true }
      )
    );
  }

  if (deckIsFullyInterpretable && analysis.copyCount === 30) {
    comparisons.push(
      comparisonFor(
      'attack-capable-total',
      'Total printed attack-capable value',
        analysis.attackCapable.complete ? analysis.attackCapable.values.total : null,
        deckRows,
        (row) => row.attackCapableTotal,
        profile,
        minimumSampleSize
      ),
      comparisonFor(
      'defense-capable-total',
      'Total printed defense-capable value',
        analysis.defenseCapable.complete ? analysis.defenseCapable.values.total : null,
        deckRows,
        (row) => row.defenseCapableTotal,
        profile,
        minimumSampleSize
      ),
      comparisonFor(
        'boost-average',
        'Boost average',
        analysis.boost.complete && analysis.boost.customSymbol.copyCount === 0
          ? analysis.boost.numeric.average
          : null,
        deckRows,
        (row) => row.boostAverage,
        profile,
        minimumSampleSize
      )
    );
  }

  return comparisons;
}
