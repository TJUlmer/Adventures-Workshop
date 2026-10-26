/**
 * Compact proof of the editable source behind each publishable slice.
 *
 * A publication is a snapshot, while the draft keeps moving. Home only needs
 * to know whether those two still agree; downloading every published document
 * (and its artwork) to answer that would defeat the summary-only library.
 * These hashes travel with the private draft instead.
 *
 * `updatedAt` and this bookkeeping are excluded. Neither changes what a
 * reader receives, and including the hashes in their own input would make
 * every refresh change itself forever.
 */
import { hashEntity } from './fingerprint';
import { computeScopedSet, parseScopeKey, scopeKeyOf, scopeOptionsFor } from './scope';
import type { PublishScope } from './scope';
import type { AdventureSet, PublicationSync } from './types';

function sourceForFingerprint(set: AdventureSet, scope: PublishScope): unknown {
  const { author, description, createdAt } = set.meta;
  const source = { ...set, meta: { author, description, createdAt } };
  if (scope.kind === 'hero') {
    /* `heroSlice` creates fresh disabled map/threat placeholders on every
       call. They are fixed output, not authored source, and a generated map
       id must not make an untouched hero look newly edited every autosave. */
    return {
      ...source,
      threat: null,
      maps: [],
      rulebooks: [],
      box: null,
      boxArt: null,
      initiativeBack: null,
      useInitiativeBack: false
    };
  }
  if (scope.kind === 'villain') {
    return { ...source, rulebooks: [], box: null, boxArt: null };
  }
  return source;
}

/** The current source fingerprint for one exact publication scope. */
export function publicationFingerprint(set: AdventureSet, scope: PublishScope): string {
  return hashEntity(sourceForFingerprint(computeScopedSet(set, scope), scope));
}

/** Every scope the current draft can publish, keyed exactly as the publish picker is. */
export function currentPublicationFingerprints(set: AdventureSet): Record<string, string> {
  return Object.fromEntries(
    scopeOptionsFor(set).map(({ value }) => {
      const scope = parseScopeKey(value);
      return [scopeKeyOf(scope), publicationFingerprint(set, scope)];
    })
  );
}

/** Apply derived fingerprints without mutating the live editor document. */
export function withCurrentPublicationFingerprints(
  set: AdventureSet,
  current: Readonly<Record<string, string>>
): AdventureSet {
  const publication: PublicationSync = set.meta.publication ?? { current: {}, published: {} };
  return {
    ...set,
    meta: {
      ...set.meta,
      publication: {
        current: { ...current },
        published: { ...publication.published }
      }
    }
  };
}

function sameFingerprints(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

/**
 * Refresh the derived half of the persisted publication state.
 *
 * This runs immediately before autosave serialises the document, so direct
 * field bindings are covered just as reliably as store commands. Assignment
 * happens only when content actually moved; that makes the second reactive
 * pass a no-op instead of an autosave loop.
 */
export function syncPublicationFingerprints(set: AdventureSet): void {
  const current = currentPublicationFingerprints(set);
  const publication: PublicationSync = set.meta.publication ?? { current: {}, published: {} };
  if (sameFingerprints(current, publication.current)) return;
  set.meta.publication = withCurrentPublicationFingerprints(set, current).meta.publication;
}

