/** Whole-document conflict helpers. No implicit merge is attempted. */
import { createId, now } from '$lib/core/id';
import type { AdventureSet, SetId } from '$lib/sets/types';

/**
 * Preserve the device version under a new draft identity.
 *
 * Entity ids deliberately survive so fork lineage and references inside the
 * complete document remain valid; only the library identity changes.
 */
export function createConflictCopy(
  source: AdventureSet,
  id: SetId = createId<SetId>('set')
): AdventureSet {
  const copy: AdventureSet = {
    ...structuredClone(source),
    id,
    name: `${source.name || 'Untitled Adventure'} (conflict copy)`
  };
  copy.meta.updatedAt = now();
  return copy;
}
