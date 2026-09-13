-- Version and safely refresh the fixed bitmaps used for link previews.
--
-- Social images are rendered by the browser: the card renderer, fonts, Canvas,
-- and optional WebGL figure snapshots do not exist inside a SQL migration or
-- the Edge middleware. The version makes old bitmaps discoverable, while the
-- narrow RPC lets an admin browser replace only that derived image without
-- impersonating a new publication by changing its document or revision.

alter table public.sets
  add column if not exists social_image_version integer not null default 0;

alter table public.sets
  drop constraint if exists sets_social_image_version_nonnegative;
alter table public.sets
  add constraint sets_social_image_version_nonnegative
  check (social_image_version >= 0);

grant insert (social_image_version) on public.sets to authenticated;
grant update (social_image_version) on public.sets to authenticated;

create index if not exists sets_social_image_version_idx
  on public.sets (social_image_version);

/*
 * Maintenance of derived preview pixels is not an author edit. The old trigger
 * stamped every UPDATE, which would make a bulk style rollout reorder shelves
 * and claim that every set was updated today. Comparing the row with only the
 * two preview fields removed preserves the old behaviour for every real edit.
 */
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['social_image_url', 'social_image_version', 'updated_at'])
     = (to_jsonb(old) - array['social_image_url', 'social_image_version', 'updated_at']) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.refresh_set_social_image(
  target uuid,
  preview_url text,
  preview_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  marker constant text := '/storage/v1/object/public/set-assets/';
  asset_name text;
begin
  if target is null or nullif(btrim(preview_url), '') is null or preview_version < 1 then
    raise exception 'A set, preview URL, and positive renderer version are required.'
      using errcode = '22023';
  end if;

  if auth.uid() is null or not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.is_admin
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if position(marker in preview_url) = 0 then
    raise exception 'The preview must be an uploaded set asset.' using errcode = '22023';
  end if;

  asset_name := split_part(split_part(preview_url, marker, 2), '?', 1);
  if asset_name !~ ('^' || auth.uid()::text || '/' || target::text ||
      '/social-[0-9a-f]{8}[.](png|webp)$')
     or not exists (
       select 1
       from storage.objects object
       where object.bucket_id = 'set-assets' and object.name = asset_name
     ) then
    raise exception 'The uploaded preview could not be verified.' using errcode = '22023';
  end if;

  update public.sets
     set social_image_url = btrim(preview_url),
         social_image_version = preview_version
   where id = target;

  if not found then
    raise exception 'Published set not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.refresh_set_social_image(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.refresh_set_social_image(uuid, text, integer)
  to authenticated;
