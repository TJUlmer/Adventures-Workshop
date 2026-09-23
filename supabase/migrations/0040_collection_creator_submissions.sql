/*
 * A creator who already contributes to a collection may offer another deck.
 *
 * The workspace has always described an accepted deck owner as part of the
 * project, but the submission policy only recognized open submissions and
 * person-level invite claims. That made the organizer's deck invitation the
 * only route for an established creator to add a second deck when submissions
 * were closed.
 *
 * Accepted membership is a narrower grant than open submissions and already
 * exposes the private workspace to that creator. It therefore grants only the
 * right to make another proposal; an organizer must still accept it.
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
      and not c.hidden
  )
  or exists (
    select 1
    from public.collection_invite_claims cl
    join public.collection_invites i on i.id = cl.invite_id
    join public.collections c on c.id = i.collection_id
    where i.collection_id = target
      and cl.user_id = auth.uid()
      and not c.hidden
  )
  or exists (
    select 1
    from public.collection_members m
    join public.sets s on s.id = m.set_id
    join public.collections c on c.id = m.collection_id
    where m.collection_id = target
      and m.status = 'accepted'
      and s.owner_id = auth.uid()
      and not c.hidden
  );
$$;

revoke all on function public.collection_accepts_submissions(uuid)
  from public, anon;
grant execute on function public.collection_accepts_submissions(uuid)
  to authenticated;
