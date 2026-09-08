-- Gallery engagement: likes, private favourites and public comments.
--
-- A like is a public signal but the people behind the count are not public.
-- A favourite is entirely private. Comments are public only while the set is
-- public, and every write requires a permanent account so throwaway sharing
-- identities cannot be used to manufacture engagement.

-- ---------------------------------------------------------------------------
-- Public aggregate counts
-- ---------------------------------------------------------------------------

alter table public.sets
  add column if not exists like_count integer not null default 0,
  add column if not exists comment_count integer not null default 0;

alter table public.sets
  drop constraint if exists sets_like_count_nonnegative,
  add constraint sets_like_count_nonnegative check (like_count >= 0),
  drop constraint if exists sets_comment_count_nonnegative,
  add constraint sets_comment_count_nonnegative check (comment_count >= 0);

create index if not exists sets_gallery_liked_idx
  on public.sets (like_count desc, published_at desc)
  where visibility = 'public' and not hidden;

/*
 * View counts already updated `sets`, and therefore used to move
 * `updated_at`. Likes and comments would make that existing problem much more
 * visible: community activity is not a new revision of the author's work.
 * Compare every author/moderation field while deliberately ignoring counters.
 */
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['updated_at', 'view_count', 'like_count', 'comment_count'])
       is distinct from
     (to_jsonb(old) - array['updated_at', 'view_count', 'like_count', 'comment_count'])
  then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Likes
-- ---------------------------------------------------------------------------

create table if not exists public.set_likes (
  set_id uuid not null references public.sets (id) on delete cascade,
  user_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (set_id, user_id)
);

create index if not exists set_likes_user_idx
  on public.set_likes (user_id, created_at desc);

alter table public.set_likes enable row level security;

drop policy if exists set_likes_self_read on public.set_likes;
create policy set_likes_self_read on public.set_likes
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists set_likes_permanent_insert on public.set_likes;
create policy set_likes_permanent_insert on public.set_likes
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (auth.jwt() ->> 'is_anonymous')::boolean is not true
    and exists (
      select 1 from public.sets s
      where s.id = set_id and s.visibility = 'public' and not s.hidden
    )
  );

drop policy if exists set_likes_self_delete on public.set_likes;
create policy set_likes_self_delete on public.set_likes
  for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.set_likes from anon, authenticated;
grant select, delete on public.set_likes to authenticated;
grant insert (set_id) on public.set_likes to authenticated;

create or replace function public.adjust_set_like_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.sets set like_count = like_count + 1 where id = new.set_id;
    return new;
  end if;

  update public.sets
     set like_count = greatest(0, like_count - 1)
   where id = old.set_id;
  return old;
end;
$$;

drop trigger if exists set_likes_adjust_count on public.set_likes;
create trigger set_likes_adjust_count
  after insert or delete on public.set_likes
  for each row execute function public.adjust_set_like_count();

-- ---------------------------------------------------------------------------
-- Private favourites
-- ---------------------------------------------------------------------------

create table if not exists public.set_favourites (
  set_id uuid not null references public.sets (id) on delete cascade,
  user_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (set_id, user_id)
);

create index if not exists set_favourites_user_idx
  on public.set_favourites (user_id, created_at desc);

alter table public.set_favourites enable row level security;

drop policy if exists set_favourites_self_read on public.set_favourites;
create policy set_favourites_self_read on public.set_favourites
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists set_favourites_permanent_insert on public.set_favourites;
create policy set_favourites_permanent_insert on public.set_favourites
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (auth.jwt() ->> 'is_anonymous')::boolean is not true
    and exists (
      select 1 from public.sets s
      where s.id = set_id and s.visibility = 'public' and not s.hidden
    )
  );

drop policy if exists set_favourites_self_delete on public.set_favourites;
create policy set_favourites_self_delete on public.set_favourites
  for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.set_favourites from anon, authenticated;
grant select, delete on public.set_favourites to authenticated;
grant insert (set_id) on public.set_favourites to authenticated;

/*
 * A character's chosen listing is not its identity. Publishing that hero on
 * their own makes `gallery_characters` prefer a different `sets.id`; keying a
 * favourite to that row would make it vanish at exactly that moment. These
 * are the three columns the gallery view itself deduplicates on instead.
 */
create table if not exists public.character_favourites (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  local_id text not null,
  character_id text not null,
  user_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, local_id, character_id, user_id)
);

create index if not exists character_favourites_user_idx
  on public.character_favourites (user_id, created_at desc);

alter table public.character_favourites enable row level security;

