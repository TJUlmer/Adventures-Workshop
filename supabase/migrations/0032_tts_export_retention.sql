-- Retention manifests for generated Tabletop Simulator assets.
--
-- One exact export of the current published revision may remain indefinitely.
-- Every other export is retired immediately and receives the storage cleanup
-- planner's existing 30-day observation period before its unreferenced assets
-- can be deleted. Existing unmanifested objects receive the same period from
-- the first post-migration cleanup scan.

create table if not exists public.tts_exports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  source_key text not null check (source_key ~ '^[A-Za-z0-9_-]+$'),
  published_set_id uuid references public.sets (id) on delete set null,
  published_revision integer check (published_revision is null or published_revision > 0),
  asset_paths text[] not null check (cardinality(asset_paths) between 1 and 2000),
  /* Null is the one retained current-publication slot. A timestamp means the
     manifest no longer protects its paths from the candidate scan. */
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tts_exports_publication_all_or_none check (
    num_nonnulls(published_set_id, published_revision) in (0, 2)
  )
);

create index if not exists tts_exports_owner_source_idx
  on public.tts_exports (owner_id, source_key, created_at desc);
create unique index if not exists tts_exports_published_current_idx
  on public.tts_exports (published_set_id)
  where retired_at is null;

alter table public.tts_exports enable row level security;
revoke all on public.tts_exports from anon, authenticated;

comment on table public.tts_exports is
  'Server-validated TTS asset manifests. Only the latest matching published revision remains active.';

create or replace function public.register_tts_export(
  p_source_key text,
  p_asset_paths text[],
  p_published_set_id uuid default null,
  p_published_revision integer default null
)
returns table (retention text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  normalised_paths text[];
  expected_prefix text;
  existing_objects integer;
  matched_set public.sets%rowtype;
  retention_kind text := 'temporary';
begin
  if caller is null then
    raise exception 'A signed-in or temporary identity is required.' using errcode = '42501';
  end if;
  if p_source_key is null or p_source_key !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'The TTS export source key is invalid.' using errcode = '22023';
  end if;
  if p_asset_paths is null or cardinality(p_asset_paths) < 1 or cardinality(p_asset_paths) > 2000 then
    raise exception 'A TTS export must contain between 1 and 2000 assets.' using errcode = '22023';
  end if;

  select array_agg(distinct path order by path)
    into normalised_paths
    from unnest(p_asset_paths) as paths(path);
  if cardinality(normalised_paths) <> cardinality(p_asset_paths) then
    raise exception 'A TTS export manifest contains duplicate paths.' using errcode = '22023';
  end if;

  expected_prefix := caller::text || '/' || p_source_key || '/';
  if exists (
    select 1
      from unnest(normalised_paths) as paths(path)
     where left(path, length(expected_prefix)) <> expected_prefix
        or path ~ '(^|/)[.]{1,2}(/|$)'
  ) then
    raise exception 'A TTS export manifest contains a path outside its owner and source.'
      using errcode = '42501';
  end if;

  select count(*)
    into existing_objects
    from storage.objects as object
   where object.bucket_id = 'tts-assets'
     and object.name = any(normalised_paths);
  if existing_objects <> cardinality(normalised_paths) then
    raise exception 'A TTS export manifest names an object that was not uploaded.'
      using errcode = '23503';
  end if;

  if p_published_set_id is not null and p_published_revision is not null then
    select published.*
      into matched_set
      from public.sets as published
     where published.id = p_published_set_id
       and published.owner_id = caller
       and published.local_id = p_source_key
       and published.revision = p_published_revision;

    if matched_set.id is not null then
      /* Re-exporting or publishing a newer revision retires the old manifest.
         Its files remain protected by the ordinary candidate grace period. */
      update public.tts_exports as export
         set retired_at = now()
       where export.published_set_id = matched_set.id
         and export.retired_at is null;
      retention_kind := 'published-current';
    end if;
  end if;

  insert into public.tts_exports (
    owner_id,
    source_key,
    published_set_id,
    published_revision,
    asset_paths,
    retired_at
  ) values (
    caller,
    p_source_key,
    case when retention_kind = 'published-current' then matched_set.id else null end,
    case when retention_kind = 'published-current' then matched_set.revision else null end,
    normalised_paths,
    case when retention_kind = 'published-current' then null else now() end
  );

  return query select retention_kind;
end;
$$;

revoke all on function public.register_tts_export(text, text[], uuid, integer)
  from public, anon, authenticated;
grant execute on function public.register_tts_export(text, text[], uuid, integer)
  to authenticated;

create or replace function public.retire_tts_export_on_revision_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.revision is distinct from old.revision then
    update public.tts_exports as export
       set retired_at = now()
     where export.published_set_id = old.id
       and export.retired_at is null;
  end if;
  return new;
end;
$$;

revoke all on function public.retire_tts_export_on_revision_change()
  from public, anon, authenticated;

drop trigger if exists sets_retire_tts_export_on_revision_change on public.sets;
create trigger sets_retire_tts_export_on_revision_change
  after update on public.sets
  for each row execute function public.retire_tts_export_on_revision_change();

create or replace function public.retire_tts_export_before_unpublish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tts_exports as export
     set retired_at = now()
   where export.published_set_id = old.id
     and export.retired_at is null;
  return old;
end;
$$;

revoke all on function public.retire_tts_export_before_unpublish()
  from public, anon, authenticated;

drop trigger if exists sets_retire_tts_export_before_unpublish on public.sets;
create trigger sets_retire_tts_export_before_unpublish
  before delete on public.sets
  for each row execute function public.retire_tts_export_before_unpublish();

create or replace function public.storage_cleanup_live_tts_assets()
returns table (name text)
language sql
security definer
set search_path = ''
stable
as $$
  select distinct path as name
    from public.tts_exports as export,
         unnest(export.asset_paths) as paths(path)
   where export.retired_at is null;
$$;

revoke all on function public.storage_cleanup_live_tts_assets()
  from public, anon, authenticated;

alter table public.storage_cleanup_candidates
  drop constraint if exists storage_cleanup_candidates_bucket_id_check;
alter table public.storage_cleanup_candidates
  add constraint storage_cleanup_candidates_bucket_id_check
  check (bucket_id in ('draft-assets', 'set-assets', 'tts-assets'));

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
           select 1 from public.set_drafts as draft
            where draft.owner_id::text = split_part(candidate.name, '/', 1)
              and draft.local_id::text = split_part(candidate.name, '/', 2)
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
          select 1 from public.set_drafts as draft
           where draft.owner_id::text = split_part(object.name, '/', 1)
             and draft.local_id::text = split_part(object.name, '/', 2)
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
        size_bytes = excluded.size_bytes;

  with due as (
    select candidate.bucket_id,
           candidate.name,
           candidate.size_bytes,
           candidate.first_observed_at,
           candidate.object_updated_at
      from public.storage_cleanup_candidates as candidate
     where candidate.first_observed_at <= now() - bounded_grace
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
           count(*) filter (where candidate.first_observed_at <= now() - bounded_grace) as due_count,
           coalesce(sum(candidate.size_bytes) filter (
             where candidate.first_observed_at <= now() - bounded_grace
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
         and candidate.first_observed_at <= now() - greatest(
           interval '30 days', least(requested_grace, interval '90 days')
         )
         and coalesce(object.updated_at, object.created_at) = expected_object_updated_at
         and (
           (candidate.bucket_id = 'draft-assets' and not exists (
              select 1 from public.set_drafts as draft
               where draft.owner_id::text = split_part(candidate.name, '/', 1)
                 and draft.local_id::text = split_part(candidate.name, '/', 2)
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
