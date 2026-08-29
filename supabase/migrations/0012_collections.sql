-- ---------------------------------------------------------------------------
-- Collections: one themed box, assembled from decks several people each own
-- ---------------------------------------------------------------------------
--
-- Phase 1 of `COLLECTIONS.md`. The shape of the trust, said once: a collection
-- **holds no document**. It points at published rows that other people own,
-- and nothing in this file gives it any power over them. Unlinking a deck
-- leaves that deck's own row, slug, shelf entry and gallery listing exactly as
-- they were; there is deliberately no path by which curating a collection
-- edits, hides or deletes somebody's set.
--
-- Purely additive, and that is what made it safe to apply against the live
-- database while the feature was still on a branch (see `DEPLOYMENT.md` on
-- previews sharing production): two new tables, no `alter` on `sets`, and
-- nothing in the shipped app reads either one. That reasoning is specific to
-- this migration and does not generalise to the next.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- The collection
-- ---------------------------------------------------------------------------

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),

  /*
   * Who first made it. Audit only — it carries no privilege of its own, and
   * every check in this file goes through `collection_organizers` instead.
   *
   * `on delete set null`, never cascade. An organizer closing their account
   * must not delete a project several other people's work is listed in. This
   * is the same lesson `sets.forked_from` already carries, and `sets.owner_id`
   * cascading from `profiles` has destroyed a published set once.
   */
  /*
   * **Sent by the client and checked**, not withheld and defaulted.
   *
   * The withhold-and-default shape borrowed from
   * `set_contributions.contributor_id` does not survive being paired with a
   * `with check` that reads the same column — the check saw NULL. The pattern
   * that works here is `sets.owner_id`, which has eight live rows behind it:
   * `publishSet` sends it and `sets_owner_all` checks it.
   *
   * Granting the column costs nothing, because **the check is the
   * enforcement**: `collections_insert` refuses any value but the caller's
   * own, so a client may name only itself either way.
   *
   * `on delete set null`, never cascade. An organizer closing their account
   * must not delete a project several other people's work is listed in — the
   * same lesson `sets.forked_from` carries, and `sets.owner_id` cascading from
   * `profiles` has destroyed a published set once.
   */
  created_by uuid references public.profiles (id) on delete set null,

  -- The share token, same unguessable shape `sets.slug` uses, and reachable
  -- only through `collection_by_slug` for the same reason.
  slug text not null unique default encode(gen_random_bytes(12), 'hex'),

  name text not null default '',
  subtitle text not null default '',
  blurb text not null default '',
  -- A picture the organizers upload, not one composed from member cards. See
  -- COLLECTIONS.md on why the cheap answer is the right one here.
  banner_url text not null default '',

  visibility text not null default 'unlisted'
    check (visibility in ('private', 'unlisted', 'public')),

  /*
   * Moderation, held apart from `visibility` exactly as it is on `sets`: a
   * takedown must leave the organizers' own setting alone, and must kill the
   * *link* as well as the listing, or a hidden project vanishes from the
   * gallery while every held URL still works.
   */
  hidden boolean not null default false,

  /*
   * Whether a creator may offer their own deck without being invited first.
   *
   * **Open by default**, which read as the reckless choice and is not: being
   * open does not let anybody *in*, it only lets them ask. Every submission
   * still lands as `submitted` and still needs an organizer to accept it, and
   * the collection is only reachable by an unguessable link to begin with —
   * so this is a spam control, and the consent boundary is acceptance.
   *
   * Closed-by-default was tried and produced exactly one outcome: a visitor
   * with a published deck opened the link, found nothing they could do, and
   * had no way to know why.
   */
  open_submissions boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists collections_public_updated_idx
  on public.collections (updated_at desc)
  where visibility = 'public' and not hidden;

drop trigger if exists collections_touch_updated_at on public.collections;
create trigger collections_touch_updated_at
  before update on public.collections
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Who may curate it
-- ---------------------------------------------------------------------------

/*
 * Organizers are **people**, not decks — and this is the one place the design
 * doc was wrong, found by trying to write it.
 *
 * `COLLECTIONS.md` put `role` on the membership row. That cannot work: a
 * membership row is keyed by `set_id`, so the person who creates a collection
 * has no row at all until they add a deck of their own, and would therefore
 * have no way to invite anyone into the thing they just made. It also ties a
 * curation right to a deck, when the two are plainly separate — an organizer
 * may run a project without contributing to it, and a contributor's right to
 * their own deck has nothing to do with whether they curate.
 *
 * So roles live here, keyed by person, and `collection_members` below is only
 * ever "which decks are in". The doc is corrected to match.
 */
