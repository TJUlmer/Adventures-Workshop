import type { ActionCard, CardOwner, CombatSymbol } from '$lib/cards/types';
import { COMBAT_SYMBOLS } from '$lib/cards/types';
import type { Character, CharacterId, HeroCharacterCard } from '$lib/characters/types';
import { hasArtwork } from '$lib/core/artwork';
import type { AdventureSet } from '$lib/sets/types';
import type {
  BoostSummary,
  CardCountSummary,
  CharacterActionAnalysis,
  CombatSymbolSummaries,
  FighterProfile,
  OwnerAccessSummary,
  OwnerRestrictionKind,
  OwnerRestrictionSummary,
  ValueMetricSummary,
  WeightedNumberSummary
} from './types';

function cardCopies(card: { quantity: number }): number {
  if (!Number.isFinite(card.quantity)) return 0;
  return Math.max(0, Math.trunc(card.quantity));
}

function countCards(cards: readonly ActionCard[]): CardCountSummary {
  return {
    designCount: cards.length,
    copyCount: cards.reduce((total, card) => total + cardCopies(card), 0)
  };
}

function summarizeWeightedNumbers(
  cards: readonly ActionCard[],
  valueFor: (card: ActionCard) => number | null
): WeightedNumberSummary {
  let copyCount = 0;
  let total = 0;
  let min: number | null = null;
  let max: number | null = null;
  let designCount = 0;

  for (const card of cards) {
    const value = valueFor(card);
    if (value === null || !Number.isFinite(value)) continue;

    const copies = cardCopies(card);
    if (copies === 0) continue;
    designCount += 1;
    copyCount += copies;
    total += value * copies;
    min = min === null ? value : Math.min(min, value);
    max = max === null ? value : Math.max(max, value);
  }

  return {
    designCount,
    copyCount,
    total: copyCount > 0 ? total : null,
    average: copyCount > 0 ? total / copyCount : null,
    min,
    max
  };
}

function summarizeValueMetric(
  cards: readonly ActionCard[],
  valueFor: (card: ActionCard) => number | null
): ValueMetricSummary {
  const counts = countCards(cards);
  const values = summarizeWeightedNumbers(cards, valueFor);
  const withoutValueCards = cards.filter((card) => {
    const value = valueFor(card);
    return value === null || !Number.isFinite(value);
  });
  const withoutValue = countCards(withoutValueCards);

  return {
    ...counts,
    values,
    withoutValue,
    coverage: counts.copyCount > 0 ? values.copyCount / counts.copyCount : null,
    complete: counts.copyCount > 0 && withoutValue.copyCount === 0
  };
}

function symbolSummaries(cards: readonly ActionCard[]): CombatSymbolSummaries {
  const forSymbol = (symbol: CombatSymbol) => cards.filter((card) => card.symbol === symbol);
  const result = {} as Record<CombatSymbol, CombatSymbolSummaries[CombatSymbol]>;

  for (const symbol of COMBAT_SYMBOLS) {
    const matching = forSymbol(symbol);
    result[symbol] = {
      symbol,
      ...countCards(matching),
      printedValue:
        symbol === 'scheme'
          ? null
          : summarizeValueMetric(matching, (card) => card.symbolValue)
    };
  }

  return result;
}

function boostSummary(cards: readonly ActionCard[]): BoostSummary {
  const numericCards: ActionCard[] = [];
  const customCards: ActionCard[] = [];
  const missingCards: ActionCard[] = [];

  for (const card of cards) {
    if (card.boostSymbol.trim().length > 0) customCards.push(card);
    else if (card.boost !== null && Number.isFinite(card.boost)) numericCards.push(card);
    else missingCards.push(card);
  }

  const counts = countCards(cards);
  const numeric = summarizeWeightedNumbers(numericCards, (card) => card.boost);
  const customSymbol = countCards(customCards);
  const missing = countCards(missingCards);
  const representedCopies = numeric.copyCount + customSymbol.copyCount;

  return {
    ...counts,
    numeric,
    customSymbol,
    missing,
    coverage: counts.copyCount > 0 ? representedCopies / counts.copyCount : null,
    complete: counts.copyCount > 0 && missing.copyCount === 0
  };
}

interface ResolvedOwner {
  kind: OwnerRestrictionKind;
  label: string;
  order: number;
}

function resolveOwner(character: Character, owner: CardOwner): ResolvedOwner {
  if (owner === 'hero') return { kind: 'primary', label: character.name, order: 0 };
  if (owner === 'sidekick') {
    return {
      kind: 'sidekick',
      label: character.sidekick.name || 'Sidekick',
      order: character.additionalCards.length + 1
    };
  }
  if (owner === 'any') {
    return { kind: 'any', label: 'Any fighter', order: character.additionalCards.length + 2 };
  }

  const additionalIndex = character.additionalCards.findIndex((identity) => identity.id === owner);
  if (additionalIndex >= 0) {
    const identity = character.additionalCards[additionalIndex] as HeroCharacterCard;
    return { kind: 'additional', label: identity.name, order: additionalIndex + 1 };
  }

  return {
    kind: 'unresolved',
    label: 'Unknown identity',
    order: character.additionalCards.length + 3
  };
}

