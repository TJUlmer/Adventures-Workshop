-- ---------------------------------------------------------------------------
-- Browsing the gallery: searching it properly, and browsing it by character
-- ---------------------------------------------------------------------------
--
-- Run after `0006_scoped_publishing.sql`. Written to be re-runnable.
--
-- Additive only. No column is dropped, no policy is loosened, and the one
-- existing table gains three columns nothing was reading before.
--
-- Four things the gallery could not do, all of them for the same underlying
-- reason: **the only searchable, listable facts about a published set were
-- `name` and `subtitle`.** Everything else about it — who is in it, what they
-- look like — was locked inside `document`, which the gallery deliberately
-- never fetches (that column is the whole set; drawing thirty tiles would mean
-- pulling thirty multi-megabyte documents). So:
--
--   * Searching "Maui" found nothing, because the only row carrying that word
--     is a character inside `Forgotten Pantheons`.
--   * Searching "d" found `Oz Adventure`, because `ilike '*d*'` matches the
--     middle of a word, and "m" found `Louhi`, because every hero-scoped row's
--     subtitle is the words "From {the box}". Both are substring matches
--     doing exactly what they were asked; neither is what anyone means.
--   * There was no way to list heroes as heroes. A hero published inside a box
--     is a row of that box, and nothing said otherwise.
--   * A set whose author never set box art got no tile picture, because the
--     thumbnail is chosen from `boxArt` or a character's own portrait — and
--     in practice authors put their pictures on *cards*, so the search came up
--     empty and the tile fell back to its initials.
--
-- The fix for all four is the same shape: **derive the facts once, at write
-- time, into columns and a table the gallery can actually query.** A trigger
-- does the deriving, which is worth more than it first looks — it means this
-- migration repairs every set already published, with no author having to
-- re-publish anything, and it means a future publish cannot forget to do it.

-- ---------------------------------------------------------------------------
-- Reading a document
-- ---------------------------------------------------------------------------

/*
 * A character's display name, matching `characters/factory.ts`'s
 * `characterLabel` — `name` when the author typed one, else the same
 * " & " join of the identities' own names that the Name field suggests as a
 * placeholder, else the "Untitled {role}" that function ends on.
 *
 * Duplicated here rather than shared, because the alternative is the client
 * computing it and sending it up, and then a set published by an older build
 * indexes under a different rule than one published by a newer build. Derived
 * facts belong on one side of the wire, and this is the side that can be
 * re-run over rows that already exist.
 */
create or replace function public.character_display_name(c jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(c ->> 'name'), ''),
    nullif(
      (select string_agg(part, ' & ')
         from (
           select btrim(c ->> 'printedName') as part
           union all
           select btrim(extra ->> 'name')
             from jsonb_array_elements(
               case jsonb_typeof(c -> 'additionalCards')
                 when 'array' then c -> 'additionalCards'
                 else '[]'::jsonb
               end
             ) extra
         ) parts
        where parts.part is not null and parts.part <> ''),
      ''),
    'Untitled ' || coalesce(nullif(c ->> 'role', ''), 'character')
  );
$$;

/*
 * The picture that stands for one character.
 *
 * Their own portrait first — and then, the part that actually matters in
 * practice, the first picture off one of their own cards. Every set published
 * so far has `character.artwork.source` null on every character and its
 * pictures on cards instead, which is why a tile fell back to initials for
 * four sets out of six. A character with cards has a face; it was simply
 * being looked for in the one place authors do not put it.
 *
 * Array order, not sorted: `limit 1` over `jsonb_array_elements` takes the
 * document's own first card, which is the one the author put first. This
 * mirrors `cloud/thumbnail.ts`'s `coverArtwork` deliberately — the two answer
 * the same question and must not drift.
 */
