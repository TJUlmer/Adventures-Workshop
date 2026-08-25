/**
 * A smaller document, sliced out of a set for publishing.
 *
 * Not a fork. `sets/fork.ts` documents an *event* — a copy taken once, meant
 * to diverge, offered back through `SetOrigin`'s fingerprint. A scoped
 * document is the opposite relationship: it always mirrors whatever the
 * master currently is, republished by hand whenever its author wants the
 * public listing to catch up, never independently edited on its own. So it
 * carries no `SetOrigin` of its own and mints no new `id` — the whole point
 * is that it stays addressed by the *same* `local_id` as the set it came
 * from, which is what lets `cloud/sets.ts`'s `publishSet` write it as its own
 * row alongside the full-set publish rather than something unrelated. The
 * `(local_id, scope, character_id)` pointer back to the master lives purely
 * as columns on that row — see `supabase/migrations/0006_scoped_publishing.sql`
 * — not as anything embedded in the document itself, because unlike a fork's
 * origin, that pointer can never go stale: there is no point-in-time copy to
 * fall behind, only the master's current state or an earlier republish of it.
 *
 * Reads straight off whatever `AdventureSet` it is handed, reactive or not —
 * the same contract every function in `sets/queries.ts` already keeps, and
 * for the same reason: this only ever filters and rebuilds plain arrays, it
 * never needs `structuredClone`'s deep independence the way `forkSet` does
 * for a document that is about to be saved as its own thing in the library.
 * This one is transient — built, serialised and thrown away inside one call
 * to `publishSet`.
 */
import { characterLabel } from '$lib/characters/factory';
import type { CharacterId } from '$lib/characters/types';
import { createArtwork } from '$lib/core/artwork';
import { createAdventureMap } from '$lib/map/types';
import { createThreatTrack } from '$lib/threat/types';
import {
  cardsForCharacter,
  charactersByRole,
  decksForCharacter,
  figuresForCharacter,
  findCharacter
} from './queries';
import { normalizeSet } from './normalize';
import type { AdventureSet } from './types';

export type PublishScope =
  | { kind: 'full' }
  | { kind: 'hero'; characterId: CharacterId }
  | { kind: 'villain' };

/** A `PublishScope` as one string, for a `<select>` — the inverse of `parseScopeKey`. */
export function scopeKeyOf(scope: PublishScope): string {
  return scope.kind === 'hero' ? `hero:${scope.characterId}` : scope.kind;
}

/** The inverse of `scopeKeyOf`, for reading a `<select>`'s value back. */
export function parseScopeKey(key: string): PublishScope {
  if (key === 'full' || key === 'villain') return { kind: key };
  return { kind: 'hero', characterId: key.slice(5) as CharacterId };
}

/**
 * Every scope worth offering in a picker, as `<select>` options.
 *
 * The one list `ExportPanel` and `SharedSetScreen` both build a scope picker
 * from — kept here rather than duplicated in each, so "which scopes exist"
 * can only ever be answered one way. Villain-side content is one bundle and
 * never split further, so it is a single option regardless of how many
 * minions there are; only worth offering once there is something to slice —
 * a set with one hero and no villain has nothing a picker would do.
 */
export function scopeOptionsFor(set: AdventureSet): { value: string; label: string }[] {
  const heroes = charactersByRole(set, 'hero');
  const hasVillainSide =
    charactersByRole(set, 'villain').length > 0 || charactersByRole(set, 'minion').length > 0;

  return [
    { value: 'full', label: 'Whole set' },
    ...heroes.map((hero) => ({ value: `hero:${hero.id}`, label: characterLabel(hero) })),
    ...(hasVillainSide ? [{ value: 'villain', label: 'Villain side' }] : [])
  ];
}

/**
 * The scoped document `publishSet` should actually publish.
 *
 * `{ kind: 'full' }` still goes through `normalizeSet`, same as the other two
 * cases, so a caller can call this unconditionally rather than branching on
 * whether scoping is happening at all.
 */
