-- Shorten the safety period for temporary Tabletop Simulator exports to seven days.
--
-- A temporary export is anything without the one retained manifest for the
-- latest published revision: an author iterating from their own editor, a
-- gallery visitor exporting someone else's set, a scoped or pruned export, and
-- a collection box. Those were the bulk of `tts-assets` under the general
-- 30-day period, and re-exporting after every edit mints new content-hashed
-- files, so the backlog tracked editing activity rather than anything anyone
-- still used. Someone testing uses their newest export; a published set's
-- current revision keeps its retained manifest and is never a candidate.
--
-- Draft and gallery assets keep the requested (30-90 day) grace, and replaced
-- committed revisions keep 0036's three days. Seven days is fixed here rather
-- than taken from the request, because the Edge Function's request floor is
-- the general 30 days.
--
-- The seven days run from the latest export that named a file, not the first.
-- Re-exporting an unchanged set reuses its objects without rewriting them, so
-- nothing else would reset their observation: a save made on day six would
-- point at files deleted on day seven. Registering any manifest therefore
-- clears its paths' candidate rows, and the next scan observes them afresh.
-- Clearing a row mid-run is safe: the deletion-time recheck demands the exact
-- `first_observed_at` it planned against, so it simply declines.

create or replace function public.reset_tts_export_candidates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.storage_cleanup_candidates as candidate
   where candidate.bucket_id = 'tts-assets'
     and candidate.name = any(new.asset_paths);
  return null;
end;
$$;

revoke all on function public.reset_tts_export_candidates()
  from public, anon, authenticated;

drop trigger if exists tts_exports_reset_candidates on public.tts_exports;
create trigger tts_exports_reset_candidates
  after insert on public.tts_exports
  for each row execute function public.reset_tts_export_candidates();

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
  temporary_tts_grace constant interval := interval '7 days';
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
          and candidate.first_observed_at <= now() - case
            when candidate.bucket_id = 'tts-assets' then temporary_tts_grace
            else bounded_grace
          end
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
               and candidate.first_observed_at <= now() - case
                 when candidate.bucket_id = 'tts-assets' then temporary_tts_grace
                 else bounded_grace
               end
             )
           ) as due_count,
           coalesce(sum(candidate.size_bytes) filter (
             where (
               candidate.superseded
               and candidate.first_observed_at <= now() - interval '3 days'
             ) or (
               not candidate.superseded
               and candidate.first_observed_at <= now() - case
                 when candidate.bucket_id = 'tts-assets' then temporary_tts_grace
                 else bounded_grace
               end
             )
           ), 0) as due_bytes
      from public.storage_cleanup_candidates as candidate
     group by candidate.bucket_id
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'graceSeconds', extract(epoch from bounded_grace)::bigint,
    'temporaryTtsGraceSeconds', extract(epoch from temporary_tts_grace)::bigint,
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
             and candidate.first_observed_at <= now() - case
               when candidate.bucket_id = 'tts-assets' then interval '7 days'
               else greatest(interval '30 days', least(requested_grace, interval '90 days'))
             end
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
