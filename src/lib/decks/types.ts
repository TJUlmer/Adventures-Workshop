import type { CharacterId } from '$lib/characters/types';
import type { Id, IsoDateTime } from '$lib/core/id';

export type DeckId = Id<'Deck'>;

/**
 * The decks an Adventures set actually uses.
 *  - `action`     — the cards a figure plays on its turn.
 *  - `initiative` — drives the villain's turn. Usually owned by the adventure
 *                   itself rather than by a character.
 *  - `rules`      — reference cards that ship with the set.
 *  - `event`      — cards the adventure deals out mid-fight.
 *  - `special`    — anything else the adventure deals from: hazards, a boss's
 *                   second phase.
 */
export const DECK_KINDS = ['action', 'initiative', 'rules', 'event', 'special'] as const;
export type DeckKind = (typeof DECK_KINDS)[number];

export interface Deck {
  readonly id: DeckId;
  name: string;
  kind: DeckKind;
  /**
   * Owning character, or `null` when the deck belongs to the adventure.
   * A deck outlives its owner: deleting a character unsets this rather than
   * destroying the cards.
   */
  ownerId: CharacterId | null;
  /** Author-only. Never printed. */
  notes: string;
  readonly createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface DeckKindMeta {
  readonly label: string;
  readonly defaultName: string;
  readonly description: string;
  /** CSS custom property carrying this kind's accent colour in the chrome. */
  readonly colorVar: string;
}

export const DECK_KIND_META: Readonly<Record<DeckKind, DeckKindMeta>> = {
  action: {
    label: 'Action',
    defaultName: 'Action deck',
    description: 'The cards this figure plays on its turn.',
    colorVar: '--kind-versatile'
  },
  initiative: {
    label: 'Initiative',
    defaultName: 'Initiative deck',
    description: 'Drives the villain’s turn during an adventure.',
    colorVar: '--kind-initiative'
  },
  rules: {
    label: 'Rules',
    defaultName: 'Rules cards',
    description: 'Reference cards that ship with the adventure.',
    colorVar: '--kind-defense'
  },
  event: {
    label: 'Event',
    defaultName: 'Event cards',
    description: 'Cards the adventure deals out mid-fight.',
    colorVar: '--kind-versatile'
  },
  special: {
    label: 'Special',
    defaultName: 'Special deck',
    description: 'Hazards, or anything else the adventure deals from.',
    colorVar: '--kind-scheme'
  }
} as const;

export function isInitiativeDeck(deck: Deck): boolean {
  return deck.kind === 'initiative';
}

/** Decks the adventure owns directly rather than a character. */
export function isSetLevelDeck(deck: Deck): boolean {
  return deck.ownerId === null;
}