create table if not exists public.collection_organizers (
  collection_id uuid not null references public.collections (id) on delete cascade,
  -- Cascade: an account that no longer exists cannot organize anything. The
  -- collection itself survives, because `collections.created_by` is set null.
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (collection_id, user_id)
);

create index if not exists collection_organizers_user_idx
  on public.collection_organizers (user_id);

/*
 * The creator becomes the first organizer, by trigger rather than by asking
 * the client to insert two rows.
 *
 * As a client-side pair it is one failed request away from a collection
 * nobody can administer — and, because only an organizer may insert into
 * `collection_organizers`, that state is unrecoverable without a service
 * role. A trigger cannot half-happen.
 */
create or replace function public.seed_collection_organizer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.collection_organizers (collection_id, user_id)
    values (new.id, new.created_by)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists collections_seed_organizer on public.collections;
create trigger collections_seed_organizer
  after insert on public.collections
  for each row execute function public.seed_collection_organizer();

-- ---------------------------------------------------------------------------
-- Which decks are in
-- ---------------------------------------------------------------------------

create table if not exists public.collection_members (
  collection_id uuid not null references public.collections (id) on delete cascade,

  /*
   * Cascade, and only in this direction. A deck that is unpublished should
   * leave the collection; the collection must survive it, with the remaining
   * tiles intact. Nothing here ever cascades upward into `sets`.
   */
  set_id uuid not null references public.sets (id) on delete cascade,

  /*
   * `invited` — an organizer asked; the deck's owner decides.
   * `submitted` — the owner offered; an organizer decides.
   *
   * Two pending states rather than one, because which side is waiting is the
   * whole of what the other side needs to be shown, and collapsing them would
   * mean deriving it from who inserted the row.
   */
  status text not null default 'invited'
    check (status in ('invited', 'submitted', 'accepted', 'declined', 'removed')),

  -- The deck's own author says it is finished. Only they may set it — see
  -- `guard_collection_member_fields`.
  ready boolean not null default false,

  /*
   * Not `position`. That is a `col_name_keyword` in Postgres — legal as a
   * table column, and a plain syntax error as a bare name in the
   * `returns table (...)` list of `collection_members_by_slug` below, which
   * is how it was found. Renaming beats carrying a quoted identifier through
   * every query, and `sort_order` says what it is besides.
   */
  sort_order integer not null default 0,

  invited_by uuid references public.profiles (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (collection_id, set_id)
);

create index if not exists collection_members_set_idx
  on public.collection_members (set_id);

create index if not exists collection_members_listing_idx
  on public.collection_members (collection_id, status, sort_order);

drop trigger if exists collection_members_touch_updated_at on public.collection_members;
create trigger collection_members_touch_updated_at
  before update on public.collection_members
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- The helpers the policies are written in terms of
-- ---------------------------------------------------------------------------

/*
 * **The recursion footgun, and why this function exists.**
 *
 * The natural policy on `collection_organizers` is "may I write this row? —
 * am I an organizer of this collection?", which queries
 * `collection_organizers` from a policy *on* `collection_organizers`.
 * Postgres evaluates the policy again for that inner read, and the statement
 * fails outright with infinite recursion. `security definer` runs with the
 * function owner's rights and so bypasses RLS on the inner read, which breaks
 * the cycle — the same technique `set_accepts_contributions` uses, there for
 * visibility rather than recursion.
 */
create or replace function public.is_collection_organizer(target uuid, who uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.collection_organizers o
    where o.collection_id = target and o.user_id = who
  );
$$;

revoke all on function public.is_collection_organizer(uuid, uuid) from public;
grant execute on function public.is_collection_organizer(uuid, uuid) to authenticated;

/** Does this person own the published set behind a membership row? */
create or replace function public.owns_set(target uuid, who uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.sets s where s.id = target and s.owner_id = who
  );
$$;

revoke all on function public.owns_set(uuid, uuid) from public;
grant execute on function public.owns_set(uuid, uuid) to authenticated;

/*
 * May a deck be offered to this collection?
 *
 * `security definer` for exactly the reason `set_accepts_contributions` is:
 * the read policy below exposes public collections only, so a policy checking
 * `collections` directly would refuse every submission to an *unlisted* one —
 * which is every collection during the entire production phase.
 *
 * **Visibility and `open_submissions` are both checked here, in one place,
 * and that is the whole point of the function.** The first version of
 * `members_submit` called a definer helper for the visibility half and then
 * added `exists (select 1 from public.collections where ... and
 * open_submissions)` for the other — a raw read, subject to the very policy
 * the helper existed to see past. It returned nothing for an unlisted
 * collection, so every submission was refused, and the trap was reintroduced
 * two lines below the comment describing it.
 *
 * Measured through the real PostgREST path rather than reasoned about: the
 * definer call answered `true` while the same visitor's own read of the same
 * row came back `[]`.
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
  );
$$;

revoke all on function public.collection_accepts_submissions(uuid) from public;
grant execute on function public.collection_accepts_submissions(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.collections enable row level security;
alter table public.collection_organizers enable row level security;
alter table public.collection_members enable row level security;

/*
 * Everyone may read *public* collections, and only public ones.
 *
 * The tempting version is "unlisted or public", on the grounds that an
 * unlisted collection is protected by its unguessable slug. It is not: the
 * anon key can query this table directly, so `select slug from collections`
 * would hand over every unlisted project at once. The slug only protects a
 * collection if the slug is the *only* way to ask for one — which is what
 * `collection_by_slug` below is for. Same trap, same answer, as
 * `sets_public_read`.
 */
drop policy if exists collections_public_read on public.collections;
create policy collections_public_read on public.collections
  for select
  using (visibility = 'public' and not hidden);

/*
 * A creator may always read their own collection.
 *
 * **Any policy set that allows an insert must also allow reading the inserted
 * row.** PostgREST asks for `return=representation` so it can hand back the
 * new row's slug, which makes the statement an `insert ... returning` — and
 * RETURNING is a *read*, needing a SELECT policy as well as a passing WITH
 * CHECK. None applied to a brand-new collection: not public, no members, and
 * its creator not yet an organizer as far as the returning clause could see.
 *
 * Postgres reports that as "new row violates row-level security policy",
 * which is indistinguishable from a genuine WITH CHECK failure — so the
 * insert side was rebuilt three times (default, then a BEFORE INSERT trigger,
 * then a client-sent value) before the read side was suspected at all. The
 * same insert with `return=minimal` succeeding with 201 is what finally
 * separated the two halves.
 *
 * It earns its place independently of that: reading your own collection
 * should not depend on the organizer trigger having run.
 */
drop policy if exists collections_creator_read on public.collections;
create policy collections_creator_read on public.collections
  for select to authenticated
  using (created_by = auth.uid());

drop policy if exists collections_organizer_read on public.collections;
create policy collections_organizer_read on public.collections
  for select to authenticated
  using (public.is_collection_organizer(id, auth.uid()));

/*
 * A deck's owner may read any collection theirs has been invited into, or is
 * in — otherwise an invitation is an offer to join something they cannot see.
 */
drop policy if exists collections_member_read on public.collections;
create policy collections_member_read on public.collections
  for select to authenticated
  using (
    exists (
      select 1 from public.collection_members m
      join public.sets s on s.id = m.set_id
      where m.collection_id = collections.id and s.owner_id = auth.uid()
    )
  );

drop policy if exists collections_insert on public.collections;
create policy collections_insert on public.collections
  for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists collections_organizer_write on public.collections;
create policy collections_organizer_write on public.collections
  for update to authenticated
  using (public.is_collection_organizer(id, auth.uid()))
  with check (public.is_collection_organizer(id, auth.uid()));

drop policy if exists collections_organizer_delete on public.collections;
create policy collections_organizer_delete on public.collections
  for delete to authenticated
  using (public.is_collection_organizer(id, auth.uid()));

/*
 * Anonymous accounts may curate by link but not list publicly, the same
 * boundary `sets_anon_no_public_insert` draws and for the same reason: an
 * anonymous sign-in gets the ordinary `authenticated` role, so without this
 * the public gallery could be filled from a browser tab with no address
 * behind it. RESTRICTIVE so it ANDs rather than ORs, and INSERT/UPDATE only
 * so an anonymous visitor can still *read* a public collection.
 */
drop policy if exists collections_anon_no_public_insert on public.collections;
create policy collections_anon_no_public_insert on public.collections
  as restrictive for insert to authenticated
  with check (
    visibility <> 'public'
    or (auth.jwt() ->> 'is_anonymous')::boolean is not true
  );

drop policy if exists collections_anon_no_public_update on public.collections;
create policy collections_anon_no_public_update on public.collections
  as restrictive for update to authenticated
  using (true)
  with check (
    visibility <> 'public'
    or (auth.jwt() ->> 'is_anonymous')::boolean is not true
  );

-- -- Organizers ------------------------------------------------------------

drop policy if exists organizers_read on public.collection_organizers;
create policy organizers_read on public.collection_organizers
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_collection_organizer(collection_id, auth.uid())
  );