create or replace function public.character_image(doc jsonb, character_id text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select nullif(c -> 'artwork' ->> 'source', '')
       from jsonb_array_elements(
         case jsonb_typeof(doc -> 'characters')
           when 'array' then doc -> 'characters' else '[]'::jsonb end
       ) c
      where c ->> 'id' = character_id
      limit 1),
    (select nullif(cd -> 'artwork' ->> 'source', '')
       from jsonb_array_elements(
              case jsonb_typeof(doc -> 'cards')
                when 'array' then doc -> 'cards' else '[]'::jsonb end
            ) cd
       join jsonb_array_elements(
              case jsonb_typeof(doc -> 'decks')
                when 'array' then doc -> 'decks' else '[]'::jsonb end
            ) dk
         on dk ->> 'id' = cd ->> 'deckId'
      where dk ->> 'ownerId' = character_id
        and nullif(cd -> 'artwork' ->> 'source', '') is not null
      limit 1)
  );
$$;

/*
 * The picture that stands for a whole set, for a row with no thumbnail.
 *
 * The same order `coverArtwork` uses — box art, the villain, the first hero,
 * then anything at all — because it is answering the same question, just from
 * SQL and without the ability to downscale. That last part is why this is a
 * *fallback* rather than the thumbnail: it is a full-size picture being drawn
 * into a 220px tile, which is wasteful but correct, and it stops being used
 * the moment the author re-publishes and a real 512px thumbnail lands on the
 * row beside it.
 *
 * `character_image(doc, null)` finds nothing and coalesces onward, which is
 * what makes the villain and hero steps safe to write without first checking
 * that the set has one.
 */
create or replace function public.set_cover_image(doc jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(doc -> 'boxArt' ->> 'source', ''),
    public.character_image(
      doc,
      (select c ->> 'id'
         from jsonb_array_elements(
           case jsonb_typeof(doc -> 'characters')
             when 'array' then doc -> 'characters' else '[]'::jsonb end
         ) c
        where c ->> 'role' = 'villain' limit 1)),
    public.character_image(
      doc,
      (select c ->> 'id'
         from jsonb_array_elements(
           case jsonb_typeof(doc -> 'characters')
             when 'array' then doc -> 'characters' else '[]'::jsonb end
         ) c
        where c ->> 'role' = 'hero' limit 1)),
    (select nullif(cd -> 'artwork' ->> 'source', '')
       from jsonb_array_elements(
         case jsonb_typeof(doc -> 'cards')
           when 'array' then doc -> 'cards' else '[]'::jsonb end
       ) cd
      where nullif(cd -> 'artwork' ->> 'source', '') is not null
      limit 1)
  );
$$;

-- ---------------------------------------------------------------------------
-- What a row now carries
-- ---------------------------------------------------------------------------

alter table public.sets
  /*
   * Name, subtitle and every character's name, as one searchable vector.
   *
   * `simple` rather than `english`: these are proper nouns — Louhi, Koschei,
   * Mombi — and an English stemmer would do nothing useful to them while
   * happily stemming "Rogers" to "roger". Nothing here wants linguistics; it
   * wants the words as written.
   *
   * A trigger rather than a `generated always as` column, because the
   * character names come out of `document` through a set-returning function,
   * and a generated column may only call something immutable on its own row.
   */
  add column if not exists search_document tsvector,
  /*
   * A picture for a row whose author never set box art. See
   * `set_cover_image` — deliberately the *unscaled* original, and deliberately
   * only ever read when `thumbnail_url` is empty.
   */
  add column if not exists cover_url text not null default '';

/*
 * GIN, which is the index a tsvector wants for `@@`. Unpartial, unlike
 * `sets_gallery_idx` above it: an author searching their own shelf is a
 * reasonable thing to add later, and this index is small either way.
 */
create index if not exists sets_search_idx
  on public.sets using gin (search_document);

/*
 * One row per character in a published set.
 *
 * This is the table that makes "show me every hero" a query rather than a
 * download. Written only by the trigger below — there is no insert, update or
 * delete grant on it for anyone, the same discipline `sets.revision` follows
 * and for the same reason: a derived fact that a client can write is a
 * derived fact that will eventually disagree with what it was derived from.
 *
 * `character_id` is the document's own id (`char_…`), so it is stable across
 * re-publishes and matches `sets.character_id` on a hero-scoped row — which
 * is what lets the view below tell "this hero, listed inside their box" from
 * "this hero, listed on their own".
 */
