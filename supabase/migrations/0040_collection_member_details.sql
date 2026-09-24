/*
 * A creator's introduction and difficulty rating for one collection entry.
 *
 * These belong to the membership, not `sets`: one published deck may appear
 * in several collections, and each project may frame it differently. Only
 * the deck's owner may write them. Accepted rows project them onto the public
 * collection page; pending and removed rows remain workspace-only as before.
 */

alter table public.collection_members
  add column if not exists description text not null default '',
  add column if not exists difficulty_rating smallint;

alter table public.collection_members
  drop constraint if exists collection_members_description_length,
  add constraint collection_members_description_length
    check (char_length(description) <= 600),
  drop constraint if exists collection_members_difficulty_rating_range,
  add constraint collection_members_difficulty_rating_range
    check (difficulty_rating is null or difficulty_rating between 1 and 5);

grant update (description, difficulty_rating)
  on public.collection_members to authenticated;

/* The column grant lets an authenticated caller address these fields; this
   transition guard keeps the right to the deck's own author. It retains every
   status, ordering and revision-readiness rule from 0029. */
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

    if (new.description is distinct from old.description
        or new.difficulty_rating is distinct from old.difficulty_rating)
       and not caller_owns then
      raise exception 'only the deck''s own author may edit its collection details';
    end if;
  end if;

  if new.ready_revision is distinct from old.ready_revision
     and new.ready is not distinct from old.ready then
    raise exception 'ready revision is managed by the database';
  end if;

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

/* Authenticated workspace rows carry the author's current editor values. */
drop function if exists public.collection_memberships(uuid);

create function public.collection_memberships(target uuid default null)
returns table (
  collection_id uuid,
  set_id uuid,
  status text,
  ready boolean,
  ready_revision integer,
  sort_order integer,
  description text,
  difficulty_rating integer,
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
    m.ready_revision, m.sort_order, m.description,
    m.difficulty_rating::integer, m.invited_by,
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

/* The public tile projection is the only place these membership details leave
   the private workspace, and only for an accepted, reachable deck. */
drop function if exists public.collection_members_by_slug(text);

create function public.collection_members_by_slug(share_slug text)
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
  ready boolean,
  description text,
  difficulty_rating integer
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
    coalesce(m.ready and m.ready_revision = s.revision, false),
    m.description,
    m.difficulty_rating::integer
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

do $$
begin
  if not has_column_privilege(
       'authenticated',
       'public.collection_members',
       'description',
       'UPDATE'
     ) or not has_column_privilege(
       'authenticated',
       'public.collection_members',
       'difficulty_rating',
       'UPDATE'
     ) then
    raise exception 'Collection creators cannot update their membership details.';
  end if;
end;
$$;