-- Only an existing organizer may promote another. The definer helper is what
-- keeps this from recursing on its own table.
drop policy if exists organizers_promote on public.collection_organizers;
create policy organizers_promote on public.collection_organizers
  for insert to authenticated
  with check (public.is_collection_organizer(collection_id, auth.uid()));

/*
 * Standing down is your own decision; removing somebody else is an
 * organizer's. Both routes go through the same policy, and neither can leave
 * the collection with nobody — see `guard_last_organizer` below.
 */
drop policy if exists organizers_remove on public.collection_organizers;
create policy organizers_remove on public.collection_organizers
  for delete to authenticated
  using (
    user_id = auth.uid()
    or public.is_collection_organizer(collection_id, auth.uid())
  );

-- -- Members ---------------------------------------------------------------

/*
 * A membership row is visible to the two parties it concerns: the deck's own
 * owner, and any organizer of the collection. The *public* listing does not
 * come through here at all — it comes through `collection_members_by_slug`,
 * which is what lets a visitor see an unlisted member deck's tile without
 * this policy having to expose unlisted rows to everyone.
 */
drop policy if exists members_read on public.collection_members;
create policy members_read on public.collection_members
  for select to authenticated
  using (
    public.owns_set(set_id, auth.uid())
    or public.is_collection_organizer(collection_id, auth.uid())
  );

