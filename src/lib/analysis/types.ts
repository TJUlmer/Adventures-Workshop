import type { CardOwner, CombatSymbol } from '$lib/cards/types';
import type {
  AttackType,
  CharacterId,
  CharacterRole,
  HeroCharacterCardId
} from '$lib/characters/types';
import type { DeckId } from '$lib/decks/types';

/** Distinct authored rows and the physical cards those rows produce. */
export interface CardCountSummary {
  designCount: number;
  copyCount: number;
}

/** Quantity-weighted statistics for cards that carry a finite numeric value. */
export interface WeightedNumberSummary extends CardCountSummary {
  /** Sum across physical copies, rather than distinct designs. */
  total: number | null;
  /** `null` distinguishes no observed value from a real average of zero. */
  average: number | null;
  min: number | null;
  max: number | null;
}

/**
 * Numeric coverage for a category whose cards are expected to print a value.
 * `withoutValue` stays separate so an incomplete deck cannot quietly produce a
 * confident-looking average from the cards that happened to be filled in.
 */
export interface ValueMetricSummary extends CardCountSummary {
  values: WeightedNumberSummary;
  withoutValue: CardCountSummary;
  /** Share of physical copies with a value; `null` when there are no copies. */
  coverage: number | null;
  complete: boolean;
}

export interface CombatSymbolSummary extends CardCountSummary {
  symbol: CombatSymbol;
  /** Scheme cards deliberately have no printed combat value. */
  printedValue: ValueMetricSummary | null;
}

export type CombatSymbolSummaries = Readonly<Record<CombatSymbol, CombatSymbolSummary>>;

/** A custom boost symbol is complete data, but is intentionally not numeric. */
export interface BoostSummary extends CardCountSummary {
  numeric: WeightedNumberSummary;
  customSymbol: CardCountSummary;
  missing: CardCountSummary;
  /** Share of copies with either a number or a custom symbol. */
  coverage: number | null;
  complete: boolean;
}

export type OwnerRestrictionKind =
  | 'primary'
  | 'additional'
  | 'sidekick'
  | 'any'
  | 'unresolved';

export interface OwnerRestrictionSummary extends CardCountSummary {
  owner: CardOwner;
  kind: OwnerRestrictionKind;
  label: string;
}

export interface OwnerAccessSummary {
  shared: CardCountSummary;
  restricted: CardCountSummary;
}

export type FighterProfileKind = 'primary' | 'additional' | 'sidekick';

/** One stat line printed on a hero character card. */
export interface FighterProfile {
  kind: FighterProfileKind;
  id: CharacterId | HeroCharacterCardId | null;
  name: string;
  attackType: AttackType;
  health: number | null;
  /** Sidekick movement is not stored independently, so it remains unknown. */
  move: number | null;
  /** Additional identities share the roster entry and do not store a count. */
  figureCount: number | null;
  /** True only for a sidekick represented by multiple identical fighters. */
  multiple: boolean;
  healthTracked: boolean;
}

export type HeroCombatSupport = 'hero-symbols' | 'unsupported-role';

export interface CharacterActionAnalysis {
  characterId: CharacterId;
  characterName: string;
  characterRole: CharacterRole;
  actionDeckIds: DeckId[];
  actionDeckCount: number;
  /** Action-card designs found in owned action decks. */
  designCount: number;
  copyCount: number;
  /** Unexpected non-action templates found inside those decks. */
  ignoredCards: CardCountSummary;
  /** Full-face images whose printed statistics cannot be read from authored fields. */
  unanalysedReplacements: CardCountSummary;
  combatSupport: HeroCombatSupport;
  symbols: CombatSymbolSummaries;
  /** Hero action cards with no class/value that analysis can safely interpret. */
  unclassifiedCombat: CardCountSummary;
  attackCapable: ValueMetricSummary;
  defenseCapable: ValueMetricSummary;
  boost: BoostSummary;
  /** Empty for non-heroes because that field has no printed meaning there. */
  ownerRestrictions: OwnerRestrictionSummary[];
  /** `null` for non-heroes, where `ActionCard.owner` is ignored by the renderer. */
  ownerAccess: OwnerAccessSummary | null;
  fighters: FighterProfile[];
}

export type NumericInput = number | null | undefined;

export interface DistributionSummary {
  sampleSize: number;
  min: number;
  max: number;
  mean: number;
  p10: number;
  lowerQuartile: number;
  median: number;
  upperQuartile: number;
  p90: number;
}

export type ComparisonBand =
  | 'outside-observed-range'
  | 'unusual'
  | 'typical'
  | 'below-median'
  | 'at-median'
  | 'above-median'
  | 'insufficient-data';

export type ComparisonDirection = 'low' | 'neutral' | 'high';

export type ComparisonUnavailableReason =
  | 'missing-value'
  | 'empty-cohort'
  | 'small-cohort'
  | null;

export interface NumericComparison {
  value: number | null;
  distribution: DistributionSummary | null;
  band: ComparisonBand;
  direction: ComparisonDirection;
  unavailableReason: ComparisonUnavailableReason;
  lowerCount: number;
  equalCount: number;
  higherCount: number;
  /** Mid-rank percentile from 0–100; tied observations share the same rank. */
  percentile: number | null;
}

export interface ComparisonRow {
  key: string;
  label: string;
  value: number | null;
  formattedValue: string;
  statement: string;
  band: ComparisonBand;
  direction: ComparisonDirection;
  cohortLabel: string;
  cohortSize: number;
  min: number | null;
  max: number | null;
  lowerQuartile: number | null;
  median: number | null;
  upperQuartile: number | null;
  /** Strict comparison counts, retained for precise “higher than…” copy. */
  lowerCount: number;
  equalCount: number;
  higherCount: number;
  /** Mid-rank percentile from 0–100; ties receive half of their shared rank. */
  percentile: number | null;
  unavailableReason: ComparisonUnavailableReason;
}

export interface ComparisonRowInput {
  key: string;
  label: string;
  value: NumericInput;
  observations: readonly NumericInput[];
  cohortLabel: string;
  minimumSampleSize?: number;
  format?: (value: number) => string;
}

export type CohortPredicate<T> = (record: T) => boolean;

export interface NumericCohort<T> {
  records: T[];
  values: number[];
  missingValueCount: number;
  distribution: DistributionSummary | null;
}

export interface CohortTier<T> {
  key: string;
  label: string;
  includes: CohortPredicate<T>;
}

export interface CohortChoice<T> extends NumericCohort<T> {
  key: string;
  label: string;
  tierIndex: number;
  broadened: boolean;
  sufficient: boolean;
}
