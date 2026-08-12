import type { CharacterId } from '$lib/characters/types';
import type { Artwork } from '$lib/core/artwork';
import type { Id, IsoDateTime } from '$lib/core/id';
import type { DeckId } from '$lib/decks/types';
import type { CardStyleOverride, Fill } from './style';

export type CardId = Id<'Card'>;

/**
 * The three printed card templates in an Adventures set. This is the card's
 * *layout*, not its combat role — an action card carries an attack value, a
 * defense value, or both.
 */
export const CARD_TYPES = ['action', 'initiative', 'rules', 'event'] as const;
export type CardType = (typeof CARD_TYPES)[number];

/**
 * Timed ability blocks. Rendered in declaration order — plain text first, then
 * Immediately, During Combat, After Combat — and only where non-empty, which is
 * what keeps a one-line card from printing three empty labels.
 */
export interface AbilityBlocks {
  /** Untimed text, printed with no label. */
  plain: string;
  immediately: string;
  duringCombat: string;
  afterCombat: string;
}

export const ABILITY_TIMINGS = ['immediately', 'duringCombat', 'afterCombat'] as const;
export type AbilityTiming = (typeof ABILITY_TIMINGS)[number];

export const ABILITY_TIMING_LABELS: Readonly<Record<AbilityTiming, string>> = {
  immediately: 'IMMEDIATELY',
  duringCombat: 'DURING COMBAT',
  afterCombat: 'AFTER COMBAT'
} as const;

export function createAbilityBlocks(init: Partial<AbilityBlocks> = {}): AbilityBlocks {
  return { plain: '', immediately: '', duringCombat: '', afterCombat: '', ...init };
}

/** The blocks that actually carry text, in printed order. */
export function usedTimings(ability: AbilityBlocks): AbilityTiming[] {
  return ABILITY_TIMINGS.filter((timing) => ability[timing].trim().length > 0);
}

export function abilityIsEmpty(ability: AbilityBlocks): boolean {
  return (
    ability.plain.trim().length === 0 &&
    ABILITY_TIMINGS.every((timing) => ability[timing].trim().length === 0)
  );
}

