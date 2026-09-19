-- Immediate, owner-scoped cleanup for one exact TTS export folder.
--
-- This deliberately requires both an owner and source key. It is intended for
-- pre-manifest or retired exports that must be reclaimed before the ordinary
-- grace period. A current retained manifest always wins, including when its
-- content-addressed path is shared with an older export.

create or replace function public.storage_cleanup_owner_tts_unretained_plan(
  requested_owner_id uuid,
  requested_source_key text,
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
  if requested_source_key is null or requested_source_key !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'the TTS source key is invalid';
  end if;

  with unretained as materialized (
    select object.name,
           coalesce((object.metadata ->> 'size')::bigint, 0) as size_bytes,
           coalesce(object.updated_at, object.created_at, now()) as object_updated_at
      from storage.objects as object
     where object.bucket_id = 'tts-assets'
       and split_part(object.name, '/', 1) = requested_owner_id::text
       and split_part(object.name, '/', 2) = requested_source_key
       and not exists (
         select 1
           from public.storage_cleanup_live_tts_assets() as live
          where live.name = object.name
       )
  ), selected as (
    select 'tts-assets'::text as bucket_id,
           unretained.name,
           unretained.size_bytes,
           unretained.object_updated_at as first_observed_at,
           unretained.object_updated_at
      from unretained
     order by unretained.name
     limit bounded_limit
  ), owner_totals as (
    select count(*) as object_count,
           coalesce(sum((object.metadata ->> 'size')::bigint), 0) as total_bytes
      from storage.objects as object
     where object.bucket_id = 'tts-assets'
       and split_part(object.name, '/', 1) = requested_owner_id::text
       and split_part(object.name, '/', 2) = requested_source_key
  ), candidate_totals as (
    select count(*) as candidate_count,
           coalesce(sum(unretained.size_bytes), 0) as candidate_bytes
      from unretained
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'graceSeconds', 0,
    'limit', bounded_limit,
    'staleMarkersRemoved', 0,
    'ownerId', requested_owner_id,
    'sourceKey', requested_source_key,
    'buckets', jsonb_build_array(jsonb_build_object(
      'bucketId', 'tts-assets',
      'objectCount', owner.object_count,
      'totalBytes', owner.total_bytes,
      'candidateCount', candidate.candidate_count,
      'candidateBytes', candidate.candidate_bytes,
      'dueCount', candidate.candidate_count,
      'dueBytes', candidate.candidate_bytes
    )),
    'candidates', coalesce((select jsonb_agg(to_jsonb(selected)) from selected), '[]'::jsonb)
  ) into planned
    from owner_totals as owner
    cross join candidate_totals as candidate;

  return planned;
end;
$$;

revoke all on function public.storage_cleanup_owner_tts_unretained_plan(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.storage_cleanup_owner_tts_unretained_plan(uuid, text, integer)
  to service_role;

create or replace function public.storage_cleanup_owner_tts_asset_is_unretained(
  requested_owner_id uuid,
  requested_source_key text,
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
    when requested_source_key is null
      or requested_source_key !~ '^[A-Za-z0-9_-]+$' then false
    when split_part(requested_name, '/', 1) <> requested_owner_id::text then false
    when split_part(requested_name, '/', 2) <> requested_source_key then false
    else exists (
      select 1
        from storage.objects as object
       where object.bucket_id = 'tts-assets'
         and object.name = requested_name
         and coalesce(object.updated_at, object.created_at) = expected_object_updated_at
         and not exists (
           select 1
             from public.storage_cleanup_live_tts_assets() as live
            where live.name = object.name
         )
    )
  end;
$$;

revoke all on function public.storage_cleanup_owner_tts_asset_is_unretained(
  uuid, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.storage_cleanup_owner_tts_asset_is_unretained(
  uuid, text, text, timestamptz
) to service_role;
