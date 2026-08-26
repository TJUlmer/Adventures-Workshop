import { cloneArtwork, createArtwork } from '$lib/core/artwork';
import { createId, now } from '$lib/core/id';
import type { DeckId } from '$lib/decks/types';
import { INITIATIVE_BAND_DEFAULTS } from '$lib/renderer/geometry';
import { SUBJECT_TOKEN } from '$lib/text/tokens';
import { solid } from './style';
import type { Card, CardCommon, CardId, CardOfType, CardType, InitiativeBands } from './types';
import { CARD_TYPE_META, createAbilityBlocks, createHeadingPlacement, initiativeHeading } from './types';

/** Band defaults, sampled from the print template. */
function createInitiativeBands(): InitiativeBands {
  const band = (key: keyof typeof INITIATIVE_BAND_DEFAULTS) => ({
    fill: solid(INITIATIVE_BAND_DEFAULTS[key].fill),
    ink: INITIATIVE_BAND_DEFAULTS[key].ink,
    artwork: createArtwork(),
    showArtwork: false
  });

  return {
    subject: band('subject'),
    rightNow: band('rightNow'),
    endOfRound: band('endOfRound')
  };
}

/** Seed values accepted when creating a card. */
export type CardDraft = Partial<Omit<CardCommon, 'id' | 'deckId' | 'createdAt' | 'updatedAt'>>;

function createCommon(deckId: DeckId, draft: CardDraft): CardCommon {
  const timestamp = now();
  return {
    id: createId<CardId>('card'),
    name: draft.name ?? '',
    deckId,
    quantity: draft.quantity ?? 1,
    artwork: draft.artwork ? createArtwork(draft.artwork) : createArtwork(),
    replacement: createArtwork(),
    useReplacement: false,
    style: draft.style ? { ...draft.style } : {},
    notes: draft.notes ?? '',
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

/**
 * Create a card of a given template. The return type narrows with the
 * argument, so `createCard('rules', deckId)` is a `RulesCard`, not a `Card`.
 */
export function createCard<TType extends CardType>(
  type: TType,
  deckId: DeckId,
  draft: CardDraft = {}
): CardOfType<TType> {
  const common = createCommon(deckId, draft);

  switch (type) {
    case 'initiative':
      return {
        ...common,
        type: 'initiative',
        variant: 'card',
        subject: 'villain',
        characterId: null,
        subjectText: '',
        moveValue: 3,
        rightNow: '',
        endOfRound: '',
        showMove: true,
        bands: createInitiativeBands()
      } as CardOfType<TType>;

    case 'rules':
      return {
        ...common,
        type,
        heading: '',
        headingAlign: 'left',
        body: '',
        landscape: false
      } as CardOfType<TType>;

    case 'event':
      return {
        ...common,
        type,
        heading: '',
        body: '',
        backHeading: createHeadingPlacement(),
        backReplacement: createArtwork(),
        useBackReplacement: false
      } as CardOfType<TType>;

    default:
      return {
        ...common,
        type: 'action',
        title: '',
        attack: 2,
        defense: 2,
        boost: 1,
        ability: createAbilityBlocks(),
        /* Meaningful only inside a hero's deck — see `ActionCard` — and given
           sensible values there rather than left null, so a card dropped into
           a hero's deck already has a ribbon to look at before anyone visits
           its editor. */
        symbol: 'attack',
        symbolValue: 2,
        owner: 'hero',
        split: false,
        defenseAbility: createAbilityBlocks(),
        showRibbonSymbol: false,
        ribbonSymbol: ''
      } as CardOfType<TType>;
  }
}

/**
 * Deception: the one card every villain and minion deck carries a copy of.
 *
 * Preset rather than typed out each time, because it is the same card every
 * time — and because its wording names the figure, which `{{name}}` keeps
 * right when the card is later assigned to a deck or the figure is renamed.
 */
export function createDeceptionCard(deckId: DeckId): CardOfType<'action'> {
  const card = createCard('action', deckId, { quantity: 1 });
  card.title = 'Deception';
  card.attack = 0;
  card.defense = 0;
  card.boost = 3;
  card.ability.plain =
    `Whenever this card is put into ${SUBJECT_TOKEN}’s discard pile, shuffle its ` +
    'discard pile back into its deck (including this card). This effect cannot be canceled.';
  return card;
}

export function duplicateCard(card: Card): Card {
  const timestamp = now();
  const copy: Card = {
    ...card,
    id: createId<CardId>('card'),
    name: card.name ? `${card.name} (copy)` : '',
    artwork: cloneArtwork(card.artwork),
    replacement: cloneArtwork(card.replacement),
    style: { ...card.style },
    createdAt: timestamp,
    updatedAt: timestamp
  };

  if (copy.type === 'event') {
    copy.backReplacement = cloneArtwork(copy.backReplacement);
  }
  if (copy.type === 'action') {
    copy.ability = { ...copy.ability };
    copy.defenseAbility = { ...copy.defenseAbility };
  }
  if (copy.type === 'initiative') {
    copy.bands = {
      subject: { ...copy.bands.subject, artwork: cloneArtwork(copy.bands.subject.artwork) },
      rightNow: { ...copy.bands.rightNow, artwork: cloneArtwork(copy.bands.rightNow.artwork) },
      endOfRound: {
        ...copy.bands.endOfRound,
        artwork: cloneArtwork(copy.bands.endOfRound.artwork)
      }
    };
  }
  return copy;
}

/** Display name that never renders as an empty string in the UI. */
export function cardLabel(card: Card): string {
  if (card.name.trim().length > 0) return card.name;
  if (card.type === 'action' && card.title.trim().length > 0) return card.title;
  if ((card.type === 'rules' || card.type === 'event') && card.heading.trim().length > 0) {
    return card.heading;
  }
  /*
   * An initiative card has no title field of its own to fall back on — its
   * only author-facing text is the band copy (`subjectText`/`rightNow`/
   * `endOfRound`), none of which reads as a name — so every one printed
   * "Untitled Initiative" regardless of which of the four it was. It already
   * has a real, distinguishing label: `initiativeHeading` computes "Villain
   * Effect" for the printed banner, and reusing it here is the whole fix —
   * "Villain"/"Villain Effect"/"Minion"/"Minion Effect" was the naming this
   * was asked for, and it turned out to already exist one call away.
   */
  if (card.type === 'initiative') return initiativeHeading(card);
  return `Untitled ${CARD_TYPE_META[card.type].label.toLowerCase()}`;
}

/** Total physical cards, counting duplicates. */
export function deckSize(cards: readonly Card[]): number {
  return cards.reduce((total, card) => total + card.quantity, 0);
}
