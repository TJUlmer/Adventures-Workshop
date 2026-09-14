/*
 * The private collection working room.
 *
 * A collection now begins as a project, not as a share link. Its public RPCs
 * still expose unlisted/public pages exactly as before, while an authenticated
 * collaborator may use the same lightweight tile and character projections
 * to preview a private collection. The two audiences are separated inside the
 * security-definer functions, so a caller cannot turn a normal table query
 * into a directory of private projects.
 *
 * This migration follows `0028_collection_deck_comments.sql`: its access
 * helper is also the definition of a collaborator used below.
 */

-- New projects are genuinely private until an organizer chooses otherwise.
alter table public.collections
  alter column visibility set default 'private';

/* A declined or removed deck is historical context, not continuing access to
   a private project. Person-level invitations have their own read policy and
   remain the deliberate way to keep somebody on the team without a deck. */
drop policy if exists collections_member_read on public.collections;
create policy collections_member_read on public.collections
  for select to authenticated
  using (
    exists (
      select 1
      from public.collection_members m
      join public.sets s on s.id = m.set_id
      where m.collection_id = collections.id
        and m.status in ('invited', 'submitted', 'accepted')
        and s.owner_id = auth.uid()
    )
  );

/*
 * "Ready" is an assertion about one publication, not the local draft forever.
 * The revision is server-stamped when the owner marks the deck ready and is
 * deliberately absent from the client's update grant.
 */
alter table public.collection_members
  add column if not exists ready_revision integer;

-- Preserve honest existing readiness when introducing the revision stamp.
update public.collection_members m
   set ready = false,
       ready_revision = null
 where m.status <> 'accepted'
   and (m.ready or m.ready_revision is not null);

update public.collection_members m
   set ready_revision = s.revision
  from public.sets s
 where m.set_id = s.id
   and m.status = 'accepted'
   and m.ready
   and m.ready_revision is null;

create or replace function public.guard_collection_member_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  published_revision integer;
  caller_id uuid := auth.uid();
  caller_owns boolean := false;
  caller_organizes boolean := false;
begin
  /* Policies constrain the resulting status, but cannot compare it with OLD.
     Without this transition guard an owner can turn their own submission into
     accepted, or an organizer can accept a deck they only invited — either
     skips the other party's decision and would also grant private-comment
     access. */
  if caller_id is not null then
    caller_owns := public.owns_set(old.set_id, caller_id);
    caller_organizes := public.is_collection_organizer(old.collection_id, caller_id);

    if new.status is distinct from old.status
       and not (
         (old.status = 'invited'
           and new.status in ('accepted', 'declined')
           and caller_owns)
         or (old.status = 'invited'
           and new.status = 'removed'
           and caller_organizes)
         or (old.status = 'submitted'
           and new.status in ('accepted', 'declined')
           and caller_organizes)
         or (old.status = 'submitted'
           and new.status = 'removed'
           and caller_owns)
         or (old.status = 'accepted'
           and new.status = 'removed'
           and (caller_owns or caller_organizes))
         or (old.status in ('declined', 'removed')
           and new.status = 'submitted'
           and caller_owns
           and public.collection_accepts_submissions(old.collection_id))
         or (old.status in ('declined', 'removed')
           and new.status = 'invited'
           and caller_organizes)
         or (old.status in ('declined', 'removed')
           and new.status = 'accepted'
           and caller_owns
           and caller_organizes)
       ) then
      raise exception 'that membership decision is no longer available';
    end if;

    if new.ready is distinct from old.ready
       and not caller_owns then
      raise exception 'only the deck''s own author may mark it ready';
    end if;

    if new.sort_order is distinct from old.sort_order
       and not caller_organizes then
      raise exception 'only an organizer may reorder a collection';
    end if;
  end if;

  /* `ready_revision` is managed here. The column grant already excludes it;
     keeping this check outside the JWT branch protects maintenance writes too. */
  if new.ready_revision is distinct from old.ready_revision
     and new.ready is not distinct from old.ready then
    raise exception 'ready revision is managed by the database';
  end if;

  /* Leaving and rejoining requires a fresh readiness decision. */
  if new.status <> 'accepted' then
    new.ready := false;
    new.ready_revision := null;
  elsif new.ready is distinct from old.ready then
    if new.ready then
      select s.revision into published_revision
        from public.sets s
       where s.id = new.set_id;

      if published_revision is null then
        raise exception 'the published deck no longer exists';
      end if;
      new.ready_revision := published_revision;
    else
      new.ready_revision := null;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_collection_member_fields()
  from public, anon, authenticated;

/*
 * Republishing invalidates every collection-level readiness claim for that
 * set. The membership rows remain accepted and in place; only their author
 * must review the new revision and mark it ready again.
 */
create or replace function public.reset_collection_readiness_for_new_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.revision is distinct from old.revision then
    update public.collection_members
       set ready = false,
           ready_revision = null
     where set_id = new.id
       and (ready or ready_revision is not null);
  end if;
  return new;