function ownerRestrictions(
  character: Character,
  cards: readonly ActionCard[]
): OwnerRestrictionSummary[] {
  if (character.role !== 'hero') return [];

  const buckets = new Map<CardOwner, OwnerRestrictionSummary & { order: number }>();
  for (const card of cards) {
    const existing = buckets.get(card.owner);
    if (existing) {
      existing.designCount += 1;
      existing.copyCount += cardCopies(card);
      continue;
    }

    const resolved = resolveOwner(character, card.owner);
    buckets.set(card.owner, {
      owner: card.owner,
      kind: resolved.kind,
      label: resolved.label,
      order: resolved.order,
      designCount: 1,
      copyCount: cardCopies(card)
    });
  }

  return [...buckets.values()]
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label))
    .map(({ order: _order, ...summary }) => summary);
}

function ownerAccess(character: Character, cards: readonly ActionCard[]): OwnerAccessSummary | null {
  if (character.role !== 'hero') return null;
  return {
    shared: countCards(cards.filter((card) => card.owner === 'any')),
    restricted: countCards(cards.filter((card) => card.owner !== 'any'))
  };
}

function fighterProfiles(character: Character): FighterProfile[] {
  const fighters: FighterProfile[] = [
    {
      kind: 'primary',
      id: character.id,
      name: character.name,
      attackType: character.attackType,
      health: character.health,
      move: character.move,
      figureCount: Math.max(0, Math.trunc(character.figureCount)),
      multiple: false,
      healthTracked: character.health !== null
    }
  ];

  for (const identity of character.additionalCards) {
    fighters.push({
      kind: 'additional',
      id: identity.id,
      name: identity.name,
      attackType: identity.attackType,
      health: identity.health,
      move: identity.move,
      figureCount: null,
      multiple: false,
      healthTracked: identity.health !== null
    });
  }

  if (character.sidekick.enabled) {
    fighters.push({
      kind: 'sidekick',
      id: null,
      name: character.sidekick.name || 'Sidekick',
      attackType: character.sidekick.attackType,
      health: character.sidekick.health,
      move: null,
      figureCount: Math.max(0, Math.trunc(character.sidekick.count)),
      multiple: character.sidekick.multiple,
      healthTracked: character.sidekick.health !== null
    });
  }

  return fighters;
}

/** Analyse the action decks owned by one character without mutating the set. */
export function analyseCharacter(
  set: AdventureSet,
  characterId: CharacterId
): CharacterActionAnalysis | null {
  const character = set.characters.find((candidate) => candidate.id === characterId);
  if (!character) return null;

  const actionDecks = set.decks.filter(
    (deck) => deck.ownerId === character.id && deck.kind === 'action'
  );
  const actionDeckIds = new Set(actionDecks.map((deck) => deck.id));
  const ownedCards = set.cards.filter((card) => actionDeckIds.has(card.deckId));
  const cards = ownedCards.filter((card): card is ActionCard => card.type === 'action');
  const ignored = ownedCards.filter((card) => card.type !== 'action');
  const replacementCards = cards.filter(
    (card) => card.useReplacement && hasArtwork(card.replacement)
  );
  const interpretedCards = cards.filter(
    (card) => !card.useReplacement || !hasArtwork(card.replacement)
  );
  const combatSupport = character.role === 'hero' ? 'hero-symbols' : 'unsupported-role';
  const classifiedCards = combatSupport === 'hero-symbols' ? interpretedCards : [];
  const symbols = symbolSummaries(classifiedCards);
  const unclassifiedCards =
    combatSupport === 'hero-symbols'
      ? interpretedCards.filter((card) => card.symbol === null)
      : interpretedCards;

  return {
    characterId: character.id,
    characterName: character.name,
    characterRole: character.role,
    actionDeckIds: actionDecks.map((deck) => deck.id),
    actionDeckCount: actionDecks.length,
    ...countCards(cards),
    ignoredCards: {
      designCount: ignored.length,
      copyCount: ignored.reduce((total, card) => total + cardCopies(card), 0)
    },
    unanalysedReplacements: countCards(replacementCards),
    combatSupport,
    symbols,
    unclassifiedCombat: countCards(unclassifiedCards),
    attackCapable: summarizeValueMetric(
      classifiedCards.filter((card) => card.symbol === 'attack' || card.symbol === 'versatile'),
      (card) => card.symbolValue
    ),
    defenseCapable: summarizeValueMetric(
      classifiedCards.filter((card) => card.symbol === 'defense' || card.symbol === 'versatile'),
      (card) => card.symbolValue
    ),
    boost: boostSummary(interpretedCards),
    ownerRestrictions: ownerRestrictions(character, interpretedCards),
    ownerAccess: ownerAccess(character, interpretedCards),
    fighters: fighterProfiles(character)
  };
}
