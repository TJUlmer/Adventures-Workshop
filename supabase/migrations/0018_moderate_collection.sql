-- A moderation route for collections, matching the one `sets` has.
--
-- `collections.hidden` already did the work — it clears the gallery listing
-- and kills the unfurl, both verified — but there was no way to set it except
-- a hand-written statement run with the service role, which answers to no
-- admin check and leaves no reason behind. `moderate_set` (0013) is the shape
-- this follows, for the same reason it exists: grants are checked before
-- policies and cannot tell an owner from a moderator, so the narrow definer
-- RPC is the only bypass rather than a column grant.

-- Why a reason at all: a takedown that cannot say why is one nobody can
-- appeal or review. `sets` carries one; a collection is more public than a
-- set, not less.
alter table public.collections
  add column if not exists hidden_reason text not null default '';

create or replace function public.moderate_collection(
  target uuid,
  should_hide boolean,
  moderation_reason text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target is null or should_hide is null then
    raise exception 'A collection id and moderation decision are required.'
      using errcode = '22023';
  end if;

  if auth.uid() is null or not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.is_admin
  ) then
    raise exception 'Moderator access required.' using errcode = '42501';
  end if;

  /*
   * The collection only. Its member decks belong to other people and are
   * separately published, separately linkable and separately moderatable —
   * taking a box down must not take down work that merely sat in it, and a
   * moderator who does want a deck gone has `moderate_set` for that.
   */
  update public.collections
  set hidden = should_hide,
      hidden_reason = case
        when should_hide then left(coalesce(moderation_reason, ''), 1000)
        else ''
      end
  where id = target;

  if not found then
    raise exception 'Collection not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.moderate_collection(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.moderate_collection(uuid, boolean, text) to authenticated;

do $$
begin
  -- Reachable by a signed-in caller (the function itself checks is_admin),
  -- never by a stranger.
  if has_function_privilege('anon', 'public.moderate_collection(uuid,boolean,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.moderate_collection(uuid,boolean,text)', 'EXECUTE') then
    raise exception 'moderate_collection grants do not match the moderator boundary.';
  end if;

  -- `hidden` and `hidden_reason` stay the database's, not an organizer's:
  -- otherwise a moderated collection could simply unhide itself.
  if has_column_privilege('authenticated', 'public.collections', 'hidden', 'UPDATE')
     or has_column_privilege('authenticated', 'public.collections', 'hidden_reason', 'UPDATE')
     or has_column_privilege('authenticated', 'public.collections', 'hidden', 'INSERT')
     or has_column_privilege('authenticated', 'public.collections', 'hidden_reason', 'INSERT') then
    raise exception 'Moderation columns are writable by organizers.';
  end if;
end;
$$;