end;
$$;

drop trigger if exists sets_reset_collection_readiness on public.sets;
create trigger sets_reset_collection_readiness
  after update of revision on public.sets
  for each row execute function public.reset_collection_readiness_for_new_revision();

revoke all on function public.reset_collection_readiness_for_new_revision()
  from public, anon, authenticated;

/*
 * A person-level invitation is still permission to offer a deck while the
 * collection is private. Open submissions remain link-facing and therefore
 * remain limited to unlisted/public collections; knowing a private UUID is
 * not an invitation.
 */
create or replace function public.collection_accepts_submissions(target uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.collections c
    where c.id = target
      and c.visibility in ('unlisted', 'public')
      and not c.hidden
      and c.open_submissions
  )
  or exists (
    select 1
    from public.collection_invites i
    join public.collections c on c.id = i.collection_id
    where i.collection_id = target
      and i.invited_user = auth.uid()
      and i.status = 'accepted'
      and not c.hidden
  )
  or exists (
    select 1
    from public.collection_invite_claims cl
    join public.collection_invites i on i.id = cl.invite_id
    join public.collections c on c.id = i.collection_id
    where i.collection_id = target
      and cl.user_id = auth.uid()
      and not c.hidden
  );
$$;

revoke all on function public.collection_accepts_submissions(uuid)
  from public, anon;
grant execute on function public.collection_accepts_submissions(uuid)
  to authenticated;

/* A recipient may answer only an invitation that is still open. The older
   policy constrained NEW.status but not OLD.status, so a named recipient could
   turn an organizer-revoked invitation back into accepted access. */
drop policy if exists invites_recipient_decide on public.collection_invites;
create policy invites_recipient_decide on public.collection_invites
  for update to authenticated
  using (
    invited_user = auth.uid()
    and status = 'open'
  )
  with check (
    invited_user = auth.uid()
    and status in ('accepted', 'declined')
  );

/*
 * The authenticated membership reader doubles as the workspace roster.
 * Owners and organizers retain their pending rows. Every collaborator may
 * additionally see accepted summaries, which is what lets the team navigate
 * all private discussion threads; nobody else sees another person's pending
 * invitation or submission.
 *
 * `target is not null` keeps Home's cross-project pending check small. The
 * no-target form still returns exactly the rows on which this caller may have
 * a decision waiting.
 */
drop function if exists public.collection_memberships(uuid);

