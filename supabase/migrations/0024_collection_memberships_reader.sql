/*
 * The membership list an organizer and a deck's owner actually need.
 *
 * Replaces a PostgREST embed that had two faults, one visible and one fatal.
 *
 * **It could not name an unlisted deck.** `sets` RLS exposes public rows and
 * your own, so an organizer reading `set:sets(...)` for somebody else's
 * unlisted deck got null and the row rendered "Untitled / Anonymous" beside a
 * Remove button. Unlisted is what collections gather during production — the
 * design says so — meaning the management list was blank for most of the
 * decks it manages. `collection_members_by_slug` already solved this for the
 * public tiles by being `security definer`; the organizer's own list was
 * still going through the table.
 *
 * **And it stopped working entirely.** `sets` gained more junctions to
 * `profiles` — `set_comments`, `set_likes`, `set_favourites` — so the nested
 * `author:profiles(...)` became ambiguous and PostgREST refused the query:
 * "more than one relationship was found for 'sets' and 'profiles'". An embed
 * is only unambiguous until somebody adds a table nowhere near it, which is a
 * poor property for a screen to depend on.
 *
 * Visibility is unchanged and restated here rather than inherited: a caller
 * sees a row when they own the deck or organize the collection — exactly
 * `members_read`. `target` null answers "what is waiting on me", across every
 * collection, for Home.
 */
create or replace function public.collection_memberships(target uuid default null)
returns table (
  collection_id uuid,
  set_id uuid,
  status text,
  ready boolean,
  sort_order integer,
  invited_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  set_slug text,
  set_name text,
  set_subtitle text,
  set_thumbnail_url text,
  set_owner_id uuid,
  set_visibility text,
  author_name text,
  author_avatar text,
  collection_slug text,
  collection_name text,
  collection_subtitle text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    m.collection_id, m.set_id, m.status, m.ready, m.sort_order, m.invited_by,
    m.created_at, m.updated_at,
    s.slug, s.name, s.subtitle, s.thumbnail_url, s.owner_id, s.visibility,
    coalesce(p.display_name, ''), coalesce(p.avatar_url, ''),
    c.slug, c.name, c.subtitle
  from public.collection_members m
  join public.collections c on c.id = m.collection_id
  join public.sets s on s.id = m.set_id
  left join public.profiles p on p.id = s.owner_id
  where auth.uid() is not null
    and (target is null or m.collection_id = target)
    and not c.hidden
    and (
      s.owner_id = auth.uid()
      or public.is_collection_organizer(m.collection_id, auth.uid())
    )
  order by m.status, m.sort_order, s.name;
$$;

revoke all on function public.collection_memberships(uuid) from public, anon;
grant execute on function public.collection_memberships(uuid) to authenticated;
