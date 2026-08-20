-- ---------------------------------------------------------------------------
-- Scoped publishing: one hero, or the villain side, published on their own
-- ---------------------------------------------------------------------------
--
-- Everything so far has published a whole set as one row. This lets an author
-- publish a *slice* of it instead — one hero and everything it owns, or "the
-- villain side" (the villain, every minion, the threat track, the map, every
-- set-level deck) — as its own independently listed, searchable, shareable
-- row, while it stays legibly part of the same local document rather than
-- becoming an unrelated fork.
--
-- The slice is not a fork. A fork gets its own `local_id` and its own
-- `SetOrigin`, because it is expected to diverge and be offered back. A scoped
-- publish keeps the *same* `local_id` as the set it was sliced from — it is
-- always "this hero, as of the last time its author republished it" — which is
-- exactly what makes several rows coexist under one `local_id` a schema
-- question rather than an application one: the uniqueness this table has had
-- since `0001_sets.sql` assumed one row per `(owner_id, local_id)`, and that
-- stops being true the moment a hero and the set it belongs to can both be
-- published at once.

alter table public.sets
  add column if not exists scope text not null default 'full'
    check (scope in ('full', 'hero', 'villain')),
  /*
   * Empty string, not null, for `full`/`villain` rows — deliberately, because
   * a unique constraint treats every `null` as distinct from every other
   * `null`. A nullable `character_id` would silently admit any number of
   * `('full', null)` or `('villain', null)` rows for the same set; every
   * non-hero scope has to agree on one concrete value to actually be unique.
   */
  add column if not exists character_id text not null default '';

-- The uniqueness this table has always had, widened rather than dropped: one
-- row per set as a whole is still true, it is now one row per set *and scope*.
alter table public.sets
  drop constraint if exists sets_owner_id_local_id_key;

alter table public.sets
  add constraint sets_owner_id_local_id_scope_key
    unique (owner_id, local_id, scope, character_id);

-- No RLS policy changes. `sets_owner_all`, `sets_public_read`, the admin
-- policies and the two restrictive anon policies all key on `owner_id`,
-- `visibility` and `hidden` — scope is orthogonal to every one of them, the
-- same way `forked_from` needed none when it was added in `0003_forks.sql`.
--
-- `set_by_slug`/`set_summary_by_slug` need no change of shape either: `slug`
-- stays the one unique lookup token a share link carries, regardless of which
-- scope the row it names happens to be. Only the *columns the app selects*
-- (`SUMMARY_COLUMNS`/`GALLERY_COLUMNS` in `cloud/sets.ts`) need `scope` and
-- `character_id` added, so the client can tell the three kinds of row apart.
