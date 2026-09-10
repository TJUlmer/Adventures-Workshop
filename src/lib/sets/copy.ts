/**
 * Give an exported document a library-safe identity without pretending it is
 * a provenance-aware fork.
 *
 * Public set files are copies rather than backups. Keeping the publisher's set
 * id would let the original author overwrite their working draft merely by
 * importing a file downloaded from their own share page. Internal ids remain
 * intact because every relationship is scoped to this document; only the id
 * IndexedDB keys the whole set by must change.
 *
 * Existing lineage is cleared too. A portable file has no trustworthy record
 * of the publication it was downloaded from, so retaining an older `origin`
 * would let a copy of a published fork offer changes to that fork's ancestor.
 * The shared screen's explicit fork action is the provenance-aware route.
 */
import { createId, now } from '$lib/core/id';
import type { AdventureSet, SetId } from './types';
import { SET_SCHEMA_VERSION } from './types';

export function makeIndependentSetCopy(set: AdventureSet): AdventureSet {
  return {
    ...set,
    id: createId<SetId>('set'),
    schemaVersion: SET_SCHEMA_VERSION,
    meta: { ...set.meta, updatedAt: now() },
    origin: null
  };
}
