-- Keep a small, path-free history of scheduled cleanup results for 90 days.

create table if not exists public.storage_cleanup_runs (
  id bigint generated always as identity primary key,
  recorded_at timestamptz not null default now(),
  generated_at timestamptz,
  status text not null check (status in ('completed', 'failed')),
  error_category text,
  mode text not null,
  dry_run boolean not null,
  grace_seconds bigint,
  run_limit integer,
  stale_markers_removed bigint not null default 0,
  attempted integer not null default 0,
  deleted integer not null default 0,
  skipped integer not null default 0,
  failed integer not null default 0,
  recheck_failed integer not null default 0,
  delete_failed integer not null default 0,
  forget_failed integer not null default 0,
  buckets jsonb not null default '[]'::jsonb,
  constraint storage_cleanup_runs_buckets_array
    check (jsonb_typeof(buckets) = 'array')
);

alter table public.storage_cleanup_runs enable row level security;
revoke all on table public.storage_cleanup_runs from public, anon, authenticated;
revoke all on sequence public.storage_cleanup_runs_id_seq from public, anon, authenticated;

create index if not exists storage_cleanup_runs_recorded_at_idx
  on public.storage_cleanup_runs (recorded_at desc);

create or replace function public.storage_cleanup_record_run(run_report jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_status text := case
    when run_report ->> 'status' in ('completed', 'failed') then run_report ->> 'status'
    else 'failed'
  end;
  report_buckets jsonb := case
    when jsonb_typeof(run_report -> 'buckets') = 'array' then run_report -> 'buckets'
    else '[]'::jsonb
  end;
begin
  if auth.role() <> 'service_role' then
    raise exception 'storage cleanup reporting is restricted to the service role';
  end if;

  delete from public.storage_cleanup_runs
   where recorded_at < now() - interval '90 days';

  insert into public.storage_cleanup_runs (
    generated_at, status, error_category, mode, dry_run, grace_seconds,
    run_limit, stale_markers_removed, attempted, deleted, skipped, failed,
    recheck_failed, delete_failed, forget_failed, buckets
  ) values (
    nullif(run_report ->> 'generatedAt', '')::timestamptz,
    report_status,
    nullif(left(run_report ->> 'errorCategory', 80), ''),
    coalesce(nullif(left(run_report ->> 'mode', 40), ''), 'standard'),
    coalesce((run_report ->> 'dryRun')::boolean, true),
    nullif(run_report ->> 'graceSeconds', '')::bigint,
    nullif(run_report ->> 'limit', '')::integer,
    coalesce((run_report ->> 'staleMarkersRemoved')::bigint, 0),
    coalesce((run_report ->> 'attempted')::integer, 0),
    coalesce((run_report ->> 'deleted')::integer, 0),
    coalesce((run_report ->> 'skipped')::integer, 0),
    coalesce((run_report ->> 'failed')::integer, 0),
    coalesce((run_report ->> 'recheckFailed')::integer, 0),
    coalesce((run_report ->> 'deleteFailed')::integer, 0),
    coalesce((run_report ->> 'forgetFailed')::integer, 0),
    report_buckets
  );
end;
$$;

revoke all on function public.storage_cleanup_record_run(jsonb)
  from public, anon, authenticated;
grant execute on function public.storage_cleanup_record_run(jsonb)
  to service_role;

comment on table public.storage_cleanup_runs is
  'Path-free aggregate reports from guarded Storage cleanup runs; retained for 90 days.';
