/*
 * One collection-wide Shared Kit.
 *
 * The kit is deliberately another published set, not a document owned by the
 * collection. That preserves the existing owner-consent, revision readiness,
 * discussion and contribution machinery while giving maps, loose components,
 * PDFs, box art and other common material one unambiguous home.
 */

alter table public.collection_members
  add column if not exists entry_kind text not null default 'deck';

alter table public.collection_members
  drop constraint if exists collection_members_entry_kind_check,
  add constraint collection_members_entry_kind_check
    check (entry_kind in ('deck', 'shared_assets'));

/* Closed history does not reserve the slot. A replacement may be chosen once
   an invitation is declined or an existing kit is removed. */
create unique index if not exists collection_members_one_live_shared_assets
  on public.collection_members (collection_id)
  where entry_kind = 'shared_assets'
    and status in ('invited', 'submitted', 'accepted');

grant insert (entry_kind) on public.collection_members to authenticated;

/* A heroes publication cannot grow maps or a threat track in its editor. Keep
   the invariant at the database boundary as well as in both UI pickers. */
create or replace function public.guard_collection_member_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.entry_kind = 'shared_assets'
     and not exists (
       select 1
       from public.sets s
       where s.id = new.set_id
         and s.scope = 'full'
         and s.kind = 'adventure'
     ) then
    raise exception 'a Shared Kit must be a full Adventure set';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_collection_member_entry()
  from public, anon, authenticated;

drop trigger if exists collection_members_guard_entry on public.collection_members;
create trigger collection_members_guard_entry
  before insert on public.collection_members
  for each row execute function public.guard_collection_member_entry();

/* A row's purpose is part of the consent question that opened it. Changing
   that purpose afterwards would turn an accepted deck into public shared
   material without asking its owner again. */
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
  if new.entry_kind is distinct from old.entry_kind then
    raise exception 'a collection entry type cannot be changed after it is offered';
  end if;

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
           and old.entry_kind = 'deck'
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

/* Offering an ordinary deck remains open to eligible creators. Choosing the
   one collection-wide Shared Kit is an organizer action: another owner joins
   it through the organizer-invites/owner-accepts consent path. */
drop policy if exists members_submit on public.collection_members;
create policy members_submit on public.collection_members
  for insert to authenticated
  with check (
    status = 'submitted'
    and entry_kind = 'deck'
    and public.owns_set(set_id, auth.uid())
    and public.collection_accepts_submissions(collection_id)
  );

/* Link-based Shared Kit invitations should reject hero/villain slices without
   downloading a multi-megabyte document merely to inspect these two fields. */
drop function if exists public.set_summary_by_slug(text);

create function public.set_summary_by_slug(share_slug text)
returns table (
  id uuid,
  slug text,
  name text,
  subtitle text,
  revision integer,
  visibility text,
  updated_at timestamptz,
  published_at timestamptz,
  change_note text,
  hidden boolean,
  scope text,
  kind text
)
language sql
security definer
set search_path = public
stable
as $$
  select s.id, s.slug, s.name, s.subtitle, s.revision, s.visibility,
         s.updated_at, s.published_at, s.change_note, s.hidden, s.scope, s.kind
  from public.sets s
  where s.slug = share_slug
    and s.visibility in ('unlisted', 'public')
  limit 1;
$$;

revoke all on function public.set_summary_by_slug(text)
  from public, anon, authenticated;
grant execute on function public.set_summary_by_slug(text)
  to anon, authenticated;

/* Authenticated workspace rows include the collection-level classification. */
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
  entry_kind text,
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
    m.difficulty_rating::integer, m.entry_kind, m.invited_by,
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

/* Public tiles retain the Shared Kit row, but name its role explicitly so the
   client can keep it out of character/set rosters and show it once. */
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
  difficulty_rating integer,
  entry_kind text
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
    m.difficulty_rating::integer,
    m.entry_kind
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

/* Shared Kit characters are implementation detail, not collection roster. */
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
    coalesce(
      nullif(s.card_previews ->> ('deck-back:' || sc.character_id || ':front'), ''),
      sc.image_url
    ),
    case
      when nullif(s.card_previews ->> ('deck-back:' || sc.character_id || ':front'), '')
           is not null then false
      else sc.image_bleeds
    end,
    sc.card_url
  from public.collection_members m
  join public.collections c on c.id = m.collection_id
  join public.sets s on s.id = m.set_id
  join public.set_characters sc on sc.set_id = s.id
  left join public.profiles p on p.id = s.owner_id
  where c.slug = share_slug
    and not c.hidden
    and m.status = 'accepted'
    and m.entry_kind = 'deck'
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

/* Shelf and public-gallery deck counts continue to mean playable deck sets. */
drop function if exists public.my_collections();

create function public.my_collections()
returns table (
  id uuid,
  slug text,
  name text,
  subtitle text,
  banner_url text,
  visibility text,
  open_submissions boolean,
  is_organizer boolean,
  deck_count integer,
  my_deck_count integer,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    c.id, c.slug, c.name, c.subtitle, c.banner_url, c.visibility, c.open_submissions,
    public.is_collection_organizer(c.id, auth.uid()) as is_organizer,
    (select count(*)::integer from public.collection_members m2
      where m2.collection_id = c.id
        and m2.status = 'accepted'
        and m2.entry_kind = 'deck') as deck_count,
    (select count(*)::integer
       from public.collection_members m3
       join public.sets s3 on s3.id = m3.set_id
      where m3.collection_id = c.id
        and s3.owner_id = auth.uid()
        and m3.entry_kind = 'deck'
        and m3.status in ('accepted', 'invited', 'submitted')) as my_deck_count,
    c.updated_at
  from public.collections c
  where auth.uid() is not null
    and not c.hidden
    and (
      public.is_collection_organizer(c.id, auth.uid())
      or exists (
        select 1
        from public.collection_members m
        join public.sets s on s.id = m.set_id
        where m.collection_id = c.id
          and s.owner_id = auth.uid()
          and m.status in ('accepted', 'invited', 'submitted')
      )
      or exists (
        select 1 from public.collection_invites i
        where i.collection_id = c.id
          and i.invited_user = auth.uid()
          and i.status = 'accepted'
      )
      or exists (
        select 1
        from public.collection_invite_claims cl
        join public.collection_invites i2 on i2.id = cl.invite_id
        where i2.collection_id = c.id and cl.user_id = auth.uid()
      )
    )
  order by c.updated_at desc;
$$;

revoke all on function public.my_collections() from public, anon;
grant execute on function public.my_collections() to authenticated;

create or replace function public.list_public_collections(want integer default 24)
returns table (
  id uuid,
  slug text,
  name text,
  subtitle text,
  blurb text,
  banner_url text,
  deck_count integer,
  creator_count integer,
  published_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    c.id, c.slug, c.name, c.subtitle, c.blurb, c.banner_url,
    counts.decks,
    counts.creators,
    c.published_at
  from public.collections c
  cross join lateral (
    select
      count(*) filter (where m.entry_kind = 'deck')::integer as decks,
      count(distinct s.owner_id)::integer as creators
    from public.collection_members m
    join public.sets s on s.id = m.set_id
    where m.collection_id = c.id and m.status = 'accepted'
  ) counts
  where c.visibility = 'public'
    and not c.hidden
    and counts.decks > 0
  order by c.published_at desc nulls last, c.created_at desc
  limit greatest(1, least(coalesce(want, 24), 60));
$$;

revoke all on function public.list_public_collections(integer)
  from public, anon, authenticated;
grant execute on function public.list_public_collections(integer)
  to anon, authenticated;
