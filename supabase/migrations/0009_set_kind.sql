-- ---------------------------------------------------------------------------
-- A published row remembers whether it is an adventure or a heroes set
-- ---------------------------------------------------------------------------
--
-- `scope` (0006_scoped_publishing.sql) says whether a row is a whole set, one
-- hero, or the villain side — it says nothing about what *kind* of set the
-- author built, because nothing needed to ask that until now. Home's gallery
-- sample wants to label one slot "Adventures set" and another "Heroes set",
-- and a `scope = 'full'` row alone cannot tell those apart: both publish the
-- same shape of row today.

alter table public.sets
  add column if not exists kind text
    check (kind is null or kind in ('adventure', 'heroes'));

-- No RLS change: orthogonal to `owner_id`/`visibility`/`hidden`, the same
-- reasoning `scope`/`character_id` needed none of in 0006.
--
-- Nullable, no default, and deliberately never backfilled. A row published
-- before this migration stays `null` until its author republishes — cloud
-- rows are a copy, never the source of truth, so there is nothing here worth
-- guessing at. `null` simply never matches `kind=eq.adventure` or
-- `kind=eq.heroes`, so an old row quietly sits out of both category slots
-- until it is current again. Only the *columns the app selects*
-- (`SUMMARY_COLUMNS` in `cloud/sets.ts`) need `kind` added for the client to
-- read it back.
