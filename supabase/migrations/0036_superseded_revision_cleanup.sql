-- Give assets from replaced committed revisions a short, three-day safety period.
--
-- Published sets and cloud drafts each store one current row rather than a
-- revision history. Once a successful write replaces a reference, that prior
-- revision cannot be opened from the product. Queue those removed references
-- for deletion after three days, but keep the 30-day observation period for
-- uploads that never belonged to any committed revision. Every deletion still
-- repeats the global live-reference and object-timestamp checks through the
-- Edge Function.

alter table public.storage_cleanup_candidates
  add column if not exists superseded boolean not null default false;

create or replace function public.storage_cleanup_set_asset_names(payload jsonb)
returns table (name text)
language sql
security definer
set search_path = ''
stable
as $$
  with strings as (
    select jsonb_path_query(
      payload,
      'lax $.** ? (@.type() == "string")'
    ) #>> '{}' as value
  )
  select distinct regexp_replace(
    strings.value,
    '^.*?/storage/v1/object/public/set-assets/([^?#]+).*$','\1'
  ) as name
    from strings
   where strings.value ~ '/storage/v1/object/public/set-assets/[^?#]+';
$$;

revoke all on function public.storage_cleanup_set_asset_names(jsonb)
  from public, anon, authenticated;

create or replace function public.queue_superseded_set_assets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_payload jsonb;
begin
  if tg_op = 'UPDATE' then
    current_payload := to_jsonb(new);
  end if;

  insert into public.storage_cleanup_candidates (
    bucket_id, name, first_observed_at, last_observed_at,
    object_updated_at, size_bytes, superseded
  )
  select 'set-assets',
         prior.name,
         now(),
         now(),
         coalesce(object.updated_at, object.created_at, now()),
         coalesce((object.metadata ->> 'size')::bigint, 0),
         true
    from public.storage_cleanup_set_asset_names(to_jsonb(old)) as prior
    join storage.objects as object
      on object.bucket_id = 'set-assets' and object.name = prior.name
   where current_payload is null
      or not exists (
           select 1
             from public.storage_cleanup_set_asset_names(current_payload) as current
            where current.name = prior.name
         )
  on conflict (bucket_id, name) do update
    set first_observed_at = now(),
        last_observed_at = now(),
        object_updated_at = excluded.object_updated_at,
        size_bytes = excluded.size_bytes,
        superseded = true;

  return null;
end;
$$;

revoke all on function public.queue_superseded_set_assets()
  from public, anon, authenticated;

drop trigger if exists sets_queue_superseded_assets on public.sets;
create trigger sets_queue_superseded_assets
  after update or delete on public.sets
  for each row execute function public.queue_superseded_set_assets();

create or replace function public.storage_cleanup_draft_asset_names(payload jsonb)
returns table (name text)
language sql
security definer
set search_path = ''
stable
as $$
  select distinct matches.parts[1] as name
    from regexp_matches(
      payload::text,
      'draft-asset:([^"#]+)#',
      'g'
    ) as matches(parts);
$$;

revoke all on function public.storage_cleanup_draft_asset_names(jsonb)
  from public, anon, authenticated;

create or replace function public.queue_superseded_draft_assets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_document jsonb;
begin
  if tg_op = 'UPDATE' then
    current_document := new.document;
  end if;

  insert into public.storage_cleanup_candidates (
    bucket_id, name, first_observed_at, last_observed_at,
    object_updated_at, size_bytes, superseded
  )
  select 'draft-assets',
         prior.name,
         now(),
         now(),
         coalesce(object.updated_at, object.created_at, now()),
         coalesce((object.metadata ->> 'size')::bigint, 0),
         true
    from public.storage_cleanup_draft_asset_names(old.document) as prior
    join storage.objects as object
      on object.bucket_id = 'draft-assets' and object.name = prior.name
   where current_document is null
      or not exists (
           select 1
             from public.storage_cleanup_draft_asset_names(current_document) as current
            where current.name = prior.name
         )
  on conflict (bucket_id, name) do update
    set first_observed_at = now(),
        last_observed_at = now(),
        object_updated_at = excluded.object_updated_at,
        size_bytes = excluded.size_bytes,
        superseded = true;

  return null;
end;
$$;

revoke all on function public.queue_superseded_draft_assets()
  from public, anon, authenticated;

