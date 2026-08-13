import { solid } from '$lib/cards/style';
import { createArtwork } from '$lib/core/artwork';
import { createId, now } from '$lib/core/id';
import type {
  CardbackDesign,
  Character,
  CharacterBandStyle,
  CharacterCardDesign,
  CharacterId,
  CharacterRole,
  HeroQuote,
  HeroSidekick
} from './types';
import { CHARACTER_ROLE_META } from './types';

/** A hero with no sidekick — the quote panel prints until one is turned on. */
export function createHeroSidekick(): HeroSidekick {
  return { enabled: false, name: '', attackType: 'melee', multiple: false, health: 7, count: 3 };
}

export function createHeroQuote(): HeroQuote {
  return { text: '', attribution: '' };
}

/**
 * The character card as the printed template dresses it: a pink border, navy
 * behind the hero and the sidekick, and the gold ability panel between them.
 */
export function createCharacterCard(): CharacterCardDesign {
  const band = (colour: string): CharacterBandStyle => ({
    fill: solid(colour),
    artwork: createArtwork()
  });
  return {
    border: solid('#dda0c7'),
    hero: band('#001722'),
    ability: band('#cfa058'),
    sidekick: band('#001722')
  };
}

/** Cardback defaults, sampled from the printed template. */
export function createCardback(role: CharacterRole): CardbackDesign {
  return {
    background: solid('#f4f1e4'),
    ink: '#6f6a55',
    artwork: createArtwork(),
    replacement: createArtwork(),
    useReplacement: false,
    label: CHARACTER_ROLE_META[role].label.toUpperCase()
  };
}

/** Fields a caller may seed when creating a character. */
export type CharacterDraft = Partial<Omit<Character, 'id' | 'createdAt' | 'updatedAt' | 'role'>>;

const ROLE_DEFAULTS: Readonly<
  Record<CharacterRole, Pick<Character, 'health' | 'move' | 'figureCount' | 'attackType'>>
> = {
  villain: { health: 18, move: 3, figureCount: 1, attackType: 'melee' },
  minion: { health: 5, move: 2, figureCount: 1, attackType: 'melee' },
  sidekick: { health: 7, move: 2, figureCount: 1, attackType: 'melee' },
  hero: { health: 16, move: 2, figureCount: 1, attackType: 'melee' }
};

export function createCharacter(role: CharacterRole, draft: CharacterDraft = {}): Character {
  const timestamp = now();
  const defaults = ROLE_DEFAULTS[role];

  return {
    id: createId<CharacterId>('char'),
    name: '',
    subtitle: '',
    role,
    attackType: defaults.attackType,
    health: defaults.health,
    move: defaults.move,
    figureCount: defaults.figureCount,
    abilities: [],
    artwork: createArtwork(),
    cardback: createCardback(role),
    sidekick: createHeroSidekick(),
    quote: createHeroQuote(),
    characterCard: createCharacterCard(),
    style: {},
    notes: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...draft
  };
}

export function duplicateCharacter(character: Character): Character {
  const timestamp = now();
  return {
    ...character,
    id: createId<CharacterId>('char'),
    name: character.name ? `${character.name} (copy)` : '',
    abilities: character.abilities.map((ability) => ({ ...ability })),
    artwork: { ...character.artwork, crop: { ...character.artwork.crop } },
    sidekick: { ...character.sidekick },
    quote: { ...character.quote },
    style: { ...character.style },
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

/** Display name that never renders as an empty string in the UI. */
export function characterLabel(character: Character): string {
  if (character.name.trim().length > 0) return character.name;
  return `Untitled ${character.role}`;
}