create function public.collection_memberships(target uuid default null)
returns table (
  collection_id uuid,
  set_id uuid,
  status text,
  ready boolean,
  ready_revision integer,
  sort_order integer,
  invited_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  set_slug text,
  set_local_id text,
  set_name text,
  set_subtitle text,
  set_thumbnail_url text,
  set_owner_id uuid,
  set_visibility text,
  set_revision integer,
  author_name text,
  author_avatar text,
  collection_slug text,
  collection_name text,
  collection_subtitle text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    m.collection_id, m.set_id, m.status,
    coalesce(m.ready and m.ready_revision = s.revision, false),
    m.ready_revision, m.sort_order, m.invited_by,
    m.created_at, m.updated_at,
    s.slug, s.local_id, s.name, s.subtitle, s.thumbnail_url, s.owner_id,
    s.visibility, s.revision,
    coalesce(p.display_name, ''), coalesce(p.avatar_url, ''),
    c.slug, c.name, c.subtitle
  from public.collection_members m
  join public.collections c on c.id = m.collection_id
  join public.sets s on s.id = m.set_id
  left join public.profiles p on p.id = s.owner_id
  where auth.uid() is not null
    and (target is null or m.collection_id = target)
    and not c.hidden
    and (
      (
        target is null
        and (
          (s.owner_id = auth.uid() and m.status = 'invited')
          or (
            public.is_collection_organizer(m.collection_id, auth.uid())
            and m.status = 'submitted'
          )
        )
      )
      or (
        target is not null
        and (
          (
            s.owner_id = auth.uid()
            and m.status in ('invited', 'submitted', 'accepted')
          )
          or public.is_collection_organizer(m.collection_id, auth.uid())
          or (
            m.status = 'accepted'
            and public.can_access_collection_deck_comments(m.collection_id, m.set_id)
          )
        )
      )
    )
  order by m.status, m.sort_order, s.name;
$$;

revoke all on function public.collection_memberships(uuid)
  from public, anon;
grant execute on function public.collection_memberships(uuid)
  to authenticated;

/*
 * A share slug never returns audit ownership. Keeping this an explicit column
 * list also prevents future internal columns from silently becoming public
 * when `collections` grows.
 */
drop function if exists public.collection_by_slug(text);

create function public.collection_by_slug(share_slug text)
returns table (
  id uuid,
  slug text,
  name text,
  subtitle text,
  blurb text,
  banner_url text,
  visibility text,
  hidden boolean,
  open_submissions boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    c.id, c.slug, c.name, c.subtitle, c.blurb, c.banner_url,
    c.visibility, c.hidden, c.open_submissions, c.created_at, c.updated_at
  from public.collections c
  where c.slug = share_slug
    and c.visibility in ('unlisted', 'public')
    and not c.hidden
  limit 1;
$$;

revoke all on function public.collection_by_slug(text)
  from public, anon, authenticated;
grant execute on function public.collection_by_slug(text)
  to anon, authenticated;

/*
 * The presentation projections have two doors:
 *
 *   1. anonymous/uninvolved callers need a reachable share page; or
 *   2. an authenticated collaborator needs the private working preview.
 *
 * Member sets keep their own moderation and shareability checks. A collection
 * never turns a private or hidden set into a readable publication.
 */
create or replace function public.collection_members_by_slug(share_slug text)
returns table (
  set_id uuid,
  owner_id uuid,
  slug text,
  name text,
  subtitle text,
  thumbnail_url text,
  cover_url text,
  cover_bleeds boolean,
  card_count integer,
  character_count integer,
  hero_count integer,
  kind text,
  scope text,
  revision integer,
  author_name text,
  author_avatar text,
  preview_card_url text,
  sort_order integer,
  ready boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.id, s.owner_id, s.slug, s.name, s.subtitle,
    s.thumbnail_url, s.cover_url, s.cover_bleeds,
    s.card_count, s.character_count, s.hero_count, s.kind, s.scope, s.revision,
    coalesce(p.display_name, ''), coalesce(p.avatar_url, ''),
    coalesce((
      select sc.card_url
      from public.set_characters sc
      where sc.set_id = s.id
        and sc.role = 'hero'
        and sc.card_url <> ''
      order by sc.position
      limit 1
    ), ''),
    m.sort_order,
    coalesce(m.ready and m.ready_revision = s.revision, false)
  from public.collection_members m
  join public.collections c on c.id = m.collection_id
  join public.sets s on s.id = m.set_id
  left join public.profiles p on p.id = s.owner_id
  where c.slug = share_slug
    and not c.hidden
    and m.status = 'accepted'
    and s.visibility in ('unlisted', 'public')
    and not s.hidden
    and (
      c.visibility in ('unlisted', 'public')
      or public.can_access_collection_deck_comments(c.id, m.set_id)
    )
  order by m.sort_order, s.name;
$$;

revoke all on function public.collection_members_by_slug(text)
  from public, anon, authenticated;
grant execute on function public.collection_members_by_slug(text)
  to anon, authenticated;

create or replace function public.collection_characters_by_slug(share_slug text)
returns table (
  set_id uuid,
  set_slug text,
  set_name text,
  set_sort_order integer,
  owner_id uuid,
  author_name text,
  author_avatar text,
  character_id text,
  character_name text,
  character_role text,
  character_position integer,
  image_url text,
  image_bleeds boolean,
  card_url text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.id, s.slug, s.name, m.sort_order,
    s.owner_id, coalesce(p.display_name, ''), coalesce(p.avatar_url, ''),
    sc.character_id, sc.name, sc.role, sc.position,
    sc.image_url, sc.image_bleeds, sc.card_url
  from public.collection_members m
  join public.collections c on c.id = m.collection_id
  join public.sets s on s.id = m.set_id
  join public.set_characters sc on sc.set_id = s.id
  left join public.profiles p on p.id = s.owner_id
  where c.slug = share_slug
    and not c.hidden
    and m.status = 'accepted'
    and s.visibility in ('unlisted', 'public')
    and not s.hidden
    and (
      c.visibility in ('unlisted', 'public')
      or public.can_access_collection_deck_comments(c.id, m.set_id)
    )
  order by m.sort_order, s.name, sc.position, sc.name;
$$;

revoke all on function public.collection_characters_by_slug(text)
  from public, anon, authenticated;
grant execute on function public.collection_characters_by_slug(text)
  to anon, authenticated;

/* Membership removal is a status change. Direct DELETE was unused by the UI
   and cascaded through every collaborator's private comments, letting either
   party erase the whole discussion rather than merely unlinking the deck. */
revoke delete on public.collection_members from authenticated;

do $$
begin
  if has_column_privilege(
       'authenticated',
       'public.collection_members',
       'ready_revision',
       'UPDATE'
     ) then
    raise exception 'Clients may write the server-managed ready revision.';
  end if;

  if has_function_privilege(
       'anon',
       'public.collection_memberships(uuid)',
       'EXECUTE'
     ) then
    raise exception 'The private collection workspace is reachable by anon.';
  end if;

  if has_table_privilege(
       'authenticated',
       'public.collection_members',
       'DELETE'
     ) then
    raise exception 'Authenticated clients can hard-delete collection memberships.';
  end if;
end;
$$;
