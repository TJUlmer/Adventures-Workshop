-- New popularity measurements stay private until there is enough activity to
-- publish them. Never put these counts on sets or a public gallery view.

create table if not exists public.gallery_activity_daily (
  owner_id uuid not null references auth.users (id) on delete cascade,
  local_id text not null,
  activity_day date not null,
  target_key text not null,
  activity_kind text not null check (activity_kind in ('view', 'export')),
  scope_key text not null check (scope_key in ('all', 'full', 'hero', 'villain', 'custom')),
  format_key text not null check (format_key in ('all', 'png', 'tts', 'project')),
  total bigint not null default 0 check (total >= 0),
  primary key (owner_id, local_id, activity_day, target_key, activity_kind, scope_key, format_key)
);

-- Short-lived deduplication receipts, not a browsing history: the client key
-- changes daily, and only its day-scoped hash is stored. Aggregates survive
-- receipt cleanup, so month/year/all-time queries never need visitor records.
create table if not exists public.gallery_activity_receipts (
  owner_id uuid not null references auth.users (id) on delete cascade,
  local_id text not null,
  activity_day date not null,
  target_key text not null,
  activity_kind text not null,
  scope_key text not null,
  format_key text not null,
  visitor_hash text not null,
  primary key (owner_id, local_id, activity_day, target_key, activity_kind, scope_key, format_key, visitor_hash)
);

alter table public.gallery_activity_daily enable row level security;
alter table public.gallery_activity_receipts enable row level security;
revoke all on public.gallery_activity_daily, public.gallery_activity_receipts
  from public, anon, authenticated;
grant all on public.gallery_activity_daily, public.gallery_activity_receipts to service_role;
grant select on public.gallery_activity_daily to authenticated;

drop policy if exists gallery_activity_admin_read on public.gallery_activity_daily;
create policy gallery_activity_admin_read on public.gallery_activity_daily
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

create index if not exists gallery_activity_daily_day_idx
  on public.gallery_activity_daily (activity_day);
create index if not exists gallery_activity_receipts_day_idx
  on public.gallery_activity_receipts (activity_day);

create or replace function public.record_gallery_activity(
  share_slug text,
  visitor_key uuid,
  activity text,
  character_key text default null,
  output_format text default null,
  output_scope text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source public.sets%rowtype;
  metric_day date := (statement_timestamp() at time zone 'UTC')::date;
  receipt_hash text;
  target text;
  targets text[] := array['set'];
  measured_scope text;
  measured_character text;
  dimension record;
  inserted integer;
begin
  if visitor_key is null or activity not in ('view', 'export') or activity is null then return; end if;
  if activity = 'export' and (
    output_format is null or output_format not in ('png', 'tts', 'project') or
    output_scope is null or output_scope not in ('full', 'hero', 'villain', 'custom')
  ) then return; end if;

  select * into source from public.sets s
   where s.slug = share_slug and s.visibility = 'public' and not s.hidden;
  if not found or source.owner_id = auth.uid() then return; end if;

  -- Identity is the author's original set, not its publication row. Opening
  -- separately published characters and their parent must not multiply totals.
  measured_scope := case
    when output_scope = 'custom' then 'custom'
    when source.scope in ('hero', 'villain') then source.scope
    else output_scope
  end;
  measured_character := coalesce(nullif(character_key, ''),
    case when source.scope = 'hero' then nullif(source.character_id, '') end);
  if measured_character is not null then
    if not exists (
      select 1 from public.set_characters sc
       where sc.set_id = source.id and sc.character_id = measured_character
    ) then return; end if;
    targets := array_append(targets, 'character:' || measured_character);
  end if;
  if source.scope = 'villain' or output_scope = 'villain' then
    targets := array_append(targets, 'villain-side');
  end if;
  receipt_hash := md5(metric_day::text || ':' || visitor_key::text);

  -- Restrict pruning to old receipts: current-day deduplication is atomic and
  -- safe even when several tabs submit the same activity simultaneously.
  delete from public.gallery_activity_receipts where activity_day < metric_day - 2;

  foreach target in array targets loop
    for dimension in
      select distinct dims.scope_key, dims.format_key
      from (values
        ('all'::text, 'all'::text),
        (case when activity = 'export' then measured_scope else 'all' end,
         case when activity = 'export' then output_format else 'all' end),
        ('all', case when activity = 'export' then output_format else 'all' end),
        (case when activity = 'export' then measured_scope else 'all' end, 'all')
      ) as dims(scope_key, format_key)
      order by dims.scope_key, dims.format_key
    loop
      insert into public.gallery_activity_receipts (
        owner_id, local_id, activity_day, target_key, activity_kind, scope_key, format_key, visitor_hash
      ) values (
        source.owner_id, source.local_id, metric_day, target, activity,
        dimension.scope_key, dimension.format_key, receipt_hash
      ) on conflict do nothing;
      get diagnostics inserted = row_count;
      if inserted = 1 then
        insert into public.gallery_activity_daily (
          owner_id, local_id, activity_day, target_key, activity_kind, scope_key, format_key, total
        ) values (
          source.owner_id, source.local_id, metric_day, target, activity,
          dimension.scope_key, dimension.format_key, 1
        ) on conflict (owner_id, local_id, activity_day, target_key, activity_kind, scope_key, format_key)
        do update set total = public.gallery_activity_daily.total + 1;
      end if;
    end loop;
  end loop;
end;
$$;

revoke all on function public.record_gallery_activity(text, uuid, text, text, text, text) from public;
grant execute on function public.record_gallery_activity(text, uuid, text, text, text, text) to anon, authenticated;

-- Legacy clients must not resume maintaining a publicly readable counter.
create or replace function public.record_set_view(share_slug text)
returns void language plpgsql set search_path = '' as $$ begin return; end; $$;
revoke all on function public.record_set_view(text) from public;
grant execute on function public.record_set_view(text) to anon, authenticated;

comment on table public.gallery_activity_daily is
  'Private UTC daily counts of distinct browser-days. Admin reads only. Use scope_key=all and format_key=all for totals; breakdowns overlap and must not be summed together.';
comment on table public.gallery_activity_receipts is
  'Private day-scoped deduplication hashes; receipts older than two days are pruned on the next valid event. No account, IP address or user-agent is recorded for the visitor.';
