-- ---------------------------------------------------------------------------
-- Contributions: someone offering their changes back to the set they copied
-- ---------------------------------------------------------------------------
--
-- Rung 2. A master owner, with others able to submit changes.
--
-- The shape of the trust here is worth stating once: a contribution is a
-- *proposal*, and nothing in this file lets it become anything else. Accepting
-- one changes a document in the owner's own browser and nowhere else — the
-- owner then re-publishes if they want to, exactly as they would after any
-- other edit. There is deliberately no path by which a stranger's row mutates
-- a published set.

create table if not exists public.set_contributions (
  id uuid primary key default gen_random_uuid(),

  -- The set being offered to. Cascade: a contribution to a set that no longer
  -- exists is not a record worth keeping, it is a proposal with no subject.
  set_id uuid not null references public.sets (id) on delete cascade,

  /*
   * Who offered it. Defaulted rather than supplied, and withheld from the
   * insert grant below, so it comes from the token and cannot be claimed —
   * the same arrangement as `set_reports.reporter_id`.
   *
   * Cascade rather than set null: withdrawing from the service should withdraw
   * what you offered, and an unattributed proposal is not something an owner
   * can weigh.
   */
  contributor_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,

  -- The revision the contributor's copy was taken at. Recorded for the owner's
  -- benefit — "built against revision 2, you are on 5" is the single most
  -- useful thing to know before opening one.
  base_revision integer not null,

  title text not null default '',
  message text not null default '',

  /*
   * The change set: an array of entries, one per entity, each carrying the hash
   * that entity had when the copy was taken. See `sets/contribution.ts`.
   *
   * Data URLs are lifted out into Storage before this is written, exactly as
   * they are for `sets.document` — an offer including new artwork would
   * otherwise put megabytes in a row that gets listed.
   */
  payload jsonb not null,

  -- Denormalised so a list can say "4 changes" without reading the payload.
  entry_count integer not null default 0,

  status text not null default 'open'
    check (status in ('open', 'accepted', 'declined', 'withdrawn')),

  -- Which entries the owner actually took. Partial acceptance is the normal
  -- case, so "accepted" alone would overstate what happened.
  applied_keys text[] not null default '{}',
  resolution_note text not null default '',

  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists set_contributions_set_idx
  on public.set_contributions (set_id, status);

create index if not exists set_contributions_contributor_idx
  on public.set_contributions (contributor_id);

/*
 * One open offer per person per set.
 *
 * Not a rate limit so much as a shape: a second open offer from the same person
 * is a revision of the first, and two of them sitting in an owner's list is a
 * question the owner should not have to answer. Resolved ones are exempt, so a
 * contributor may offer again after a decision.
 */
create unique index if not exists set_contributions_one_open_idx
  on public.set_contributions (set_id, contributor_id)
  where status = 'open';

alter table public.set_contributions enable row level security;

/*
 * Is this set open to being contributed to?
 *
 * `security definer` for the same reason `set_by_slug` is: the table's read
 * policy exposes public sets only, so a policy that checked `sets` directly
 * would refuse every contribution to an *unlisted* set — which is most of
 * them, since an unlisted link is how a set gets shared with the handful of
 * people most likely to work on it.
 */
create or replace function public.set_accepts_contributions(target uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.sets s
    where s.id = target
      and s.visibility in ('unlisted', 'public')
      and not s.hidden
  );
$$;

revoke all on function public.set_accepts_contributions(uuid) from public;
grant execute on function public.set_accepts_contributions(uuid) to authenticated;

-- Visible to the two people it concerns, and to nobody else. Not admins
-- either: moderation is about what is published, and an unresolved proposal
-- between two authors is not published.
drop policy if exists contributions_visible on public.set_contributions;
create policy contributions_visible on public.set_contributions
  for select to authenticated
  using (
    contributor_id = auth.uid()
    or exists (
      select 1 from public.sets s where s.id = set_id and s.owner_id = auth.uid()
    )
  );

drop policy if exists contributions_insert on public.set_contributions;
create policy contributions_insert on public.set_contributions
  for insert to authenticated
  with check (
    contributor_id = auth.uid()
    and status = 'open'
    and public.set_accepts_contributions(set_id)
  );

/*
 * Two update policies, because the two parties may make two different moves.
 *
 * They are permissive and therefore OR together, and each pins the status it
 * is allowed to produce in its own `with check`. That is what stops a
 * contributor marking their own offer accepted: their policy can only ever
 * write 'withdrawn'. `using` restricts both to offers still open, so nothing
 * already decided can be reopened or rewritten.
 */
drop policy if exists contributions_withdraw on public.set_contributions;
create policy contributions_withdraw on public.set_contributions
  for update to authenticated
  using (contributor_id = auth.uid() and status = 'open')
  with check (contributor_id = auth.uid() and status = 'withdrawn');

drop policy if exists contributions_resolve on public.set_contributions;
create policy contributions_resolve on public.set_contributions
  for update to authenticated
  using (
    status = 'open'
    and exists (select 1 from public.sets s where s.id = set_id and s.owner_id = auth.uid())
  )
  with check (
    status in ('accepted', 'declined')
    and exists (select 1 from public.sets s where s.id = set_id and s.owner_id = auth.uid())
  );

/*
 * Column grants, checked before any policy runs.
 *
 * `contributor_id` is absent from the insert grant so it can only come from
 * the token's default. `set_id`, `payload` and `base_revision` are absent from
 * the update grant so a decided offer cannot be quietly rewritten into a
 * different one, and `resolved_at` is absent because the trigger below owns it.
 */
revoke all on public.set_contributions from anon, authenticated;
grant select on public.set_contributions to authenticated;
grant insert (set_id, base_revision, title, message, payload, entry_count)
  on public.set_contributions to authenticated;
grant update (status, applied_keys, resolution_note)
  on public.set_contributions to authenticated;

/*
 * When it was decided, written by the database.
 *
 * The client has no reason to be trusted with a timestamp it could get wrong
 * by a timezone, and no reason to be able to set one at all — the same
 * argument that made `sets.revision` a trigger.
 */
create or replace function public.stamp_contribution_resolved()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status <> 'open' then
    new.resolved_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_contribution_resolved on public.set_contributions;
create trigger stamp_contribution_resolved
  before update on public.set_contributions
  for each row execute function public.stamp_contribution_resolved();

/*
 * How many open offers a set has, for a badge.
 *
 * `security definer` so an owner can count without the count itself needing a
 * readable join, and restricted to the caller's own sets — asking about
 * somebody else's set answers zero rather than refusing, because how popular
 * another author's set is with contributors is not a stranger's business.
 */
create or replace function public.open_contribution_counts()
returns table (set_id uuid, open_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select c.set_id, count(*)
  from public.set_contributions c
  join public.sets s on s.id = c.set_id
  where s.owner_id = auth.uid() and c.status = 'open'
  group by c.set_id;
$$;

revoke all on function public.open_contribution_counts() from public;
grant execute on function public.open_contribution_counts() to authenticated;