-- An organizer invites a deck. Status pinned, so an invitation cannot be
-- inserted already accepted on the owner's behalf.
drop policy if exists members_invite on public.collection_members;
create policy members_invite on public.collection_members
  for insert to authenticated
  with check (
    status = 'invited'
    and public.is_collection_organizer(collection_id, auth.uid())
  );

-- A creator offers their own deck, to a collection that is open to it.
drop policy if exists members_submit on public.collection_members;
create policy members_submit on public.collection_members
  for insert to authenticated
  with check (
    status = 'submitted'
    and public.owns_set(set_id, auth.uid())
    and public.collection_accepts_submissions(collection_id)
  );

/*
 * Two update policies, because the two parties make two different moves —
 * the same arrangement as `contributions_withdraw`/`contributions_resolve`,
 * and for the same reason.
 *
 * They are permissive and therefore OR together, and each pins in its own
 * `with check` the statuses its side may produce. That is what stops an
 * organizer accepting an invitation on a creator's behalf: their policy can
 * only ever resolve a `submitted` row, never an `invited` one.
 */
drop policy if exists members_owner_decide on public.collection_members;
create policy members_owner_decide on public.collection_members
  for update to authenticated
  using (public.owns_set(set_id, auth.uid()))
  with check (
    public.owns_set(set_id, auth.uid())
    and status in ('accepted', 'declined', 'removed', 'submitted')
  );

drop policy if exists members_organizer_decide on public.collection_members;
create policy members_organizer_decide on public.collection_members
  for update to authenticated
  using (public.is_collection_organizer(collection_id, auth.uid()))
  with check (
    public.is_collection_organizer(collection_id, auth.uid())
    and status in ('accepted', 'declined', 'removed', 'invited')
  );

