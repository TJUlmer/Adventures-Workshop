-- Gallery previews and the shared TTS save are separate rendered snapshots.
-- Repairing one must not leave administrators unable to repair the other.
-- Keep the old save's paths in the retained manifest: tables already using it
-- must not lose their textures merely because new downloads use a repair.

create or replace function public.refresh_published_tts_save(
  p_source_key text,
  p_asset_paths text[],
  p_published_set_id uuid,
  p_published_revision integer,
  p_save_path text
)
returns table (retention text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_set public.sets%rowtype;
  registered_retention text;
  retained_paths text[];
  updated_count integer;
begin
  if not exists (
    select 1 from public.profiles as profile where profile.id = auth.uid() and profile.is_admin
  ) then
    raise exception 'Only an administrator can refresh a shared TTS copy.' using errcode = '42501';
  end if;
  if p_save_path is null or p_save_path = '' then
    raise exception 'A shared TTS refresh requires its saved object.' using errcode = '22023';
  end if;

  -- Hold the publication stable through validation and the manifest swap.
  -- An author republishing during rendering must never get an older repair.
  select published.*
    into matched_set
    from public.sets as published
   where published.id = p_published_set_id
     and published.local_id = p_source_key
     and published.revision = p_published_revision
     and published.visibility in ('unlisted', 'public')
     and not published.hidden
   for update;
  if matched_set.id is null then
    raise exception 'The published set changed or is no longer available. Look it up and refresh again.'
      using errcode = '40001';
  end if;

  -- Reuse every upload validation from normal registration, including caller
  -- ownership, saved-object membership and existence in Storage. With an
  -- existing shared copy this creates a temporary manifest; the retained
  -- manifest below then protects those same files from cleanup.
  select registered.retention into registered_retention
    from public.register_tts_export(
      p_source_key, p_asset_paths, p_published_set_id, p_published_revision, p_save_path
    ) as registered;

  if registered_retention = 'temporary' then
    select array_agg(distinct path order by path)
      into retained_paths
      from (
        select unnest(export.asset_paths) as path
          from public.tts_exports as export
         where export.published_set_id = matched_set.id
           and export.published_revision = matched_set.revision
           and export.retired_at is null
        union all
        select unnest(p_asset_paths)
      ) as retained;
    if cardinality(retained_paths) > 2000 then
      raise exception 'This repair would exceed the retained TTS asset limit. Publish a new revision instead.'
        using errcode = '22023';
    end if;

    update public.tts_exports as export
       set asset_paths = retained_paths,
           save_path = p_save_path
     where export.published_set_id = matched_set.id
       and export.published_revision = matched_set.revision
       and export.retired_at is null;
    get diagnostics updated_count = row_count;
    if updated_count <> 1 then
      raise exception 'The shared TTS copy changed. Look it up and refresh again.' using errcode = '40001';
    end if;
  end if;

  return query select 'published-current'::text;
end;
$$;

revoke all on function public.refresh_published_tts_save(text, text[], uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.refresh_published_tts_save(text, text[], uuid, integer, text)
  to authenticated;
