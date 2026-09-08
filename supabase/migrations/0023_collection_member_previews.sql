/*
 * Give the collection showcase one representative character card per deck.
 *
 * This stays inside the consent-gated collection RPC. In particular, joining
 * `set_characters` through its public gallery view would make previews vanish
 * for the unlisted decks collections are designed to gather during production.
 * The existing member/collection visibility and moderation gates remain the
 * security boundary; the function still returns no document data.
 */
drop function public.collection_members_by_slug(text);

create function public.collection_members_by_slug(share_slug text)
returns table (
  set_id uuid,
  owner_id uuid,
  slug text,
  name text,
  subtitle text,
  thumbnail_url text,
  cover_url text,
  cover_bleeds boolean,
  card_count integer,
  character_count integer,
  hero_count integer,
  kind text,
  scope text,
  revision integer,
  author_name text,
  author_avatar text,
  preview_card_url text,
  sort_order integer,
  ready boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.id, s.owner_id, s.slug, s.name, s.subtitle,
    s.thumbnail_url, s.cover_url, s.cover_bleeds,
    s.card_count, s.character_count, s.hero_count, s.kind, s.scope, s.revision,
    coalesce(p.display_name, ''), coalesce(p.avatar_url, ''),
    coalesce((
      select sc.card_url
      from public.set_characters sc
      where sc.set_id = s.id
        and sc.role = 'hero'
        and sc.card_url <> ''
      order by sc.position
      limit 1
    ), ''),
    m.sort_order, m.ready
  from public.collection_members m
  join public.collections c on c.id = m.collection_id
  join public.sets s on s.id = m.set_id
  left join public.profiles p on p.id = s.owner_id
  where c.slug = share_slug
    and c.visibility in ('unlisted', 'public')
    and not c.hidden
    and m.status = 'accepted'
    and s.visibility in ('unlisted', 'public')
    and not s.hidden
  order by m.sort_order, s.name;
$$;

revoke all on function public.collection_members_by_slug(text) from public;
grant execute on function public.collection_members_by_slug(text) to anon, authenticated;
