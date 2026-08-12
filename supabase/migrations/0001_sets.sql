-- Adventures Workshop: published sets.
--
-- Run this once in the Supabase SQL editor. It is written to be re-runnable.
--
-- The shape follows one rule: the cloud is a *publish target*, never the source
-- of truth. A row here is a copy of a document that still lives in the author's
-- browser, so nothing in the app ever has to read from here to work.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Sets
-- ---------------------------------------------------------------------------

create table if not exists public.sets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,

  -- The set's id in the author's own library. Republishing the same set has to
  -- update its row rather than mint a second one, and this is what identifies
  -- it: the row id is ours, the local id is theirs.
  local_id text not null,

  -- The share token. Unguessable, and the only way to reach an unlisted set —
  -- see `set_by_slug` below for why that is enforced rather than assumed.
  slug text not null unique default encode(gen_random_bytes(12), 'hex'),

  -- Denormalised for the browse list, so drawing a shelf of sets never has to
  -- pull a document down. Same reasoning as `LibraryEntry` locally.
  name text not null,
  subtitle text not null default '',
  card_count integer not null default 0,
  character_count integer not null default 0,

  -- The app refuses a file from the future. The server records the version so a
  -- client can make that judgement before downloading several megabytes.
  schema_version integer not null,

  -- The document, with every data URL swapped for a Storage URL. See
  -- `cloud/publish.ts` — the swap is what keeps rows small enough to be rows.
  document jsonb not null,

  /*
   * Bumped on every publish, and here from the start on purpose.
   *
   * Nothing reads it yet. It exists so that adding "the cloud copy is newer,
   * which do you want?" later is an addition rather than a migration — the one
   * decision that makes the two-way-sync upgrade cheap instead of a rewrite.
   */
  revision integer not null default 1,

  visibility text not null default 'unlisted'
    check (visibility in ('private', 'unlisted', 'public')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (owner_id, local_id)
);

create index if not exists sets_owner_updated_idx
  on public.sets (owner_id, updated_at desc);

-- Only public sets are ever listed, so that is the only index a gallery needs.
create index if not exists sets_public_updated_idx
  on public.sets (updated_at desc) where visibility = 'public';

-- `search_path` is pinned empty, and that is not decoration: a function that
-- resolves its search_path at call time can be aimed at a schema the caller
-- controls. Supabase's own linter flags the omission (0011). Every function
-- here sets it.
create or replace function public.touch_updated_at()
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

drop trigger if exists sets_touch_updated_at on public.sets;
create trigger sets_touch_updated_at
  before update on public.sets
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.sets enable row level security;

-- An author owns their rows completely.
drop policy if exists sets_owner_all on public.sets;
create policy sets_owner_all on public.sets
  for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

/*
 * Everyone may read *public* sets, and only public ones.
 *
 * This is the part that is easy to get wrong. The obvious policy is "readable
 * if visibility is unlisted or public", on the grounds that an unlisted set is
 * protected by its unguessable slug. It is not: the anon key can query this
 * table directly, so `select slug from sets` would hand over every unlisted
 * set in the database at once. The slug only protects a set if the slug is the
 * *only* way to ask for one — which is what `set_by_slug` below is for.
 */
drop policy if exists sets_public_read on public.sets;
create policy sets_public_read on public.sets
  for select
  using (visibility = 'public');

/*
 * Anonymous users may share by link, but not publish to the gallery.
 *
 * Supabase's anonymous sign-ins hand a throwaway account the same
 * `authenticated` role as a real one, which is exactly what makes them cheap
 * to adopt — every policy above applies unchanged. It is also what makes this
 * necessary: without it there is no unlisted-only boundary, and the public
 * gallery could be filled from a browser tab with no address behind it.
 *
 * RESTRICTIVE, so it ANDs with the permissive policies rather than ORing. A
 * permissive policy here would grant rather than constrain.
 *
 * INSERT and UPDATE only. `AS RESTRICTIVE FOR ALL` would also gate SELECT, and
 * an anonymous author must still be able to *read* the gallery.
 */
drop policy if exists sets_anon_no_public_insert on public.sets;
create policy sets_anon_no_public_insert on public.sets
  as restrictive for insert to authenticated
  with check (
    visibility <> 'public'
    or (auth.jwt() ->> 'is_anonymous')::boolean is not true
  );

drop policy if exists sets_anon_no_public_update on public.sets;
create policy sets_anon_no_public_update on public.sets
  as restrictive for update to authenticated
  using (true)
  with check (
    visibility <> 'public'
    or (auth.jwt() ->> 'is_anonymous')::boolean is not true
  );

/*
 * Fetch one set by its share token.
 *
 * `security definer` so it can see past the policies above, and deliberately
 * narrow: it takes a slug and returns at most one row. There is no way to ask
 * it for a list, so knowing the token is the only way through — which is what
 * makes an unlisted set actually unlisted.
 *
 * `private` is excluded here as well as in the policy: turning a set private
 * has to revoke a link that was already shared, or the setting means nothing.
 */
create or replace function public.set_by_slug(share_slug text)
returns setof public.sets
language sql
security definer
set search_path = public
stable
as $$
  select * from public.sets
  where slug = share_slug
    and visibility in ('unlisted', 'public')
  limit 1;
$$;

revoke all on function public.set_by_slug(text) from public;
grant execute on function public.set_by_slug(text) to anon, authenticated;

/*
 * Supabase's database linter reports two warnings against the grant above —
 * 0028 and 0029, "a SECURITY DEFINER function is executable by anon /
 * authenticated". Both are expected, and neither should be "fixed".
 *
 * That combination *is* the sharing mechanism. The function has to see past
 * the table's policies, or an unlisted set could not be fetched by anyone; and
 * it has to be callable without signing in, or a shared link would only work
 * for people who already have accounts. What makes it safe is not the grant
 * but the function's shape: exact match on a unique column, `limit 1`, no way
 * to ask it for a list, and `private` excluded so revoking a link works.
 *
 * If either warning is ever silenced, sharing breaks. Leave them.
 */

-- ---------------------------------------------------------------------------
-- Storage: artwork lifted out of published documents
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('set-assets', 'set-assets', true)
on conflict (id) do nothing;

/*
 * Every object is written under the uploader's own user id — `<uid>/<set>/…` —
 * and the policies below are what make that prefix mean something rather than
 * being a naming convention. Without them any signed-in user could overwrite
 * anyone's artwork.
 */
drop policy if exists set_assets_read on storage.objects;
create policy set_assets_read on storage.objects
  for select
  using (bucket_id = 'set-assets');

drop policy if exists set_assets_write on storage.objects;
create policy set_assets_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'set-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists set_assets_update on storage.objects;
create policy set_assets_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'set-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists set_assets_delete on storage.objects;
create policy set_assets_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'set-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
