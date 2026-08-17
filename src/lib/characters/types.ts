import type { CardStyleOverride, Fill } from '$lib/cards/style';
import type { Artwork } from '$lib/core/artwork';
import type { Id, IsoDateTime } from '$lib/core/id';

export type CharacterId = Id<'Character'>;

/**
 * Where a figure sits in an Adventures set.
 *  - `villain`  — the antagonist the heroes are up against. One per set.
 *  - `minion`   — recurring rank-and-file figures under the villain.
 *  - `sidekick` — a figure attached to another character's deck.
 *  - `hero`     — a playable protagonist bundled with the set.
 */
export const CHARACTER_ROLES = ['villain', 'minion', 'sidekick', 'hero'] as const;
export type CharacterRole = (typeof CHARACTER_ROLES)[number];

/**
 * The roles an author can actually pick.
 *
 * `sidekick` stays out: it is not a roster entity a set adds directly — a
 * hero's own companion lives on `Character.sidekick` instead, a field rather
 * than a character, so there is nothing to select it *as*. The role stays in
 * `CHARACTER_ROLES` so a document that already used it still loads and still
 * groups correctly.
 */
export const SELECTABLE_ROLES = ['hero', 'villain', 'minion'] as const;

/**
 * How a figure attacks, in the order the printed symbols read: the two
 * ordinary ranges first, then the three that modify one.
 *
 * Each is a supplied lockup in `public/assets/symbols` — the word and its
 * icon drawn together as one picture, in the colour that identifies it — so
 * adding one here is adding a file, and nothing about the character card
 * changes to print it.
 */
export const ATTACK_TYPES = ['melee', 'ranged', 'lunge', 'reach', 'large'] as const;
export type AttackType = (typeof ATTACK_TYPES)[number];

export const ATTACK_TYPE_LABELS: Readonly<Record<AttackType, string>> = {
  melee: 'Melee',
  ranged: 'Ranged',
  lunge: 'Lunge',
  reach: 'Reach',
  large: 'Large'
};

export interface CharacterAbility {
  name: string;
  text: string;
  /** Passive abilities are always on; triggered ones fire on a condition. */
  kind: 'passive' | 'triggered';
}

/**
 * The card back printed for this figure's deck.
 *
 * `replacement` exists because some authors will want to supply a finished back
 * rather than composing one — when it is on, it stands in for the entire card,
 * template and all.
 */
export interface CardbackDesign {
  background: Fill;
  ink: string;
  /** Art shown inside the template's border. */
  artwork: Artwork;
  /** A finished image that replaces the whole card back. */
  replacement: Artwork;
  useReplacement: boolean;
  /** Line above the name. Defaults from the role. */
  label: string;
}

/**
 * A hero's companion figure, printed on the character card's lower block.
 *
 * One sub-object rather than a list: every template the character card comes
 * in shows at most one sidekick *concept* — a single tracked individual, or an
 * undifferentiated swarm of copies — never several distinct named companions
 * side by side. `enabled` off is what selects the quote panel instead; nothing
 * about `name`, `attackType`, `health` or `count` is drawn on the character
 * card even when it is on, since that card prints the fixed word "SIDEKICK"
 * rather than an identity. `name` exists to be picked up elsewhere: labelling
 * which of a hero's action cards this figure may play, and naming the piece in
 * a Tabletop Simulator export.
 *
 * `multiple` is not asked for directly — the editor derives it from `count`
 * (one copy is a single tracked figure, more than one a swarm) rather than
 * offering it as its own toggle, since the two fields would otherwise be
 * able to disagree with each other. A single tracked sidekick stays a
 * genuinely different, lighter thing than "+1 character card"
 * (`Character.additionalCards`): a name and a stat line on someone else's
 * sheet, not a full stat block, abilities and a sheet of its own — so it is
 * not a stand-in for one, and is never folded into `additionalCards`. The
 * one place old data *is* folded is a not-yet-normalized document from
 * before `additionalCards` existed at all, where a single tracked companion
 * was the only way to express a second figure — see `sets/normalize.ts`.
 */
export interface HeroSidekick {
  enabled: boolean;
  name: string;
  attackType: AttackType;
  /**
   * Off: one figure with its own tracked `health`. On: `count` identical,
   * healthless copies — a token count printed in place of the health badge,
   * the way a minion's `figureCount` already works.
   */
  multiple: boolean;
  health: number | null;
  count: number;
}

/** Flavour text on the character card, printed only when there is no sidekick. */
export interface HeroQuote {
  text: string;
  attribution: string;
}

export type HeroCharacterCardId = Id<'HeroCharacterCard'>;

/**
 * A further named identity sharing its hero's roster entry, action deck and
 * figures — Dagger, alongside Cloak, entered as "+1 character card" rather
 * than as a second, separately-linked roster entry. Prints as its own full
 * character-card sheet, reusing the same template every hero already uses —
 * with its own `characterCard` design, independent of the primary's, since
 * two identities sharing one deck do not have to share one look.
 *
 * No top-level `artwork`: the character-card sheet has no portrait window of
 * its own to put one in — what art it carries lives inside `characterCard`,
 * as band artwork or a whole-sheet replacement, same as the primary's. No
 * `createdAt`/`updatedAt`: `Character.updatedAt` already covers every nested
 * mutation, the same as a threat track's slots or a map's spaces.
 */
