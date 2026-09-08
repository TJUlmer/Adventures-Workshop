/*
 * A collection you accepted an invitation to belongs on your shelf.
 *
 * `my_collections` is from `0015` and knew two ways to belong: you organize
 * it, or a deck of yours is in it. Invitations arrived in `0019` and nothing
 * taught this function about them — so somebody invited by name, who accepted,
 * and who had not yet published anything, watched the collection disappear the
 * moment they left the page. Which is precisely the person the invitation
 * feature exists for: you invite people *before* they have built anything.
 *
 * `my_deck_count` is new and says which kind of belonging this is. Without it
 * the shelf calls every non-organizer "your deck is in this", which for a
 * fresh invitee is both wrong and unhelpful — the useful thing to tell them is
 * that they are in, and a deck is the part still missing.
 *
 * Only *accepted* invitations count. An open one is a question, and it is
 * already asked on Home's attention strip; putting it on the shelf as well
 * would show a collection you have not agreed to join among the ones you have.
 *
 * Dropped and recreated rather than replaced: adding a column changes the row
 * type, which `create or replace` refuses.
 */
drop function public.my_collections();

create function public.my_collections()
returns table (
  id uuid,
  slug text,
  name text,
  subtitle text,
  banner_url text,
  visibility text,
  open_submissions boolean,
  is_organizer boolean,
  deck_count integer,
  my_deck_count integer,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    c.id, c.slug, c.name, c.subtitle, c.banner_url, c.visibility, c.open_submissions,
    public.is_collection_organizer(c.id, auth.uid()) as is_organizer,
    (select count(*)::integer from public.collection_members m2
      where m2.collection_id = c.id and m2.status = 'accepted') as deck_count,
    (select count(*)::integer
       from public.collection_members m3
       join public.sets s3 on s3.id = m3.set_id
      where m3.collection_id = c.id
        and s3.owner_id = auth.uid()
        and m3.status in ('accepted', 'invited', 'submitted')) as my_deck_count,
    c.updated_at
  from public.collections c
  where auth.uid() is not null
    and not c.hidden
    and (
      public.is_collection_organizer(c.id, auth.uid())
      or exists (
        select 1
        from public.collection_members m
        join public.sets s on s.id = m.set_id
        where m.collection_id = c.id
          and s.owner_id = auth.uid()
          and m.status in ('accepted', 'invited', 'submitted')
      )
      or exists (
        select 1 from public.collection_invites i
        where i.collection_id = c.id
          and i.invited_user = auth.uid()
          and i.status = 'accepted'
      )
      or exists (
        select 1
        from public.collection_invite_claims cl
        join public.collection_invites i2 on i2.id = cl.invite_id
        where i2.collection_id = c.id and cl.user_id = auth.uid()
      )
    )
  order by c.updated_at desc;
$$;

revoke all on function public.my_collections() from public, anon;
grant execute on function public.my_collections() to authenticated;
