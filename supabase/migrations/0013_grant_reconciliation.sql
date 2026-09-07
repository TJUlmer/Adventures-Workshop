-- Phase 0 grant reconciliation.
--
-- The live catalogue audit found that `sets` and `gallery_characters` retained
-- Supabase's broad object-creation defaults. RLS still restricted rows, but it
-- did not make moderator- and database-owned columns client-owned. This file
-- narrows the grants before private drafts add another exposed table.

-- ---------------------------------------------------------------------------
-- Reports: production already has this safer shape; keep a full replay aligned
-- ---------------------------------------------------------------------------

alter table public.set_reports alter column reporter_id set default auth.uid();

revoke all on public.set_reports from anon, authenticated;
grant insert (set_id, reason) on public.set_reports to anon, authenticated;
grant select, update (resolved) on public.set_reports to authenticated;

-- ---------------------------------------------------------------------------
-- Published sets: author columns are explicit; derived/moderation columns are not
-- ---------------------------------------------------------------------------

revoke all on public.sets from anon, authenticated;

grant select on public.sets to anon, authenticated;

grant insert (
  owner_id,
  local_id,
  name,
  subtitle,
  card_count,
  character_count,
  schema_version,
  document,
  thumbnail_url,
  social_image_url,
  character_cards,
  change_note,
  visibility,
  forked_from,
  forked_from_revision,
  scope,
  character_id,
  kind,
  hero_count
) on public.sets to authenticated;

/*
 * The upsert sends its conflict identity columns again, so those columns need
 * update grants even though their values normally stay put. RLS still requires
 * the resulting owner id to equal `auth.uid()`.
 */
grant update (
  owner_id,
  local_id,
  name,
  subtitle,
  card_count,
  character_count,
  schema_version,
  document,
  thumbnail_url,
  social_image_url,
  character_cards,
  change_note,
  visibility,
  forked_from,
  forked_from_revision,
  scope,
  character_id,
  kind,
  hero_count
) on public.sets to authenticated;

grant delete on public.sets to authenticated;

/*
 * The old admin policy gave the authenticated role an UPDATE route to every
 * column, because grants are checked before policies and cannot distinguish an
 * owner from a moderator. A narrow definer RPC makes the moderation operation
 * the only bypass instead.
 */
create or replace function public.moderate_set(
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
    raise exception 'A set id and moderation decision are required.' using errcode = '22023';
  end if;

  if auth.uid() is null or not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.is_admin
  ) then
    raise exception 'Moderator access required.' using errcode = '42501';
  end if;

  update public.sets
  set hidden = should_hide,
      hidden_reason = case
        when should_hide then left(coalesce(moderation_reason, ''), 1000)
        else ''
      end
  where id = target;

  if not found then
    raise exception 'Published set not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.moderate_set(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.moderate_set(uuid, boolean, text) to authenticated;

drop policy if exists sets_admin_moderate on public.sets;

-- ---------------------------------------------------------------------------
-- Read-only view and internal trigger functions
-- ---------------------------------------------------------------------------

revoke all on public.gallery_characters from anon, authenticated;
grant select on public.gallery_characters to anon, authenticated;

/*
 * These functions are reached only through triggers. Supabase grants new
 * functions directly to both client roles as well as PUBLIC, so all three
 * sources must be revoked explicitly. Existing triggers were created by their
 * owner and continue to run without making the functions Data API endpoints.
 */
revoke execute on function public.touch_updated_at()
  from public, anon, authenticated;
revoke execute on function public.bump_revision()
  from public, anon, authenticated;
revoke execute on function public.stamp_published_at()
  from public, anon, authenticated;
revoke execute on function public.handle_new_user()
  from public, anon, authenticated;
revoke execute on function public.stamp_contribution_resolved()
  from public, anon, authenticated;
revoke execute on function public.index_set_search()
  from public, anon, authenticated;
revoke execute on function public.index_set_characters()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fail the migration rather than silently landing a half-hardened catalogue
-- ---------------------------------------------------------------------------

do $$
begin
  if not has_table_privilege('anon', 'public.sets', 'SELECT')
     or has_table_privilege('anon', 'public.sets', 'INSERT')
     or has_table_privilege('anon', 'public.sets', 'UPDATE')
     or has_table_privilege('anon', 'public.sets', 'DELETE')
     or has_table_privilege('anon', 'public.sets', 'TRUNCATE')
     or has_table_privilege('anon', 'public.sets', 'REFERENCES')
     or has_table_privilege('anon', 'public.sets', 'TRIGGER') then
    raise exception 'Unexpected anon privileges remain on public.sets.';
  end if;

  if not has_table_privilege('authenticated', 'public.sets', 'SELECT')
     or not has_table_privilege('authenticated', 'public.sets', 'DELETE')
     or has_table_privilege('authenticated', 'public.sets', 'INSERT')
     or has_table_privilege('authenticated', 'public.sets', 'UPDATE')
     or has_table_privilege('authenticated', 'public.sets', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.sets', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.sets', 'TRIGGER') then
    raise exception 'Unexpected relation-level authenticated privileges remain on public.sets.';
  end if;

  if not has_column_privilege('authenticated', 'public.sets', 'document', 'INSERT')
     or not has_column_privilege('authenticated', 'public.sets', 'document', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.sets', 'visibility', 'UPDATE')
     or has_column_privilege('authenticated', 'public.sets', 'revision', 'INSERT')
     or has_column_privilege('authenticated', 'public.sets', 'revision', 'UPDATE')
     or has_column_privilege('authenticated', 'public.sets', 'hidden', 'INSERT')
     or has_column_privilege('authenticated', 'public.sets', 'hidden', 'UPDATE')
     or has_column_privilege('authenticated', 'public.sets', 'view_count', 'INSERT')
     or has_column_privilege('authenticated', 'public.sets', 'view_count', 'UPDATE') then
    raise exception 'Published-set column grants do not match the author/database boundary.';
  end if;

  if has_column_privilege('anon', 'public.set_reports', 'reporter_id', 'INSERT')
     or has_table_privilege('anon', 'public.gallery_characters', 'INSERT')
     or has_table_privilege('anon', 'public.gallery_characters', 'UPDATE')
     or has_table_privilege('authenticated', 'public.gallery_characters', 'INSERT')
     or has_table_privilege('authenticated', 'public.gallery_characters', 'UPDATE') then
    raise exception 'Report or gallery grants remain broader than intended.';
  end if;

  if has_function_privilege('anon', 'public.moderate_set(uuid,boolean,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.moderate_set(uuid,boolean,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.index_set_characters()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.index_set_characters()', 'EXECUTE') then
    raise exception 'Function execution grants do not match the reviewed boundary.';
  end if;
end;
$$;
