-- One shared, permanent Tabletop Simulator copy per published revision.
--
-- A gallery set's TTS save must keep working for as long as it is the latest
-- revision, for everyone who exported it, not only for its author. Keeping
-- each visitor's own export would store a popular set once per person, and
-- could never be shared anyway: every browser renders slightly different
-- bytes, so their content-hashed files never coincide. So the copy made at
-- publish (or by an administrator's backfill) is *the* copy. Its saved-object
-- JSON is hosted beside its images and recorded as `save_path`, and a visitor
-- exporting that whole revision downloads that JSON instead of rendering and
-- uploading their own.
--
-- Only the owner or an administrator may register it. A visitor's upload
-- cannot be trusted for everyone: whatever the first registrant uploaded is
-- what every later visitor would receive.
--
-- The first shared copy registered for a revision is never replaced while
-- that revision is current. Replacing it would retire files that earlier
-- visitors' saves already point at, breaking the latest revision for them;
-- a new revision or an unpublish is what retires it (0032's triggers). A
-- manifest without a `save_path` (registered before this migration) is not a
-- shared copy and may be replaced by one.
--
-- Every `tts-assets` cleanup candidate is now due after seven days, including
-- files of a replaced revision (formerly 0036's three days), so a save of an
-- older revision has a week to be re-exported. Draft and gallery assets are
-- unchanged.

alter table public.tts_exports
  add column if not exists save_path text;

alter table public.tts_exports
  drop constraint if exists tts_exports_save_path_in_manifest;
alter table public.tts_exports
  add constraint tts_exports_save_path_in_manifest
  check (save_path is null or save_path = any(asset_paths));

drop function if exists public.register_tts_export(text, text[], uuid, integer);

create or replace function public.register_tts_export(
  p_source_key text,
  p_asset_paths text[],
  p_published_set_id uuid default null,
  p_published_revision integer default null,
  p_save_path text default null
)
returns table (retention text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  caller_is_admin boolean;
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
  if p_save_path is not null and not (p_save_path = any(normalised_paths)) then
    raise exception 'A TTS export save must be one of its own assets.' using errcode = '22023';
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

  select exists (
    select 1 from public.profiles as profile where profile.id = caller and profile.is_admin
  ) into caller_is_admin;

  /* A shared copy needs its save, or nobody else can be handed it. */
  if p_published_set_id is not null and p_published_revision is not null
     and p_save_path is not null then
    select published.*
      into matched_set
      from public.sets as published
     where published.id = p_published_set_id
       and (published.owner_id = caller or caller_is_admin)
       and published.local_id = p_source_key
       and published.revision = p_published_revision;

    if matched_set.id is not null and not exists (
      select 1
        from public.tts_exports as export
       where export.published_set_id = matched_set.id
         and export.retired_at is null
         and export.published_revision = matched_set.revision
         and export.save_path is not null
    ) then
      /* Only an older revision's leftover, or a pre-0043 manifest with no
         save, can be here; 0032's revision trigger normally retired the
         former already. Its files receive the ordinary candidate period. */
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
    save_path,
    retired_at
  ) values (
    caller,
    p_source_key,
    case when retention_kind = 'published-current' then matched_set.id else null end,
    case when retention_kind = 'published-current' then matched_set.revision else null end,
    normalised_paths,
    p_save_path,
    case when retention_kind = 'published-current' then null else now() end
  );

  return query select retention_kind;
end;
$$;

revoke all on function public.register_tts_export(text, text[], uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.register_tts_export(text, text[], uuid, integer, text)
  to authenticated;

/*
 * The shared save for a published row's current revision, for anyone who can
 * already open that row by its link. Answers a path rather than a URL so the
 * database never needs to know the project's public address.
 */
create or replace function public.published_tts_save(p_set_id uuid)
returns table (save_path text, revision integer)
language sql
security definer
set search_path = ''
stable
as $$
  select export.save_path, published.revision
    from public.tts_exports as export
    join public.sets as published on published.id = export.published_set_id
   where export.published_set_id = p_set_id
     and export.retired_at is null
     and export.save_path is not null
     and export.published_revision = published.revision
     and published.visibility in ('unlisted', 'public')
     and not published.hidden
   limit 1;
$$;

revoke all on function public.published_tts_save(uuid) from public;
grant execute on function public.published_tts_save(uuid) to anon, authenticated;

/* The administrator backfill's queue: visible rows with no shared copy yet. */
create or replace function public.published_sets_missing_tts_save()
returns table (id uuid, name text, scope text, visibility text, revision integer)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not exists (
    select 1 from public.profiles as profile where profile.id = auth.uid() and profile.is_admin
  ) then
    raise exception 'Only an administrator can list missing TTS copies.' using errcode = '42501';
  end if;

  return query
    select published.id, published.name, published.scope, published.visibility, published.revision
      from public.sets as published
     where published.visibility in ('unlisted', 'public')
       and not published.hidden
       and not exists (
         select 1
           from public.tts_exports as export
          where export.published_set_id = published.id
            and export.retired_at is null
            and export.published_revision = published.revision
            and export.save_path is not null
       )
     order by published.created_at;
end;
$$;

revoke all on function public.published_sets_missing_tts_save() from public, anon;
grant execute on function public.published_sets_missing_tts_save() to authenticated;

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
  tts_grace constant interval := interval '7 days';
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

  with graced as (
    select candidate.*,
           candidate.first_observed_at <= now() - case
             when candidate.bucket_id = 'tts-assets' then tts_grace
             when candidate.superseded then interval '3 days'
             else bounded_grace
           end as is_due
      from public.storage_cleanup_candidates as candidate
  ), due as (
    select graced.bucket_id,
           graced.name,
           graced.size_bytes,
           graced.first_observed_at,
           graced.object_updated_at
      from graced
     where graced.is_due
     order by graced.first_observed_at, graced.bucket_id, graced.name
     limit bounded_limit
  ), bucket_totals as (
    select object.bucket_id,
           count(*) as object_count,
           coalesce(sum((object.metadata ->> 'size')::bigint), 0) as total_bytes
      from storage.objects as object
     where object.bucket_id in ('draft-assets', 'set-assets', 'tts-assets')
     group by object.bucket_id
  ), candidate_totals as (
    select graced.bucket_id,
           count(*) as candidate_count,
           coalesce(sum(graced.size_bytes), 0) as candidate_bytes,
           count(*) filter (where graced.is_due) as due_count,
           coalesce(sum(graced.size_bytes) filter (where graced.is_due), 0) as due_bytes
      from graced
     group by graced.bucket_id
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'graceSeconds', extract(epoch from bounded_grace)::bigint,
    'ttsGraceSeconds', extract(epoch from tts_grace)::bigint,
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
         and candidate.first_observed_at <= now() - case
           when candidate.bucket_id = 'tts-assets' then interval '7 days'
           when candidate.superseded then interval '3 days'
           else greatest(interval '30 days', least(requested_grace, interval '90 days'))
         end
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
