-- Multiplayer-ready Tabletop Simulator exports.
--
-- These are generated derivatives rather than published-set artwork, so they
-- have their own bucket and lifecycle. TTS must be able to fetch them without
-- an auth header, while uploads remain confined to the uploader's own prefix.

insert into storage.buckets (id, name, public)
values ('tts-assets', 'tts-assets', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists tts_assets_read on storage.objects;
create policy tts_assets_read on storage.objects
  for select
  using (bucket_id = 'tts-assets');

drop policy if exists tts_assets_write on storage.objects;
create policy tts_assets_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tts-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists tts_assets_update on storage.objects;
create policy tts_assets_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'tts-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'tts-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists tts_assets_delete on storage.objects;
create policy tts_assets_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tts-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
