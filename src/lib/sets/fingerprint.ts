/**
 * A content hash per addressable thing in a set.
 *
 * This exists for one purpose: so that a copy of someone's set can later work
 * out *which parts it changed*, without keeping a second copy of the document
 * to compare against.
 *
 * ## Why a hash rather than the document
 *
 * Offering a change back needs a three-way comparison — the **base** a copy
 * started from, **theirs** as it stands now, and **mine**. Two-way is not
 * enough: without the base, "I edited this card" and "the owner edited this
 * card" are indistinguishable, and a merge built on that will quietly propose
 * undoing the owner's own work.
 *
 * The base is not recoverable later. Publishing overwrites — there is no
 * revision history, by choice — so the document behind revision 2 stops
 * existing the moment revision 3 is published. The only moment it can be
 * captured is when the copy is taken.
 *
 * Keeping the whole base document would double every copied set's footprint
 * in storage — no longer the acute problem it was under `localStorage`'s 5MB
 * ceiling now that the library lives in IndexedDB, but still real weight for
 * no reason: the question being asked of the base is never "what did it
 * say?", it is only "was this the same before?". A hash answers that
 * exactly, at about 4 KB for a whole set against several megabytes for the
 * document.
 *
 * With one hash per entity, every case falls out:
 *
 *   mine differs, theirs does not   a clean proposal
 *   theirs differs, mine does not   the owner moved on — leave it alone
 *   both differ                     a conflict, for the owner to judge
 *   absent from the base            I added it
 *   absent from mine                I deleted it
 *
 * ## Why the stringify has to be canonical
 *
 * `JSON.stringify` preserves insertion order, and an edit that sets a field
 * which was previously absent appends it — so a card can round-trip through
 * the editor unchanged in *content* and come out with a different key order.
 * Hashing that directly would report every such card as edited, which is the
 * one thing this must not do. Keys are therefore sorted at every level.
 *
 * Arrays are *not* sorted: order is meaningful everywhere it appears here —
 * ability blocks, threat steps, map paths — so a reordered list is a real
 * change and should read as one.
 */
import type { AdventureSet } from './types';

/**
 * JSON with every object's keys in sorted order.
 *
 * Written out rather than using a `replacer`, because a replacer is handed
 * each value *after* the parent has already fixed its key order.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';

  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    // `undefined` is absent rather than present-and-empty, and `JSON.stringify`
    // drops it — so it has to be dropped here too or the two disagree.
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
}

/**
 * FNV-1a, 64-bit, as sixteen hex characters.
 *
 * Hand-rolled for the same reason everything else here is: it is a few dozen
 * lines and `package.json` has no runtime dependencies to spend. `SubtleCrypto`
 * would be the stronger hash and cannot be used — it is async, and this runs
 * over a whole document inside an ordinary synchronous call.
 *
 * Strength is not the requirement, and it is worth being clear why: nothing is
 * defended by this. The whole comparison happens in the browser of the person
 * proposing the change, so anyone wanting to claim a card was untouched can
 * simply claim it. All this has to do is make an *accidental* collision
 * implausible across the few dozen entities in a set, which 64 bits does with
 * an enormous margin.
 *
 * Held as four 16-bit limbs. JavaScript's bitwise operators are 32-bit, so a
 * 64-bit multiply has to be carried by hand — and `BigInt`, the obvious way
 * out, is roughly an order of magnitude slower over the megabytes of embedded
 * artwork one card can carry. With 16-bit limbs every partial product stays
 * under 2^26 and no intermediate can lose precision.
 *
 * The prime is 2^40 + 2^8 + 0xb3, so two of its four limbs are zero and half
 * the partial products disappear.
 */
const PRIME_LOW = 0x01b3; // limb 0 of the FNV prime
const PRIME_HIGH = 0x0100; // limb 2; limbs 1 and 3 are zero

