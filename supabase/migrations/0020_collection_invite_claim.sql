/*
 * Take a link invitation.
 *
 * `security definer` because the token *is* the capability: whoever holds the
 * link may claim it, and they match none of `invites_read`'s predicates until
 * they do. Same reasoning as `set_by_slug` — a narrow definer function that
 * returns one row beats a policy wide enough to list what it protects.
 *
 * Directed invitations are not claimable this way. They are addressed to a
 * person already, and that person accepts through the ordinary update policy;
 * letting a token override a name would make the address decorative.
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

  if not found.id is not null then
    return query select ''::text, ''::text, 'not_found'::text;
    return;
  end if;

  select * into home from public.collections c where c.id = found.collection_id;
  if home.id is null or home.hidden then
    return query select ''::text, ''::text, 'not_found'::text;
    return;
  end if;

  if found.status = 'revoked' then
    return query select home.slug, home.name, 'revoked'::text;
    return;
  end if;

  /* Already taken, by somebody else. Said plainly rather than silently
     rebinding: a link that two people opened should not quietly change hands. */
  if found.claimed_by is not null and found.claimed_by <> auth.uid() then
    return query select home.slug, home.name, 'taken'::text;
    return;
  end if;

  update public.collection_invites
  set claimed_by = auth.uid(),
      status = 'accepted'
  where id = found.id;

  return query select home.slug, home.name, 'accepted'::text;
end;
$$;

revoke all on function public.claim_collection_invite(text) from public, anon;
grant execute on function public.claim_collection_invite(text) to authenticated;

/*
 * An invitation is also permission to offer a deck.
 *
 * Without this the feature fails at exactly the case it was built for: an
 * organizer closes submissions, hand-picks five creators, and none of them
 * can offer anything, because `members_submit` asks this function and this
 * function only knew about `open_submissions`. Being invited is a narrower
 * and more deliberate permission than leaving the door open to everyone, so
 * it belongs here rather than forcing organizers to reopen the door.
 *
 * Still `security definer` for the reason recorded in 0015: reading
 * `collections` directly from a policy would refuse every submission to an
 * *unlisted* collection, which is most of them.
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
      and i.status = 'accepted'
      and coalesce(i.invited_user, i.claimed_by) = auth.uid()
      and c.visibility in ('unlisted', 'public')
      and not c.hidden
  );
$$;

revoke all on function public.collection_accepts_submissions(uuid) from public, anon;
grant execute on function public.collection_accepts_submissions(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.claim_collection_invite(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.collection_accepts_submissions(uuid)', 'EXECUTE') then
    raise exception 'Invite functions are reachable by anon.';
  end if;
  if not has_function_privilege('authenticated', 'public.claim_collection_invite(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.collection_accepts_submissions(uuid)', 'EXECUTE') then
    raise exception 'Invite functions are not reachable by signed-in callers.';
  end if;
end;
$$;