/** Everything every card carries, whatever its template. */
export interface CardCommon {
  readonly id: CardId;
  name: string;
  /** The deck this card sits in. Every card belongs to exactly one. */
  deckId: DeckId;
  /** Copies of this card in its deck. */
  quantity: number;
  artwork: Artwork;
  /**
   * A finished image standing in for the whole composed face.
   *
   * The same escape hatch the deck back and the threat board already have, and
   * for the same reason: an author who has drawn a card elsewhere should not
   * have to rebuild it here to get it into a set. When it is on it replaces the
   * card entirely — template, type, artwork and all — so nothing else on the
   * card can contradict it.
   *
   * Kept alongside the composed card rather than instead of it, so turning it
   * off gets the composition back untouched.
   */
  replacement: Artwork;
  useReplacement: boolean;
  /** Sparse look overrides. Absent keys inherit from character, set, then stock. */
  style: CardStyleOverride;
  /** Author-only working notes. Never rendered on the card. */
  notes: string;
  readonly createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** A villain or minion action card. */
export interface ActionCard extends CardCommon {
  type: 'action';
  /** Printed above the ability text. Distinct from the character name ribbon. */
  title: string;
  /** `null` means the symbol is not printed at all. */
  attack: number | null;
  defense: number | null;
  boost: number | null;
  ability: AbilityBlocks;
  /**
   * Split cards divide the body panel: the attack value and `ability` above a
   * floating separator, the defense value and `defenseAbility` below it.
   */
  split: boolean;
  defenseAbility: AbilityBlocks;
}

/**
 * Initiative deck card. `variant` is the toggle between an acting card
 * ("Villain") and an effect card ("Villain Effect"); `subject` picks which
 * figure it refers to, because the initiative deck belongs to the adventure
 * rather than to one character.
 */
export const INITIATIVE_VARIANTS = ['card', 'effect'] as const;
export type InitiativeVariant = (typeof INITIATIVE_VARIANTS)[number];

export const INITIATIVE_SUBJECTS = ['villain', 'minion'] as const;
export type InitiativeSubject = (typeof INITIATIVE_SUBJECTS)[number];

export const INITIATIVE_BANDS = ['subject', 'rightNow', 'endOfRound'] as const;
export type InitiativeBandKey = (typeof INITIATIVE_BANDS)[number];

/**
 * Each band is styled independently, and can carry its own artwork over its
 * fill, so any mix of image and flat colour is possible across the three.
 */
export interface InitiativeBandStyle {
  fill: Fill;
  ink: string;
  artwork: Artwork;
  showArtwork: boolean;
}

export type InitiativeBands = Record<InitiativeBandKey, InitiativeBandStyle>;

export interface InitiativeCard extends CardCommon {
  type: 'initiative';
  variant: InitiativeVariant;
  subject: InitiativeSubject;
  /** The figure this card acts for. Supplies the move value when set. */
  characterId: CharacterId | null;
  /** Top band copy: the character's name, or the effect text. */
  subjectText: string;
  /** Used when no character is assigned. */
  moveValue: number;
  /** Middle band: what happens right now. */
  rightNow: string;
  /** Bottom band: what happens at the end of the round. */
  endOfRound: string;
  /** Print the MOVE badge on the right of the Right Now band. */
  showMove: boolean;
  bands: InitiativeBands;
}

/** A rules or reference card. Body is sanitised rich text. */
export interface RulesCard extends CardCommon {
  type: 'rules';
  heading: string;
  /** Sanitised HTML. See `lib/text/rich-text.ts`. */
  body: string;
}

/**
 * Where the reverse's heading sits, relative to where the template puts it.
 *
 * Offsets are a percentage of the card's own width and height rather than
 * pixels, so a placement holds at a 120px thumbnail and at print size alike —
 * the same reason a threat note is placed by fraction. Rotation is degrees,
 * about the block's centre.
 */
export interface HeadingPlacement {
  offsetX: number;
  offsetY: number;
  rotation: number;
}

export function createHeadingPlacement(): HeadingPlacement {
  return { offsetX: 0, offsetY: 0, rotation: 0 };
}

/**
 * Event card. Same authoring shape as a rules card — heading plus rich text —
 * but a distinct type because it prints landscape on mini European stock, and
 * because its *reverse* is designed too: the printed title runs on a slant, so
 * the heading there can be moved and turned.
 */
export interface EventCard extends CardCommon {
  type: 'event';
  heading: string;
  body: string;
  /** Placement of the heading on the reverse. The front's is fixed. */
  backHeading: HeadingPlacement;
  /**
   * The reverse's own replacement. An event card is the one template designed
   * on both sides, so `useReplacement` covering only the front would leave half
   * of it unreachable.
   */
  backReplacement: Artwork;
  useBackReplacement: boolean;
}

export type Card = ActionCard | InitiativeCard | RulesCard | EventCard;

/** Cards authored as a heading plus rich text. */
export function isProseCard(card: Card): card is RulesCard | EventCard {
  return card.type === 'rules' || card.type === 'event';
}

/** Narrow the union by template: `CardOfType<'rules'>` → `RulesCard`. */
export type CardOfType<TType extends CardType> = Extract<Card, { type: TType }>;

export interface CardTypeMeta {
  readonly label: string;
  readonly plural: string;
  readonly description: string;
  /** CSS custom property carrying this type's accent colour in the chrome. */
  readonly colorVar: string;
}

export const CARD_TYPE_META: Readonly<Record<CardType, CardTypeMeta>> = {
  action: {
    label: 'Action',
    plural: 'Action cards',
    description: 'A villain or minion card with combat values and an ability.',
    colorVar: '--kind-attack'
  },
  initiative: {
    label: 'Initiative',
    plural: 'Initiative cards',
    description: 'Drives the villain’s turn: Right Now, then End of Round.',
    colorVar: '--kind-initiative'
  },
  rules: {
    label: 'Rules',
    plural: 'Rules cards',
    description: 'Reference text for the adventure.',
    colorVar: '--kind-scheme'
  },
  event: {
    label: 'Event',
    plural: 'Event cards',
    description: 'Something the adventure deals out mid-fight. Prints landscape.',
    colorVar: '--kind-versatile'
  }
} as const;

export const INITIATIVE_VARIANT_LABELS: Readonly<Record<InitiativeVariant, string>> = {
  card: 'Card',
  effect: 'Effect'
} as const;

export const INITIATIVE_SUBJECT_LABELS: Readonly<Record<InitiativeSubject, string>> = {
  villain: 'Villain',
  minion: 'Minion'
} as const;

/** The banner an initiative card prints, e.g. "Villain Effect". */
export function initiativeHeading(card: InitiativeCard): string {
  const subject = INITIATIVE_SUBJECT_LABELS[card.subject];
  return card.variant === 'effect' ? `${subject} Effect` : subject;
}

/** The rotated label printed to the left of a band's separator. */
export function initiativeBandLabel(card: InitiativeCard, band: InitiativeBandKey): string {
  if (band === 'rightNow') return 'Right Now';
  if (band === 'endOfRound') return 'End of Round';
  return initiativeHeading(card);
}

export function isActionCard(card: Card): card is ActionCard {
  return card.type === 'action';
}

export function isInitiativeCard(card: Card): card is InitiativeCard {
  return card.type === 'initiative';
}

export function isRulesCard(card: Card): card is RulesCard {
  return card.type === 'rules';
}