export interface HeroCharacterCard {
  readonly id: HeroCharacterCardId;
  name: string;
  subtitle: string;
  attackType: AttackType;
  health: number | null;
  move: number;
  abilities: CharacterAbility[];
  quote: HeroQuote;
  characterCard: CharacterCardDesign;
}

/**
 * The three bands of the character card an author can dress: the hero's own
 * heading *and its attack row*, the special-ability panel, and whichever of
 * the sidekick bands or the quote panel is showing.
 *
 * Three rather than five, because the hero's name and its attack row are one
 * block to look at — the frame rules a line between them, and nobody wants to
 * match two colours across it. Named for what they are on the card rather than
 * by index, so a layout change cannot silently re-point somebody's picture.
 */
export const CHARACTER_BAND_NAMES = ['hero', 'ability', 'sidekick'] as const;
export type CharacterBandName = (typeof CHARACTER_BAND_NAMES)[number];

export interface CharacterBandStyle {
  fill: Fill;
  artwork: Artwork;
}

/**
 * How one character-card sheet is dressed — the primary's own
 * (`Character.characterCard`), or one belonging to a specific additional
 * card (`HeroCharacterCard.characterCard`); each identity's is independent.
 *
 * The only part of this card that goes through anything like the style
 * cascade, and it does not go through the cascade proper: the sheet is one
 * fixed layout and its chrome is supplied art, so what an author gets to
 * choose is the border's colour and what fills each of the three bands —
 * or, with `useReplacement` on, a finished sheet that skips composing one
 * entirely, the same escape hatch every other printed face already has.
 */
export interface CharacterCardDesign {
  /** The pink outline and the bars between the bands, in the printed art. */
  border: Fill;
  hero: CharacterBandStyle;
  ability: CharacterBandStyle;
  sidekick: CharacterBandStyle;
  /** A finished image that replaces the whole composed sheet, template included. */
  replacement: Artwork;
  useReplacement: boolean;
}

export interface Character {
  readonly id: CharacterId;
  name: string;
  /**
   * A shorter form of the name, for where the full one will not fit.
   *
   * The character card prints `name`; the action cards' ribbon prints this
   * when it is set and falls back to `name` when it is not — "Geralt" on the
   * ribbon against "Geralt of Rivia" on the sheet and beside the copies count.
   * Blank is the ordinary case: most names are short enough already.
   */
  subtitle: string;
  role: CharacterRole;
  attackType: AttackType;
  /** `null` for figures with no health track. */
  health: number | null;
  move: number;
  /** Identical figures placed on the board for this entry. */
  figureCount: number;
  abilities: CharacterAbility[];
  artwork: Artwork;
  cardback: CardbackDesign;
  /**
   * The character card's lower block, and its no-sidekick alternative.
   * Present on every character but drawn only for a `hero` — the printed
   * card the rest of this app's roles do not have yet.
   */
  sidekick: HeroSidekick;
  quote: HeroQuote;
  /**
   * Further named identities sharing this roster entry, its action deck and
   * its figures — a duo like Cloak & Dagger, entered as "+1 character card"
   * rather than as two linked characters. Empty for the ordinary case of one
   * figure, one name.
   */
  additionalCards: HeroCharacterCard[];
  /**
   * The joint name printed on the roster, the deck-owner line and the action
   * card ribbon's fallback, once there is more than one identity here. Blank
   * auto-joins `name` and every `additionalCards[].name` with " & ". Set
   * explicitly for something that isn't a plain join, e.g. "The Bishops."
   * Irrelevant and hidden while `additionalCards` is empty.
   */
  printedName: string;
  /** The printed character card's border, band fills and band artwork. */
  characterCard: CharacterCardDesign;
  /**
   * Look overrides applied to every card in this character's decks.
   * Sits between the set's style and each card's own overrides.
   */
  style: CardStyleOverride;
  /** Author-only. Never rendered. */
  notes: string;
  readonly createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CharacterRoleMeta {
  readonly label: string;
  readonly plural: string;
  readonly description: string;
  /** CSS custom property carrying this role's accent colour. */
  readonly colorVar: `--role-${CharacterRole}`;
}

export const CHARACTER_ROLE_META: Readonly<Record<CharacterRole, CharacterRoleMeta>> = {
  villain: {
    label: 'Villain',
    plural: 'Villains',
    description: 'The antagonist the heroes face. One per adventure.',
    colorVar: '--role-villain'
  },
  minion: {
    label: 'Minion',
    plural: 'Minions',
    description: 'Rank-and-file figures fighting alongside the villain.',
    colorVar: '--role-minion'
  },
  sidekick: {
    label: 'Sidekick',
    plural: 'Sidekicks',
    description: 'A figure attached to another character’s deck.',
    colorVar: '--role-sidekick'
  },
  hero: {
    label: 'Hero',
    plural: 'Heroes',
    description: 'A playable protagonist bundled with the set.',
    colorVar: '--role-hero'
  }
} as const;

export function isVillain(character: Character): boolean {
  return character.role === 'villain';
}
