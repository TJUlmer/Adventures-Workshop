/**
 * Offering changes back to the set you copied from, and taking them in.
 *
 * Rung 2. A fork already knows what it started from — `set.origin` carries the
 * revision and a hash per entity, recorded when the copy was taken — so this
 * module is the two halves either side of that:
 *
 *   `buildChangeSet`   what my copy altered, ready to send
 *   `applyEntries`     fold accepted entries into the owner's document
 *
 * The unit throughout is **one entity**: a card, a deck, a character, a figure,
 * or one of the parts of a set that has no id of its own. Never a field within
 * one. That is what makes the whole thing tractable — an owner can look at a
 * card and say yes or no, and there is never a question of merging two people's
 * wording of the same sentence. A card whose name *and* ability both changed is
 * one offer, not two.
 *
 * ## How a conflict is found without any history
 *
 * Each entry carries the **base hash** of its entity: what it hashed to when
 * the copy was taken. The owner does not need the base document to use it —
 * they hash their own current entity and compare:
 *
 *   base hash === theirs   they have not touched it, so this applies cleanly
 *   base hash !== theirs   both of us changed it, and only they can judge that
 *
 * That check runs at *review* time rather than at submission, so an original
 * that moved on while a contribution sat waiting is judged as it actually is
 * rather than as it was when the offer was made.
 */
import { cardLabel } from '$lib/cards/factory';
import type { Card } from '$lib/cards/types';
import { characterLabel } from '$lib/characters/factory';
import type { Character } from '$lib/characters/types';
import { deckLabel } from '$lib/decks/factory';
import type { Deck } from '$lib/decks/types';
import { figureLabel } from '$lib/figures/types';
import type { Figure } from '$lib/figures/types';
import { hashEntity, SET_KEYS } from './fingerprint';
import type { AdventureSet } from './types';

/** Which collection an entry belongs to, so applying it knows where to look. */
export type EntityKind = 'card' | 'deck' | 'character' | 'figure' | 'set';

export type ChangeKind = 'added' | 'changed' | 'removed';

export interface ChangeEntry {
  /** The entity's own id, or one of `SET_KEYS` for the un-addressed parts. */
  key: string;
  kind: EntityKind;
  change: ChangeKind;
  /** A short name for a review list, worked out when the entry is built. */
  label: string;
  /**
   * The proposed value. Absent for a removal, which proposes nothing.
   *
   * Typed as `unknown` on purpose: it crosses the network as JSON and comes
   * back from a stranger's browser, so it is not a `Card` until something has
   * checked. `applyEntries` runs the whole document through `normalizeSet`
   * afterwards for exactly that reason.
   */
  value?: unknown;
  /** What this entity hashed to when the copy was taken. */
  baseHash: string | null;
}

/** An entry judged against the document it would be applied to. */
export interface ReviewedEntry extends ChangeEntry {
  /**
   * The owner changed this too, since the copy was taken. Not a blocker — the
   * owner may still take it — but it is the one thing they must be told.
   */
  conflict: boolean;
  /** What the owner currently has, for a side-by-side. Absent if they have none. */
  current?: unknown;
}

// -- Reading a set by entity key ----------------------------------------

/**
 * Where a key lives, or `null` for a key this build does not know.
 *
 * The prefixes are the ones the factories mint — `char` and `fig`, not
 * `character` and `figure`. Guessing them from the type names produced a
 * `kindOf` that silently returned `null` for every character and figure, so
 * their changes were dropped from an offer without a word. Read them off
 * `characters/factory.ts` and `figures/types.ts` rather than from memory.
 */
const PREFIXES: readonly [string, EntityKind][] = [
  ['card_', 'card'],
  ['deck_', 'deck'],
  ['char_', 'character'],
  ['fig_', 'figure']
];

export function kindOf(key: string): EntityKind | null {
  const singleton = Object.values(SET_KEYS) as string[];
  if (singleton.includes(key)) return 'set';
  return PREFIXES.find(([prefix]) => key.startsWith(prefix))?.[1] ?? null;
}

/** The value a key names, or `undefined` if the set does not have it. */
export function readEntity(set: AdventureSet, key: string): unknown {
  switch (key) {
    case SET_KEYS.identity:
      return { name: set.name, subtitle: set.subtitle, singleHero: set.singleHero };
    case SET_KEYS.style:
      return set.style;
    case SET_KEYS.threat:
      return set.threat;
    case SET_KEYS.map:
      return set.map;
    case SET_KEYS.boxArt:
      return set.boxArt;
    case SET_KEYS.initiativeBack:
      return { artwork: set.initiativeBack, used: set.useInitiativeBack };
    default:
      break;
  }

  return (
    set.cards.find((card) => card.id === key) ??
    set.decks.find((deck) => deck.id === key) ??
    set.characters.find((character) => character.id === key) ??
    set.figures.find((figure) => figure.id === key)
  );
}