drop trigger if exists set_drafts_queue_superseded_assets on public.set_drafts;
create trigger set_drafts_queue_superseded_assets
  after update of document or delete on public.set_drafts
  for each row execute function public.queue_superseded_draft_assets();

create or replace function public.queue_superseded_tts_assets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.storage_cleanup_candidates (
    bucket_id, name, first_observed_at, last_observed_at,
    object_updated_at, size_bytes, superseded
  )
  select 'tts-assets',
         path,
         now(),
         now(),
         coalesce(object.updated_at, object.created_at, now()),
         coalesce((object.metadata ->> 'size')::bigint, 0),
         true
    from unnest(old.asset_paths) as paths(path)
    join storage.objects as object
      on object.bucket_id = 'tts-assets' and object.name = path
  on conflict (bucket_id, name) do update
    set first_observed_at = now(),
        last_observed_at = now(),
        object_updated_at = excluded.object_updated_at,
        size_bytes = excluded.size_bytes,
        superseded = true;

  return null;
end;
$$;

revoke all on function public.queue_superseded_tts_assets()
  from public, anon, authenticated;

drop trigger if exists tts_exports_queue_superseded_assets on public.tts_exports;
create trigger tts_exports_queue_superseded_assets
  after update of retired_at on public.tts_exports
  for each row
  when (old.retired_at is null and new.retired_at is not null)
  execute function public.queue_superseded_tts_assets();

create or replace function public.storage_cleanup_plan(
  requested_grace interval default interval '30 days',
  requested_limit integer default 250
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  bounded_grace interval := greatest(interval '30 days', least(requested_grace, interval '90 days'));
  bounded_limit integer := greatest(1, least(requested_limit, 500));
  removed_count bigint := 0;
  planned jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'storage cleanup is restricted to the service role';
  end if;

  delete from public.storage_cleanup_candidates as candidate
   where not exists (
           select 1 from storage.objects as object
            where object.bucket_id = candidate.bucket_id and object.name = candidate.name
         )
      or (candidate.bucket_id = 'draft-assets' and exists (
           select 1 from public.storage_cleanup_live_draft_assets() as live
            where live.name = candidate.name
         ))
      or (candidate.bucket_id = 'set-assets' and exists (
           select 1 from public.storage_cleanup_live_set_assets() as live
            where live.name = candidate.name
         ))
      or (candidate.bucket_id = 'tts-assets' and exists (
           select 1 from public.storage_cleanup_live_tts_assets() as live
            where live.name = candidate.name
         ));
  get diagnostics removed_count = row_count;

  insert into public.storage_cleanup_candidates (
    bucket_id, name, first_observed_at, last_observed_at, object_updated_at, size_bytes
  )
  select object.bucket_id,
         object.name,
         now(),
         now(),
         coalesce(object.updated_at, object.created_at, now()),
         coalesce((object.metadata ->> 'size')::bigint, 0)
    from storage.objects as object
   where object.bucket_id in ('draft-assets', 'set-assets', 'tts-assets')
     and (
       (object.bucket_id = 'draft-assets' and not exists (
          select 1 from public.storage_cleanup_live_draft_assets() as live
           where live.name = object.name
       ))
       or (object.bucket_id = 'set-assets' and not exists (
          select 1 from public.storage_cleanup_live_set_assets() as live
           where live.name = object.name
       ))
       or (object.bucket_id = 'tts-assets' and not exists (
          select 1 from public.storage_cleanup_live_tts_assets() as live
           where live.name = object.name
       ))
     )
  on conflict (bucket_id, name) do update
    set first_observed_at = case
          when public.storage_cleanup_candidates.object_updated_at is distinct from excluded.object_updated_at
            then now()
          else public.storage_cleanup_candidates.first_observed_at
        end,
        last_observed_at = now(),
        object_updated_at = excluded.object_updated_at,
        size_bytes = excluded.size_bytes,
        superseded = case
          when public.storage_cleanup_candidates.object_updated_at is distinct from excluded.object_updated_at
            then false
          else public.storage_cleanup_candidates.superseded
        end;

  with due as (
    select candidate.bucket_id,
           candidate.name,
           candidate.size_bytes,
           candidate.first_observed_at,
           candidate.object_updated_at
      from public.storage_cleanup_candidates as candidate
     where (candidate.superseded and candidate.first_observed_at <= now() - interval '3 days')
        or (
          not candidate.superseded
          and candidate.first_observed_at <= now() - bounded_grace
        )
     order by candidate.first_observed_at, candidate.bucket_id, candidate.name
     limit bounded_limit
  ), bucket_totals as (
    select object.bucket_id,
           count(*) as object_count,
           coalesce(sum((object.metadata ->> 'size')::bigint), 0) as total_bytes
      from storage.objects as object
     where object.bucket_id in ('draft-assets', 'set-assets', 'tts-assets')
     group by object.bucket_id
  ), candidate_totals as (
    select candidate.bucket_id,
           count(*) as candidate_count,
           coalesce(sum(candidate.size_bytes), 0) as candidate_bytes,
           count(*) filter (
             where (
               candidate.superseded
               and candidate.first_observed_at <= now() - interval '3 days'
             ) or (
               not candidate.superseded
               and candidate.first_observed_at <= now() - bounded_grace
             )
           ) as due_count,
           coalesce(sum(candidate.size_bytes) filter (
             where (
               candidate.superseded
               and candidate.first_observed_at <= now() - interval '3 days'
             ) or (
               not candidate.superseded
               and candidate.first_observed_at <= now() - bounded_grace
             )
           ), 0) as due_bytes
      from public.storage_cleanup_candidates as candidate
     group by candidate.bucket_id
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'graceSeconds', extract(epoch from bounded_grace)::bigint,
    'limit', bounded_limit,
    'staleMarkersRemoved', removed_count,
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bucketId', bucket.bucket_id,
        'objectCount', bucket.object_count,
        'totalBytes', bucket.total_bytes,
        'candidateCount', coalesce(candidate.candidate_count, 0),
        'candidateBytes', coalesce(candidate.candidate_bytes, 0),
        'dueCount', coalesce(candidate.due_count, 0),
        'dueBytes', coalesce(candidate.due_bytes, 0)
      ) order by bucket.bucket_id)
        from bucket_totals as bucket
        left join candidate_totals as candidate using (bucket_id)
    ), '[]'::jsonb),
    'candidates', coalesce((select jsonb_agg(to_jsonb(due)) from due), '[]'::jsonb)
  ) into planned;

  return planned;
