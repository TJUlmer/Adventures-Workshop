# Collections — one box, many creators

**Phase 1 is built, deployed, and carrying real data.** This was written as a
specification before any of it existed, and everything below is still that
document, kept as it was — the reasoning it records is what the code now does.
Only the status has moved: build steps 1–8 are marked **done** at the foot of
this file, and `0015_collections.sql` is applied to production with live
collections in it.

Still open: the `middleware.ts` unfurl needs a deploy to confirm (step 8), and
everything under *Deliberately not in phase 1* — the combined box export,
pinned revisions — is unbuilt.

The goal is **a themed box assembled from decks that several people each own
outright** — the shape the Unmatched community already works in, where ten
creators each build one deck to a blanket theme and the result ships as one
project under one link. Spring Scramble is the standing example; "Winter
Extravaganza" is the worked one below.

It is written backwards from that: every decision exists because taking it
later would be a migration, and taking it now costs nothing.

---

## The workaround, and what is wrong with it

Today this is reachable, badly. One person owns a master set; everyone else
forks it, builds their deck inside the copy, and offers it back as a
contribution. It works, and four things about it are wrong:

- **Alice does not own her deck in any visible sense.** The master owner does.
  `set_contributors` credits her, but as a flat "these people helped" list —
  not "Alice made *this* deck".
- **She cannot patch it.** A balance fix after launch is another contribution,
  waiting on someone else's review.
- **It never reaches her own shelf.** Her best work of the year is not on her
  profile, not in the gallery under her name, not forkable from her.
- **Every addition re-merges the whole box.** A sixth creator arriving in week
  six means the master merges six entities by hand, republishes, and every
  export anyone generated is stale.

The objection is not to a master owner as such. It is that the workaround puts
*ownership* where only *curation* was wanted.

---

## The one rule that makes this possible

> **A collection is not a set. It holds no document — it points at published
> rows that other people own.**

The instinct is "one set, many owners", and it fights everything: `sets` is
keyed `(owner_id, local_id, scope, character_id)`, `sets_owner_all` is
`auth.uid() = owner_id`, and the cloud-is-never-the-source-of-truth rule means
a document lives in exactly one person's browser. Multi-owner *documents* are
a rewrite of the whole storage model.

They are also unnecessary. A deck of the kind these projects are made of is
already a first-class published object: a one-hero **heroes set**, published
whole, is exactly what `listPublicSets` already calls a "Single hero" and what
Home already has a permanent gallery slot for. `heroSlice` even forces
`kind: 'heroes'` when a hero is sliced out of a larger box, so both shapes
qualify without special-casing.

So the missing noun is a **collection**: a named, themed, ordered pointer at N
published rows owned by N people. Alice keeps owning her deck, keeps her shelf
entry, keeps her gallery listing, and patches it whenever she likes without
asking anyone.

**A collection is deliberately not a `SetKind`.** That enum describes
documents, and this is not one.

---

## "Latest published" is the only thing on offer

The first instinct is to worry about a collection exposing someone's
half-finished work in progress. It cannot: **the cloud never sees an author's
working document.** `publishSet` writes a copy, and nothing reads back the
other way. A member row *is* a snapshot, taken when its author last chose to
publish.

So "follow the latest published version" needs no column and no mechanism — it
is what a pointer at a row already does. Bob edits locally all week and the
collection shows nothing new until he publishes.

The real distinction is narrower:

- **Follow latest published** — the default, free.
- **Pin a revision** — `collection_members.pinned_revision`, freezing the box
  as it debuted, so a ZIP downloaded in December is the one that shipped in
  October.

These are not exclusive, and the second is not needed on day one. Following
latest is obviously right during production; pinning is arguably right after
launch. `forked_from_revision` is the existing precedent for storing exactly
this, and adding the column later is an addition rather than a migration — so
it is left out of phase 1 on purpose.

---

## The finding that shapes the export: merge at the object graph, not the document

The prize is "download the whole box as one file". The obvious route —
concatenate N `AdventureSet` documents into one — hits three walls, and all
three are load-bearing:

