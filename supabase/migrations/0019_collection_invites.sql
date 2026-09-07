-- Invite a person, not a deck.
--
-- `collection_members` is keyed `(collection_id, set_id)`: membership *is* a
-- deck. That is right for what it does and wrong for recruiting, where the
-- whole point is to gather people before anybody has built anything. Rather
-- than make `set_id` nullable — which would disturb every query and policy
-- for one new case — an invitation is its own record, and becomes a
-- membership only when the person offers a deck through the flow that
-- already exists.
--
-- Two ways in, and deliberately no third:
--
--   * **Directed**, at a real person picked from their published work. The
--     organizer never types a name; they reach a profile and invite it, so
--     `invited_user` is an id from the start. Display names are not
--     identities here — nothing makes them unique, 11 of 28 accounts have
--     none, and anyone may rename to anything — so a name is never what an
--     invitation is addressed to.
--   * **By link**, carrying a token and the organizer's own label. For
--     someone who has published nothing yet, or whom the organizer only
--     knows on Discord. No directory, nothing to enumerate.

create table if not exists public.collection_invites (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id) on delete cascade,

  /* Null for a link invitation, until somebody claims it. */
  invited_user uuid references public.profiles (id) on delete cascade,

  /* The organizer's own note — "the Discord person doing the ice hero" —
     shown on the roster until a link invitation is claimed and a real
     profile takes its place. Never shown to the person being invited. */
  label text not null default '',

  token text not null unique default encode(gen_random_bytes(12), 'hex'),
  invited_by uuid references public.profiles (id) on delete set null,
  status text not null default 'open'
    check (status in ('open', 'accepted', 'declined', 'revoked')),
  claimed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* One open invitation per person per collection: an organizer clicking twice
   should not queue two, and a declined one should not block a later change of
   heart. Partial, so only the open ones are constrained. */
create unique index if not exists collection_invites_one_open_per_user
  on public.collection_invites (collection_id, invited_user)
  where invited_user is not null and status = 'open';

create index if not exists collection_invites_for_user
  on public.collection_invites (invited_user)
  where status = 'open';

drop trigger if exists collection_invites_touch_updated_at on public.collection_invites;
create trigger collection_invites_touch_updated_at
  before update on public.collection_invites
  for each row execute function public.touch_updated_at();

alter table public.collection_invites enable row level security;

/*
 * Readable by the organizers who sent it and the person it names. A link
 * invitation names nobody, so it is reachable only through the claim function
 * in `0020` — the token is the capability, and a token nobody holds should not
 * be listable by anyone but the collection's own organizers.
 */
drop policy if exists invites_read on public.collection_invites;
create policy invites_read on public.collection_invites
  for select to authenticated
  using (
    public.is_collection_organizer(collection_id, auth.uid())
    or invited_user = auth.uid()
    or claimed_by = auth.uid()
  );

drop policy if exists invites_create on public.collection_invites;
create policy invites_create on public.collection_invites
  for insert to authenticated
  with check (
    public.is_collection_organizer(collection_id, auth.uid())
    and invited_by = auth.uid()
    and status = 'open'
  );

/*
 * An organizer may revoke; the person named may accept or decline. Two
 * permissive policies, each pinning the statuses its own side may write —
 * the same shape `set_contributions` uses, and for the same reason: a single
 * policy could not express "either of these two roles, but each may only
 * reach certain values".
 */
drop policy if exists invites_organizer_decide on public.collection_invites;
create policy invites_organizer_decide on public.collection_invites
  for update to authenticated
  using (public.is_collection_organizer(collection_id, auth.uid()))
  with check (
    public.is_collection_organizer(collection_id, auth.uid())
    and status in ('revoked', 'open')
  );

drop policy if exists invites_recipient_decide on public.collection_invites;
create policy invites_recipient_decide on public.collection_invites
  for update to authenticated
  using (invited_user = auth.uid())
  with check (invited_user = auth.uid() and status in ('accepted', 'declined'));

drop policy if exists invites_delete on public.collection_invites;
create policy invites_delete on public.collection_invites
  for delete to authenticated
  using (public.is_collection_organizer(collection_id, auth.uid()));

revoke all on public.collection_invites from anon, authenticated;
grant select, delete on public.collection_invites to authenticated;
grant insert (collection_id, invited_user, label, invited_by) on public.collection_invites to authenticated;
grant update (status) on public.collection_invites to authenticated;
