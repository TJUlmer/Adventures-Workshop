-- Recently Deleted promised a 30-day recovery window, but set_drafts only
-- recorded deleted_at; no server process ever removed an expired row. Queue
-- its private objects at the original deletion time so the existing guarded
-- Storage cleanup can remove them on its next run without adding another
-- 30-day orphan wait.

create or replace function public.purge_expired_set_drafts(
  requested_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  bounded_limit integer := greatest(1, least(requested_limit, 500));
  purged_count bigint := 0;
  queued_object_count bigint := 0;
begin
  with expired as materialized (
    select draft.id,
           draft.owner_id,
           draft.local_id,
           draft.deleted_at
      from public.set_drafts as draft
     where draft.deleted_at <= now() - interval '30 days'
     order by draft.deleted_at, draft.id
     limit bounded_limit
  ), queued as (
    insert into public.storage_cleanup_candidates (
      bucket_id,
      name,
      first_observed_at,
      last_observed_at,
      object_updated_at,
      size_bytes
    )
    select object.bucket_id,
           object.name,
           expired.deleted_at,
           now(),
           coalesce(object.updated_at, object.created_at, now()),
           coalesce((object.metadata ->> 'size')::bigint, 0)
      from expired
      join storage.objects as object
        on object.bucket_id = 'draft-assets'
       and split_part(object.name, '/', 1) = expired.owner_id::text
       and split_part(object.name, '/', 2) = expired.local_id
    on conflict (bucket_id, name) do update
      set first_observed_at = least(
            public.storage_cleanup_candidates.first_observed_at,
            excluded.first_observed_at
          ),
          last_observed_at = now(),
          object_updated_at = excluded.object_updated_at,
          size_bytes = excluded.size_bytes
    returning 1
  ), removed as (
    delete from public.set_drafts as draft
      using expired
     where draft.id = expired.id
       and draft.deleted_at = expired.deleted_at
       and draft.deleted_at <= now() - interval '30 days'
    returning 1
  )
  select (select count(*) from removed),
         (select count(*) from queued)
    into purged_count, queued_object_count;

  return jsonb_build_object(
    'purgedDrafts', purged_count,
    'queuedObjects', queued_object_count,
    'retentionDays', 30,
    'limit', bounded_limit,
    'completedAt', now()
  );
end;
$$;

revoke all on function public.purge_expired_set_drafts(integer)
  from public, anon, authenticated, service_role;

comment on function public.purge_expired_set_drafts(integer) is
  'Permanently removes up to the requested number of drafts deleted at least 30 days ago and queues their private assets for guarded cleanup.';

do $$
begin
  perform cron.unschedule(jobid)
    from cron.job
   where jobname = 'set-draft-expiry-hourly';

  perform cron.schedule(
    'set-draft-expiry-hourly',
    '10 * * * *',
    $command$
      select public.purge_expired_set_drafts(100);
    $command$
  );
end;
$$;
