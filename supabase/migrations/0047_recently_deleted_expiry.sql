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
  bounded_limit integer := greatest(1, least(coalesce(requested_limit, 100), 500));
  purged_count bigint := 0;
  queued_object_count bigint := 0;
  affected_objects bigint := 0;
  expired record;
begin
  for expired in
    select draft.id,
           draft.owner_id,
           draft.local_id,
           draft.deleted_at
      from public.set_drafts as draft
     where draft.deleted_at <= now() - interval '30 days'
     order by draft.deleted_at, draft.id
     limit bounded_limit
       for update skip locked
  loop
    delete from public.set_drafts as draft
     where draft.id = expired.id
       and draft.deleted_at = expired.deleted_at
       and draft.deleted_at <= now() - interval '30 days';

    if not found then
      continue;
    end if;

    purged_count := purged_count + 1;

    -- Migration 0036's delete trigger queues document-referenced objects as
    -- superseded at `now()`. Re-upsert the whole draft prefix afterwards so
    -- every private object inherits the already-elapsed deletion window.
    insert into public.storage_cleanup_candidates (
      bucket_id,
      name,
      first_observed_at,
      last_observed_at,
      object_updated_at,
      size_bytes,
      superseded
    )
    select object.bucket_id,
           object.name,
           expired.deleted_at,
           now(),
           coalesce(object.updated_at, object.created_at, now()),
           coalesce((object.metadata ->> 'size')::bigint, 0),
           true
      from storage.objects as object
     where object.bucket_id = 'draft-assets'
       and split_part(object.name, '/', 1) = expired.owner_id::text
       and split_part(object.name, '/', 2) = expired.local_id
    on conflict (bucket_id, name) do update
      set first_observed_at = least(
            public.storage_cleanup_candidates.first_observed_at,
            excluded.first_observed_at
          ),
          last_observed_at = now(),
          object_updated_at = excluded.object_updated_at,
          size_bytes = excluded.size_bytes,
          superseded = true;

    get diagnostics affected_objects = row_count;
    queued_object_count := queued_object_count + affected_objects;
  end loop;

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
   where jobname in ('set-draft-expiry-hourly', 'set-draft-expiry-daily');

  perform cron.schedule(
    'set-draft-expiry-daily',
    '10 6 * * *',
    $command$
      select public.purge_expired_set_drafts(100);
    $command$
  );
end;
$$;
