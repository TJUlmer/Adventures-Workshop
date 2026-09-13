-- Persistent proofs for reusing unchanged gallery card PNGs.
--
-- `card_previews` remains the authoritative key-to-URL manifest. This parallel
-- map records the canonical renderer-input hash that produced each URL, so a
-- later publish can skip both photographing and uploading an unchanged face.

alter table public.sets
  add column if not exists card_preview_fingerprints jsonb not null default '{}'::jsonb;

alter table public.sets
  drop constraint if exists sets_card_preview_fingerprints_object;
alter table public.sets
  add constraint sets_card_preview_fingerprints_object
  check (jsonb_typeof(card_preview_fingerprints) = 'object');

grant insert (card_preview_fingerprints) on public.sets to authenticated;
grant update (card_preview_fingerprints) on public.sets to authenticated;

/*
 * Derived preview maintenance must not make a set look newly republished.
 *
 * The first branch is rollout protection: an older client can update the URL
 * manifest without knowing the fingerprint column exists. Clearing the proofs
 * in that case costs one full render on the next modern publish, but prevents a
 * stale proof from ever authorising reuse of a different image.
 */
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.card_previews is distinct from old.card_previews
     and new.card_preview_fingerprints is not distinct from old.card_preview_fingerprints then
    new.card_preview_fingerprints := '{}'::jsonb;
  end if;

  if (to_jsonb(new) - array[
        'social_image_url',
        'social_image_version',
        'card_previews',
        'card_preview_version',
        'card_preview_fingerprints',
        'updated_at'
      ])
     = (to_jsonb(old) - array[
          'social_image_url',
          'social_image_version',
          'card_previews',
          'card_preview_version',
          'card_preview_fingerprints',
          'updated_at'
        ]) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

/*
 * Four-argument overload of the card-preview maintenance RPC. Keeping the
 * older three-argument form available lets an already-open older client finish
 * safely during deployment; `touch_updated_at` clears its proofs if it changes
 * the URL manifest.
 */
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
     or jsonb_typeof(preview_fingerprints) <> 'object'
     or jsonb_object_length(preview_manifest) <> jsonb_object_length(preview_fingerprints) then
    raise exception 'A set, matching preview manifests, and positive renderer version are required.'
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

  for preview in select key, value from jsonb_each_text(preview_manifest)
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