- **Entity ids collide by design.** `sets/fork.ts` preserves every id
  deliberately, so that a contribution can say "this card changed and nothing
  else did". Two creators who forked the same starter template therefore hold
  genuinely identical ids. Re-minting them to merge would destroy the
  fingerprint relationship that makes contributions work at all.
- **The style cascade has one set-level layer.** `resolveStyleForCard` reads
  `set.style` above `character.style`. Ten decks with ten set layers merged
  into one document means one layer wins and nine decks silently restyle —
  invisible until someone exports and finds every card wrong. Fixing it means
  flattening each member's set layer down into its character layer at merge
  time, which is a real transformation on someone else's design.
- **Set-level singletons do not merge.** `threat`, `map`, `initiativeBack`,
  `boxArt`, `meta` — one each, and no rule for choosing.

Concatenating the **finished object graphs** sidesteps all three, because each
document is rendered by its own author's styling, independently, and only the
outputs are joined:

- **Tabletop Simulator.** `placeSavedObjects(states, index)` already positions
  by a running index — the existing figure loop does exactly this. And
  `writeAsset` names every file by a **content hash** of its own bytes, so N
  bundles written into one folder dedupe shared assets and cannot collide on a
  name. The multi-source case works for free, on machinery that exists for an
  unrelated reason (defeating TTS's URL texture cache).
- **Print sheets.** `print/sheet.ts` already groups pages by printed size. N
  members is more pages in the same buckets.
- **Card PNGs.** A folder per creator.

> **The combined download is only offered when every member is a heroes-scope
> deck.** A collection of full adventures, each with its own map and threat
> track, is not a box and should not pretend to be one — it stays a
> browse-and-download-individually page.

---

## Governance: make ownership low-stakes rather than eliminating it

The requirement is "no master owner". That cannot reach zero — someone's
`auth.uid()` is on the insert, and moderation needs an accountable anchor; a
collection nobody owns is a takedown hole. But the role can be made nearly
ceremonial, which is what was actually wanted.

**Roles, not an owner** — and they attach to **people, not decks**, which is a
correction this document's first draft got wrong. It put `role` on the
membership row; that cannot work, because a membership row is keyed by
`set_id`, so whoever creates a collection has no row at all until they add a
deck of their own, and would have no way to invite anybody into the thing they
just made. It also ties a curation right to a deck when the two are plainly
separate: an organizer may run a project without contributing to it.

So `collection_organizers` is its own table, keyed by person, and
`collection_members` is only ever "which decks are in".
`collections.created_by` is audit only and carries no privilege — a trigger
seeds the creator as the first organizer, because doing that as a second
client-side insert is one failed request away from a collection nobody can
administer, and only an organizer may create one.

Then the permissions are split so that an organizer cannot damage anyone:

| Action | Who |
|---|---|
| Edit name, blurb, banner, ordering | any organizer |
| Accept a submission, send an invitation | any organizer |
| Flip visibility | any organizer |
| Promote another organizer | any organizer |
| Remove **your own** deck, or leave | that deck's owner, alone |
| Remove someone else's deck | any organizer — but it only **unlinks**; that deck's own row, slug, shelf entry and gallery listing are untouched |

Once removal is non-destructive and departure is unilateral, "who owns the
collection" stops being a power question and becomes a housekeeping one. The
bus factor goes with it: an organizer who disappears mid-project blocks
nothing.

**Transfer is therefore uninteresting** and needs no special mechanism —
promote someone and leave.

### Membership is a proposal, decided by the other party

Exactly the trust shape contributions already have, and deliberately so — the
RLS writes itself from an existing, attacked-and-tested precedent.

Two directions, both ending in the *other* side's acceptance:

- **Creator submits** — the collection is open for submissions; a creator
  points their published deck at it; an organizer accepts.
- **Organizer invites** — an organizer adds a deck by its share link; that
  deck's owner accepts.

The policy shape is `0004_contributions.sql`'s: **two permissive `update`
policies that OR together, each pinning in its own `with check` the status its
own side is allowed to produce.** An organizer's policy can only ever write
`accepted`/`removed` on a collection they organize; a member's can only ever
write `accepted`/`declined` on a row naming a set they own. Neither can forge
the other's decision, for the same reason a contributor cannot mark their own
offer accepted.

---

## The consent boundary, which must be said out loud in the UI

`sets_public_read` exposes only `visibility = 'public'`, and `set_by_slug`
returns one row per token. Neither can serve a collection page listing five
**unlisted** decks — which is the entire production phase.

So the collection needs its own `security definer` function taking a
collection slug and returning its accepted members' rows, unlisted ones
included, gated on the collection itself being unlisted-or-public and not
hidden. Same shape as `set_contributors`, including its `and not s.hidden`
clause.

That creates a real privacy boundary, and it is fine *because* it is
consent-gated — but the consent has to be visible:

> **Accepting membership makes your deck reachable to anyone holding this
> collection's link.**

That sentence belongs on the accept button, not in a help page. An unlisted
deck inside a public collection becomes publicly reachable through it, and
nobody should discover that after the fact.

---

## The worked timeline

Six creators, ten weeks. `[exists]` marks what the app already does.

**Week 0 — the idea.** Maya signs in `[exists]`, creates "Winter Extravaganza"
as an **unlisted** collection, and gets a link with an unguessable slug. The
collection is empty; it is a container, not a document. She pastes the link
into a Discord, and **that same link is the one the community will eventually
get** — it changes state, not address.

**Week 1 — five people build five decks.** Each creates a local set, picks
**Heroes set**, builds one hero: character card, action deck, sidekick,
artwork, tokens `[exists]`. Nobody has signed in to do any of it. Five
independent local-first documents in five browsers.

**Week 2 — publishing and joining.** Each publishes their deck **unlisted**
`[exists]`, getting their own slug and `revision 1`. Membership goes through in
either direction, and the other side accepts. The collection page now shows
five tiles, each carrying **its own creator's name** — the
`author:profiles(display_name, avatar_url)` embed the gallery already uses
`[exists]`.

**Weeks 3–8 — the production loop.** Priya rebalances and republishes with a
change note; `revision` bumps, and only on a real document change, since the
trigger tests `document is distinct from old.document` — a visibility flip does
not inflate it `[exists]`.

Tom forks Ines's deck, fixes an ability's wording, and offers it back; she
reviews and accepts, applied in her own browser to her own document `[exists]`.
**Peer review across an unlisted, in-production box needs no new code at all**,
because `set_accepts_contributions` is `security definer` precisely so it can
gate on `visibility in ('unlisted','public')` rather than on the read policy.

Playtesting means six separate TTS exports loaded one at a time — workable,
clunky, and the concrete argument for the combined export.

**Week 6 — Sol joins.** Builds a deck, publishes unlisted, submits it; Dev
accepts. **Nothing about the other five changes** — no re-merge, no
re-publish, no stale exports, nobody's document touched. Adding the sixth deck
is inserting one row.

**Week 7 — Maya goes quiet.** Dev is already an organizer and keeps things
moving. Nothing he can do damages anyone (see the table above).

**Week 9 — release candidate.** All six mark ready. Banner art and ordering
land. "Download the whole box" produces one TTS save and one print run.

**Week 10 — launch.** An organizer flips the collection **public**. The link
unfurls with banner and blurb. Each creator separately chooses whether to make
their own deck public too, so it also stands alone in the gallery and on their
profile — two doors to one deck.

**Week 12+ — after.** Priya patches an overtuned hero and republishes.
Following latest, everyone gets it. Someone from the community forks a deck to
make a variant, credited with its revision `[exists]`; someone else offers a
card fix from outside the group entirely `[exists]`.

---

## Four frictions the timeline surfaced

Each is a decision, not a bug.

1. **A collection has no local document.** It exists only as a cloud row, so it
   cannot be drafted offline — the one place the local-first rule bends.
   Defensible: it is metadata *about* published rows, which are already
   cloud-only, and its members cannot exist offline either. Worth stating
   rather than discovering.
2. **A member whose kind does not fit.** Someone builds a full adventure, with
   a villain and a map, for a box of heroes. It cannot join the combined
   export. The collection should declare what it accepts, or at minimum warn
   when a member's `kind` differs from the rest.
3. **Schema skew over a long project.** Sol publishes from a newer build at a
   higher `schema_version`; Maya, who has not reloaded in weeks, **cannot open
   his deck** — newer files are refused outright, never guessed at. On a
   ten-week project against a shipping app this *will* happen. The collection
   page must say "this deck needs a newer version of the workshop", not fail
   opaquely.
4. **An account deletion.** `sets.owner_id` cascades from `profiles`, so a
   deleted account takes its published decks with it, and the membership rows
   cascade away in turn. The collection survives with five tiles. That has to
   degrade visibly rather than silently.

---

## Database — migration `0015_collections.sql`

Two tables, no change to `sets` at all.

Numbered `0015` rather than `0012`, which is what it was written and deployed
as. Production records it under timestamped versions, so the number here only
ever governed a clean replay — and it had to move once `0012_tts_assets.sql`
was baselined into the live ledger under that number and the cloud-drafts work
reserved `0013`/`0014`. The file's own header carries the same warning worth
repeating: **this is already applied to production and must not be re-run.**

```
collections
  id           uuid primary key
  created_by   uuid not null references profiles (id) on delete set null
  slug         text not null unique   -- unguessable, as sets.slug
  name, subtitle, blurb, banner_url
  visibility   text check (visibility in ('private','unlisted','public'))
  hidden       boolean not null default false   -- moderation, held apart
  open_submissions boolean not null default false
  created_at, updated_at

collection_organizers
  collection_id uuid not null references collections (id) on delete cascade
  user_id       uuid not null references profiles (id) on delete cascade
  primary key (collection_id, user_id)

collection_members
  collection_id uuid not null references collections (id) on delete cascade
  set_id        uuid not null references sets (id) on delete cascade
  status        text check (status in ('invited','submitted','accepted','declined','removed'))
  ready         boolean not null default false
  sort_order    integer not null default 0   -- not `position`: a reserved
                                             -- column keyword in RETURNS TABLE
  primary key (collection_id, set_id)
```

Notes that are not obvious:

- **`created_by` is `on delete set null`, never cascade.** An organizer
  deleting their account must not delete other people's project. This is the
  same lesson `forked_from` already carries — `owner_id`'s cascade has
  destroyed a published set once.
- **`set_id` *is* `on delete cascade`.** An unpublished deck should leave the
  collection; the collection must survive it. Nothing cascades upward.
- **`hidden` is held apart from `visibility`**, exactly as on `sets`, so a
  takedown leaves the organizers' own setting alone and kills the link as well
  as the listing.

### One new function, and one footgun

`collection_by_slug(text)` mirrors `set_by_slug` — `security definer`, exact
match on a unique column, `limit 1`, `private` excluded so revoking a link
works. The read policy on `collections` must be `visibility = 'public'`
**only**; the tempting "unlisted or public" would let one query return every
unlisted collection's token, which is the same trap `0001_sets.sql` documents
at length.

`collection_members_by_slug(text)` is the one described under *the consent
boundary* above.

> **The recursion footgun.** The natural policy on `collection_members` is "may
> I write this row? — am I an organizer of this collection?", which queries
> `collection_members` from a policy *on* `collection_members`. That is the
> classic Postgres RLS infinite recursion. A `security definer` helper
> (`is_collection_organizer(collection_id, uid)`) runs with definer rights,
> bypasses RLS, and breaks the cycle — the same technique
> `set_accepts_contributions` already uses for a different reason.

---

## What changes on screen

- **A collection page**, at a real path. `/collection/{slug}` earns the same
  exception `/shared/{slug}` has, for the same reason and no other: a link
  unfurler fetches over plain HTTP and a fragment never leaves the browser, so
  a hash route cannot be previewed in Discord. It needs a `middleware.ts`
  match beside the existing one. **Do not read this as permission for more
  real paths.**
- **Banner, blurb, and a tile grid** — each tile the gallery's own, showing
  cover, deck name, creator, and revision.
- **"Add my deck" / "Invite a deck"**, and a pending-decisions list on each
  side. Reuse the contributions screen's shape; it is the same verb.
- **A readiness line** — "4 of 6 ready" — computed from membership rows alone,
  with no document fetches.
- **A reverse link** on each member's own `/shared/{slug}`: *part of Winter
  Extravaganza*. Cheap, and it is what makes the thing read as a project
  rather than a list of links.

---

## Deliberately not in phase 1

- **The combined export.** It is the prize, and it is a separate piece of work
  on the export side that touches no schema. Phase 1 is worth shipping without
  it: a curated, correctly-credited, one-link page where each deck's existing
  export already works.
- **Pinned revisions** (`pinned_revision`) — see above; an addition later, not
  a migration.
- **Any merged *document*.** Adopting a whole box into one local set runs into
  all three walls above and buys nothing the object-graph merge does not.
- **Collections containing collections.** No.
- **A `kind` for collections.** They are not documents.

---

## Open decisions

- ~~**Does going public require every member's `ready`?**~~ **Decided: yes,
  with an override.** The gate fits the consent theme and stops one eager
  organizer debuting someone's half-finished deck, but an absent member must
  not be able to freeze a project indefinitely — so the control names who is
  not ready and lets an organizer go anyway, rather than sitting disabled with
  nothing to be done about it.
- **Should members be pushed to publish publicly at launch?** Staying unlisted
  and reachable only through the box is a legitimate creative choice ("these
  decks exist only as part of this project"). Per-member, not forced either
  way — but the launch flow should ask rather than leave it to chance.
- **Does the collection get its own social image**, or reuse the first
  member's? `cloud/social-image.ts` composes from cards and would need a
  collection-shaped variant. A banner the organizers upload is the cheap
  answer and probably the right one.
- **Ordering** — manual `position`, or by acceptance date? Manual, presumably,
  but it is one more thing organizers must agree on.
- ~~**Is there a lighter first outing?**~~ **Decided: no — build phase 1
  proper.** A bare `sets.collection_tag` plus a gallery filter is an
  afternoon's work, but it buys no curation, no ordering, no banner and no
  consent, and its "one link" is a filter rather than a page. What is being
  asked for is a *project's home*, which a filter cannot be.

- ~~**Which database does the branch develop against?**~~ **Decided:
  production.** `DEPLOYMENT.md` warns that preview builds share the production
  database, and says to decide this before the branch rather than during. It is
  safe here for one specific reason: `0012` is purely additive — two new
  tables, no `alter` on `sets`, and nothing in the shipped app reads them — so
  the migration cannot affect live data by existing. Re-read that reasoning
  before any later migration; it does not generalise.

---

## Rough size

**Phase 1** is comparable to the fork-and-lineage work: two tables, RLS
mirroring two existing patterns, three `security definer` functions, one
screen, one middleware match, and an "add to collection" control on the
publish side.

The notable part is what it does *not* touch: **no document change, no
`SET_SCHEMA_VERSION` bump, no `sets/normalize.ts` branch, no change to `sets`.**
It is a curation layer over rows that already exist, so the risk to anyone's
local library is zero.

**Phase 2**, the combined export, is a new multi-set bundle path that reuses
every renderer unchanged and still touches no schema. Not in the first
milestone — see the build order.

---

## Build order — phase 1

Eight steps, ordered so each leaves something that can be looked at rather than
a half-wired layer. Nothing here bumps `SET_SCHEMA_VERSION` or touches
`sets/normalize.ts`; if a step starts wanting to, stop and re-read *the one
rule* above, because a collection has begun turning into a set.

All of it on its own branch — and, since this runs alongside ordinary work on
`main`, in its own worktree, so switching between the two never means stashing:

    git worktree add ../Adventures_Workshop-collections -b collections

### 1. `supabase/migrations/0015_collections.sql` — **done**

Both tables, their RLS, and three `security definer` functions:
`collection_by_slug`, `collection_members_by_slug`, and
`is_collection_organizer`. The third is not a convenience — it is what breaks
the RLS recursion described above, and writing the policies without it is the
one way this step fails outright.

The two membership `update` policies mirror `0004_contributions.sql`'s
`contributions_withdraw`/`contributions_resolve` exactly: permissive, ORed,
each pinning in its own `with check` the statuses its own side may produce.

**Verify by attacking it, not by reading it.** Anonymously: `select` on
`collections` returns public rows only; `select` on `collection_members`
directly returns nothing; `collection_by_slug` returns the row for an unlisted
slug and nothing for a private one. Signed in as a non-member: writing
`accepted` onto somebody else's membership row is refused. This is the only
step here where a mistake is a security bug rather than a visual one.

### 2. `src/lib/cloud/collections.ts` — **done**

The client module, shaped like `cloud/contributions.ts`: types, then one
function per verb — `createCollection`, `updateCollection`,
`fetchCollectionBySlug`, `listMyCollections`, `listCollectionMembers`,
`inviteDeck`, `submitDeck`, `respondToInvitation`, `setMemberReady`,
`reorderMember`, `removeMember`, `promoteToOrganizer`,
`setCollectionVisibility`.

**Every public read passes `anonymous: true`.** The rule from `cloud/sets.ts`
applies unchanged and for the same reason: RLS answers identically either way,
but a *stale* token makes PostgREST refuse the request outright, so a signed-in
visitor with an overnight session would see an empty collection while a
stranger saw it fine. A collection link is exactly the kind that gets opened
weeks after it was pasted.

### 3. Navigation, and the second real path — **done**

`View` gains `{ kind: 'collection'; slug: string }`;
`openCollection`/`leaveCollection` mirror `openShared`/`leaveShared`, including
the `#returnTo` bookkeeping and the URL clearing — a collection is the second
real path in this app, so leaving it through a bare `openHome()` strands
`/collection/{slug}` in the address bar to reassert itself on the next reload.
That is the trap `leaveShared`'s own doc comment already records.

`readCollectionSlug()` reads the path form *and* a hash fallback, as
`readSharedSlug` does. `vercel.json` gains a second rewrite. `App.svelte` routes
it outside `AppShell`, beside `GalleryScreen` and `SharedSetScreen`.

### 4. `CollectionScreen`, read-only — **done**

Banner, blurb, and the tile grid — the gallery's own tile, so per-creator
attribution comes free from the `author:profiles(…)` embed. Its header carries
the standing shell-less set: Home, Gallery, `ThemeToggle`, `AccountMenu`.

Read-only first, seeded with a collection and two members inserted by hand in
SQL. That is what makes steps 1–3 verifiable end to end before any authoring UI
exists to confuse the picture.

### 5. Creating and editing a collection — **done**

"New collection" from Home; then name, subtitle, blurb, banner and the
visibility control on the collection page itself, for organizers only.

### 6. Membership, both directions — **done**

"Add my deck" for a signed-in author with published sets; "Invite a deck" for an
organizer, by share link. Both land as a pending row the *other* side decides.

The accept control carries the consent sentence verbatim — see *the consent
boundary* — and it belongs on the button, not behind a help link.

Pending decisions surface on Home's attention strip, which already answers
"contributions waiting on a decision" and is the right place for "an invitation
waiting on you".

### 7. Readiness, and the publish gate — **done**

The per-member `ready` flag, the "4 of 6 ready" line, and the gate on going
public: it names who is not ready and offers to publish anyway, so an absent
member cannot freeze the project.

### 8. The reverse link, and the unfurl — **done** (unfurl needs a deploy to confirm)

*Part of Winter Extravaganza* on each member's own `/shared/{slug}`, which is
what makes the thing read as a project rather than a list of links.

Then `middleware.ts`: `/collection/:slug*` on the matcher, and a
`collection_by_slug` call beside the existing `set_by_slug` one. Last,
deliberately — it is the one step `vite dev` cannot test, having no Edge Runtime
to run it in, so verifying it means a real deploy plus either a spoofed bot
User-Agent or a paste into Discord. Discord caches unfurls per URL aggressively,
so budget a throwaway slug for the second attempt.

### Not in this milestone

The combined box export (phase 2), pinned revisions, and any merged document.
Each deck exports individually through its own shared page meanwhile — which is
exactly what the production phase of the worked timeline already assumes.