/**
 * What the rest of the app calls this thing.
 *
 * Through the same label helpers every other screen uses, rather than reading
 * `.name` — which was the first attempt and was wrong for most of the
 * document. An action card is often named by its `title` and a rules or event
 * card by its `heading`, so a perfectly well-named card came through the review
 * list as "Untitled card"; a health dial takes its name from the character it
 * belongs to and had none of its own. Anything that names an entity for a
 * person belongs in one place, and that place already existed.
 */
function displayName(set: AdventureSet, key: string, value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;

  switch (kindOf(key)) {
    case 'card':
      return cardLabel(value as Card);
    case 'character':
      return characterLabel(value as Character);
    case 'deck':
      return deckLabel(value as Deck);
    case 'figure': {
      const figure = value as Figure;
      const owner = set.characters.find((entry) => entry.id === figure.characterId);
      return figureLabel(figure, owner ? characterLabel(owner) : null);
    }
    default:
      return null;
  }
}

/** Something to call an entity in a list, without opening it. */
function labelFor(set: AdventureSet, key: string, value: unknown): string {
  switch (key) {
    case SET_KEYS.identity:
      return 'Set name and subtitle';
    case SET_KEYS.style:
      return 'Set-wide styling';
    case SET_KEYS.threat:
      return 'Threat track';
    case SET_KEYS.map:
      return 'Adventure map';
    case SET_KEYS.boxArt:
      return 'Box art';
    case SET_KEYS.initiativeBack:
      return 'Initiative deck back';
    default:
      break;
  }

  const shown = displayName(set, key, value) ?? displayName(set, key, readEntity(set, key));
  if (shown) return shown;

  /*
   * A removal has nothing left to read a name from — that is what removing it
   * means — so this says so rather than calling it untitled. "Untitled card" is
   * a claim about the card, and it was wrong every time: a deleted card
   * usually had a perfectly good name. `reviewEntries` puts the real one back
   * for the owner, who still has it.
   */
  const kind = kindOf(key);
  if (!kind) return 'Unknown item';
  return value === undefined ? `A deleted ${kind}` : `Untitled ${kind}`;
}

// -- Building an offer ---------------------------------------------------

/**
 * Everything this copy altered since it was taken.
 *
 * Entries are ordered by kind so a review list reads in the order a set is
 * assembled rather than in whatever order the ids happened to hash into.
 * Nothing is filtered out here — an offer with fifty entries is a real offer,
 * and it is the review screen's job to make that readable, not this one's.
 */
