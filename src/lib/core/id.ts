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

/**
 * Mint a new prefixed ID. The prefix keeps raw JSON readable during debugging;
 * uniqueness comes from the UUID.
 */
export function createId<TId extends Id<string>>(prefix: string): TId {
  return `${prefix}_${crypto.randomUUID()}` as TId;
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
