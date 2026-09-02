-- Public discovery for collections.
--
-- The read policy `collections_public_read` already exposes exactly
-- `visibility = 'public' and not hidden` to every role, so nothing here
-- widens what may be read. What was missing is a way to *list* them, and a
-- stable thing to sort by.

-- `updated_at` moves on every edit, so ordering a gallery by it would make
-- "newest" mean "most recently touched" — the same trap `sets` avoids by
-- sorting on `published_at`. A collection had no equivalent, so it gets one:
-- stamped the first time it becomes public, and never moved again.
alter table public.collections
  add column if not exists published_at timestamptz;

create or replace function public.stamp_collection_published()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.visibility = 'public'
     and new.published_at is null
     and (tg_op = 'INSERT' or old.visibility is distinct from 'public') then
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists collections_stamp_published on public.collections;
create trigger collections_stamp_published
  before insert or update on public.collections
  for each row execute function public.stamp_collection_published();

-- Backfilled in the same migration that adds the column, because nothing
-- else ever will: a published row is rewritten only by a deliberate edit,
-- and leaving this null would sort every existing public collection last
-- for ever. `updated_at` is the best evidence available for when a row that
-- is already public became so. This is the rule `0010` had to learn for
-- `sets.kind` — see the note in CLAUDE.md.
update public.collections
   set published_at = updated_at
 where visibility = 'public' and published_at is null;

/*
 * The gallery's listing.
 *
 * `security definer` for the member count alone — `collection_members` is
 * not readable by a stranger, and the count is the one fact a tile needs
 * that the row itself does not carry. The rows returned are only ever those
 * `collections_public_read` already exposes, restated here rather than
 * relied upon, so this function is safe to read on its own terms.
 *
 * Not "unlisted or public". An unlisted collection's slug *is* its share
 * token, so listing one would hand out every private link in the database —
 * the same mistake `sets_public_read` is written to avoid.
 *
 * Empty collections are left out. A public collection with no decks has
 * nothing to show and no reason to occupy a tile; it reappears the moment
 * its first deck is accepted.
 */
create or replace function public.list_public_collections(want integer default 24)
returns table (
  id uuid,
  slug text,
  name text,
  subtitle text,
  blurb text,
  banner_url text,
  deck_count integer,
  creator_count integer,
  published_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    c.id, c.slug, c.name, c.subtitle, c.blurb, c.banner_url,
    counts.decks,
    counts.creators,
    c.published_at
  from public.collections c
  cross join lateral (
    select
      count(*)::integer as decks,
      count(distinct s.owner_id)::integer as creators
    from public.collection_members m
    join public.sets s on s.id = m.set_id
    where m.collection_id = c.id and m.status = 'accepted'
  ) counts
  where c.visibility = 'public'
    and not c.hidden
    and counts.decks > 0
  order by c.published_at desc nulls last, c.created_at desc
  limit greatest(1, least(coalesce(want, 24), 60));
$$;

grant execute on function public.list_public_collections(integer) to anon, authenticated;
