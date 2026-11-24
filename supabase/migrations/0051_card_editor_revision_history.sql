-- History belongs to the publisher's editing workspace. The archived images
-- and the trigger installed by 0050 continue to serve the same revisions.
drop function if exists public.published_card_revisions(text, text, integer);

create or replace function public.own_published_card_revisions(
  requested_set text, requested_card text, requested_copy integer
)
returns table (
  publication_id uuid,
  publication_name text,
  scope text,
  latest_revision integer,
  ranges jsonb
)
language sql
security definer
set search_path = ''
stable
as $$
  select publication.id, publication.name, publication.scope, publication.revision,
         jsonb_agg(jsonb_build_object(
           'first_revision', snapshot.first_revision,
           'last_revision', snapshot.last_revision,
           'front_path', face.front,
           'back_path', snapshot.preview #>> '{faces,back}'
         ) order by snapshot.first_revision)
    from public.sets as publication
    cross join lateral (
      -- The author can compare their draft with the latest published card
      -- even when the listing has yet to record its first historical range.
      select publication.revision as first_revision, publication.revision as last_revision, current_card.preview
        from public.published_card_history_previews(publication) as current_card
       where current_card.card_id = requested_card
      union all
      select greatest(history.first_revision, publication.revision - 4),
             least(coalesce(history.last_revision, publication.revision), publication.revision - 1),
             history.preview
        from public.published_card_history as history
       where history.set_id = publication.id and history.card_id = requested_card
         and history.first_revision < publication.revision
         and (history.last_revision is null or history.last_revision >= publication.revision - 4)
    ) as snapshot
    cross join lateral (
      select case
        when requested_copy = 1 then snapshot.preview #>> '{faces,front}'
        when snapshot.preview -> 'faces' ? ('copy:' || requested_copy || ':front')
          then snapshot.preview -> 'faces' ->> ('copy:' || requested_copy || ':front')
        when jsonb_typeof(snapshot.preview -> 'aliases') = 'object'
          then snapshot.preview -> 'faces' ->> coalesce(
            'copy:' || (snapshot.preview -> 'aliases' ->> requested_copy::text) || ':front', 'front')
        -- Older manifests reliably resolve an implicit copy only when all
        -- physical copies used one appearance.
        when (snapshot.preview -> 'faces') - array['front', 'back'] = '{}'::jsonb
          then snapshot.preview #>> '{faces,front}'
      end as front
    ) as face
   where publication.owner_id = (select auth.uid())
     and publication.local_id = requested_set
     and publication.card_previews ? ('card:' || requested_card || ':front')
     and requested_copy between 1 and (snapshot.preview ->> 'quantity')::integer
     and face.front is not null
   group by publication.id, publication.name, publication.scope, publication.revision
   order by case publication.scope when 'full' then 0 when 'hero' then 1 else 2 end,
            publication.name, publication.id;
$$;

revoke all on function public.own_published_card_revisions(text, text, integer) from public, anon;
grant execute on function public.own_published_card_revisions(text, text, integer) to authenticated;
