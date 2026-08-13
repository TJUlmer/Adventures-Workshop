/**
 * Pure, side-effect-free reads over an `AdventureSet`.
 *
 * Everything the UI needs to *display* the document derives from here, so the
 * store only ever holds the document itself — no denormalised copies to keep
 * in sync.
 */
import { deckSize } from '$lib/cards/factory';
import type { CardStyleOverride, CardTheme } from '$lib/cards/style';
import type { StyleOrigin } from '$lib/cards/theme';
import { resolveCardTheme, styleOrigin } from '$lib/cards/theme';
import type { Card, CardId } from '$lib/cards/types';
import type { Character, CharacterId, CharacterRole } from '$lib/characters/types';
import type { Deck, DeckId } from '$lib/decks/types';
import type { AdventureSet, CharacterEntry, DeckEntry, SetOutline } from './types';

// -- Lookups ------------------------------------------------------------

export function findCard(set: AdventureSet, id: CardId | null): Card | null {
  if (id === null) return null;
  return set.cards.find((card) => card.id === id) ?? null;
}

export function findCharacter(set: AdventureSet, id: CharacterId | null): Character | null {
  if (id === null) return null;
  return set.characters.find((character) => character.id === id) ?? null;
}

export function findDeck(set: AdventureSet, id: DeckId | null): Deck | null {
  if (id === null) return null;
  return set.decks.find((deck) => deck.id === id) ?? null;
}

// -- Relationships ------------------------------------------------------

export function cardsInDeck(set: AdventureSet, deckId: DeckId): Card[] {
  return set.cards.filter((card) => card.deckId === deckId);
}

/** Every deck a character owns, initiative included. */
export function decksForCharacter(set: AdventureSet, characterId: CharacterId): Deck[] {
  return set.decks.filter((deck) => deck.ownerId === characterId);
}

/** Cards across all of a character's decks. */
export function cardsForCharacter(set: AdventureSet, characterId: CharacterId): Card[] {
  const owned = new Set(decksForCharacter(set, characterId).map((deck) => deck.id));
  return set.cards.filter((card) => owned.has(card.deckId));
}

export function deckOwner(set: AdventureSet, deck: Deck): Character | null {
  return findCharacter(set, deck.ownerId);
}

export function characterForCard(set: AdventureSet, card: Card): Character | null {
  const deck = findDeck(set, card.deckId);
  return deck ? deckOwner(set, deck) : null;
}

export function initiativeDecks(set: AdventureSet): Deck[] {
  return set.decks.filter((deck) => deck.kind === 'initiative');
}

export function rulesDecks(set: AdventureSet): Deck[] {
  return set.decks.filter((deck) => deck.kind === 'rules');
}

export function eventDecks(set: AdventureSet): Deck[] {
  return set.decks.filter((deck) => deck.kind === 'event');
}

/** Deck kinds the sidebar collects set-wide rather than under a figure. */
const SET_LEVEL_KINDS = new Set(['initiative', 'rules', 'event']);

/**
 * Decks with no owner that none of the set-level groups claim.
 *
 * The point of the group is to rescue an author's cards when their figure is
 * deleted, so an *empty* orphan is not worth a section — it would be a heading
 * over nothing. `outline` drops those; this returns them all, since re-parenting
 * one is a legitimate thing to want to do with it.
 */
export function looseDecks(set: AdventureSet): Deck[] {
  return set.decks.filter((deck) => deck.ownerId === null && !SET_LEVEL_KINDS.has(deck.kind));
}

export function charactersByRole(set: AdventureSet, role: CharacterRole): Character[] {
  return set.characters.filter((character) => character.role === role);
}

export function getVillain(set: AdventureSet): Character | null {
  return set.characters.find((character) => character.role === 'villain') ?? null;
}

// -- Outline ------------------------------------------------------------

