-- ---------------------------------------------------------------------------
-- Contributor credit: who helped build a published set
-- ---------------------------------------------------------------------------
--
-- Everything in `set_contributions` is private between the two people it
-- concerns — `contributions_visible` sees to that, and nothing here loosens
-- it. What this adds is a narrower question with a very different answer: not
-- "what did they propose", but "did this set take anything from them at all".
--
-- That is safe to make public precisely because it reveals nothing new. The
-- changes a contributor's work produced are already sitting in the published
-- document for anyone to see — naming who made them is a credit on work
-- already visible, not a leak of anything that was not. The proposal itself
-- (payload, message, declined offers, anything still open) stays exactly as
-- private as it was.

create or replace function public.set_contributors(target uuid)
returns table (display_name text, avatar_url text)
language sql
security definer
set search_path = public
stable
as $$
  select distinct p.display_name, p.avatar_url
  from public.set_contributions c
  join public.profiles p on p.id = c.contributor_id
  join public.sets s on s.id = c.set_id
  where c.set_id = target
    and c.status = 'accepted'
    /*
     * `array_length` rather than a bare truthiness check on `applied_keys`:
     * an offer can be marked accepted with nothing actually taken from it —
     * ExportPanel does exactly that when every entry conflicted and the owner
     * still wanted to close it out — and a credit for zero changes taken is
     * not a credit, it is a false one.
     */
    and coalesce(array_length(c.applied_keys, 1), 0) > 0
    -- The same visibility rule as `set_accepts_contributions`: a set that
    -- cannot be found cannot have its contributors listed either.
    and s.visibility in ('unlisted', 'public')
    and not s.hidden
  order by p.display_name;
$$;

revoke all on function public.set_contributors(uuid) from public;
grant execute on function public.set_contributors(uuid) to anon, authenticated;
