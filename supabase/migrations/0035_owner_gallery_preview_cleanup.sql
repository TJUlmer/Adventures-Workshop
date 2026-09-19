-- Immediate cleanup limited to one owner's superseded gallery card previews.
-- The Edge Function still rechecks every selected object immediately before
-- deleting it through the Storage API.

create or replace function public.storage_cleanup_owner_gallery_preview_plan(
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
    select object.name,
           coalesce((object.metadata ->> 'size')::bigint, 0) as size_bytes,
           coalesce(object.updated_at, object.created_at, now()) as object_updated_at
      from storage.objects as object
     where object.bucket_id = 'set-assets'
       and split_part(object.name, '/', 1) = requested_owner_id::text
       and object.name ~ '^[^/]+/[^/]+/card-preview-[0-9a-f]{8}-[0-9a-f]{8}[.](png|webp)$'
       and not exists (
         select 1
           from public.storage_cleanup_live_set_assets() as live
          where live.name = object.name
       )
  ), selected as (
    select unreferenced.name,
           unreferenced.size_bytes,
           unreferenced.object_updated_at
      from unreferenced
     order by unreferenced.name
     limit bounded_limit
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'ownerId', requested_owner_id,
    'limit', bounded_limit,
    'buckets', jsonb_build_array(jsonb_build_object(
      'bucketId', 'set-assets',
      'candidateCount', (select count(*) from unreferenced),
      'candidateBytes', coalesce((select sum(size_bytes) from unreferenced), 0)
    )),
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bucket_id', 'set-assets',
        'name', selected.name,
        'first_observed_at', selected.object_updated_at,
        'object_updated_at', selected.object_updated_at,
        'size_bytes', selected.size_bytes
      ) order by selected.name)
        from selected
    ), '[]'::jsonb)
  ) into planned;

  return planned;
end;
$$;

revoke all on function public.storage_cleanup_owner_gallery_preview_plan(uuid, integer)
  from public, anon, authenticated;

create or replace function public.storage_cleanup_owner_gallery_preview_is_unreferenced(
  requested_owner_id uuid,
  requested_name text,
  expected_object_updated_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'storage cleanup is restricted to the service role';
  end if;

  return case
    when split_part(requested_name, '/', 1) <> requested_owner_id::text then false
    when requested_name !~ '^[^/]+/[^/]+/card-preview-[0-9a-f]{8}-[0-9a-f]{8}[.](png|webp)$' then false
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
end;
$$;

revoke all on function public.storage_cleanup_owner_gallery_preview_is_unreferenced(uuid, text, timestamptz)
  from public, anon, authenticated;
