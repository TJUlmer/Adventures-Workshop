-- A link invitation admits more than one person.
--
-- One link per project is how recruiting actually works — an organizer posts
-- it to the group chat once. Five single-use links to invite five people is
-- busywork, and the thing it bought (knowing exactly who a link was for) was
-- never real anyway: a link can be forwarded whatever the schema says.
--
-- The trade is explicit and belongs in the UI: **anyone holding the link can
-- join, so it is not for posting publicly.** A collection's own share link
-- shows the box; this one puts you in it.
--
-- So a claim becomes its own row. `collection_invites.claimed_by` cannot hold
-- five people, and widening it would have meant a column that means one thing
-- for a directed invitation and another for a link.

create table if not exists public.collection_invite_claims (
  invite_id uuid not null references public.collection_invites (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (invite_id, user_id)
);

create index if not exists collection_invite_claims_user
  on public.collection_invite_claims (user_id);

alter table public.collection_invite_claims enable row level security;

/*
 * An organizer sees who has joined through their link; a claimant sees their
 * own row and nobody else's. Reading the claims of a collection you have
 * nothing to do with would be a roster of strangers.
 */
drop policy if exists invite_claims_read on public.collection_invite_claims;
create policy invite_claims_read on public.collection_invite_claims
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.collection_invites i
      where i.id = invite_id
        and public.is_collection_organizer(i.collection_id, auth.uid())
    )
  );

/*
 * Claims are written only by `claim_collection_invite`, which holds the token
 * check. No insert policy and no insert grant: possession of the link is the
 * permission, and a policy cannot see a token.
 */
drop policy if exists invite_claims_remove on public.collection_invite_claims;
create policy invite_claims_remove on public.collection_invite_claims
  for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.collection_invites i
      where i.id = invite_id
        and public.is_collection_organizer(i.collection_id, auth.uid())
    )
  );

revoke all on public.collection_invite_claims from anon, authenticated;
grant select, delete on public.collection_invite_claims to authenticated;

/*
 * Claiming, now that a link admits many.
 *
 * Idempotent: opening the link twice is not an error, and the second visit
 * says `accepted` exactly as the first did. The old single-use `taken`
 * outcome is gone with the thing it described.
 */
create or replace function public.claim_collection_invite(invite_token text)
returns table (collection_slug text, collection_name text, outcome text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  found public.collection_invites%rowtype;
  home public.collections%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to accept an invitation.' using errcode = '42501';
  end if;

  select * into found
  from public.collection_invites i
  where i.token = invite_token
    and i.invited_user is null
  limit 1;

  if found.id is null then
    return query select ''::text, ''::text, 'not_found'::text;
    return;
  end if;

  select * into home from public.collections c where c.id = found.collection_id;
  if home.id is null or home.hidden then
    return query select ''::text, ''::text, 'not_found'::text;
    return;
  end if;

  /* Revoking stops the link admitting anybody *new*. It deliberately does not
     eject the people already in: killing a leaked link must not throw out the
     five creators it was shared with, and removing one of them is a separate,
     deliberate act with its own control. */
  if found.status = 'revoked' then
    if exists (
      select 1 from public.collection_invite_claims c2
      where c2.invite_id = found.id and c2.user_id = auth.uid()
    ) then
      return query select home.slug, home.name, 'accepted'::text;
    else
      return query select home.slug, home.name, 'revoked'::text;
    end if;
    return;
  end if;

  insert into public.collection_invite_claims (invite_id, user_id)
  values (found.id, auth.uid())
  on conflict do nothing;

  return query select home.slug, home.name, 'accepted'::text;
end;
$$;

revoke all on function public.claim_collection_invite(text) from public, anon;
grant execute on function public.claim_collection_invite(text) to authenticated;

/*
 * Permission to offer a deck, now reading claims rather than `claimed_by`.
 *
 * A claim outlives its link's revocation on purpose — see the note above.
 * An organizer who wants somebody out deletes their claim, which is the
 * granularity the situation actually calls for.
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
      and c.visibility in ('unlisted', 'public')
      and not c.hidden
  )
  or exists (
    select 1
    from public.collection_invite_claims cl
    join public.collection_invites i on i.id = cl.invite_id
    join public.collections c on c.id = i.collection_id
    where i.collection_id = target
      and cl.user_id = auth.uid()
      and c.visibility in ('unlisted', 'public')
      and not c.hidden
  );
$$;

revoke all on function public.collection_accepts_submissions(uuid) from public, anon;
grant execute on function public.collection_accepts_submissions(uuid) to authenticated;
