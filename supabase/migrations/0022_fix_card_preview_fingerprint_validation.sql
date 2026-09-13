-- Repair the fingerprint-aware card-preview maintenance RPC.
--
-- PostgreSQL has `jsonb_array_length` but no `jsonb_object_length`. PL/pgSQL
-- accepts the function body when it is created and only resolves that call at
-- execution, so migration 0021 succeeded but an administrator refresh failed.
-- Validate both directions of the key relationship instead: the preview loop
-- proves every URL has a fingerprint, and the explicit check rejects any
-- fingerprint that has no corresponding URL.

create or replace function public.refresh_set_card_previews(
  target uuid,
  preview_manifest jsonb,
  preview_version integer,
  preview_fingerprints jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  marker constant text := '/storage/v1/object/public/set-assets/';
  preview record;
  asset_name text;
begin
  if target is null
     or preview_manifest is null
     or jsonb_typeof(preview_manifest) <> 'object'
     or preview_version is null
     or preview_version < 1
     or preview_fingerprints is null
     or jsonb_typeof(preview_fingerprints) <> 'object' then
    raise exception 'A set, matching preview manifests, and positive renderer version are required.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_object_keys(preview_fingerprints) as fingerprint(key)
     where not (preview_manifest ? fingerprint.key)
  ) then
    raise exception 'Every card preview fingerprint must have a matching preview.'
      using errcode = '22023';
  end if;

  if auth.uid() is null or not exists (
    select 1
      from public.profiles p
     where p.id = auth.uid() and p.is_admin
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.sets s where s.id = target) then
    raise exception 'Published set not found.' using errcode = 'P0002';
  end if;

  for preview in select key, value from pg_catalog.jsonb_each_text(preview_manifest)
  loop
    if nullif(btrim(preview.key), '') is null
       or nullif(btrim(preview.value), '') is null
       or position(marker in preview.value) = 0
       or coalesce(preview_fingerprints ->> preview.key, '') !~ '^[0-9a-f]{16}$' then
      raise exception 'Every card preview must have a key, uploaded URL, and fingerprint.'
        using errcode = '22023';
    end if;

    asset_name := split_part(split_part(preview.value, marker, 2), '?', 1);
    if asset_name !~ ('^' || auth.uid()::text || '/' || target::text ||
        '/card-preview-[0-9a-f]{8}-[0-9a-f]{8}[.]png$')
       or not exists (
         select 1
           from storage.objects object
          where object.bucket_id = 'set-assets' and object.name = asset_name
       ) then
      raise exception 'An uploaded card preview could not be verified.'
        using errcode = '22023';
    end if;
  end loop;

  update public.sets
     set card_previews = preview_manifest,
         card_preview_version = preview_version,
         card_preview_fingerprints = preview_fingerprints
   where id = target;
end;
$$;

revoke execute on function public.refresh_set_card_previews(uuid, jsonb, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.refresh_set_card_previews(uuid, jsonb, integer, jsonb)
  to authenticated;
