-- A narrow fast path for the PNG-to-WebP gallery migration.
--
-- The general storage cleanup keeps its 30-day grace period. These functions
-- may only select generated legacy card-preview PNGs that no published set or
-- contribution references, and the predicate is checked again immediately
-- before each Storage API deletion.

create or replace function public.storage_cleanup_legacy_card_preview_plan(
  requested_limit integer default 100
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

  with orphaned as materialized (
    select object.bucket_id,
           object.name,
           coalesce((object.metadata ->> 'size')::bigint, 0) as size_bytes,
           coalesce(object.updated_at, object.created_at, now()) as object_updated_at
      from storage.objects as object
     where object.bucket_id = 'set-assets'
       and object.name ~ '^[^/]+/[^/]+/card-preview-[0-9a-f]{8}-[0-9a-f]{8}[.]png$'
       and not exists (
         select 1
           from public.storage_cleanup_live_set_assets() as live
          where live.name = object.name
       )
  ), selected as (
    select orphaned.bucket_id,
           orphaned.name,
           orphaned.size_bytes,
           orphaned.object_updated_at as first_observed_at,
           orphaned.object_updated_at
      from orphaned
     order by orphaned.name
     limit bounded_limit
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'graceSeconds', 0,
    'limit', bounded_limit,
    'staleMarkersRemoved', 0,
    'buckets', jsonb_build_array(jsonb_build_object(
      'bucketId', 'set-assets',
      'objectCount', (select count(*) from orphaned),
      'totalBytes', (select coalesce(sum(size_bytes), 0) from orphaned),
      'candidateCount', (select count(*) from orphaned),
      'candidateBytes', (select coalesce(sum(size_bytes), 0) from orphaned),
      'dueCount', (select count(*) from orphaned),
      'dueBytes', (select coalesce(sum(size_bytes), 0) from orphaned)
    )),
    'candidates', coalesce((select jsonb_agg(to_jsonb(selected)) from selected), '[]'::jsonb)
  ) into planned;

  return planned;
end;
$$;

revoke all on function public.storage_cleanup_legacy_card_preview_plan(integer)
  from public, anon, authenticated;
grant execute on function public.storage_cleanup_legacy_card_preview_plan(integer)
  to service_role;

create or replace function public.storage_cleanup_legacy_card_preview_is_unreferenced(
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
    when requested_name !~ '^[^/]+/[^/]+/card-preview-[0-9a-f]{8}-[0-9a-f]{8}[.]png$' then false
    else exists (
      select 1
        from storage.objects as object
       where object.bucket_id = 'set-assets'
         and object.name = requested_name
         and coalesce(object.updated_at, object.created_at) = expected_object_updated_at
         and not exists (
           select 1
             from public.storage_cleanup_live_set_assets() as live
            where live.name = object.name
         )
    )
  end;
$$;

revoke all on function public.storage_cleanup_legacy_card_preview_is_unreferenced(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.storage_cleanup_legacy_card_preview_is_unreferenced(text, timestamptz)
  to service_role;
