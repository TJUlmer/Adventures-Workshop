/*
 * The lightweight roster for a collection's public showcase.
 *
 * A direct read of `set_characters` is not enough here: its public policy sees
 * characters only when their own published set is public, while a collection
 * may deliberately contain an unlisted deck whose author consented to the
 * collection link exposing it. This function therefore repeats
 * `collection_members_by_slug`'s complete reachability boundary and returns
 * only indexed presentation fields — never either set's document.
 *
 * Set order comes first, then the character order recorded by that set, so a
 * collection's roster follows the same editorial sequence as its deck grid.
 */
create or replace function public.collection_characters_by_slug(share_slug text)
returns table (
  set_id uuid,
  set_slug text,
  set_name text,
  set_sort_order integer,
  owner_id uuid,
  author_name text,
  author_avatar text,
  character_id text,
  character_name text,
  character_role text,
  character_position integer,
  image_url text,
  image_bleeds boolean,
  card_url text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.id, s.slug, s.name, m.sort_order,
    s.owner_id, coalesce(p.display_name, ''), coalesce(p.avatar_url, ''),
    sc.character_id, sc.name, sc.role, sc.position,
    sc.image_url, sc.image_bleeds, sc.card_url
  from public.collection_members m
  join public.collections c on c.id = m.collection_id
  join public.sets s on s.id = m.set_id
  join public.set_characters sc on sc.set_id = s.id
  left join public.profiles p on p.id = s.owner_id
  where c.slug = share_slug
    and c.visibility in ('unlisted', 'public')
    and not c.hidden
    and m.status = 'accepted'
    and s.visibility in ('unlisted', 'public')
    and not s.hidden
  order by m.sort_order, s.name, sc.position, sc.name;
$$;

revoke all on function public.collection_characters_by_slug(text) from public;
grant execute on function public.collection_characters_by_slug(text) to anon, authenticated;
