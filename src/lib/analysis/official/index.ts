import catalogueData from './catalogue.json';
import type {
  OfficialAttackType,
  OfficialCardTypeSummary,
  OfficialCatalogue,
  OfficialCatalogueRow,
  OfficialCharacter,
  OfficialRelease
} from './types';

export type {
  OfficialAttackType,
  OfficialCardCategory,
  OfficialCardTypeSummary,
  OfficialCatalogue,
  OfficialCatalogueRow,
  OfficialCatalogueSource,
  OfficialCharacter,
  OfficialComplexity,
  OfficialDataStatus,
  OfficialDeckCoverage,
  OfficialDeckModel,
  OfficialDeckSummary,
  OfficialFighter,
  OfficialFighterRole,
  OfficialRelease,
  OfficialReleaseProductType,
  OfficialRosterType
} from './types';
export { OFFICIAL_CATALOGUE_SCHEMA_VERSION } from './types';

function deepFreeze<T extends object>(value: T): T {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child as Record<string, unknown>);
    }
  }
  return value;
}

export const officialCatalogue = deepFreeze(catalogueData as OfficialCatalogue);
export const OFFICIAL_CATALOGUE_VERSION = officialCatalogue.catalogueVersion;
export const officialCharacters = officialCatalogue.characters;
export const officialReleases = officialCatalogue.releases;

const releasesById = new Map(officialReleases.map((release) => [release.id, release]));
const charactersById = new Map(officialCharacters.map((character) => [character.id, character]));

function uniqueAttackTypes(character: OfficialCharacter): OfficialAttackType[] {
  return [
    ...new Set(
      character.fighters
        .map((fighter) => fighter.attackType)
        .filter((attackType): attackType is OfficialAttackType => attackType !== null)
    )
  ];
}

function knownQuantity(fighters: OfficialCharacter['fighters']): number {
  return fighters.reduce((total, fighter) => total + (fighter.quantity ?? 0), 0);
}

function completeQuantity(fighters: OfficialCharacter['fighters']): number | null {
  return fighters.some((fighter) => fighter.quantity === null) ? null : knownQuantity(fighters);
}

function legalSidekickProfiles(character: OfficialCharacter): OfficialCharacter['fighters'] {
  const sidekicks = character.fighters.filter((fighter) => fighter.role === 'sidekick');
  // A singular-sidekick roster may list alternative profiles, but fields only one.
  return character.rosterType === 'hero-with-sidekick' ? sidekicks.slice(0, 1) : sidekicks;
}

function legalRosterProfiles(character: OfficialCharacter): OfficialCharacter['fighters'] {
  const nonSidekicks = character.fighters.filter((fighter) => fighter.role !== 'sidekick');
  return [...nonSidekicks, ...legalSidekickProfiles(character)];
}

function sharedSidekickHealth(character: OfficialCharacter): number | null {
  const sidekicks = character.fighters.filter((fighter) => fighter.role === 'sidekick');
  if (sidekicks.length === 0 || sidekicks.some((fighter) => fighter.startingHealth === null)) {
    return null;
  }
  const health = sidekicks.map((fighter) => fighter.startingHealth as number);
  return health.every((value) => value === health[0]) ? health[0] ?? null : null;
}

function completeTotal(summaries: readonly OfficialCardTypeSummary[]): number | null {
  const copyCount = summaries.reduce((total, summary) => total + summary.copyCount, 0);
  const knownCopies = summaries.reduce(
    (total, summary) => total + summary.printedValueKnownCopies,
    0
  );
  if (knownCopies !== copyCount) return null;
  return summaries.reduce((total, summary) => total + summary.printedValueSum, 0);
}

function completeBoostAverage(character: OfficialCharacter): number | null {
  return character.deck.sourceCopyCount > 0 &&
    character.deck.boostKnownCopies === character.deck.sourceCopyCount
    ? character.deck.boostSum / character.deck.sourceCopyCount
    : null;
}

function toCatalogueRow(character: OfficialCharacter): OfficialCatalogueRow {
  const release = releasesById.get(character.releaseId);
  if (!release) throw new Error(`Official character ${character.id} has no release`);

  const primary = character.fighters.find((fighter) => fighter.role === 'hero') ?? null;
  const legalRoster = legalRosterProfiles(character);
  const sidekicks = legalSidekickProfiles(character);
  return {
    id: character.id,
    name: character.name,
    licence: character.licence,
    setName: release.name,
    releaseId: release.id,
    releaseYear: release.year,
    productType: release.productType,
    rosterType: character.rosterType,
    complexity: character.complexity,
    dataStatus: character.dataStatus,
    dataNote: character.dataNote,
    move: character.move,
    fighterCount: completeQuantity(legalRoster),
    knownFighterCount: knownQuantity(legalRoster),
    primaryAttackType: primary?.attackType ?? null,
    attackTypes: uniqueAttackTypes(character),
    primaryHealth: primary?.startingHealth ?? null,
    sidekickHealth: sharedSidekickHealth(character),
    sidekickCount: completeQuantity(sidekicks),
    deckModel: character.deck.model,
    deckCoverage: character.deck.coverage,
    sourceCardCount: character.deck.sourceCopyCount,
    selectedCardCount: character.deck.selectedCopyCount,
    uniqueCardCount: character.deck.uniqueCardCount,
    attackCopyCount: character.deck.cardTypes.attack.copyCount,
    defenseCopyCount: character.deck.cardTypes.defense.copyCount,
    versatileCopyCount: character.deck.cardTypes.versatile.copyCount,
    schemeCopyCount: character.deck.cardTypes.scheme.copyCount,
    attackCapableTotal: completeTotal([
      character.deck.cardTypes.attack,
      character.deck.cardTypes.versatile
    ]),
    defenseCapableTotal: completeTotal([
      character.deck.cardTypes.defense,
      character.deck.cardTypes.versatile
    ]),
    boostAverage: completeBoostAverage(character)
  };
}

export const officialCatalogueRows: readonly OfficialCatalogueRow[] = deepFreeze(
  officialCharacters.map(toCatalogueRow)
);

export function findOfficialCharacter(id: string): OfficialCharacter | null {
  return charactersById.get(id) ?? null;
}

export function findOfficialRelease(id: string): OfficialRelease | null {
  return releasesById.get(id) ?? null;
}
