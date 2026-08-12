import { solid } from '$lib/cards/style';
import { createArtwork } from '$lib/core/artwork';
import { createId, now } from '$lib/core/id';
import type { CardbackDesign, Character, CharacterId, CharacterRole } from './types';
import { CHARACTER_ROLE_META } from './types';

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
  hero: { health: 16, move: 3, figureCount: 1, attackType: 'melee' }
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
