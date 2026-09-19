-- Immediate, owner-scoped cleanup for superseded published and cloud-draft assets.
--
-- This path exists for an owner who needs to reclaim storage before the ordinary
-- 30-day candidate period ends. It selects only objects under that owner's path,
-- excludes every asset referenced by a current published set, contribution, or
-- current cloud-draft document, and repeats those checks immediately before the
-- Edge Function deletes through the Storage API.

create or replace function public.storage_cleanup_live_draft_assets()
returns table (name text)
language sql
security definer
set search_path = ''
stable
as $$
  select distinct matches.parts[1] as name
    from public.set_drafts as draft
    cross join lateral regexp_matches(
      draft.document::text,
      'draft-asset:([^"#]+)#',
      'g'
    ) as matches(parts);
$$;

revoke all on function public.storage_cleanup_live_draft_assets()
  from public, anon, authenticated;

create or replace function public.storage_cleanup_owner_superseded_plan(
  requested_owner_id uuid,
  requested_limit integer default 250
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  bounded_limit integer := greatest(1, least(requested_limit, 500));
  planned jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'storage cleanup is restricted to the service role';
  end if;

  with unreferenced as materialized (
    select object.bucket_id,
           object.name,
           coalesce((object.metadata ->> 'size')::bigint, 0) as size_bytes,
           coalesce(object.updated_at, object.created_at, now()) as object_updated_at
      from storage.objects as object
     where object.bucket_id in ('draft-assets', 'set-assets')
       and split_part(object.name, '/', 1) = requested_owner_id::text
       and (
         (object.bucket_id = 'draft-assets' and not exists (
           select 1
             from public.storage_cleanup_live_draft_assets() as live
            where live.name = object.name
         ))
         or (object.bucket_id = 'set-assets' and not exists (
           select 1
             from public.storage_cleanup_live_set_assets() as live
            where live.name = object.name
         ))
       )
  ), selected as (
    select unreferenced.bucket_id,
           unreferenced.name,
           unreferenced.size_bytes,
           unreferenced.object_updated_at as first_observed_at,
           unreferenced.object_updated_at
      from unreferenced
     order by unreferenced.bucket_id, unreferenced.name
     limit bounded_limit
  ), owner_totals as (
    select object.bucket_id,
           count(*) as object_count,
           coalesce(sum((object.metadata ->> 'size')::bigint), 0) as total_bytes
      from storage.objects as object
     where object.bucket_id in ('draft-assets', 'set-assets')
       and split_part(object.name, '/', 1) = requested_owner_id::text
     group by object.bucket_id
  ), candidate_totals as (
    select unreferenced.bucket_id,
           count(*) as candidate_count,
           coalesce(sum(unreferenced.size_bytes), 0) as candidate_bytes
      from unreferenced
     group by unreferenced.bucket_id
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'graceSeconds', 0,
    'limit', bounded_limit,
    'staleMarkersRemoved', 0,
    'ownerId', requested_owner_id,
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bucketId', bucket.bucket_id,
        'objectCount', bucket.object_count,
        'totalBytes', bucket.total_bytes,
        'candidateCount', coalesce(candidate.candidate_count, 0),
        'candidateBytes', coalesce(candidate.candidate_bytes, 0),
        'dueCount', coalesce(candidate.candidate_count, 0),
        'dueBytes', coalesce(candidate.candidate_bytes, 0)
      ) order by bucket.bucket_id)
        from owner_totals as bucket
        left join candidate_totals as candidate using (bucket_id)
    ), '[]'::jsonb),
    'candidates', coalesce((select jsonb_agg(to_jsonb(selected)) from selected), '[]'::jsonb)
  ) into planned;

  return planned;
end;
$$;

revoke all on function public.storage_cleanup_owner_superseded_plan(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.storage_cleanup_owner_superseded_plan(uuid, integer)
  to service_role;

create or replace function public.storage_cleanup_owner_asset_is_unreferenced(
  requested_owner_id uuid,
  requested_bucket_id text,
  requested_name text,
  expected_object_updated_at timestamptz
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select case
    when auth.role() <> 'service_role' then false
    when requested_bucket_id not in ('draft-assets', 'set-assets') then false
    when split_part(requested_name, '/', 1) <> requested_owner_id::text then false
    else exists (
      select 1
        from storage.objects as object
       where object.bucket_id = requested_bucket_id
         and object.name = requested_name
         and coalesce(object.updated_at, object.created_at) = expected_object_updated_at
         and (
           (object.bucket_id = 'draft-assets' and not exists (
             select 1
               from public.storage_cleanup_live_draft_assets() as live
              where live.name = object.name
           ))
           or (object.bucket_id = 'set-assets' and not exists (
             select 1
               from public.storage_cleanup_live_set_assets() as live
              where live.name = object.name
           ))
         )
    )
  end;
$$;

revoke all on function public.storage_cleanup_owner_asset_is_unreferenced(
  uuid, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.storage_cleanup_owner_asset_is_unreferenced(
  uuid, text, text, timestamptz
) to service_role;
