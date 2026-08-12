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
 * An Adventures set is a villain and its minions; sidekicks and heroes belong
 * to a hero-side feature that does not exist yet. The roles stay in the model
 * so a document that already uses them still loads and still groups correctly —
 * they are just not offered.
 */
export const SELECTABLE_ROLES = ['villain', 'minion'] as const;

export const ATTACK_TYPES = ['melee', 'ranged'] as const;
export type AttackType = (typeof ATTACK_TYPES)[number];

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

export interface Character {
  readonly id: CharacterId;
  name: string;
  /** Small line under the name on the character sheet. */
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
