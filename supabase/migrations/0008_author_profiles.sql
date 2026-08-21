-- ---------------------------------------------------------------------------
-- Author profile pages: crediting a contributor by id, and finding what
-- someone has built or helped build
-- ---------------------------------------------------------------------------
--
-- `set_contributors` already answered "did this set take anything from them",
-- but only as a name and a picture — enough to print a credit line, not
-- enough to link one. A profile page needs the id to link to.
--
-- `sets_contributed_by` is the reverse question, and does not exist yet: "what
-- has this person helped build". It needs its own `security definer` function
-- for the same reason `set_contributors` does — `set_contributions` is only
-- readable by the contributor or the set's owner, never by a stranger.
--
-- Scoped to `visibility = 'public'` only, deliberately narrower than
-- `set_contributors`'s own `'unlisted', 'public'`. `set_contributors` is safe
-- at that wider scope because it is only ever called from a context that
-- already holds the specific set's slug; a profile page is general discovery
-- reachable from a stranger's name alone, and listing an unlisted set there
-- would hand out a working link to it.

drop function if exists public.set_contributors(uuid);

create or replace function public.set_contributors(target uuid)
returns table (id uuid, display_name text, avatar_url text)
language sql
security definer
set search_path = public
stable
as $$
  select distinct p.id, p.display_name, p.avatar_url
  from public.set_contributions c
  join public.profiles p on p.id = c.contributor_id
  join public.sets s on s.id = c.set_id
  where c.set_id = target
    and c.status = 'accepted'
    and coalesce(array_length(c.applied_keys, 1), 0) > 0
    and s.visibility in ('unlisted', 'public')
    and not s.hidden
  order by p.display_name;
$$;

revoke all on function public.set_contributors(uuid) from public;
grant execute on function public.set_contributors(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------

create or replace function public.sets_contributed_by(contributor uuid)
returns table (
  id uuid,
  slug text,
  name text,
  subtitle text,
  thumbnail_url text,
  cover_url text,
  cover_bleeds boolean,
  character_count integer,
  card_count integer,
  view_count integer,
  published_at timestamptz,
  updated_at timestamptz,
  revision integer
)
language sql
security definer
set search_path = public
stable
as $$
  select id, slug, name, subtitle, thumbnail_url, cover_url, cover_bleeds,
         character_count, card_count, view_count, published_at, updated_at, revision
  from (
    /* `distinct on` collapses several accepted offers against the same set
       into the one row a shelf wants — a returning contributor should not
       print the same tile twice. */
    select distinct on (s.id)
      s.id, s.slug, s.name, s.subtitle, s.thumbnail_url, s.cover_url, s.cover_bleeds,
      s.character_count, s.card_count, s.view_count, s.published_at, s.updated_at, s.revision
    from public.set_contributions c
    join public.sets s on s.id = c.set_id
    where c.contributor_id = contributor
      and c.status = 'accepted'
      and coalesce(array_length(c.applied_keys, 1), 0) > 0
      and s.visibility = 'public'
      and not s.hidden
  ) distinct_sets
  order by published_at desc nulls last;
$$;

revoke all on function public.sets_contributed_by(uuid) from public;
grant execute on function public.sets_contributed_by(uuid) to anon, authenticated;
