/*
 * `touch_updated_at` is shared by four tables. Make it safe on all four again.
 *
 * The card-preview work taught it to clear `card_preview_fingerprints` when
 * `card_previews` changes — correct for `sets`, and fatal everywhere else,
 * because reaching `new.card_previews` on a row type without that column
 * raises `record "new" has no field "card_previews"` at runtime. The trigger
 * is also on `collections`, `collection_members` and `collection_invites`,
 * none of which have it, so **every update to any collections table was
 * failing**: changing visibility, toggling submissions, marking a deck ready,
 * answering an invitation, turning off a link.
 *
 * It went unnoticed because the collections tables exist in production while
 * the feature that uses them lives on a branch — so nothing on main ever
 * touched a row that would fail. The general lesson: a trigger function named
 * for something generic is a shared surface, and teaching it one table's
 * columns breaks every other table silently, at runtime, on write.
 *
 * The fix is a nested guard rather than one `and` chain: PL/pgSQL evaluates a
 * boolean expression as SQL, and SQL does not promise to short-circuit, so
 * `to_jsonb(new) ? 'card_previews' and new.card_previews ...` could still
 * evaluate the unsafe half. Nesting makes the order explicit.
 *
 * Behaviour for `sets` is unchanged — verified by driving both branches on a
 * real row inside a transaction that always aborts: previews changed alone
 * clears the fingerprints to `{}`, previews and fingerprints changed together
 * keeps what was written. The second block already coped, since `-` on a
 * jsonb object simply ignores keys that are not there.
 */
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  new_json jsonb := to_jsonb(new);
  old_json jsonb := to_jsonb(old);
begin
  if new_json ? 'card_previews' then
    if new_json -> 'card_previews' is distinct from old_json -> 'card_previews'
       and new_json -> 'card_preview_fingerprints'
           is not distinct from old_json -> 'card_preview_fingerprints' then
      new.card_preview_fingerprints := '{}'::jsonb;
    end if;
  end if;

  if (new_json - array[
        'social_image_url',
        'social_image_version',
        'card_previews',
        'card_preview_version',
        'card_preview_fingerprints',
        'updated_at'
      ])
     = (old_json - array[
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

revoke execute on function public.touch_updated_at() from public, anon, authenticated;
