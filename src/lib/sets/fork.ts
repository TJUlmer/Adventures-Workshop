/**
 * Taking a copy of somebody else's published set.
 *
 * The one rule, and everything else follows from it:
 *
 *   **A fork keeps every id inside the document. Only the set's own id changes.**
 *
 * Card ids, deck ids, character ids and figure ids are all preserved. That is
 * what makes it possible, later, for a change to be offered back as "card
 * `card_9f3e…` changed and nothing else did" rather than as "here is a whole
 * new set". Re-minting them would throw that away silently and irreversibly —
 * the copy would work perfectly and simply never be able to say what it
 * altered.
 *
 * There is no collision to worry about. Cards are only ever looked up within
 * their own set, and the library is keyed by set id, so two sets in one library
 * holding the same card ids is not merely tolerable — it is the mechanism.
 *
 * The set's own id *must* change, and for a reason that has bitten before: the
 * library is keyed by it, so adopting a set under its published id would
 * overwrite any set of that id already there. The person most likely to hit
 * that is the original author opening their own share link, which is exactly
 * the person who would least expect their working copy to be replaced.
 */
import { createId, now } from '$lib/core/id';
import type { PublishedSet } from '$lib/cloud/sets';
import { fingerprintSet } from './fingerprint';
import { normalizeSet } from './normalize';
import type { AdventureSet, SetId, SetOrigin } from './types';
import { SET_SCHEMA_VERSION } from './types';

/** What a fork needs to know about where it came from. */
export interface ForkSource {
  slug: string;
  /** The published row's id, which a contribution will be addressed to. */
  id: string;
  revision: number;
  /** The author's display name, for the credit line. May be empty. */
  authorName: string;
}

/** Read a fork source off a gallery row and its embedded author. */
export function sourceOf(row: PublishedSet, authorName: string): ForkSource {
  return { slug: row.slug, id: row.id, revision: row.revision, authorName };
}

/**
 * Copy a published set into something the author can work on.
 *
 * The fingerprint is taken from the document *as it arrived*, before the new
 * id and the origin are attached, so it describes the original rather than the
 * copy. Neither of those fields is fingerprinted anyway — `set:identity`
 * covers the name and subtitle only — but taking it first means the hash of a
 * fork's card equals the hash of the original's card, which is the property the
 * whole comparison rests on.
 */
export function forkSet(published: AdventureSet, source: ForkSource): AdventureSet {
  /*
   * `published` must be a plain document, not reactive state — callers hand in
   * `$state.snapshot(…)`. A rune cannot be read from a `.ts` module, and
   * `structuredClone` on a `$state` proxy throws, so this is a requirement of
   * the caller rather than something that can be enforced here.
   *
   * Normalised again on the way through: the original may have been published
   * by an older build, and a fork is written by this one. Repairing here rather
   * than on next load means the fingerprint is taken over the same shape the
   * fork will be saved in.
   */
  const document = normalizeSet(structuredClone(published));

  const origin: SetOrigin = {
    slug: source.slug,
    setId: source.id,
    revision: source.revision,
    authorName: source.authorName,
    copiedAt: now(),
    fingerprint: fingerprintSet(document)
  };

  return {
    ...document,
    id: createId<SetId>('set'),
    // A new document written by this build, whatever the original was saved as.
    schemaVersion: SET_SCHEMA_VERSION,
    meta: { ...document.meta, updatedAt: now() },
    /*
     * Lineage is replaced, not chained.
     *
     * A copy of a copy records its *immediate* parent, because that is the set
     * it will offer changes back to and the revision those changes are measured
     * against. The chain is still reconstructible — each published fork carries
     * `forked_from` on its row — so nothing is lost by keeping the document's
     * own record to one hop.
     */
    origin
  };
}

/**
 * A short credit line for a forked set, or `null` for one authored here.
 *
 * The author's name is whatever it was when the copy was taken. Names change
 * and this one is not re-fetched: it is a record of who to credit at the
 * moment of copying, not a live lookup, and a credit that silently rewrote
 * itself would be worse than one that is a little out of date.
 */
export function originLabel(set: AdventureSet): string | null {
  if (!set.origin) return null;
  const who = set.origin.authorName.trim();
  return who ? `Based on a set by ${who}` : 'Based on a published set';
}