create table if not exists public.set_characters (
  set_id uuid not null references public.sets (id) on delete cascade,
  character_id text not null,
  name text not null default '',
  /* `hero`, `villain` or `minion` — `characters/types.ts`'s SELECTABLE_ROLES.
     Not constrained, so a role added to the app later indexes rather than
     failing the publish that introduced it. */
  role text not null default '',
  /* The document's own order, so a roster reads the way its author arranged
     it rather than alphabetically by accident. */
  position integer not null default 0,
  image_url text not null default '',
  primary key (set_id, character_id)
);

create index if not exists set_characters_role_idx on public.set_characters (role);

-- ---------------------------------------------------------------------------
-- Keeping both in step with the document
-- ---------------------------------------------------------------------------

/*
 * Both triggers below open with the same guard, and it is not an optimisation.
 *
 * `record_set_view` bumps `view_count` on every single visit to a shared set.
 * Without the guard, every one of those would re-parse a multi-megabyte
 * `document` and rewrite this set's whole character index — turning a counter
 * increment into the most expensive statement in the schema, on the app's
 * hottest path.
 *
 * Both also test whether the row has *ever* been indexed, and that clause is
 * what makes the backfill at the foot of this file work at all. A backfill is
 * by construction an update that changes nothing, so a guard keyed only on
 * "did anything change" would skip every row it was written to repair —
 * silently, leaving a gallery that searches nothing.
 */
create or replace function public.index_set_search()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  doc jsonb;
  character_names text;
begin
  if tg_op = 'UPDATE'
     and new.search_document is not null
     and new.document is not distinct from old.document
     and new.name is not distinct from old.name
     and new.subtitle is not distinct from old.subtitle
  then
    return new;
  end if;

  doc := new.document -> 'set';

  select coalesce(string_agg(public.character_display_name(c), ' '), '')
    into character_names
    from jsonb_array_elements(
      case jsonb_typeof(doc -> 'characters')
        when 'array' then doc -> 'characters' else '[]'::jsonb end
    ) c;

  new.search_document :=
       to_tsvector('simple', coalesce(new.name, ''))
    || to_tsvector('simple', character_names)
    || to_tsvector('simple', coalesce(new.subtitle, ''));

  new.cover_url := coalesce(public.set_cover_image(doc), '');

  return new;
end;
$$;

drop trigger if exists sets_index_search on public.sets;
create trigger sets_index_search
  before insert or update on public.sets
  for each row execute function public.index_set_search();

/*
 * The character index, rebuilt whole rather than diffed.
 *
 * AFTER, not BEFORE, and that is forced rather than chosen: `set_characters`
 * references `sets(id)`, so on an INSERT the parent row has to exist before
 * a child can point at it. Delete-then-insert rather than an upsert because
 * a re-publish can *remove* a character, and an upsert would leave them
 * listed in the gallery forever.
 *
 * `security definer`, because no client role has any write on this table and
 * the publishing author must not need one.
 *
 * `old.search_document` is what this reads as "has this row been indexed
 * before" — see the guard note above. It is `old`'s rather than `new`'s
 * because the BEFORE trigger has already run by now and filled `new`'s in,
 * so `new` can no longer tell a first indexing from a repeat one.
 */
create or replace function public.index_set_characters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  doc jsonb;
begin
  if tg_op = 'UPDATE'
     and old.search_document is not null
     and new.document is not distinct from old.document
  then
    return null;
  end if;

  doc := new.document -> 'set';

  delete from public.set_characters where set_id = new.id;

  insert into public.set_characters (set_id, character_id, name, role, position, image_url)
  select new.id,
         entry.c ->> 'id',
         public.character_display_name(entry.c),
         coalesce(entry.c ->> 'role', ''),
         (entry.ordinality - 1)::integer,
         coalesce(public.character_image(doc, entry.c ->> 'id'), '')
    from jsonb_array_elements(
           case jsonb_typeof(doc -> 'characters')
             when 'array' then doc -> 'characters' else '[]'::jsonb end
         ) with ordinality as entry(c, ordinality)
   where nullif(entry.c ->> 'id', '') is not null
  on conflict (set_id, character_id) do nothing;

  return null;
end;
$$;

drop trigger if exists sets_index_characters on public.sets;
create trigger sets_index_characters
  after insert or update on public.sets
  for each row execute function public.index_set_characters();

