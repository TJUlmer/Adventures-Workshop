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
 * The picture that stands for one character, and whether it carries bleed —
 * `{"url": …, "bleeds": …}`.
 *
 * Both from one function, because the two have to be answered about the
 * *same* candidate. Split in two they would each re-walk the chain below and
 * could disagree the moment either changed, reporting "no bleed" about a
 * picture the other one did not pick.
 *
 * Only one case bleeds, and only for a hero: a finished replacement deck
 * back, which is supplied on the action card's own 1632×2222 bleed canvas.
 * A villain's or minion's back uses `CARD_FORMATS.cardback`, which declares
 * `bleedMm: 0` and is drawn at trim size — so the same field on two roles
 * means two different things. Everything further down the chain is artwork
 * placed *inside* a card rather than a print plate, and has no bleed at all.
 *
 * **Their deck back first**, and that is the ordering worth explaining. A
 * deck back is the one picture in a set drawn deliberately to *be* that
 * character's face — it carries their name and their portrait, composed by
 * the author for exactly this purpose — where a card's artwork is a scene
 * from one of their moves and a portrait field is something most authors
 * never fill. Every hero published so far uses a finished replacement image
 * for their back (`useReplacement` with `replacement.source`), which is why
 * that is read before `cardback.artwork`: when the flag is on, the
 * replacement *is* the back and the artwork underneath it is not what prints.
 *
 * Then the portrait, then the first picture off one of their own cards. That
 * last step is what rescued the tiles at all: every set published so far has
 * `character.artwork.source` null on every character, with the pictures on
 * cards instead, so a search that stopped at the portrait came up empty for
 * four sets out of six.
 *
 * Array order, not sorted: `limit 1` over `jsonb_array_elements` takes the
 * document's own first card, which is the one the author put first. This
 * mirrors `cloud/thumbnail.ts`'s `characterCover` deliberately — the two
 * answer the same question and must not drift.
 */
create or replace function public.character_picture(doc jsonb, character_id text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with self as (
    select c
      from jsonb_array_elements(
        case jsonb_typeof(doc -> 'characters')
          when 'array' then doc -> 'characters' else '[]'::jsonb end
      ) c
     where c ->> 'id' = character_id
     limit 1
  ),
  plain as (
    select coalesce(
      (select nullif(c -> 'cardback' -> 'artwork' ->> 'source', '') from self),
      (select nullif(c -> 'artwork' ->> 'source', '') from self),
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
    ) as url
  )
  select coalesce(
    (select jsonb_build_object(
              'url', nullif(c -> 'cardback' -> 'replacement' ->> 'source', ''),
              'bleeds', c ->> 'role' = 'hero')
       from self
      where (c -> 'cardback' ->> 'useReplacement')::boolean is true
        and nullif(c -> 'cardback' -> 'replacement' ->> 'source', '') is not null),
    (select jsonb_build_object('url', url, 'bleeds', false)
       from plain where url is not null)
  );
$$;

/* The plain-URL reading of the above, so nothing that only wants a picture
   has to know about bleed. */
create or replace function public.character_image(doc jsonb, character_id text)
returns text
language sql
immutable
set search_path = ''
as $$
  select public.character_picture(doc, character_id) ->> 'url';
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
 * `character_picture(doc, null)` finds nothing and coalesces onward, which is
 * what makes the villain and hero steps safe to write without first checking
 * that the set has one.
 *
 * Built on `character_picture` rather than beside it, so "does this bleed"
 * travels with whichever candidate actually won. Answering the two questions
 * in two functions would mean two walks of this chain, free to disagree the
 * moment either changed — reporting "no bleed" about a picture the other one
 * did not pick.
 */
create or replace function public.set_cover_picture(doc jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('url', nullif(doc -> 'boxArt' ->> 'source', ''), 'bleeds', false)
      where nullif(doc -> 'boxArt' ->> 'source', '') is not null),
    public.character_picture(
      doc,
      (select c ->> 'id'
         from jsonb_array_elements(
           case jsonb_typeof(doc -> 'characters')
             when 'array' then doc -> 'characters' else '[]'::jsonb end
         ) c
        where c ->> 'role' = 'villain' limit 1)),
    public.character_picture(
      doc,
      (select c ->> 'id'
         from jsonb_array_elements(
           case jsonb_typeof(doc -> 'characters')
             when 'array' then doc -> 'characters' else '[]'::jsonb end
         ) c
        where c ->> 'role' = 'hero' limit 1)),
    (select jsonb_build_object('url', nullif(cd -> 'artwork' ->> 'source', ''), 'bleeds', false)
       from jsonb_array_elements(
         case jsonb_typeof(doc -> 'cards')
           when 'array' then doc -> 'cards' else '[]'::jsonb end
       ) cd
      where nullif(cd -> 'artwork' ->> 'source', '') is not null
      limit 1)
  );
$$;

