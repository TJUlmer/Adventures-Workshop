-- Unmatched Labs: the community gallery.
--
-- Run after `0001_sets.sql`. Written to be re-runnable.
--
-- Three things a gallery needs that link-sharing did not:
--   * an author with a *name*, because attribution is the point
--   * enough on the row to draw a shelf without downloading the sets
--   * somewhere for a takedown to live that is not the author's own setting

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

/*
 * One row per account, and the only place a person is named.
 *
 * Separate from `sets` rather than denormalised onto it so an author can rename
 * themselves once instead of re-publishing everything. `auth.users` is not
 * readable by clients — nor should it be, it holds email addresses — so this is
 * what the gallery joins against to say who made something.
 */
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url text not null default '',
  /* Moderation rights. Never self-serve — see the grants below. */
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A display name is public by definition: it is printed under every set.
drop policy if exists profiles_public_read on public.profiles;
create policy profiles_public_read on public.profiles
  for select
  using (true);

drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles
  for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

/*
 * `is_admin` is withheld at the *grant* level, not by policy.
 *
 * A row policy cannot see the old value of a column, so "you may update your
 * own row, but not that field" is not expressible as `with check`. Column
 * grants are, and they are checked before any policy runs — so an author can
 * rename themselves and cannot, by any route through PostgREST, make
 * themselves a moderator.
 */
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant insert (id, display_name, avatar_url) on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

/*
 * A profile the moment an account exists.
 *
 * OAuth hands back a name and a picture in `raw_user_meta_data`, under keys
 * that differ by provider — Google says `full_name`, GitHub says `name`, and an
 * anonymous account says nothing at all. Taking whichever is there means an
 * author never has to introduce themselves before they can publish.
 */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'user_name',
      ''
    ),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill, so accounts made before this migration are not nameless.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- What a shelf needs
-- ---------------------------------------------------------------------------

alter table public.sets
  /*
   * A small picture, written at publish. The gallery cannot read `document` to
   * find one: that column is the whole set, and drawing thirty tiles would mean
   * pulling thirty multi-megabyte documents to show thirty thumbnails.
   */
  add column if not exists thumbnail_url text not null default '',
  /*
   * When it first became public — *not* `updated_at`, which moves every time
   * the author re-publishes. Sorting a gallery by `updated_at` would show
   * "recently edited" while claiming to show "new".
   */
  add column if not exists published_at timestamptz,
  /*
   * A takedown, held apart from `visibility` on purpose. The author's own
   * setting stays exactly where they left it, so hiding something does not read
   * to them as though they did it — and undoing it restores what they chose
   * rather than a guess.
   */
  add column if not exists hidden boolean not null default false,
  add column if not exists hidden_reason text not null default '',
  add column if not exists view_count integer not null default 0;

create or replace function public.stamp_published_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- First time it goes public, and never moved again.
  if new.visibility = 'public' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists sets_stamp_published_at on public.sets;
create trigger sets_stamp_published_at
  before insert or update on public.sets
  for each row execute function public.stamp_published_at();

-- Newest-first over the gallery, which is the only order it opens on.
create index if not exists sets_gallery_idx
  on public.sets (published_at desc)
  where visibility = 'public' and not hidden;

-- ---------------------------------------------------------------------------
-- Reading the gallery
-- ---------------------------------------------------------------------------

/*
 * A hidden set leaves the gallery *and* its link stops resolving.
 *
 * Both, or a takedown is theatre: the row would vanish from the shelf while
 * anyone holding the URL carried on reading it.
 */
drop policy if exists sets_public_read on public.sets;
create policy sets_public_read on public.sets
  for select
  using (visibility = 'public' and not hidden);

create or replace function public.set_by_slug(share_slug text)
returns setof public.sets
language sql
security definer
set search_path = ''
stable
as $$
  select * from public.sets
  where slug = share_slug
    and visibility in ('unlisted', 'public')
    and not hidden
  limit 1;
$$;

revoke all on function public.set_by_slug(text) from public;
grant execute on function public.set_by_slug(text) to anon, authenticated;

/*
 * Counting a view.
 *
 * An RPC because RLS gives a reader no write anywhere near this table, and
 * loosening that so a counter can move would be the widest hole in the schema.
 * `security definer`, and it can only ever add one to one row it finds by slug.
 */
create or replace function public.record_set_view(share_slug text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sets
  set view_count = view_count + 1
  where slug = share_slug and visibility = 'public' and not hidden;
$$;

revoke all on function public.record_set_view(text) from public;
grant execute on function public.record_set_view(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Moderation
-- ---------------------------------------------------------------------------

/*
 * Anyone may report; only a moderator may read the reports.
 *
 * `reporter_id` is nullable and set null on delete, so a report survives the
 * account that raised it — the thing being judged is the set, not the reporter.
 */
create table if not exists public.set_reports (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.sets (id) on delete cascade,
  reporter_id uuid references auth.users (id) on delete set null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  resolved boolean not null default false
);

alter table public.set_reports enable row level security;

drop policy if exists reports_anyone_insert on public.set_reports;
create policy reports_anyone_insert on public.set_reports
  for insert to anon, authenticated
  with check (true);

drop policy if exists reports_admin_read on public.set_reports;
create policy reports_admin_read on public.set_reports
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists reports_admin_update on public.set_reports;
create policy reports_admin_update on public.set_reports
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

revoke all on public.set_reports from anon, authenticated;
grant insert (set_id, reporter_id, reason) on public.set_reports to anon, authenticated;
grant select, update (resolved) on public.set_reports to authenticated;

/*
 * A moderator can see and hide anything.
 *
 * Additive to `sets_owner_all` and `sets_public_read`, which are permissive and
 * therefore OR together — so this grants a moderator sight of a hidden set
 * without widening what anyone else can read.
 */
drop policy if exists sets_admin_read on public.sets;
create policy sets_admin_read on public.sets
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists sets_admin_moderate on public.sets;
create policy sets_admin_moderate on public.sets
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