drop policy if exists members_delete on public.collection_members;
create policy members_delete on public.collection_members
  for delete to authenticated
  using (
    public.owns_set(set_id, auth.uid())
    or public.is_collection_organizer(collection_id, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Column grants, checked before any policy runs
-- ---------------------------------------------------------------------------

revoke all on public.collections from anon, authenticated;
grant select on public.collections to anon, authenticated;
-- `created_by` *is* insertable, and is safe because `collections_insert`
-- checks it against `auth.uid()` — see the column's own note. `slug` and
-- `hidden` stay absent, so neither a share token nor a moderator's decision
-- can be chosen by the client, and neither is checked by any policy.
grant insert (created_by, name, subtitle, blurb, banner_url, visibility, open_submissions)
  on public.collections to authenticated;
grant update (name, subtitle, blurb, banner_url, visibility, open_submissions)
  on public.collections to authenticated;

revoke all on public.collection_organizers from anon, authenticated;
grant select, delete on public.collection_organizers to authenticated;
grant insert (collection_id, user_id) on public.collection_organizers to authenticated;

revoke all on public.collection_members from anon, authenticated;
grant select, delete on public.collection_members to authenticated;
grant insert (collection_id, set_id, status, invited_by)
  on public.collection_members to authenticated;
grant update (status, ready, sort_order) on public.collection_members to authenticated;

-- ---------------------------------------------------------------------------
-- What a policy cannot say
-- ---------------------------------------------------------------------------

/*
 * **`ready` is the deck owner's, `position` is the organizer's — and RLS
 * cannot express that on its own.**
 *
 * A column grant is table-wide, not per-policy, so granting `update (status,
 * ready, position)` grants all three to whichever policy lets the row through
 * — and a `with check` sees only the NEW row, so it cannot notice that an
 * organizer's otherwise-legitimate update also flipped somebody's `ready`.
 * That matters more than it looks: `ready` is what the publish gate reads, so
 * an organizer who could set it could debut a half-finished deck over its
 * author's head, which is the exact thing the gate exists to prevent.
 *
 * A `before update` trigger *can* see OLD, so the rule goes here. Same reason
 * `stamp_contribution_resolved` is a trigger rather than a grant.
 */
create or replace function public.guard_collection_member_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  /*
   * No JWT means no PostgREST user, which means the service role, a migration
   * or a psql session — all already trusted, and none of them reachable
   * through the grants above: `anon` has no update grant at all, so a null
   * uid here can never be an untrusted caller.
   *
   * Without this the guard also blocks the *server's* own maintenance. Found
   * by writing a probe that reset `ready` between attacks and being refused
   * by my own trigger.
   */
  if auth.uid() is null then
    return new;
  end if;

  if new.ready is distinct from old.ready
     and not public.owns_set(new.set_id, auth.uid()) then
    raise exception 'only the deck''s own author may mark it ready';
  end if;

  if new.sort_order is distinct from old.sort_order
     and not public.is_collection_organizer(new.collection_id, auth.uid()) then
    raise exception 'only an organizer may reorder a collection';
  end if;

  /* Readiness is a claim about the deck as it stands. Letting it survive a
     trip out of the collection and back would quietly re-arm the publish gate
     with an assurance nobody gave a second time. */
  if new.status is distinct from old.status and new.status <> 'accepted' then
    new.ready := false;
  end if;

  return new;
end;
$$;

drop trigger if exists collection_members_guard on public.collection_members;
create trigger collection_members_guard
  before update on public.collection_members
  for each row execute function public.guard_collection_member_fields();

/*
 * A collection must never end up with no organizer.
 *
 * Only an organizer may promote one, so an empty organizer table is
 * unrecoverable through PostgREST — the project would need a service role to
 * rescue. Cheaper to refuse the last one leaving, and to say why.
 *
 * **A cascade does not skip a row trigger**, which this file claimed and was
 * wrong about. Deleting a collection cascades to its organizer rows and fires
 * this guard once per row, so the last one tripped it and rolled the whole
 * delete back — a collection could never be deleted at all, and silently,
 * since PostgREST reports a refused delete as zero rows affected. Caught by
 * trying it rather than by re-reading the comment.
 *
 * By the time a cascade reaches the child the parent is already gone inside
 * the same transaction, so the parent's absence is exactly the signal that
 * this delete is a cascade rather than somebody standing down.
 *
 * An account deletion cascading from `profiles` is deliberately left able to
 * remove a last organizer: it orphans the collection, which is survivable and
 * visible, where blocking somebody's account deletion is neither.
 */
create or replace function public.guard_last_organizer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.collections c where c.id = old.collection_id) then
    return old;
  end if;

  if not exists (
    select 1 from public.collection_organizers o
    where o.collection_id = old.collection_id and o.user_id <> old.user_id
  ) then
    raise exception 'a collection needs at least one organizer; promote somebody first';
  end if;
  return old;
end;
$$;

drop trigger if exists collection_organizers_guard_last on public.collection_organizers;
create trigger collection_organizers_guard_last
  before delete on public.collection_organizers
  for each row execute function public.guard_last_organizer();

-- ---------------------------------------------------------------------------
-- Reading a collection by its share token
-- ---------------------------------------------------------------------------

/*
 * The same shape as `set_by_slug`, and safe for the same reasons: exact match
 * on a unique column, `limit 1`, no way to ask it for a list, and `private`
 * excluded so turning a collection private really does revoke a link that was
 * already shared.
 *
 * Supabase's linter will report 0028/0029 against the grant below — a
 * `security definer` function executable by `anon`. Expected, and not to be
 * "fixed": that combination *is* the sharing mechanism, exactly as it is for
 * `set_by_slug`. Silence it and unlisted collections stop working.
 */
create or replace function public.collection_by_slug(share_slug text)
returns setof public.collections
language sql
security definer
set search_path = public
stable
as $$
  select * from public.collections
  where slug = share_slug
    and visibility in ('unlisted', 'public')
    and not hidden
  limit 1;
$$;

revoke all on function public.collection_by_slug(text) from public;
grant execute on function public.collection_by_slug(text) to anon, authenticated;

/*
 * The accepted members of one collection, as a page needs them.
 *
 * This is the function that makes the entire production phase work, and it is
 * where the consent boundary actually lives: it returns a member deck's tile
 * **even when that deck is unlisted**, which no ordinary policy would allow.
 * That is safe only because a deck is here at all by its own owner's
 * acceptance — which is why the accept control has to say so in plain words.
 *
 * Hidden member sets are dropped, matching `set_contributors`' own rule: a
 * moderated set must not reappear through a side door.
 *
 * Returns the columns a tile draws and nothing else — never `document`, which
 * would put a multi-megabyte set behind every tile.
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
    m.sort_order, m.ready
  from public.collection_members m
  join public.collections c on c.id = m.collection_id
  join public.sets s on s.id = m.set_id
  left join public.profiles p on p.id = s.owner_id
  where c.slug = share_slug
    and c.visibility in ('unlisted', 'public')
    and not c.hidden
    and m.status = 'accepted'
    and s.visibility in ('unlisted', 'public')
    and not s.hidden
  order by m.sort_order, s.name;
$$;

revoke all on function public.collection_members_by_slug(text) from public;
grant execute on function public.collection_members_by_slug(text) to anon, authenticated;

/*
 * Which collections a published set appears in, for the reverse link on its
 * own shared page. Accepted membership of a reachable collection only, so
 * this can never disclose a private project or an undecided invitation.
 */
create or replace function public.collections_for_set(target uuid)
returns table (slug text, name text)
language sql
security definer
set search_path = public
stable
as $$
  select c.slug, c.name
  from public.collection_members m
  join public.collections c on c.id = m.collection_id
  where m.set_id = target
    and m.status = 'accepted'
    and c.visibility in ('unlisted', 'public')
    and not c.hidden
  order by c.name;
$$;

revoke all on function public.collections_for_set(uuid) from public;
grant execute on function public.collections_for_set(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Closing the grants `revoke ... from public` does not close
-- ---------------------------------------------------------------------------

/*
 * `revoke all on function ... from public` is **not enough on this project**,
 * and every `revoke` above is written on the assumption that it is.
 *
 * Supabase ships default privileges granting EXECUTE on every new function in
 * `public` to `anon`, `authenticated` and `service_role` at creation time.
 * Those are explicit grants to named roles, so revoking from PUBLIC leaves
 * them entirely untouched — which left `owns_set` and
 * `is_collection_organizer` callable without signing in: an oracle for "does
 * user X own set Y", answerable by anybody with two uuids.
 *
 * Found by reading `proacl` after the fact rather than by trusting the
 * revokes, which is the only way to see it — the migration reads as if it had
 * already locked these down.
 *
 * Only the three reader functions below stay anonymous, because those *are*
 * the sharing mechanism. Everything else here is internal to a policy or a
 * trigger and has no business being an endpoint at all.
 */
revoke execute on function public.is_collection_organizer(uuid, uuid) from anon;
revoke execute on function public.owns_set(uuid, uuid) from anon;
revoke execute on function public.collection_accepts_submissions(uuid) from anon;

revoke all on function public.seed_collection_organizer() from public, anon, authenticated;
revoke all on function public.guard_collection_member_fields() from public, anon, authenticated;
revoke all on function public.guard_last_organizer() from public, anon, authenticated;