-- ---------------------------------------------------------------------------
-- Reading the character index
-- ---------------------------------------------------------------------------

alter table public.set_characters enable row level security;

/*
 * Readable exactly when the set it belongs to is. Mirrors `sets_public_read`
 * rather than restating its condition loosely — a character index that
 * outlived its set's takedown would be a takedown that leaked the roster.
 */
drop policy if exists set_characters_public_read on public.set_characters;
create policy set_characters_public_read on public.set_characters
  for select
  using (exists (
    select 1 from public.sets s
    where s.id = set_id and s.visibility = 'public' and not s.hidden
  ));

drop policy if exists set_characters_owner_read on public.set_characters;
create policy set_characters_owner_read on public.set_characters
  for select to authenticated
  using (exists (
    select 1 from public.sets s where s.id = set_id and s.owner_id = auth.uid()
  ));

-- Read only, for everyone. The trigger is the only writer. See the table above.
revoke all on public.set_characters from anon, authenticated;
grant select on public.set_characters to anon, authenticated;

/*
 * Every published character, once.
 *
 * The deduplication is the whole point of the view. A hero published both
 * inside their box and on their own is *one* character with two listings, and
 * showing them twice in a character browse is the confusing outcome. `distinct
 * on (owner_id, local_id, character_id)` collapses them, and the ordering
 * picks which listing survives: a row published as *this specific character*
 * wins over the box that contains them, because a reader clicking Louhi wants
 * Louhi's own page when there is one.
 *
 * `parent_slug`/`parent_name` are the other half — the whole set this
 * character belongs to, when that is public too. For a character reached
 * through their box those equal the listing itself, which the client checks
 * for rather than the view trying to null out; the view's job is to say what
 * is true, not to guess what will be drawn.
 *
 * `security_invoker`, so the reader's own RLS decides. The `where` clause
 * would answer the same either way — it is written out because a view that
 * depends on the invoker setting for its security is a view one `alter` away
 * from leaking, and this one does not.
 */
create or replace view public.gallery_characters
with (security_invoker = on) as
select distinct on (s.owner_id, s.local_id, sc.character_id)
       sc.character_id,
       sc.name,
       sc.role,
       sc.image_url,
       sc.position,
       s.id            as set_id,
       s.slug          as slug,
       s.name          as listing_name,
       s.scope         as listing_scope,
       s.thumbnail_url,
       s.cover_url,
       s.owner_id,
       s.local_id,
       s.published_at,
       s.view_count,
       parent.slug     as parent_slug,
       parent.name     as parent_name
  from public.set_characters sc
  join public.sets s on s.id = sc.set_id
  left join lateral (
    select p.slug, p.name
      from public.sets p
     where p.owner_id = s.owner_id
       and p.local_id = s.local_id
       and p.scope = 'full'
       and p.visibility = 'public'
       and not p.hidden
     limit 1
  ) parent on true
 where s.visibility = 'public' and not s.hidden
 order by s.owner_id, s.local_id, sc.character_id,
          (s.scope <> 'full' and s.character_id = sc.character_id) desc,
          s.published_at desc nulls last;

grant select on public.gallery_characters to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

/*
 * Everything above derives from `document`, which every existing row already
 * has — so every set already published is brought up to date here, and no
 * author has to re-publish anything to appear in a search or a character
 * browse. A no-op update fires both triggers, and their "has this ever been
 * indexed" clause is what lets a no-op through.
 *
 * Neither `revision` nor `updated_at` may move. A migration is not an edition:
 * `revision` is printed on tiles as "rev N" and `updated_at` as the date a set
 * last changed, and bumping either would tell every reader that six sets were
 * edited on the day this ran.
 *
 * `revision` holds itself — `bump_revision` only moves it for a changed
 * document. `updated_at` does not: `touch_updated_at` sets it to `now()`
 * unconditionally, and being a BEFORE trigger it runs *after* this statement's
 * own assignment and overwrites it. Hence disabling it rather than assigning
 * around it. Re-enabled immediately, in the same transaction as the migration,
 * so a failure anywhere here cannot leave the table without it.
 */
alter table public.sets disable trigger sets_touch_updated_at;

update public.sets set document = document;

alter table public.sets enable trigger sets_touch_updated_at;