function fnv1a(bytes: Uint8Array): string {
  // The 64-bit offset basis, 0xcbf29ce484222325, least significant limb first.
  let w0 = 0x2325;
  let w1 = 0x8422;
  let w2 = 0x9ce4;
  let w3 = 0xcbf2;

  for (let index = 0; index < bytes.length; index += 1) {
    w0 ^= bytes[index] as number;

    let t0 = w0 * PRIME_LOW;
    let t1 = w1 * PRIME_LOW;
    let t2 = w2 * PRIME_LOW + w0 * PRIME_HIGH;
    let t3 = w3 * PRIME_LOW + w1 * PRIME_HIGH;

    t1 += t0 >>> 16;
    t0 &= 0xffff;
    t2 += t1 >>> 16;
    t1 &= 0xffff;
    t3 += t2 >>> 16;
    t2 &= 0xffff;
    // Anything above bit 63 is discarded, which is the modulo the algorithm
    // specifies rather than an overflow being ignored.
    t3 &= 0xffff;

    w0 = t0;
    w1 = t1;
    w2 = t2;
    w3 = t3;
  }

  return (
    w3.toString(16).padStart(4, '0') +
    w2.toString(16).padStart(4, '0') +
    w1.toString(16).padStart(4, '0') +
    w0.toString(16).padStart(4, '0')
  );
}

/*
 * UTF-8 bytes, because FNV is defined over bytes and `charCodeAt` would hand
 * it UTF-16 code units. It matters less than it looks — any consistent
 * encoding would compare correctly — but a hash that matches the published
 * test vectors can be checked against them, and one that does not cannot.
 */
const encoder = new TextEncoder();

/** The hash of any one thing, on its own. */
export function hashEntity(value: unknown): string {
  return fnv1a(encoder.encode(canonical(value)));
}

/** Exposed so the hash can be checked against FNV's published test vectors. */
export function hashText(text: string): string {
  return fnv1a(encoder.encode(text));
}

/*
 * Keys for the parts of a set that have no id of their own.
 *
 * Prefixed so they can never collide with an entity id, which always carries
 * its own prefix (`card_`, `deck_`, …). A contribution treats each of these as
 * one indivisible unit — the threat track is offered back whole or not at all,
 * because a track with one step from each of two authors is not a track either
 * of them designed.
 */
export const SET_KEYS = {
  identity: 'set:identity',
  style: 'set:style',
  threat: 'set:threat',
  map: 'set:map',
  boxArt: 'set:boxArt',
  initiativeBack: 'set:initiativeBack'
} as const;

/**
 * Every addressable part of a set, hashed.
 *
 * `meta` is deliberately excluded from `set:identity`: it carries `updatedAt`,
 * which moves on every autosave, so including it would mark the set as changed
 * every few seconds and make the whole comparison meaningless. `version` and
 * `description` are the author's own notes about their own copy and are not
 * something to offer back either.
 */
export function fingerprintSet(set: AdventureSet): Record<string, string> {
  const marks: Record<string, string> = {
    [SET_KEYS.identity]: hashEntity({ name: set.name, subtitle: set.subtitle }),
    [SET_KEYS.style]: hashEntity(set.style),
    [SET_KEYS.threat]: hashEntity(set.threat),
    [SET_KEYS.map]: hashEntity(set.map),
    [SET_KEYS.boxArt]: hashEntity(set.boxArt),
    [SET_KEYS.initiativeBack]: hashEntity({
      artwork: set.initiativeBack,
      used: set.useInitiativeBack
    })
  };

  for (const character of set.characters) marks[character.id] = hashEntity(character);
  for (const deck of set.decks) marks[deck.id] = hashEntity(deck);
  for (const card of set.cards) marks[card.id] = hashEntity(card);
  for (const figure of set.figures) marks[figure.id] = hashEntity(figure);
  for (const symbol of set.customSymbols) marks[symbol.id] = hashEntity(symbol);

  return marks;
}

/** What became of one entity between two fingerprints. */
export type EntityChange = 'added' | 'removed' | 'changed' | 'same';

/**
 * Compare a set against the fingerprint it was copied from.
 *
 * Rung 1 uses this only to say whether a copy has been touched at all. It is
 * written for the comparison that comes next, which runs the same function
 * twice — once for the copy and once for the original — and reads the two
 * results together.
 */
export function compareToFingerprint(
  set: AdventureSet,
  base: Readonly<Record<string, string>>
): Map<string, EntityChange> {
  const now = fingerprintSet(set);
  const out = new Map<string, EntityChange>();

  for (const [key, mark] of Object.entries(now)) {
    const before = base[key];
    if (before === undefined) out.set(key, 'added');
    else if (before !== mark) out.set(key, 'changed');
    else out.set(key, 'same');
  }

  for (const key of Object.keys(base)) {
    if (!(key in now)) out.set(key, 'removed');
  }

  return out;
}

/** Whether anything at all has moved since the copy was taken. */
export function hasDiverged(set: AdventureSet, base: Readonly<Record<string, string>>): boolean {
  for (const change of compareToFingerprint(set, base).values()) {
    if (change !== 'same') return true;
  }
  return false;
}
