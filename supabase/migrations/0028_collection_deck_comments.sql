/*
 * Private discussion attached to one deck in one collection.
 *
 * This is deliberately not `set_comments`: those are public conversation on
 * a set's own gallery page, while these notes belong to the team producing a
 * particular collection. The composite foreign key keeps the same published
 * deck's discussions separate when it belongs to more than one collection.
 *
 * Nothing here is granted to `anon`, and none of the public collection RPCs
 * project this table. That makes "never shown publicly" a database boundary,
 * rather than a promise made by whichever component happens to render it.
 */

create table if not exists public.collection_deck_comments (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null,
  set_id uuid not null,
  author_id uuid not null default auth.uid(),
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint collection_deck_comments_member_fkey
    foreign key (collection_id, set_id)
    references public.collection_members (collection_id, set_id)
    on delete cascade,
  constraint collection_deck_comments_author_id_fkey
    foreign key (author_id)
    references public.profiles (id)
    on delete cascade
);

create index if not exists collection_deck_comments_thread_idx
  on public.collection_deck_comments (collection_id, set_id, created_at, id);

drop trigger if exists collection_deck_comments_touch_updated_at
  on public.collection_deck_comments;
create trigger collection_deck_comments_touch_updated_at
  before update on public.collection_deck_comments
  for each row execute function public.touch_updated_at();

/*
 * May the current caller take part in this deck's discussion?
 *
 * `security definer` is required because an accepted invitee may discuss a
 * deck they do not own. A policy-side read of `collection_members` would be
 * filtered by that table's RLS and would therefore see no target row for that
 * perfectly legitimate collaborator.
 *
 * A collaborator is an organizer, the owner of any accepted deck, somebody
 * who accepted a directed invitation, or somebody who claimed a reusable
 * invitation link. Claims deliberately survive revoking the link: revocation
 * stops new entrants, while deleting a claim removes one existing person.
 * `is_collection_invitee` is not used because it also includes invitations
 * that are still open; being asked is not yet access to the team's notes.
 *
 * The target deck itself must still be accepted. Moving a membership to
 * `removed` therefore makes its thread inaccessible without destroying it;
 * reopening that same membership restores the existing project history.
 */
create or replace function public.can_access_collection_deck_comments(
  target_collection uuid,
  target_set uuid
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
      from public.collection_members target
      join public.collections c on c.id = target.collection_id
      where target.collection_id = target_collection
        and target.set_id = target_set
        and target.status = 'accepted'
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
        from public.collection_members own_member
        join public.sets own_set on own_set.id = own_member.set_id
        where own_member.collection_id = target_collection
          and own_member.status = 'accepted'
          and own_set.owner_id = auth.uid()
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

revoke all on function public.can_access_collection_deck_comments(uuid, uuid)
  from public, anon;
grant execute on function public.can_access_collection_deck_comments(uuid, uuid)
  to authenticated;

alter table public.collection_deck_comments enable row level security;

drop policy if exists collection_deck_comments_team_read
  on public.collection_deck_comments;
create policy collection_deck_comments_team_read
  on public.collection_deck_comments
  for select to authenticated
  using (
    public.can_access_collection_deck_comments(collection_id, set_id)
  );

drop policy if exists collection_deck_comments_team_insert
  on public.collection_deck_comments;
create policy collection_deck_comments_team_insert
  on public.collection_deck_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_access_collection_deck_comments(collection_id, set_id)
  );

/* A collaborator may revise only their own words, and only while they still
   have access to the thread. Association and authorship columns are absent
   from the update grant below, so an edit cannot move or reassign a comment. */
drop policy if exists collection_deck_comments_author_update
  on public.collection_deck_comments;
create policy collection_deck_comments_author_update
  on public.collection_deck_comments
  for update to authenticated
  using (
    author_id = auth.uid()
    and public.can_access_collection_deck_comments(collection_id, set_id)
  )
  with check (
    author_id = auth.uid()
    and public.can_access_collection_deck_comments(collection_id, set_id)
  );

/* A collaborator may delete only their own words. PostgreSQL also requires
   the row to remain visible through the SELECT policy, so leaving the team
   closes the thread completely instead of preserving a private back door. */
drop policy if exists collection_deck_comments_author_delete
  on public.collection_deck_comments;
create policy collection_deck_comments_author_delete
  on public.collection_deck_comments
  for delete to authenticated
  using (author_id = auth.uid());

revoke all on public.collection_deck_comments from public, anon, authenticated;
grant select, delete on public.collection_deck_comments to authenticated;
grant insert (collection_id, set_id, body)
  on public.collection_deck_comments to authenticated;
grant update (body)
  on public.collection_deck_comments to authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.collection_deck_comments', 'SELECT')
     or has_table_privilege('anon', 'public.collection_deck_comments', 'INSERT')
     or has_function_privilege(
       'anon',
       'public.can_access_collection_deck_comments(uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception 'Collection deck discussions are reachable by anon.';
  end if;

  if not has_table_privilege(
       'authenticated',
       'public.collection_deck_comments',
       'SELECT'
     )
     or not has_function_privilege(
       'authenticated',
       'public.can_access_collection_deck_comments(uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception 'Collection deck discussions are not reachable by collaborators.';
  end if;
end;
$$;
