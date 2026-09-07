/*
 * Somebody invited to a collection may look at it.
 *
 * Found by driving the invitation: Home said "You are invited to a
 * collection" and could not name which, because the embed that fetches the
 * collection alongside the invitation returned null. None of the existing
 * read policies fit an invitee — they are for creators, organizers, and
 * people whose deck is already a member — so the one person being asked to
 * say yes was the one person who could not see what they were saying yes to.
 *
 * A `security definer` helper rather than an `exists` inside the policy,
 * because the direct version recurses: a policy on `collections` that reads
 * `collection_invites` triggers that table's own policy, which would have to
 * read `collection_invite_claims`, whose policy reads `collection_invites`
 * again. Postgres refuses that outright. The function sidesteps it by not
 * being subject to RLS at all, which is the same reason
 * `is_collection_organizer` exists.
 */
create or replace function public.is_collection_invitee(target uuid, who uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select who is not null and (
    exists (
      select 1 from public.collection_invites i
      where i.collection_id = target
        and i.invited_user = who
        and i.status in ('open', 'accepted')
    )
    or exists (
      select 1
      from public.collection_invite_claims cl
      join public.collection_invites i on i.id = cl.invite_id
      where i.collection_id = target and cl.user_id = who
    )
  );
$$;

revoke all on function public.is_collection_invitee(uuid, uuid) from public, anon;
grant execute on function public.is_collection_invitee(uuid, uuid) to authenticated;

/*
 * Read only. An invitation is not membership and grants nothing else: it
 * cannot edit the collection, cannot see its other invitations, and reaches
 * the decks through `collection_members_by_slug` exactly as any other holder
 * of the link would.
 */
drop policy if exists collections_invitee_read on public.collections;
create policy collections_invitee_read on public.collections
  for select to authenticated
  using (public.is_collection_invitee(id, auth.uid()));
