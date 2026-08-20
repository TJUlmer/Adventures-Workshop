import { solid } from '$lib/cards/style';
import { cloneArtwork, createArtwork } from '$lib/core/artwork';
import { createId, now } from '$lib/core/id';
import type {
  CardbackDesign,
  Character,
  CharacterAbility,
  CharacterBandStyle,
  CharacterCardDesign,
  CharacterId,
  CharacterRole,
  HeroCharacterCard,
  HeroCharacterCardId,
  HeroQuote,
  HeroSidekick
} from './types';
import { CHARACTER_BAND_NAMES, CHARACTER_ROLE_META } from './types';

/** A hero with no sidekick — the quote panel prints until one is turned on. */
export function createHeroSidekick(): HeroSidekick {
  return { enabled: false, name: '', attackType: 'melee', multiple: false, health: 7, count: 3 };
}

export function createHeroQuote(): HeroQuote {
  return { text: '', attribution: '' };
}

/**
 * A blank ability, ready to type into. A hero's own card and every
 * additional card start with one already in the list — the printed sheet
 * shows a placeholder-styled block either way (see `HeroCharacterCardFace`),
 * so there's nothing to lose by making that block editable immediately
 * instead of hiding it behind an "Add ability" click.
 */
export function createCharacterAbility(): CharacterAbility {
  return { name: '', text: '', kind: 'passive' };
}

/** A fresh additional character card — "+1 character card." */
export function createHeroCharacterCard(): HeroCharacterCard {
  return {
    id: createId<HeroCharacterCardId>('hchar'),
    name: '',
    subtitle: '',
    attackType: 'melee',
    health: 16,
    move: 2,
    abilities: [createCharacterAbility()],
    quote: createHeroQuote(),
    characterCard: createCharacterCard()
  };
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
    healthBadge: solid('#293992'),
    healthBadgeAccent: solid('#f9f6ee'),
    quoteInk: solid('#f6eada'),
    hero: band('#001722'),
    ability: band('#cfa058'),
    sidekick: band('#001722'),
    replacement: createArtwork(),
    useReplacement: false
  };
}

/**
 * A `CharacterCardDesign`, independent all the way down.
 *
 * `duplicateCharacter` used to shallow-spread a character, which leaves
 * every field this function touches — `characterCard` itself, each band's
 * `fill`/`artwork`, `replacement` — pointing at the *same* nested objects
 * the original still holds. Editing the duplicate's ability band silently
 * repainted the original's too, and vice versa: exactly the hazard
 * `sets/normalize.ts`'s own `heroCharacterCard` doc comment already warns
 * about ("a clone, via `characterCard` itself — never the same object
 * twice"), just unguarded on this path.
 */
export function cloneCharacterCard(design: CharacterCardDesign): CharacterCardDesign {
  const bands = Object.fromEntries(
    CHARACTER_BAND_NAMES.map((name) => [
      name,
      { fill: { ...design[name].fill }, artwork: cloneArtwork(design[name].artwork) }
    ])
  ) as Pick<CharacterCardDesign, (typeof CHARACTER_BAND_NAMES)[number]>;

  return {
    ...design,
    ...bands,
    replacement: cloneArtwork(design.replacement)
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
    // Only a hero prints this list — see `createCharacterAbility`. A villain
    // or minion has no character card to show it on, so there is nothing to
    // pre-fill for them.
    abilities: role === 'hero' ? [createCharacterAbility()] : [],
    artwork: createArtwork(),
    cardback: createCardback(role),
    sidekick: createHeroSidekick(),
    quote: createHeroQuote(),
    additionalCards: [],
    printedName: '',
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
    characterCard: cloneCharacterCard(character.characterCard),
    additionalCards: character.additionalCards.map((card) => ({
      ...card,
      id: createId<HeroCharacterCardId>('hchar'),
      abilities: card.abilities.map((ability) => ({ ...ability })),
      quote: { ...card.quote },
      characterCard: cloneCharacterCard(card.characterCard)
    })),
    style: { ...character.style },
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

/** Display name that never renders as an empty string in the UI. */
export function characterLabel(character: Character): string {
  const resolved = resolvedHeroName(character);
  return resolved.length > 0 ? resolved : `Untitled ${character.role}`;
}

/**
 * The whole hero's resolved identity — `name` when an author has typed one,
 * else the same join the "Name" field's placeholder already suggests, once
 * there is more than one card to join. Never falls back to "Untitled" itself
 * — callers each supply their own placeholder for the truly-blank case, so a
 * hero with two named cards and a blank group name still reads as their
 * joined names everywhere rather than "Untitled hero."
 */
export function resolvedHeroName(character: Character): string {
  if (character.name.trim().length > 0) return character.name.trim();
  return character.additionalCards.length > 0 ? suggestedGroupName(character) : '';
}

/**
 * The primary identity's own name — what its own character-card sheet
 * prints, what the action-card ribbon and "who may play this card" show for
 * it. A solo hero's `name` already does this job on its own; once there is a
 * second card, `name` is needed for the whole hero's own identity instead
 * (see `characterLabel`), so `printedName` takes over specifically this one.
 */
export function primaryCardName(character: Character): string {
  return character.additionalCards.length === 0 ? character.name : character.printedName;
}

/**
 * What the Identity "Name" field's placeholder suggests once there is a
 * second card and `name` is sitting blank, waiting for a group name — every
 * identity's own name joined with " & ", skipping any not yet typed in.
 */
export function suggestedGroupName(character: Character): string {
  const names = [character.printedName, ...character.additionalCards.map((card) => card.name)]
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return names.join(' & ');
}
