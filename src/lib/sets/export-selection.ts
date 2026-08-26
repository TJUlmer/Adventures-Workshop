/**
 * A smaller document, pruned for one export and thrown away — not published,
 * not saved, not a fork.
 *
 * Different from `sets/scope.ts`'s `PublishScope` on purpose, rather than one
 * concept doing both jobs: a publish scope is coarse (a hero, the villain
 * side, the whole set) and its result is a document someone else's browser
 * will hold onto, possibly for years, addressed by a link. This is the
 * opposite kind of thing — an author trying "what does this look like without
 * the side deck" or "just the initiative pile, to check the TTS layout" one
 * export at a time. `ExportSelection` is never written to the document, never
 * sent anywhere, and resets the moment the picker that built it closes.
 *
 * Deck-level only, deliberately — no per-card checkboxes. A card excluded on
 * its own while its deck stays is already perfectly safe (the deck just
 * prints one card lighter), but it is not what this is *for*: the request
 * this exists to answer is "toggle off the special deck" or "toggle off
 * initiative", not "hide one card". Keeping the unit at the deck cuts the
 * whole feature down to one `Set<DeckId>` instead of a tree of tri-state
 * checkboxes that would need to show a deck as "some cards on" — simpler to
 * build, and simpler for an author scanning a long list to reason about.
 */
import type { DeckId } from '$lib/decks/types';
import type { FigureId } from '$lib/figures/types';
import { normalizeSet } from './normalize';
import type { AdventureSet } from './types';

export interface ExportSelection {
  excludedDeckIds: ReadonlySet<DeckId>;
  excludedFigureIds: ReadonlySet<FigureId>;
  /** Ignored when the set's own `threat.enabled` is already `false`. */
  includeThreat: boolean;
  /** Ignored when the set's own `map.enabled` is already `false`. */
  includeMap: boolean;
}

export function defaultExportSelection(): ExportSelection {
  return {
    excludedDeckIds: new Set(),
    excludedFigureIds: new Set(),
    includeThreat: true,
    includeMap: true
  };
}

/** Whether `selection` would actually change anything about `set`. */
export function isExportSelectionActive(selection: ExportSelection): boolean {
  return (
    selection.excludedDeckIds.size > 0 ||
    selection.excludedFigureIds.size > 0 ||
    !selection.includeThreat ||
    !selection.includeMap
  );
}

/**
 * Apply a selection, or hand `set` straight back where there is nothing to
 * prune — the identical short-circuit `computeScopedSet` takes for
 * `{ kind: 'full' }`, and for the same reason: every export already reads
 * whatever this returns unconditionally, so the common case (nothing
 * unchecked) has to be free rather than a no-op pass through `normalizeSet`.
 *
 * Decks are filtered first and cards are derived from the decks that
 * survive — never the other way around — because nothing downstream repairs
 * a card whose `deckId` points at a deck that is not there. `heroSlice`/
 * `villainSlice` in `sets/scope.ts` follow the same discipline for the same
 * reason: `card-pngs.ts` and `tabletop-simulator.ts` both build their output
 * by walking decks and looking cards up by `deckId`, so an orphaned card
 * would simply vanish from every export rather than error — survivable for
 * a PNG or a TTS bundle, but not for the set-file export, which serialises
 * whatever it is given with no validation on write. A document with a card
 * pointing at a deck that is not in it fails to re-import later with "File
 * contains a card that points at a missing deck" — so this cannot produce
 * one, ever, not even transiently.
 */
export function applyExportSelection(set: AdventureSet, selection: ExportSelection): AdventureSet {
  if (!isExportSelectionActive(selection)) return set;

  const decks = set.decks.filter((deck) => !selection.excludedDeckIds.has(deck.id));
  const keptDeckIds = new Set(decks.map((deck) => deck.id));
  const cards = set.cards.filter((card) => keptDeckIds.has(card.deckId));
  const figures = set.figures.filter((figure) => !selection.excludedFigureIds.has(figure.id));

  return normalizeSet({
    ...set,
    decks,
    cards,
    figures,
    threat: selection.includeThreat ? set.threat : { ...set.threat, enabled: false },
    map: selection.includeMap ? set.map : { ...set.map, enabled: false }
  });
}