/** One pass over the cards, so building the outline stays linear. */
function indexCardsByDeck(set: AdventureSet): Map<DeckId, Card[]> {
  const index = new Map<DeckId, Card[]>();
  for (const card of set.cards) {
    const bucket = index.get(card.deckId);
    if (bucket) bucket.push(card);
    else index.set(card.deckId, [card]);
  }
  return index;
}

function toDeckEntry(deck: Deck, index: Map<DeckId, Card[]>): DeckEntry {
  const cards = index.get(deck.id) ?? [];
  return { deck, cards, printCount: deckSize(cards) };
}

function toCharacterEntry(
  character: Character,
  decks: readonly Deck[],
  index: Map<DeckId, Card[]>
): CharacterEntry {
  // Initiative and rules decks are collected set-wide, not listed per figure.
  const entries = decks
    .filter((deck) => deck.ownerId === character.id && !SET_LEVEL_KINDS.has(deck.kind))
    .map((deck) => toDeckEntry(deck, index));

  return {
    character,
    decks: entries,
    cardCount: entries.reduce((total, entry) => total + entry.cards.length, 0),
    printCount: entries.reduce((total, entry) => total + entry.printCount, 0)
  };
}

export function outline(set: AdventureSet): SetOutline {
  const index = indexCardsByDeck(set);

  const entryFor = (character: Character): CharacterEntry =>
    toCharacterEntry(character, set.decks, index);

  return {
    heroes: charactersByRole(set, 'hero').map(entryFor),
    villains: charactersByRole(set, 'villain').map(entryFor),
    minions: charactersByRole(set, 'minion').map(entryFor),
    others: charactersByRole(set, 'sidekick').map(entryFor),
    initiative: initiativeDecks(set).map((deck) => toDeckEntry(deck, index)),
    rules: rulesDecks(set).map((deck) => toDeckEntry(deck, index)),
    events: eventDecks(set).map((deck) => toDeckEntry(deck, index)),
    // Only orphans that still hold cards; an empty one has nothing to rescue.
    loose: looseDecks(set)
      .map((deck) => toDeckEntry(deck, index))
      .filter((entry) => entry.cards.length > 0)
  };
}

// -- Stats --------------------------------------------------------------

export interface SetStats {
  characterCount: number;
  deckCount: number;
  /** Distinct card entries. */
  cardCount: number;
  /** Physical cards once quantities are counted. */
  printCount: number;
  initiativeCount: number;
  rulesCount: number;
}

function countIn(set: AdventureSet, decks: readonly Deck[]): number {
  const ids = new Set(decks.map((deck) => deck.id));
  return deckSize(set.cards.filter((card) => ids.has(card.deckId)));
}

export function setStats(set: AdventureSet): SetStats {
  return {
    characterCount: set.characters.length,
    deckCount: set.decks.length,
    cardCount: set.cards.length,
    printCount: deckSize(set.cards),
    initiativeCount: countIn(set, initiativeDecks(set)),
    rulesCount: countIn(set, rulesDecks(set))
  };
}

// -- Style cascade ------------------------------------------------------

export interface StyleLayers {
  set: CardStyleOverride;
  character: CardStyleOverride | null;
  card: CardStyleOverride;
}

/** The three override layers that sit above the stock template look. */
export function styleLayersForCard(set: AdventureSet, card: Card): StyleLayers {
  const character = characterForCard(set, card);
  return {
    set: set.style,
    character: character ? character.style : null,
    card: card.style
  };
}

/** The card's final look: stock → set → character → card. */
export function resolveStyleForCard(set: AdventureSet, card: Card): CardTheme {
  const layers = styleLayersForCard(set, card);
  const role = characterForCard(set, card)?.role;
  return resolveCardTheme(layers.set, layers.character, layers.card, card.type, role);
}

/** Which layer a given style key is currently coming from. */
export function styleOriginForCard(
  set: AdventureSet,
  card: Card,
  key: keyof CardTheme
): StyleOrigin {
  /* The stock layer differs per template, but "from template" reads the same. */
  const layers = styleLayersForCard(set, card);
  return styleOrigin(key, layers.set, layers.character, layers.card);
}