drop policy if exists character_favourites_self_read on public.character_favourites;
create policy character_favourites_self_read on public.character_favourites
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists character_favourites_permanent_insert on public.character_favourites;
create policy character_favourites_permanent_insert on public.character_favourites
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (auth.jwt() ->> 'is_anonymous')::boolean is not true
    and exists (
      select 1
        from public.sets s
        join public.set_characters sc on sc.set_id = s.id
       where s.owner_id = character_favourites.owner_id
         and s.local_id = character_favourites.local_id
         and sc.character_id = character_favourites.character_id
         and s.visibility = 'public'
         and not s.hidden
    )
  );

drop policy if exists character_favourites_self_delete on public.character_favourites;
create policy character_favourites_self_delete on public.character_favourites
  for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.character_favourites from anon, authenticated;
grant select, delete on public.character_favourites to authenticated;
grant insert (owner_id, local_id, character_id) on public.character_favourites to authenticated;

-- ---------------------------------------------------------------------------
-- Comments and reports
-- ---------------------------------------------------------------------------

create table if not exists public.set_comments (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.sets (id) on delete cascade,
  author_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  hidden boolean not null default false,
  hidden_reason text not null default ''
);

create index if not exists set_comments_set_created_idx
  on public.set_comments (set_id, created_at);

alter table public.set_comments enable row level security;

drop policy if exists set_comments_public_read on public.set_comments;
create policy set_comments_public_read on public.set_comments
  for select
  using (
    deleted_at is null
    and not hidden
    and exists (
      select 1 from public.sets s
      where s.id = set_id and s.visibility = 'public' and not s.hidden
    )
  );

drop policy if exists set_comments_admin_read on public.set_comments;
create policy set_comments_admin_read on public.set_comments
  for select to authenticated
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin
  ));

drop policy if exists set_comments_permanent_insert on public.set_comments;
create policy set_comments_permanent_insert on public.set_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and (auth.jwt() ->> 'is_anonymous')::boolean is not true
    and exists (
      select 1 from public.sets s
      where s.id = set_id and s.visibility = 'public' and not s.hidden
    )
  );

drop policy if exists set_comments_self_update on public.set_comments;
create policy set_comments_self_update on public.set_comments
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

revoke all on public.set_comments from anon, authenticated;
grant select on public.set_comments to anon, authenticated;
grant insert (set_id, body) on public.set_comments to authenticated;
grant update (body, deleted_at) on public.set_comments to authenticated;

/*
 * A soft-deleted row deliberately stops satisfying the public SELECT policy.
 * PostgreSQL consequently rejects a direct client UPDATE as an RLS check on
 * the new row, even though the author-only UPDATE policy itself passes. Keep
 * that visibility rule strict and put the transition behind one narrow
 * function instead: it can only touch the caller's own visible comment and
 * exposes no way to edit somebody else's moderation state.
 */
create or replace function public.delete_own_set_comment(target uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed boolean;
begin
  if auth.uid() is null or (auth.jwt() ->> 'is_anonymous')::boolean is true then
    raise exception 'A permanent account is required.' using errcode = '42501';
  end if;

  update public.set_comments
     set deleted_at = now()
   where id = target
     and author_id = auth.uid()
     and deleted_at is null
  returning true into removed;

  return coalesce(removed, false);
end;
$$;

revoke all on function public.delete_own_set_comment(uuid) from public;
grant execute on function public.delete_own_set_comment(uuid) to authenticated;

create or replace function public.touch_set_comment_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_comments_touch_updated_at on public.set_comments;
create trigger set_comments_touch_updated_at
  before update on public.set_comments
  for each row execute function public.touch_set_comment_updated_at();

create or replace function public.adjust_set_comment_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_visible boolean := false;
  new_visible boolean := false;
  target_set_id uuid;
begin
  if tg_op <> 'INSERT' then
    old_visible := old.deleted_at is null and not old.hidden;
  end if;
  if tg_op <> 'DELETE' then
    new_visible := new.deleted_at is null and not new.hidden;
  end if;
  if tg_op = 'DELETE' then
    target_set_id := old.set_id;
  else
    target_set_id := new.set_id;
  end if;

  if old_visible <> new_visible then
    update public.sets
       set comment_count = greatest(
         0,
         comment_count + case when new_visible then 1 else -1 end
       )
     where id = target_set_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists set_comments_adjust_count on public.set_comments;
create trigger set_comments_adjust_count
  after insert or update of deleted_at, hidden or delete on public.set_comments
  for each row execute function public.adjust_set_comment_count();

create table if not exists public.set_comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.set_comments (id) on delete cascade,
  reporter_id uuid default auth.uid() references auth.users (id) on delete set null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  resolved boolean not null default false
);