export function computeScopedSet(set: AdventureSet, scope: PublishScope): AdventureSet {
  if (scope.kind === 'full') return normalizeSet(set);
  if (scope.kind === 'hero') return normalizeSet(heroSlice(set, scope.characterId));
  return normalizeSet(villainSlice(set));
}

/**
 * A hero and everything it owns — reusing the same ownership queries the rest
 * of the app already reads a character's content through.
 *
 * `threat`/`map` reset to their disabled defaults rather than carrying the
 * villain's board along: neither has an ownership field, and both are
 * meaningless for a hero to publish. `boxArt` is dropped for the same reason
 * it is dropped from the villain slice below — see `villainSlice`.
 *
 * `name`/`subtitle` are overridden too, and deliberately not left as the
 * master's — a gallery tile and a shared-set page both read these straight
 * off the published row, and "this hero, from {the box}" is what a slice's
 * own identity is. `set.name` moves into `subtitle` rather than being
 * dropped, so the box is still named on the tile even before a clickable
 * link back to its own listing exists (see `GalleryScreen.svelte`).
 */
function heroSlice(set: AdventureSet, characterId: CharacterId): AdventureSet {
  const character = findCharacter(set, characterId);

  return {
    ...set,
    /*
     * A hero on their own *is* a heroes set, whatever the box they came out
     * of — every villain-side thing is stripped below, so publishing this as
     * an adventure would describe it as missing a villain, minions, an
     * initiative deck and a threat track it was never meant to carry.
     */
    kind: 'heroes',
    name: character ? characterLabel(character) : set.name,
    subtitle: `From ${set.name || 'an Adventures set'}`,
    characters: character ? [character] : [],
    decks: decksForCharacter(set, characterId),
    cards: cardsForCharacter(set, characterId),
    figures: figuresForCharacter(set, characterId),
    threat: createThreatTrack(),
    map: createAdventureMap(),
    boxArt: createArtwork(),
    initiativeBack: createArtwork(),
    useInitiativeBack: false
  };
}

/**
 * Everything that is not a specific hero's own content.
 *
 * Deliberately a complement rather than a union of `outline()`'s categories —
 * built that way so a future deck kind or roster role that isn't a hero's
 * cannot be silently left out of it just because nobody remembered to add it
 * to an enumerated list in two places. At `MAX_VILLAINS = 1` there is nothing
 * left to disambiguate: the villain, every minion, the one threat track and
 * the one map all travel together, unambiguously, by construction.
 */
function villainSlice(set: AdventureSet): AdventureSet {
  const heroIds = new Set(charactersByRole(set, 'hero').map((character) => character.id));

  const characters = set.characters.filter((character) => !heroIds.has(character.id));
  const decks = set.decks.filter((deck) => deck.ownerId === null || !heroIds.has(deck.ownerId));
  const keptDeckIds = new Set(decks.map((deck) => deck.id));
  const cards = set.cards.filter((card) => keptDeckIds.has(card.deckId));
  const figures = set.figures.filter(
    (figure) => figure.characterId === null || !heroIds.has(figure.characterId)
  );

  /* Named for the villain, the same way a hero slice is named for its hero —
     see `heroSlice`. Picks the first if a legacy document still has two
     (`MAX_VILLAINS` was lowered to 1 going forward, not repaired on load);
     nothing here needs to disambiguate further, this is a display name only. */
  const villain = charactersByRole(set, 'villain')[0] ?? null;

  return {
    ...set,
    name: villain ? characterLabel(villain) : set.name,
    subtitle: `From ${set.name || 'an Adventures set'}`,
    characters,
    decks,
    cards,
    figures,
    /*
     * Box art is dropped from every scoped document, in both directions —
     * not just a content call. `cloud/thumbnail.ts`'s `coverArtwork()` tries
     * box art, then the villain, then a hero, then any character with
     * artwork, in that order. Dropping box art here is what makes a villain
     * slice's thumbnail fall straight through to the villain's own portrait
     * for free, with no scope-awareness needed in `thumbnail.ts` at all — see
     * the cross-reference left there.
     */
    boxArt: createArtwork()
  };
}
