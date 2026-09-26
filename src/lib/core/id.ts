/**
 * Branded identifier primitives.
 *
 * A `CardId` and a `CharacterId` are both strings at runtime, but the compiler
 * refuses to swap them. That single constraint prevents most of the ID mix-ups
 * a normalised document model would otherwise invite.
 */

declare const BRAND: unique symbol;

export type Branded<TValue, TBrand extends string> = TValue & {
  readonly [BRAND]: TBrand;
};

/** An opaque string ID, tagged with the entity it points at. */
export type Id<TBrand extends string> = Branded<string, TBrand>;

/** ISO-8601 timestamp, e.g. `2026-07-29T12:00:00.000Z`. */
export type IsoDateTime = Branded<string, 'IsoDateTime'>;

function createUuid(): string {
  const source = globalThis.crypto;
  if (typeof source?.randomUUID === 'function') return source.randomUUID();

  /* `randomUUID` is hidden by some browsers on a plain-HTTP LAN origin even
     though `getRandomValues` remains available there. Phone preview sessions
     still need real random ids rather than a timestamp or Math.random fallback. */
  if (!source || typeof source.getRandomValues !== 'function') {
    throw new Error('This browser cannot generate secure random identifiers.');
  }

  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

/**
 * Mint a new prefixed ID. The prefix keeps raw JSON readable during debugging;
 * uniqueness comes from the UUID.
 */
export function createId<TId extends Id<string>>(prefix: string): TId {
  return `${prefix}_${createUuid()}` as TId;
}

export function now(): IsoDateTime {
  return new Date().toISOString() as IsoDateTime;
}

/**
 * Re-tag a plain string as a branded ID. Only for deserialisation boundaries
 * (file import, localStorage) where the value has already been validated.
 */
export function asId<TId extends Id<string>>(raw: string): TId {
  return raw as TId;
}

export function asIsoDateTime(raw: string): IsoDateTime {
  return raw as IsoDateTime;
}