alter table public.set_comment_reports enable row level security;

drop policy if exists comment_reports_anyone_insert on public.set_comment_reports;
create policy comment_reports_anyone_insert on public.set_comment_reports
  for insert to anon, authenticated
  with check (true);

drop policy if exists comment_reports_admin_read on public.set_comment_reports;
create policy comment_reports_admin_read on public.set_comment_reports
  for select to authenticated
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin
  ));

drop policy if exists comment_reports_admin_update on public.set_comment_reports;
create policy comment_reports_admin_update on public.set_comment_reports
  for update to authenticated
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin
  ))
  with check (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin
  ));

revoke all on public.set_comment_reports from anon, authenticated;
grant insert (comment_id, reason) on public.set_comment_reports to anon, authenticated;
grant select, update (resolved) on public.set_comment_reports to authenticated;

create or replace function public.moderate_set_comment(
  target uuid,
  should_hide boolean,
  moderation_reason text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin
  ) then
    raise exception 'Only a moderator can moderate comments.' using errcode = '42501';
  end if;

  update public.set_comments
     set hidden = should_hide,
         hidden_reason = case when should_hide then left(moderation_reason, 500) else '' end
   where id = target;
end;
$$;

revoke all on function public.moderate_set_comment(uuid, boolean, text) from public;
grant execute on function public.moderate_set_comment(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Character gallery aggregates and backfill
-- ---------------------------------------------------------------------------

/* Production's original view predates the final 0007 source order, so a
   create-or-replace attempts to rename columns by position. Rebuild it in
   the production order, then append the two counters. API callers select by
   name, while preserving the old positions avoids a needless contract
   change for any direct database consumers. */
drop function if exists public.my_favourite_gallery_characters();
drop view if exists public.gallery_characters;

create view public.gallery_characters
with (security_invoker = on) as
select distinct on (s.owner_id, s.local_id, sc.character_id)
       sc.character_id,
       sc.name,
       sc.role,
       sc.image_url,
       sc.position,
       s.id            as set_id,
       s.slug          as slug,
       s.name          as listing_name,
       s.scope         as listing_scope,
       s.thumbnail_url,
       s.cover_url,
       s.owner_id,
       s.local_id,
       s.published_at,
       s.view_count,
       parent.slug     as parent_slug,
       parent.name     as parent_name,
       sc.card_url,
       sc.image_bleeds,
       s.cover_bleeds,
       s.like_count,
       s.comment_count
  from public.set_characters sc
  join public.sets s on s.id = sc.set_id
  left join lateral (
    select p.slug, p.name
      from public.sets p
     where p.owner_id = s.owner_id
       and p.local_id = s.local_id
       and p.scope = 'full'
       and p.visibility = 'public'
       and not p.hidden
     limit 1
  ) parent on true
 where s.visibility = 'public' and not s.hidden
 order by s.owner_id, s.local_id, sc.character_id,
          (s.scope <> 'full' and s.character_id = sc.character_id) desc,
          s.published_at desc nulls last;

revoke all on public.gallery_characters from anon, authenticated;
grant select on public.gallery_characters to anon, authenticated;

/*
 * Private shelves as table-valued functions, so search/sort/paging can still
 * be applied by PostgREST after the account's favourites have narrowed the
 * rows. Passing hundreds of compound character ids through a URL eventually
 * exceeds ordinary proxy limits; keeping that join here avoids a hidden cap.
 */
create or replace function public.my_favourite_sets()
returns setof public.sets
language sql
security invoker
set search_path = ''
stable
as $$
  select s.*
    from public.set_favourites f
    join public.sets s on s.id = f.set_id
   where f.user_id = auth.uid()
     and s.visibility = 'public'
     and not s.hidden;
$$;

revoke all on function public.my_favourite_sets() from public;
grant execute on function public.my_favourite_sets() to authenticated;

create or replace function public.my_favourite_gallery_characters()
returns setof public.gallery_characters
language sql
security invoker
set search_path = ''
stable
as $$
  select gc.*
    from public.character_favourites f
    join public.gallery_characters gc
      on gc.owner_id = f.owner_id
     and gc.local_id = f.local_id
     and gc.character_id = f.character_id
   where f.user_id = auth.uid();
$$;

revoke all on function public.my_favourite_gallery_characters() from public;
grant execute on function public.my_favourite_gallery_characters() to authenticated;

update public.sets s
   set like_count = (
         select count(*) from public.set_likes l where l.set_id = s.id
       ),
       comment_count = (
         select count(*)
           from public.set_comments c
          where c.set_id = s.id and c.deleted_at is null and not c.hidden
       );
