---
inclusion: auto
description: Rules for persisted document shape. Apply when adding or changing any field that is saved, or when touching src/lib/sets/normalize.ts, src/lib/storage/, src/lib/cloud/, import/export serialisation, or SET_SCHEMA_VERSION.
---

# Schema and persistence

`SET_SCHEMA_VERSION` (currently **29**) is checked on import; files from a newer
schema are **refused**, not guessed at. The same check applies when opening a
published set — `row.schema_version > SET_SCHEMA_VERSION` throws rather than
loading a document this build cannot fully understand.

There is no migration ladder. What exists instead is repair: `sets/normalize.ts`
fills absent fields from the factories' defaults and renames what has been renamed.

**Any new persisted field needs a branch in `normalize.ts`**, or existing documents
load without it.

**`normalizeSet` must be idempotent.** This is not a nicety — a factory that
stamps `now()` for a timestamp field, or mints a fresh id, will hand every load a
new value unless the branch explicitly reads the raw value back when it is
present. `figure()` did exactly this with `createdAt`/`updatedAt` once: every load
silently destroyed both, and once fork fingerprints existed it also meant a
freshly-taken fork reported every one of its components as edited, because
hashing the same document twice gave two different answers. Verify by normalising
a document three times and comparing `fingerprintSet` across the passes — they
must be identical, and a fresh fork must report nothing.

**Absent is meaningfully different from empty** in places — a threat step's
`fill: null` means "follow the board", not "no fill". Do not collapse the two.

A real migration ladder lands when a *shape* changes, not just a name.

## Storage: IndexedDB, not `localStorage`

The library — every set, indexed for the Home screen — lives in **IndexedDB**
(`src/lib/storage/indexeddb.ts`, a hand-rolled promise wrapper; `storage/library.ts`
builds the library on top of it). It moved off `localStorage` because that store is
roughly 5MB **per browser origin**, shared across every set in the library rather
than metered per set — a single unresized camera photo could fill it. IndexedDB's
ceiling is tied to available disk space instead.

Consequences worth knowing before touching this code:

- **Every library/persistence function is `async`.** There is no synchronous
  IndexedDB API to have kept any of it on. This propagates through
  `state/workshop.svelte.ts` (`createSet`, `openSet`, `closeSet`, `removeSet`,
  `duplicateSet`, `saveNow`) and their callers.
- **Migration from `localStorage` is automatic, idempotent and resumable.**
  `migrateLibraryFromLocalStorage` and `migrateLegacyDocument` run on every
  startup and are a no-op once there is nothing left of their own to move — no
  separate "have we migrated" flag to keep in sync with reality. The library
  migration copies before it deletes, and only deletes what it confirmed landed
  in IndexedDB.
- **`App.svelte` gates its first paint on session restore**, because that restore
  is now async. Rendering routes unconditionally in the meantime would flash the
  Home screen before jumping to whatever set (or shared-set deep link) was
  actually meant to open.
- **Deleting a set is a soft delete.** `deleteSet` stamps `LibraryEntry.deletedAt`;
  the document itself is untouched in `SETS_STORE`. `restoreSet` clears the flag;
  `purgeSet` is the old unconditional delete, reachable only from "Delete forever"
  in Recently Deleted. `saveSet` rebuilds its index row on every write (including
  autosave) and must carry `deletedAt` forward explicitly, or an autosave on a
  trashed set would silently restore it.
- Large images never reach the document at full size — `core/image-import.ts`
  downscales anything above `ARTWORK_MAX_DIMENSION` and re-encodes as WebP before
  it is embedded. This is orthogonal to the IndexedDB move and stays worth doing
  regardless of which store backs the library.
- **`exports/` is the one exception** to "everything lives in the browser": a
  dev-only Vite plugin (`export/exports-folder.ts`) writes/prunes files there
  because Tabletop Simulator needs a real URL, not a data URI. It is the only
  destructive filesystem operation in the app and is fenced accordingly (path
  containment checks, refuses an empty prune manifest, symlinks skipped).

## Cloud persistence: publish is a copy, not a save

`src/lib/cloud/` persists to Supabase, but **never as the source of truth** — see
`product.md` and `tech.md`. Rules that follow from that:

- **A public read must never carry a user's own access token.** `listPublicSets`,
  `fetchSetBySlug` and friends pass `anonymous: true` so the request always uses
  the project key. A stale user token would otherwise empty the gallery for its
  own signed-in owner while every anonymous visitor saw it fine.
- **RLS is the actual boundary, not the client.** `sets_public_read` exposes
  `visibility = 'public' and not hidden` only; an *unlisted* set is reachable
  solely through `set_by_slug`, a `security definer` function returning at most
  one row. Never write a query that could return "public or unlisted" in one
  shot — that is exactly the bug this schema avoids.
- **`revision` is written by a database trigger**, never sent by the client, and
  only moves when the document itself differs — a visibility flip or a takedown
  is not a new edition.
- **A fork keeps every id in the document; only the set's own id changes.** This
  is what lets a later contribution say "this card changed, nothing else did."
  Re-minting ids would work and would silently destroy that.
- **A fork's fingerprint (`SetOrigin.fingerprint`) is a content hash per entity,
  taken once at fork time** — not the entities themselves. There is no server-side
  revision history, so the fork is the only chance to ever have a "before" to
  compare against later. The hash is FNV-1a 64 over a canonical (key-sorted)
  stringify — key order must stay canonical, or a card that merely gains a
  previously-absent field reads as edited after a round trip.
- **`forked_from` is `on delete set null`, never cascade.** `owner_id` already
  cascades from `profiles`, and that cascade has destroyed a published set by
  accident once; an original being deleted must orphan its forks, not take them
  down too.
- **A contribution is a proposal and cannot be more than that.** Accepting one
  mutates the owner's own document in their own browser (`workshop.applyContribution`);
  the database row only ever records the decision. There is no path by which a
  stranger's row can mutate a published set directly — verify any new
  contribution-adjacent code against that invariant.

See `CLAUDE.md` ("Sharing and the gallery", "Contributions") and
`COLLABORATION.md` for the full reasoning and the specific RLS policies.
