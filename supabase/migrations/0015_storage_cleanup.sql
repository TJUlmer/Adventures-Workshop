-- Reference-aware storage cleanup. This migration only creates the planner and
-- candidate ledger; it never deletes a Storage object.

create table public.storage_cleanup_candidates (
  bucket_id text not null check (bucket_id in ('draft-assets', 'set-assets')),
  name text not null,
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  object_updated_at timestamptz not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  primary key (bucket_id, name)
);

alter table public.storage_cleanup_candidates enable row level security;
revoke all on table public.storage_cleanup_candidates from anon, authenticated;

comment on table public.storage_cleanup_candidates is
  'Orphan observations used by the dry-run-first Storage cleanup. Rows are not deletion authorisation by themselves.';

create or replace function public.storage_cleanup_live_set_assets()
returns table (name text)
language sql
security definer
set search_path = ''
stable
as $$
  with source_rows as (
    select to_jsonb(s) as payload
      from public.sets as s
    union all
    select to_jsonb(c) as payload
      from public.set_contributions as c
  ), strings as (
    select jsonb_path_query(
      source_rows.payload,
      'lax $.** ? (@.type() == "string")'
    ) #>> '{}' as value
      from source_rows
  )
  select distinct regexp_replace(
    strings.value,
    '^.*?/storage/v1/object/public/set-assets/([^?#]+).*$','\1'
  ) as name
    from strings
   where strings.value ~ '/storage/v1/object/public/set-assets/[^?#]+';
$$;

revoke all on function public.storage_cleanup_live_set_assets() from public, anon, authenticated;

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

  -- A candidate disappears when its object is gone or it becomes referenced again.
  delete from public.storage_cleanup_candidates as candidate
   where not exists (
           select 1
             from storage.objects as object
            where object.bucket_id = candidate.bucket_id
              and object.name = candidate.name
         )
      or (
        candidate.bucket_id = 'draft-assets'
        and exists (
          select 1
            from public.set_drafts as draft
           where draft.owner_id::text = split_part(candidate.name, '/', 1)
             and draft.local_id::text = split_part(candidate.name, '/', 2)
        )
      )
      or (
        candidate.bucket_id = 'set-assets'
        and exists (
          select 1
            from public.storage_cleanup_live_set_assets() as live
           where live.name = candidate.name
        )
      );
  get diagnostics removed_count = row_count;

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
         now(),
         now(),
         coalesce(object.updated_at, object.created_at, now()),
         coalesce((object.metadata ->> 'size')::bigint, 0)
    from storage.objects as object
   where object.bucket_id in ('draft-assets', 'set-assets')
     and (
       (
         object.bucket_id = 'draft-assets'
         and not exists (
           select 1
             from public.set_drafts as draft
            where draft.owner_id::text = split_part(object.name, '/', 1)
              and draft.local_id::text = split_part(object.name, '/', 2)
         )
       )
       or (
         object.bucket_id = 'set-assets'
         and not exists (
           select 1
             from public.storage_cleanup_live_set_assets() as live
            where live.name = object.name
         )
       )
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
     where object.bucket_id in ('draft-assets', 'set-assets')
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

revoke all on function public.storage_cleanup_plan(interval, integer) from public, anon, authenticated;
grant execute on function public.storage_cleanup_plan(interval, integer) to service_role;

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
          on object.bucket_id = candidate.bucket_id
         and object.name = candidate.name
       where candidate.bucket_id = requested_bucket_id
         and candidate.name = requested_name
         and candidate.first_observed_at = expected_first_observed_at
         and candidate.object_updated_at = expected_object_updated_at
         and candidate.first_observed_at <= now() - greatest(
           interval '30 days',
           least(requested_grace, interval '90 days')
         )
         and coalesce(object.updated_at, object.created_at) = expected_object_updated_at
         and (
           (
             candidate.bucket_id = 'draft-assets'
             and not exists (
               select 1
                 from public.set_drafts as draft
                where draft.owner_id::text = split_part(candidate.name, '/', 1)
                  and draft.local_id::text = split_part(candidate.name, '/', 2)
             )
           )
           or (
             candidate.bucket_id = 'set-assets'
             and not exists (
               select 1
                 from public.storage_cleanup_live_set_assets() as live
                where live.name = candidate.name
             )
           )
         )
    )
  end;
$$;

revoke all on function public.storage_cleanup_candidate_is_due(text, text, timestamptz, timestamptz, interval) from public, anon, authenticated;
grant execute on function public.storage_cleanup_candidate_is_due(text, text, timestamptz, timestamptz, interval) to service_role;

create or replace function public.storage_cleanup_forget(
  requested_bucket_id text,
  requested_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'storage cleanup is restricted to the service role';
  end if;

  delete from public.storage_cleanup_candidates
   where bucket_id = requested_bucket_id
     and name = requested_name;
end;
$$;

revoke all on function public.storage_cleanup_forget(text, text) from public, anon, authenticated;
grant execute on function public.storage_cleanup_forget(text, text) to service_role;

do $$
begin
  if has_table_privilege('anon', 'public.storage_cleanup_candidates', 'select')
     or has_table_privilege('authenticated', 'public.storage_cleanup_candidates', 'select') then
    raise exception 'storage cleanup candidate ledger must not be readable by clients';
  end if;
end;
$$;
