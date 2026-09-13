-- Keep a provider's real name private unless the account owner chooses it.
--
-- This changes only profiles created after the migration. Existing names may
-- have been deliberately kept or edited to match the provider value, and the
-- schema has no reliable history that would let a backfill distinguish those
-- choices from an untouched default.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'user_name'), ''),
      ''
    ),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Trigger-only function: replacing it must not accidentally make it a Data API endpoint.
revoke execute on function public.handle_new_user()
  from public, anon, authenticated;
