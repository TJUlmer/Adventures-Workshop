/*
 * A private, organizer-managed timeline for the collection working room.
 *
 * Milestones are project coordination, not public presentation. Every person
 * who has actually joined the team may read them; only an organizer may
 * create, change, complete, or remove one. A person who merely received an
 * invitation but has not accepted it is deliberately not a collaborator yet.
 */

create table if not exists public.collection_milestones (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id) on delete cascade,
  title text not null,
  note text not null default '',
  target_date date not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint collection_milestones_title_length
    check (char_length(btrim(title)) between 1 and 120),
  constraint collection_milestones_note_length
    check (char_length(note) <= 400)
);

create index if not exists collection_milestones_project_date_idx
  on public.collection_milestones (collection_id, target_date, created_at);

drop trigger if exists collection_milestones_touch_updated_at
  on public.collection_milestones;
create trigger collection_milestones_touch_updated_at
  before update on public.collection_milestones
  for each row execute function public.touch_updated_at();

/*
 * Collection collaboration is person-level as well as deck-level. In
 * particular, reusable-link claimants and people who accepted a named invite
 * may belong to the working room before they publish a deck, so membership
 * rows alone are not an adequate access check.
 */
create or replace function public.can_access_collection_workspace(
  target_collection uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.collections c
      where c.id = target_collection
        and not c.hidden
    )
    and (
      exists (
        select 1
        from public.collection_organizers o
        where o.collection_id = target_collection
          and o.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.collection_members m
        join public.sets s on s.id = m.set_id
        where m.collection_id = target_collection
          and m.status = 'accepted'
          and s.owner_id = auth.uid()
      )
      or exists (
        select 1
        from public.collection_invites i
        where i.collection_id = target_collection
          and i.invited_user = auth.uid()
          and i.status = 'accepted'
      )
      or exists (
        select 1
        from public.collection_invite_claims claim
        join public.collection_invites i on i.id = claim.invite_id
        where i.collection_id = target_collection
          and claim.user_id = auth.uid()
      )
    );
$$;

revoke all on function public.can_access_collection_workspace(uuid)
  from public, anon;
grant execute on function public.can_access_collection_workspace(uuid)
  to authenticated;

alter table public.collection_milestones enable row level security;

drop policy if exists collection_milestones_team_read
  on public.collection_milestones;
create policy collection_milestones_team_read
  on public.collection_milestones
  for select to authenticated
  using (public.can_access_collection_workspace(collection_id));

drop policy if exists collection_milestones_organizer_insert
  on public.collection_milestones;
create policy collection_milestones_organizer_insert
  on public.collection_milestones
  for insert to authenticated
  with check (public.is_collection_organizer(collection_id, auth.uid()));

drop policy if exists collection_milestones_organizer_update
  on public.collection_milestones;
create policy collection_milestones_organizer_update
  on public.collection_milestones
  for update to authenticated
  using (public.is_collection_organizer(collection_id, auth.uid()))
  with check (public.is_collection_organizer(collection_id, auth.uid()));

drop policy if exists collection_milestones_organizer_delete
  on public.collection_milestones;
create policy collection_milestones_organizer_delete
  on public.collection_milestones
  for delete to authenticated
  using (public.is_collection_organizer(collection_id, auth.uid()));

revoke all on public.collection_milestones from anon, authenticated;
grant select on public.collection_milestones to authenticated;
grant insert (collection_id, title, note, target_date)
  on public.collection_milestones to authenticated;
grant update (title, note, target_date, completed_at)
  on public.collection_milestones to authenticated;
grant delete on public.collection_milestones to authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.collection_milestones', 'SELECT') then
    raise exception 'The private collection timeline is readable by anon.';
  end if;

  if has_function_privilege(
       'anon',
       'public.can_access_collection_workspace(uuid)',
       'EXECUTE'
     ) then
    raise exception 'The private collection workspace helper is callable by anon.';
  end if;
end;
$$;
