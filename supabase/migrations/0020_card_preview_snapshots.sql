-- Lossless, authoritative card pictures for shared-set galleries.
--
-- The browser photographs the same CardRenderer used by PNG export before it
-- publishes a row. The manifest lives outside the document because these are
-- derived pixels, not authored data; refreshing them must not change the set's
-- content revision or contribution fingerprints.

alter table public.sets
  add column if not exists card_previews jsonb not null default '{}'::jsonb,
  add column if not exists card_preview_version integer not null default 0;

alter table public.sets
  drop constraint if exists sets_card_previews_object;
alter table public.sets
  add constraint sets_card_previews_object
  check (jsonb_typeof(card_previews) = 'object');

alter table public.sets
  drop constraint if exists sets_card_preview_version_nonnegative;
alter table public.sets
  add constraint sets_card_preview_version_nonnegative
  check (card_preview_version >= 0);

grant insert (card_previews, card_preview_version) on public.sets to authenticated;
grant update (card_previews, card_preview_version) on public.sets to authenticated;

create index if not exists sets_card_preview_version_idx
  on public.sets (card_preview_version);

/* Regenerating derived pixels is maintenance, not a claim that the author
   edited or republished the set. */
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array[
        'social_image_url',
        'social_image_version',
        'card_previews',
        'card_preview_version',
        'updated_at'
      ])
     = (to_jsonb(old) - array[
          'social_image_url',
          'social_image_version',
          'card_previews',
          'card_preview_version',
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
 * An administrator may backfill an old publication without taking ownership
 * of it or moving its revision. Every URL has to name a real PNG uploaded for
 * this exact row beneath the administrator's own protected Storage prefix.
 */
create or replace function public.refresh_set_card_previews(
  target uuid,
  preview_manifest jsonb,
  preview_version integer
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
     or preview_version < 1 then
    raise exception 'A set, preview manifest, and positive renderer version are required.'
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
       or position(marker in preview.value) = 0 then
      raise exception 'Every card preview must have a key and uploaded URL.'
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
         card_preview_version = preview_version
   where id = target;
end;
$$;

revoke execute on function public.refresh_set_card_previews(uuid, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.refresh_set_card_previews(uuid, jsonb, integer)
  to authenticated;