create or replace function public.set_cover_image(doc jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select public.set_cover_picture(doc) ->> 'url';
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
  add column if not exists cover_url text not null default '',
  /* Whether `cover_url` is a full print plate rather than a finished picture —
     see `character_picture`. The gallery trims one that says so, since the
     bleed is the part that exists to be guillotined off. */
  add column if not exists cover_bleeds boolean not null default false,
  /*
   * A picture of each hero's character card, keyed by character id.
   *
   * Written by the **client** at publish, unlike everything else here —
   * because unlike everything else here, it cannot be derived. A character
   * card is composed DOM with no entry in `set.cards` and no finished image
   * behind it, so the only way to have a picture of one is to photograph it
   * in a browser. `cloud/character-cards.ts` does that; this column carries
   * the addresses through to `set_characters` below.
   *
   * Its own column rather than part of `document`, and that is not tidiness:
   * a re-render is a new URL, so folding these into the document would move
   * `revision` on every publish and make every character read as *edited* to
   * `sets/fingerprint.ts`, which is what decides whether a contribution
   * applies cleanly.
   */
  add column if not exists character_cards jsonb not null default '{}'::jsonb;

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
  /* Whether `image_url` is a full print plate. See `sets.cover_bleeds`. */
  image_bleeds boolean not null default false,
  /* A picture of this character's own card, copied out of
     `sets.character_cards`. Empty for everyone but a hero, and for a hero
     published by a build older than the one that started rendering them. */
  card_url text not null default '',
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
  cover jsonb;
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

  cover := public.set_cover_picture(doc);
  new.cover_url := coalesce(cover ->> 'url', '');
  new.cover_bleeds := coalesce((cover ->> 'bleeds')::boolean, false);

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
  /* `character_cards` joins the guard because a re-publish can render new
     previews without the document moving at all — an author on a build that
     never made them, publishing again on one that does. */
  if tg_op = 'UPDATE'
     and old.search_document is not null
     and new.document is not distinct from old.document
     and new.character_cards is not distinct from old.character_cards
  then
    return null;
  end if;

  doc := new.document -> 'set';

  delete from public.set_characters where set_id = new.id;

  insert into public.set_characters
    (set_id, character_id, name, role, position, image_url, image_bleeds, card_url)
  select new.id,
         entry.c ->> 'id',
         public.character_display_name(entry.c),
         coalesce(entry.c ->> 'role', ''),
         (entry.ordinality - 1)::integer,
         coalesce(picture ->> 'url', ''),
         coalesce((picture ->> 'bleeds')::boolean, false),
         coalesce(new.character_cards ->> (entry.c ->> 'id'), '')
    from jsonb_array_elements(
           case jsonb_typeof(doc -> 'characters')
             when 'array' then doc -> 'characters' else '[]'::jsonb end
         ) with ordinality as entry(c, ordinality),
         lateral public.character_picture(doc, entry.c ->> 'id') as picture
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
       sc.image_bleeds,
       sc.position,
       sc.card_url,
       s.id            as set_id,
       s.slug          as slug,
       s.name          as listing_name,
       s.scope         as listing_scope,
       s.thumbnail_url,
       s.cover_url,
       s.cover_bleeds,
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

-- Supabase's creation defaults include writes. This view is an explicitly
-- read-only API surface, so `grant select` must be preceded by a revoke.
revoke all on public.gallery_characters from anon, authenticated;
grant select on public.gallery_characters to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

/*
 * Everything above derives from `document`, which every existing row already
 * has — so every set already published is brought up to date here, and no
 * author has to re-publish anything to appear in a search or a character
 * browse.
 *
 * **Written to bypass the triggers rather than fire them**, and that is worth
 * stating because the obvious version does not work. The obvious version is a
 * no-op `update sets set document = document`, letting the triggers do it —
 * but their guard asks "did the document change", and the answer for a
 * backfill is always no. It happens to work exactly once, on the cold run
 * where `search_document` is still null; run it again after changing one of
 * the derivation functions above and every row is silently skipped, leaving
 * the index disagreeing with the code that built it. Which is what happened:
 * `character_image` learnt to prefer a deck back and nothing moved.
 *
 * So the derivation is re-run directly. Re-runnable from any state, which is
 * what this file claims at the top.
 *
 * Neither `revision` nor `updated_at` may move. A migration is not an edition:
 * `revision` is printed on tiles as "rev N" and `updated_at` as the date a set
 * last changed, and bumping either would tell every reader that six sets were
 * edited on the day this ran. `revision` holds itself — `bump_revision` only
 * moves it for a changed document — but `touch_updated_at` sets `now()`
 * unconditionally on any update, so it is stood down for the one statement
 * that writes to `sets` and restored immediately after.
 */
alter table public.sets disable trigger sets_touch_updated_at;

update public.sets
   set search_document =
         to_tsvector('simple', coalesce(name, ''))
      || to_tsvector(
           'simple',
           coalesce(
             (select string_agg(public.character_display_name(c), ' ')
                from jsonb_array_elements(
                  case jsonb_typeof(document -> 'set' -> 'characters')
                    when 'array' then document -> 'set' -> 'characters' else '[]'::jsonb end
                ) c),
             ''))
      || to_tsvector('simple', coalesce(subtitle, '')),
       cover_url = coalesce(public.set_cover_picture(document -> 'set') ->> 'url', ''),
       cover_bleeds =
         coalesce((public.set_cover_picture(document -> 'set') ->> 'bleeds')::boolean, false);

alter table public.sets enable trigger sets_touch_updated_at;

/* Rebuilt whole, for the same reason the trigger rebuilds rather than diffs:
   a character can have been removed since the last pass. */
delete from public.set_characters;

insert into public.set_characters
  (set_id, character_id, name, role, position, image_url, image_bleeds, card_url)
select s.id,
       entry.c ->> 'id',
       public.character_display_name(entry.c),
       coalesce(entry.c ->> 'role', ''),
       (entry.ordinality - 1)::integer,
       coalesce(picture ->> 'url', ''),
       coalesce((picture ->> 'bleeds')::boolean, false),
       coalesce(s.character_cards ->> (entry.c ->> 'id'), '')
  from public.sets s,
       lateral jsonb_array_elements(
         case jsonb_typeof(s.document -> 'set' -> 'characters')
           when 'array' then s.document -> 'set' -> 'characters' else '[]'::jsonb end
       ) with ordinality as entry(c, ordinality),
       lateral public.character_picture(s.document -> 'set', entry.c ->> 'id') as picture
 where nullif(entry.c ->> 'id', '') is not null
on conflict (set_id, character_id) do nothing;