end;
$$;

revoke all on function public.storage_cleanup_plan(interval, integer)
  from public, anon, authenticated;
grant execute on function public.storage_cleanup_plan(interval, integer)
  to service_role;

create or replace function public.storage_cleanup_candidate_is_due(
  requested_bucket_id text,
  requested_name text,
  expected_first_observed_at timestamptz,
  expected_object_updated_at timestamptz,
  requested_grace interval default interval '30 days'
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select case
    when auth.role() <> 'service_role' then false
    else exists (
      select 1
        from public.storage_cleanup_candidates as candidate
        join storage.objects as object
          on object.bucket_id = candidate.bucket_id and object.name = candidate.name
       where candidate.bucket_id = requested_bucket_id
         and candidate.name = requested_name
         and candidate.first_observed_at = expected_first_observed_at
         and candidate.object_updated_at = expected_object_updated_at
         and (
           (
             candidate.superseded
             and candidate.first_observed_at <= now() - interval '3 days'
           ) or (
             not candidate.superseded
             and candidate.first_observed_at <= now() - greatest(
               interval '30 days', least(requested_grace, interval '90 days')
             )
           )
         )
         and coalesce(object.updated_at, object.created_at) = expected_object_updated_at
         and (
           (candidate.bucket_id = 'draft-assets' and not exists (
              select 1 from public.storage_cleanup_live_draft_assets() as live
               where live.name = candidate.name
           ))
           or (candidate.bucket_id = 'set-assets' and not exists (
              select 1 from public.storage_cleanup_live_set_assets() as live
               where live.name = candidate.name
           ))
           or (candidate.bucket_id = 'tts-assets' and not exists (
              select 1 from public.storage_cleanup_live_tts_assets() as live
               where live.name = candidate.name
           ))
         )
    )
  end;
$$;

revoke all on function public.storage_cleanup_candidate_is_due(
  text, text, timestamptz, timestamptz, interval
) from public, anon, authenticated;
grant execute on function public.storage_cleanup_candidate_is_due(
  text, text, timestamptz, timestamptz, interval
) to service_role;
