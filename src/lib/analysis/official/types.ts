export const OFFICIAL_CATALOGUE_SCHEMA_VERSION = 1 as const;

export type OfficialComplexity = 'low' | 'medium' | 'high';
export type OfficialDataStatus = 'complete' | 'needs-review' | 'partial';
export type OfficialRosterType =
  | 'solo'
  | 'hero-with-sidekick'
  | 'hero-with-multiple-sidekicks'
  | 'team'
  | 'transforming';

export type OfficialReleaseProductType = 'adventure-box' | 'core-box' | 'battle-box' | 'promo';
export type OfficialFighterRole = 'hero' | 'sidekick' | 'companion' | 'token' | 'other';
export type OfficialAttackType = 'melee' | 'ranged' | 'hybrid' | 'none';
export type OfficialCardCategory = 'attack' | 'defense' | 'versatile' | 'scheme';
export type OfficialDeckModel = 'fixed' | 'choice-pool' | 'fixed-with-starting-card';
export type OfficialDeckCoverage = 'complete' | 'partial';

export interface OfficialCatalogueSource {
  readonly file: string;
  readonly sha256: string;
}

export interface OfficialRelease {
  readonly id: string;
  readonly name: string;
  readonly year: number;
  readonly productType: OfficialReleaseProductType;
}

export interface OfficialFighter {
  readonly id: string;
  readonly name: string;
  readonly role: OfficialFighterRole;
  /** Unknown for summoned groups whose available token count was not captured. */
  readonly quantity: number | null;
  /** `null` means the source did not establish the attack type. */
  readonly attackType: OfficialAttackType | null;
  /** `null` means the source did not establish starting health. */
  readonly startingHealth: number | null;
  readonly isUnique: boolean;
}

/** Quantity-weighted primitives; averages stay a caller concern. */
export interface OfficialCardTypeSummary {
  readonly uniqueCount: number;
  readonly copyCount: number;
  readonly printedValueKnownCopies: number;
  readonly printedValueSum: number;
  readonly boostKnownCopies: number;
  readonly boostSum: number;
}

export interface OfficialDeckSummary {
  /** A choice pool is not one legal deck, even though every source card is counted below. */
  readonly model: OfficialDeckModel;
  /** Partial coverage means the source omitted part of the action deck. */
  readonly coverage: OfficialDeckCoverage;
  /** Every physical copy represented by the source rows. */
  readonly sourceCopyCount: number;
  /** Copies used in one legal loadout; unknown when coverage is partial. */
  readonly selectedCopyCount: number | null;
  /** Copies shuffled at setup; excludes a card that explicitly starts outside the deck. */
  readonly shuffledCopyCount: number | null;
  readonly outsideDeckCopyCount: number;
  readonly uniqueCardCount: number;
  readonly cardTypes: Readonly<Record<OfficialCardCategory, OfficialCardTypeSummary>>;
  readonly boostKnownCopies: number;
  readonly boostSum: number;
  readonly sharedCopies: number;
  readonly restrictedCopies: number;
}

export interface OfficialCharacter {
  readonly id: string;
  readonly name: string;
  readonly licence: string | null;
  readonly releaseId: string;
  readonly move: number;
  readonly rosterType: OfficialRosterType;
  /** Reserved for documented editorial classifications; the current source has none. */
  readonly complexity: OfficialComplexity | null;
  readonly dataStatus: OfficialDataStatus;
  /** A source caveat with import bookkeeping removed. */
  readonly dataNote: string | null;
  readonly fighters: readonly OfficialFighter[];
  readonly deck: OfficialDeckSummary;
}

export interface OfficialCatalogue {
  readonly schemaVersion: typeof OFFICIAL_CATALOGUE_SCHEMA_VERSION;
  readonly catalogueVersion: string;
  readonly source: OfficialCatalogueSource;
  readonly releases: readonly OfficialRelease[];
  readonly characters: readonly OfficialCharacter[];
}

/** Flat, joined fields for the catalogue explorer. */
export interface OfficialCatalogueRow {
  readonly id: string;
  readonly name: string;
  readonly licence: string | null;
  readonly setName: string;
  readonly releaseId: string;
  readonly releaseYear: number;
  readonly productType: OfficialReleaseProductType;
  readonly rosterType: OfficialRosterType;
  readonly complexity: OfficialComplexity | null;
  readonly dataStatus: OfficialDataStatus;
  readonly dataNote: string | null;
  readonly move: number;
  /** Figures in one legal roster; alternative sidekick profiles do not stack. */
  readonly fighterCount: number | null;
  /** Known figures in that legal roster when an additional quantity remains unknown. */
  readonly knownFighterCount: number;
  readonly primaryAttackType: OfficialAttackType | null;
  readonly attackTypes: readonly OfficialAttackType[];
  readonly primaryHealth: number | null;
  /** Common health across the available sidekick profiles; `null` if they differ or are unknown. */
  readonly sidekickHealth: number | null;
  /** Sidekicks fielded in one legal roster; alternative profiles do not stack. */
  readonly sidekickCount: number | null;
  readonly deckModel: OfficialDeckModel;
  readonly deckCoverage: OfficialDeckCoverage;
  readonly sourceCardCount: number;
  readonly selectedCardCount: number | null;
  readonly uniqueCardCount: number;
  readonly attackCopyCount: number;
  readonly defenseCopyCount: number;
  readonly versatileCopyCount: number;
  readonly schemeCopyCount: number;
  /** Quantity-weighted printed value across Attack and Versatile copies. */
  readonly attackCapableTotal: number | null;
  /** Quantity-weighted printed value across Defense and Versatile copies. */
  readonly defenseCapableTotal: number | null;
  /** Quantity-weighted across every card copy; `null` if any boost is unknown. */
  readonly boostAverage: number | null;
}
