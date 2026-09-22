/*
 * A character tile represents the printed deck back, not merely the source
 * artwork placed beneath it. Replacement artwork happened to look correct
 * because it already contains the whole card; composed backs lost their frame,
 * name and UMLabs mark when `set_characters.image_url` exposed only the raw
 * artwork. Publication already stores the canonical rendered back in
 * `sets.card_previews`, so prefer that finished image everywhere a published
 * character is presented and retain the indexed artwork as a legacy fallback.
 *
 * Card previews are photographed without bleed. Keep `image_bleeds` paired
 * with whichever URL won so the Gallery does not crop a finished preview as
 * though it were a replacement back on the full print canvas.
 */

create or replace view public.gallery_characters
with (security_invoker = on) as
select distinct on (s.owner_id, s.local_id, sc.character_id)
       sc.character_id,
       sc.name,
       sc.role,
       coalesce(
         nullif(s.card_previews ->> ('deck-back:' || sc.character_id || ':front'), ''),
         sc.image_url
       )               as image_url,
       sc.position,
       s.id             as set_id,
       s.slug           as slug,
       s.name           as listing_name,
       s.scope          as listing_scope,
       s.thumbnail_url,
       s.cover_url,
       s.owner_id,
       s.local_id,
       s.published_at,
       s.view_count,
       parent.slug      as parent_slug,
       parent.name      as parent_name,
       sc.card_url,
       case
         when nullif(s.card_previews ->> ('deck-back:' || sc.character_id || ':front'), '')
              is not null then false
         else sc.image_bleeds
       end              as image_bleeds,
       s.cover_bleeds,
       s.like_count,
       s.comment_count
  from public.set_characters sc
  join public.sets s on s.id = sc.set_id
  left join lateral (
    select p.slug, p.name
      from public.sets p
     where p.owner_id = s.owner_id
       and p.local_id = s.local_id
       and p.scope = 'full'
       and p.visibility = 'public'
       and not p.hidden
     limit 1
  ) parent on true
 where s.visibility = 'public' and not s.hidden
 order by s.owner_id, s.local_id, sc.character_id,
          (s.scope <> 'full' and s.character_id = sc.character_id) desc,
          s.published_at desc nulls last;

revoke all on public.gallery_characters from anon, authenticated;
grant select on public.gallery_characters to anon, authenticated;

/* Repair existing solo-hero listings as well as future publishes. An uploaded
   box cover remains authoritative, and Adventures/multi-hero sets retain their
   compilation thumbnails. The document test is necessary because `box_art`
   itself is not a database column. */
update public.sets s
   set thumbnail_url = s.card_previews ->> ('deck-back:' || sc.character_id || ':front')
  from public.set_characters sc
 where sc.set_id = s.id
   and sc.role = 'hero'
   and s.kind = 'heroes'
   and s.hero_count = 1
   and s.scope in ('full', 'hero')
   and nullif(s.document -> 'set' -> 'boxArt' ->> 'source', '') is null
   and nullif(s.card_previews ->> ('deck-back:' || sc.character_id || ':front'), '')
       is not null;

/* Collections draw the same character tiles through a function rather than
   the public Gallery view because an invited collection may expose an unlisted
   member. Keep that presentation on the same finished-deck-back rule. */
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
    coalesce(
      nullif(s.card_previews ->> ('deck-back:' || sc.character_id || ':front'), ''),
      sc.image_url
    ),
    case
      when nullif(s.card_previews ->> ('deck-back:' || sc.character_id || ':front'), '')
           is not null then false
      else sc.image_bleeds
    end,
    sc.card_url
  from public.collection_members m
  join public.collections c on c.id = m.collection_id
  join public.sets s on s.id = m.set_id
  join public.set_characters sc on sc.set_id = s.id
  left join public.profiles p on p.id = s.owner_id
  where c.slug = share_slug
    and not c.hidden
    and m.status = 'accepted'
    and s.visibility in ('unlisted', 'public')
    and not s.hidden
    and (
      c.visibility in ('unlisted', 'public')
      or public.can_access_collection_deck_comments(c.id, m.set_id)
    )
  order by m.sort_order, s.name, sc.position, sc.name;
$$;

revoke all on function public.collection_characters_by_slug(text)
  from public, anon, authenticated;
grant execute on function public.collection_characters_by_slug(text)
  to anon, authenticated;
