-- Close two holes the database linter found before launch.
--
-- Neither is reachable as an exploit today, and both are the kind of thing
-- that stops being harmless the moment somebody builds on it.

/*
 * `stamp_collection_published` is a trigger function and nothing else. It was
 * added in `0016` without the revoke every other trigger function in this
 * surface gets, so Supabase's default grant left it callable as
 * `/rest/v1/rpc/stamp_collection_published` by anybody at all. A trigger
 * function invoked as an RPC has no NEW row and simply errors, so the
 * exposure is an endpoint rather than a leak — but `guard_last_organizer`,
 * `guard_collection_delete`, `guard_collection_member_fields`,
 * `seed_collection_organizer` and `touch_updated_at` are all revoked, and one
 * exception is how a convention stops being one.
 *
 * Revoking EXECUTE does not stop the trigger: it was created by its owner and
 * runs as such. Verified by inserting a public collection and watching
 * `published_at` still get stamped.
 */
revoke all on function public.stamp_collection_published()
  from public, anon, authenticated;

/*
 * `collection_accepts_submissions` had drifted. `0015` revokes it from anon
 * explicitly, no client calls it, and the only policy that uses it
 * (`members_submit`) is `to authenticated` — but production, which reached
 * its state through nineteen incremental migrations rather than that file,
 * still had the default PUBLIC grant behind it.
 *
 * Worth noting for the next reconciliation: replaying `0015` proved it builds
 * the same *objects* as production, which is not the same as proving it
 * builds the same *privileges*. Grants need their own comparison.
 */
revoke all on function public.collection_accepts_submissions(uuid)
  from public, anon;
grant execute on function public.collection_accepts_submissions(uuid)
  to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.stamp_collection_published()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.stamp_collection_published()', 'EXECUTE') then
    raise exception 'stamp_collection_published is still reachable as an RPC.';
  end if;

  if has_function_privilege('anon', 'public.collection_accepts_submissions(uuid)', 'EXECUTE') then
    raise exception 'collection_accepts_submissions is still executable by anon.';
  end if;

  -- The policy that uses it runs as the caller, so this one must survive.
  if not has_function_privilege('authenticated', 'public.collection_accepts_submissions(uuid)', 'EXECUTE') then
    raise exception 'collection_accepts_submissions is no longer executable by authenticated.';
  end if;
end;
$$;
