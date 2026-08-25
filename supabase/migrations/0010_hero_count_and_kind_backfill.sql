-- ---------------------------------------------------------------------------
-- How many heroes a published row has, and a one-time backfill of `kind`
-- ---------------------------------------------------------------------------
--
-- Two things `0009_set_kind.sql` got wrong in practice.
--
-- **It left every existing row `null` on purpose, and that was the mistake.**
-- The reasoning there — "a row repairs itself on the next natural write, the
-- same as `LibraryEntry.blockers` does locally" — holds for a *local* index an
-- author rewrites constantly by simply working. A published row is not that:
-- nothing rewrites it but a deliberate re-publish, which an author has no
-- reason to do just because a column appeared. So Home's Adventures and Heroes
-- slots read empty against a gallery that plainly had both, and would have
-- stayed empty indefinitely. Backfilled here from each row's own stored
-- document, which is the authority rather than a guess: `document->'set'->>
-- 'kind'` where it exists (schema v28+), and otherwise inferred the way
-- `sets/health.ts` already defines an adventure — it needs a villain. That
-- differs deliberately from `normalizeSet`'s own fallback, which opens a
-- kind-less document as `'adventure'` unconditionally: that default exists so
-- documents written before heroes sets existed still *open*, and every set was
-- an adventure then. Applied to a villain-less box of three heroes it is
-- simply false, which is what it would have said about Forgotten Pantheons.
--
-- **`character_count` cannot answer "how many heroes".** It counts the whole
-- roster — villain, minions and separately-recorded sidekicks included — so it
-- says 5 for a one-villain adventure and 1 for a lone hero. Home's slots split
-- a heroes set by hero count (one hero is "Single hero", more than one is a
-- "Heroes set"), so that number has to be its own denormalised column, the
-- same way `card_count`/`character_count` already are.

alter table public.sets
  add column if not exists hero_count integer not null default 0;

update public.sets s
set
  kind = case
    when s.kind in ('adventure', 'heroes') then s.kind
    when s.document->'set'->>'kind' in ('adventure', 'heroes') then s.document->'set'->>'kind'
    when (
      select count(*) from jsonb_array_elements(
        coalesce(s.document->'set'->'characters', '[]'::jsonb)
      ) c where c->>'role' = 'villain'
    ) > 0 then 'adventure'
    else 'heroes'
  end,
  hero_count = (
    select count(*) from jsonb_array_elements(
      coalesce(s.document->'set'->'characters', '[]'::jsonb)
    ) c where c->>'role' = 'hero'
  );

-- No RLS change, same as 0009: both columns are orthogonal to `owner_id`,
-- `visibility` and `hidden`. `publishSet` sends both on every publish from
-- here on, so this backfill runs once and never needs repeating.
--
-- A scoped hero publish is already correct without a special case: `heroSlice`
-- forces `kind: 'heroes'` on the slice (`sets/scope.ts`) and the slice holds
-- exactly the one hero, so it lands in "Single hero" on its own terms.
