-- Keep the gallery images that represent the last five published revisions.
-- Images already live in Storage. Each row is a card's unchanged run of images.

alter table public.sets add column if not exists card_preview_copy_aliases jsonb;
grant insert (card_preview_copy_aliases), update (card_preview_copy_aliases)
  on public.sets to authenticated;

create table if not exists public.published_card_history (
  set_id uuid not null references public.sets(id) on delete cascade,
  card_id text not null,
  first_revision integer not null check (first_revision > 0),
  last_revision integer check (last_revision >= first_revision),
  preview jsonb not null,
  primary key (set_id, card_id, first_revision)
);

create unique index if not exists published_card_history_current
  on public.published_card_history (set_id, card_id) where last_revision is null;

alter table public.published_card_history enable row level security;
revoke all on public.published_card_history from public, anon, authenticated;

create or replace function public.published_card_history_previews(publication public.sets)
returns table (card_id text, preview jsonb)
language sql
set search_path = ''
immutable
as $$
  with images as materialized (
    select entry.key,
           substring(entry.value from '/storage/v1/object/public/set-assets/([^?#]+)$') as path
      from jsonb_each_text(publication.card_previews) as entry
  ), owned_images as materialized (
    select key, path from images
     where split_part(path, '/', 1) = publication.owner_id::text
       and split_part(path, '/', 2) = publication.local_id
       and split_part(path, '/', 3) ~ '^card-preview-[0-9a-f]+-[0-9a-f]+[.](png|webp)$'
       and array_length(string_to_array(path, '/'), 1) = 3
  ), card_faces as (
    select parts[1] as card_id, jsonb_object_agg(parts[2], path) as faces
      from owned_images
      cross join lateral regexp_match(key, '^card:(.+?):(front|back|copy:[0-9]+:front)$') as parts
     where parts[1] is not null
     group by parts[1]
  ), cards as (
    select entry ->> 'id' as id, entry ->> 'deckId' as deck_id, entry ->> 'type' as type,
           case when entry ->> 'quantity' ~ '^[0-9]{1,6}$'
                then greatest(1, (entry ->> 'quantity')::integer) else 1 end as quantity
      from jsonb_array_elements(
        case when jsonb_typeof(publication.document #> '{set,cards}') = 'array'
             then publication.document #> '{set,cards}' else '[]'::jsonb end
      ) as entry
  )
  select distinct on (cards.id) cards.id,
         jsonb_build_object(
           'faces', card_faces.faces || case
             when cards.type = 'event' and not card_faces.faces ? 'back' and reverse.path is not null
               then jsonb_build_object('back', reverse.path) else '{}'::jsonb end,
           'quantity', cards.quantity,
           -- An older client can republish without replacing this column.
           'aliases', case when publication.card_preview_copy_aliases ->> 'exportedAt' = publication.document ->> 'exportedAt'
                           then publication.card_preview_copy_aliases -> 'cards' -> cards.id end
         )
    from cards join card_faces on cards.id = card_faces.card_id
    left join owned_images as reverse on reverse.key = 'deck-back:' || cards.deck_id || ':front'
   where card_faces.faces ? 'front' and length(cards.id) between 1 and 200
   order by cards.id;
$$;

revoke all on function public.published_card_history_previews(public.sets) from public, anon, authenticated;

create or replace function public.retain_published_card_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_cards jsonb;
begin
  -- Existing publications start at their current revision when first superseded.
  if not exists (select 1 from public.published_card_history where set_id = new.id) then
    insert into public.published_card_history (set_id, card_id, first_revision, preview)
    select old.id, previous.card_id, old.revision, previous.preview
      from public.published_card_history_previews(old) as previous;
  end if;

  select coalesce(jsonb_object_agg(next.card_id, next.preview), '{}'::jsonb)
    into next_cards
    from public.published_card_history_previews(new) as next;

  update public.published_card_history as history
     set last_revision = old.revision
   where history.set_id = new.id and history.last_revision is null
     and next_cards ? history.card_id
     and history.preview is distinct from next_cards -> history.card_id;

  delete from public.published_card_history as history
   where history.set_id = new.id
     and (not next_cards ? history.card_id or history.last_revision < new.revision - 4);

  insert into public.published_card_history (set_id, card_id, first_revision, preview)
  select new.id, next.key, new.revision, next.value
    from jsonb_each(next_cards) as next
   where not exists (
     select 1 from public.published_card_history as history
      where history.set_id = new.id and history.card_id = next.key and history.last_revision is null
   );

  return null;
end;
$$;

revoke all on function public.retain_published_card_history() from public, anon, authenticated;

drop trigger if exists sets_retain_published_card_history on public.sets;
create trigger sets_retain_published_card_history
  after update on public.sets for each row
  when (new.revision > old.revision)
  execute function public.retain_published_card_history();

create or replace function public.published_card_revisions(share_slug text, requested_card text, requested_copy integer)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object('latest_revision', publication.revision, 'ranges', coalesce((
    select jsonb_agg(jsonb_build_object(
      'first_revision', greatest(history.first_revision, publication.revision - 4),
      'last_revision', least(coalesce(history.last_revision, publication.revision), publication.revision - 1),
      'front_path', face.front,
      'back_path', history.preview #>> '{faces,back}'
    ) order by history.first_revision)
      from public.published_card_history as history
      cross join lateral (
        select case
          when requested_copy = 1 then history.preview #>> '{faces,front}'
          when history.preview -> 'faces' ? ('copy:' || requested_copy || ':front')
            then history.preview -> 'faces' ->> ('copy:' || requested_copy || ':front')
          when jsonb_typeof(history.preview -> 'aliases') = 'object'
            then history.preview -> 'faces' ->> coalesce(
              'copy:' || (history.preview -> 'aliases' ->> requested_copy::text) || ':front', 'front')
          -- Legacy publications lack the alias map. Only a single appearance
          -- proves that an unlisted physical copy used the front image.
          when (history.preview -> 'faces') - array['front', 'back'] = '{}'::jsonb
            then history.preview #>> '{faces,front}'
        end as front
      ) as face
     where publication.card_previews ? ('card:' || requested_card || ':front')
       and history.set_id = publication.id and history.card_id = requested_card
       and requested_copy between 1 and (history.preview ->> 'quantity')::integer
       and history.first_revision < publication.revision
       and (history.last_revision is null or history.last_revision >= publication.revision - 4)
       and face.front is not null
  ), '[]'::jsonb))
    from public.sets as publication
   where publication.slug = share_slug and not publication.hidden
     and publication.visibility in ('unlisted', 'public');
$$;

revoke all on function public.published_card_revisions(text, text, integer) from public;
grant execute on function public.published_card_revisions(text, text, integer) to anon, authenticated;

create or replace function public.storage_cleanup_live_set_assets()
returns table (name text)
language sql
security definer
set search_path = ''
stable
as $$
  with source_rows as (
    select to_jsonb(s) as payload from public.sets as s
    union all
    select to_jsonb(c) as payload from public.set_contributions as c
  ), strings as (
    select jsonb_path_query(source_rows.payload, 'lax $.** ? (@.type() == "string")') #>> '{}' as value
      from source_rows
  )
  select regexp_replace(strings.value, '^.*?/storage/v1/object/public/set-assets/([^?#]+).*$','\1')
    from strings where strings.value ~ '/storage/v1/object/public/set-assets/[^?#]+'
  union
  select image.value
    from public.published_card_history as history
    cross join lateral jsonb_each_text(history.preview -> 'faces') as image;
$$;

revoke all on function public.storage_cleanup_live_set_assets() from public, anon, authenticated;
