-- ---------------------------------------------------------------------------
-- Lineage: a published set that was copied from another one
-- ---------------------------------------------------------------------------
--
-- Rung 1 of collaboration. A copy records where it came from, and the gallery
-- says so. Nothing here grants anyone anything — the copy is an ordinary set
-- owned by whoever made it, and every existing policy applies to it unchanged.
--
-- What this is really for is rung 2: offering a change back. That needs the
-- copy to know which row and which revision it started from, and the revision
-- is only obtainable at the moment of copying, because publishing overwrites.

alter table public.sets
  /*
   * `on delete set null`, emphatically not cascade.
   *
   * `sets.owner_id` already cascades from `profiles`, and that cascade has
   * destroyed a published set once during a tidy-up of test accounts. An
   * original being deleted must orphan its copies, never take them with it —
   * the copies are other people's work.
   */
  add column if not exists forked_from uuid references public.sets(id) on delete set null,

  -- The revision copied. Kept beside the reference rather than derived from it,
  -- because `sets.revision` is the *current* one and this has to stay the one
  -- the copy was taken at even after the original moves on.
  add column if not exists forked_from_revision integer;

-- Answering "what came from this set?" without scanning the table. Partial,
-- since the overwhelming majority of rows are not forks of anything.
create index if not exists sets_forked_from_idx
  on public.sets (forked_from)
  where forked_from is not null;

-- A trap for whoever writes the next query against this column. PostgREST
-- embeds it by the *column* name — `origin:forked_from(...)` — and NOT by the
-- table name. `sets!forked_from(...)` is a legal request that silently
-- resolves the relationship backwards, returning an array of the sets forked
-- *from* this one: an original ends up credited to its own copy, and a copy
-- shows nothing. See `GALLERY_COLUMNS` in `cloud/sets.ts`.

-- ---------------------------------------------------------------------------
-- set_summary_by_slug: the row without the document
-- ---------------------------------------------------------------------------
--
-- A copy needs to know whether its original has moved on — "you copied
-- revision 2; it is now at revision 5". That cannot go through `set_by_slug`,
-- which returns the whole document and would pull megabytes to compare one
-- integer, and it cannot go through a filtered select, because the table's read
-- policy exposes public sets only while plenty of originals are unlisted.
--
-- Same shape and same reasoning as `set_by_slug`, and the same answer to the
-- linter's 0028/0029 warnings: exact match on a unique column, `limit 1`, no
-- way to ask it for a list, and `private` excluded so revoking a link works.
-- It returns strictly less than `set_by_slug` already does.

create or replace function public.set_summary_by_slug(share_slug text)
returns table (
  id uuid,
  slug text,
  name text,
  subtitle text,
  revision integer,
  visibility text,
  updated_at timestamptz,
  published_at timestamptz,
  change_note text,
  hidden boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select s.id, s.slug, s.name, s.subtitle, s.revision, s.visibility,
         s.updated_at, s.published_at, s.change_note, s.hidden
  from public.sets s
  where s.slug = share_slug
    and s.visibility in ('unlisted', 'public')
  limit 1;
$$;

revoke all on function public.set_summary_by_slug(text) from public;
grant execute on function public.set_summary_by_slug(text) to anon, authenticated;

-- The two new columns are writable by their owner like every other column on
-- the row; `is_admin` remains the only one held back by grant. Nothing to add.