export function buildChangeSet(set: AdventureSet): ChangeEntry[] {
  const base = set.origin?.fingerprint;
  if (!base) return [];

  const entries: ChangeEntry[] = [];
  const seen = new Set<string>();

  for (const [key, baseHash] of Object.entries(base)) {
    seen.add(key);
    const kind = kindOf(key);
    if (!kind) continue;

    const value = readEntity(set, key);
    if (value === undefined) {
      entries.push({ key, kind, change: 'removed', label: labelFor(set, key, undefined), baseHash });
      continue;
    }
    if (hashEntity(value) !== baseHash) {
      entries.push({ key, kind, change: 'changed', label: labelFor(set, key, value), value, baseHash });
    }
  }

  // Anything the copy grew that the base never had.
  const additions: [string, unknown][] = [
    ...set.characters.map((entry): [string, unknown] => [entry.id, entry]),
    ...set.decks.map((entry): [string, unknown] => [entry.id, entry]),
    ...set.cards.map((entry): [string, unknown] => [entry.id, entry]),
    ...set.figures.map((entry): [string, unknown] => [entry.id, entry])
  ];

  for (const [key, value] of additions) {
    if (seen.has(key)) continue;
    const kind = kindOf(key);
    if (!kind) continue;
    entries.push({ key, kind, change: 'added', label: labelFor(set, key, value), value, baseHash: null });
  }

  const order: EntityKind[] = ['set', 'character', 'deck', 'card', 'figure'];
  return entries.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

/** Whether this copy has anything to offer back. */
export function hasChangesToOffer(set: AdventureSet): boolean {
  return buildChangeSet(set).length > 0;
}

// -- Reviewing an offer --------------------------------------------------

/**
 * Judge each entry against the document it would land in.
 *
 * The `baseHash` in the entry is what the contributor started from; hashing the
 * owner's own entity says whether the owner has moved since. Entries whose base
 * hash is missing — an addition — cannot conflict: there was nothing there to
 * disagree about.
 */
export function reviewEntries(
  target: AdventureSet,
  entries: readonly ChangeEntry[]
): ReviewedEntry[] {
  return entries.map((entry) => {
    const current = readEntity(target, entry.key);
    const conflict =
      entry.baseHash !== null && current !== undefined && hashEntity(current) !== entry.baseHash;

    /*
     * Name a removal from the owner's own copy.
     *
     * The contributor could not: they deleted the thing, so their document has
     * nothing left to read a name off and the entry arrives labelled "A deleted
     * card". The owner still has it, and "Melting" is what they need to see to
     * judge whether losing it is a good idea.
     */
    const held = entry.change === 'removed' ? displayName(target, entry.key, current) : null;
    const label = held ?? entry.label;

    return { ...entry, label, conflict, ...(current === undefined ? {} : { current }) };
  });
}

// -- Taking an offer in --------------------------------------------------

function replaceById<T extends { id: string }>(list: T[], value: T): T[] {
  const index = list.findIndex((entry) => entry.id === value.id);
  if (index === -1) return [...list, value];
  return list.map((entry, at) => (at === index ? value : entry));
}

/**
 * Fold accepted entries into a set, and answer with a new one.
 *
 * Pure: the caller decides what to do with the result, which keeps this usable
 * from a preview as well as from the accept button. The document it returns is
 * **not** normalised — `applyContribution` in the store does that, because
 * every value here arrived as JSON from somebody else's browser and the
 * repair pass is the boundary where that stops being true.
 */
export function applyEntries(set: AdventureSet, entries: readonly ChangeEntry[]): AdventureSet {
  let next: AdventureSet = { ...set };

  for (const entry of entries) {
    if (entry.change === 'removed') {
      switch (entry.kind) {
        case 'card':
          next = { ...next, cards: next.cards.filter((card) => card.id !== entry.key) };
          break;
        case 'deck':
          /*
           * A deck goes with the cards in it. Leaving them would orphan every
           * one — `deckId` would point at nothing, they would vanish from every
           * grouping the UI derives, and the author would have no way to reach
           * them to find out why their card count dropped.
           */
          next = {
            ...next,
            decks: next.decks.filter((deck) => deck.id !== entry.key),
            cards: next.cards.filter((card) => card.deckId !== entry.key)
          };
          break;
        case 'character':
          next = {
            ...next,
            characters: next.characters.filter((character) => character.id !== entry.key)
          };
          break;
        case 'figure':
          next = { ...next, figures: next.figures.filter((figure) => figure.id !== entry.key) };
          break;
        case 'set':
          // There is no such thing as removing the threat track or the box art;
          // an offer to clear one arrives as a change to an empty value.
          break;
      }
      continue;
    }

    const value = entry.value;
    if (value === null || typeof value !== 'object') continue;

    switch (entry.kind) {
      case 'card':
        next = { ...next, cards: replaceById(next.cards, value as Card) };
        break;
      case 'deck':
        next = { ...next, decks: replaceById(next.decks, value as Deck) };
        break;
      case 'character':
        next = { ...next, characters: replaceById(next.characters, value as Character) };
        break;
      case 'figure':
        next = { ...next, figures: replaceById(next.figures, value as Figure) };
        break;
      case 'set':
        next = applySetPart(next, entry.key, value as Record<string, unknown>);
        break;
    }
  }

  return next;
}

function applySetPart(
  set: AdventureSet,
  key: string,
  value: Record<string, unknown>
): AdventureSet {
  switch (key) {
    case SET_KEYS.identity:
      return {
        ...set,
        name: typeof value['name'] === 'string' ? value['name'] : set.name,
        subtitle: typeof value['subtitle'] === 'string' ? value['subtitle'] : set.subtitle,
        singleHero:
          typeof value['singleHero'] === 'boolean' ? value['singleHero'] : set.singleHero
      };
    case SET_KEYS.style:
      return { ...set, style: value as AdventureSet['style'] };
    case SET_KEYS.threat:
      return { ...set, threat: value as unknown as AdventureSet['threat'] };
    case SET_KEYS.map:
      return { ...set, map: value as unknown as AdventureSet['map'] };
    case SET_KEYS.boxArt:
      return { ...set, boxArt: value as unknown as AdventureSet['boxArt'] };
    case SET_KEYS.initiativeBack:
      return {
        ...set,
        initiativeBack: value['artwork'] as AdventureSet['initiativeBack'],
        useInitiativeBack: value['used'] === true
      };
    default:
      return set;
  }
}
