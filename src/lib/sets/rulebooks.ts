import type { Id } from '$lib/core/id';

export type RulebookId = Id<'Rulebook'>;

/** A finished PDF supplied by the author, carried with the set. */
export interface Rulebook {
  id: RulebookId;
  name: string;
  /** Embedded in a draft; a public Storage URL in a published snapshot. */
  source: string;
  size: number;
}

export function isRulebookSource(value: unknown): value is string {
  return typeof value === 'string' &&
    (/^data:application\/pdf;base64,/i.test(value) || /^https?:\/\//i.test(value));
}
