# Collaboration — rung 1: forking with lineage

> **Built, 12 August 2026, along with rung 2 on top of it.** This document is
> kept as the record of why it is shaped this way. Where it says "nothing here
> is built", read it as the state at the time of writing. The rung 2 design it
> anticipates — a change set of whole entities, conflicts found from the fork
> fingerprint, acceptance applied locally — is what was built; see
> `sets/contribution.ts` and the Contributions section of `CLAUDE.md`.

A specification, not a change. Nothing here is built.

The goal is **a master owner, with others able to submit changes** — rung 2 in
the ladder we sketched. This document specifies rung 1, which is the copy
mechanism underneath it, and it is written backwards from rung 2: every
decision below exists because taking it later would be a migration, and taking
it now costs nothing.

---

## The reversal, said out loud

Two days ago the shared-set screen lost its "Add to my library" button, and
`CLAUDE.md` records the reason: it made every share link a fork button, so an
author's set would go on being edited by someone else under the author's name.

Rung 1 puts copying back. That is not a change of mind — the objection was
never to copying, it was to copying that **erased where the set came from**. A
copy that carries its origin, shows it on the tile, and can offer its changes
back is the opposite of the thing that was removed. The button returns with a
different name, a different sentence under it, and a record attached.

What stays true: adopting still never touches the original, and the original's
author still decides what their set is.

---

## The one rule that makes rung 2 possible

> **A fork keeps every id inside the document. Only the set's own id changes.**

Card ids, deck ids, character ids, figure ids — all preserved. This already
happens, by accident, in the code that was removed: it did a `structuredClone`
and replaced `copy.id` alone. Rung 1 makes it deliberate and writes down why.

Without it, a contribution can only ever say "here is a whole new set". With
it, a contribution says "card `card_9f3e…` changed, and nothing else did",
which is a thing an owner can look at and accept in one click.

There is no collision risk. Cards are only ever looked up within their own set
(`set.cards.filter(…)`), and the library is keyed by set id — so two sets in
one library holding the same card ids is not merely tolerable, it is the point.

---

## The finding that shapes everything: there is no base to diff against

Rung 2 needs a three-way comparison — **base** (what the fork started from),
**theirs** (the original as it is now), **mine** (the fork as it is now). Only
that tells "I changed this" apart from "they changed this", and a two-way diff
against the current original will silently propose reverting the owner's own
edits.

The base is not available. Publishing overwrites, by your explicit choice —
there is no revision history, so revision 2's document ceases to exist the
moment revision 3 is published. Recording the base at fork time is therefore
the only chance to have it, and once a fork is a week old the chance is gone.

The obvious fix — keep a copy of the base document inside the fork — doubles
every set's footprint in `localStorage`, which is already the storage headroom
problem listed as still open. So instead:

> **A fork records a hash per entity, not the entity.**

For each card, deck, character and figure, plus one for each of the
un-addressed singletons (`set:threat`, `set:map`, `set:style`, `set:meta`), the
fork stores a short content hash of it as it was at fork time. Then at
contribution time, for every id:

| in base | mine differs | theirs differs | meaning |
|---|---|---|---|
| yes | no | no | untouched — ignore |
| yes | **yes** | no | a clean proposal |
| yes | no | yes | the owner moved on — leave alone |
| yes | **yes** | **yes** | conflict — show both, owner decides |
| no | — | — | I added it |
| gone from mine | — | — | I deleted it |

That is a complete change-set at card granularity, and it needs none of the
base *content* — only the answer to "was this the same before?". Displaying
"before" for a clean proposal is a separate, easy problem: for those entities
the original has not touched, the original's current published copy **is** the
before.

Cost: roughly sixty entities × (id + 16 hex characters) ≈ **4 KB per fork**,
against several megabytes for the document. Computing it means hashing the
embedded artwork too, which is the expensive part — once, at fork time, and
never again.

The hash is hand-rolled like everything else: a key-sorted canonical
stringify, then FNV-1a to 64 bits, hex. Key order has to be canonical or an
unchanged card reads as changed after a round-trip through `JSON.stringify`.

### The alternative, and why not

A `set_revisions` table storing each published document would give a real base,
and version history with it. It is rejected for the same reason you rejected
history in the first place: it multiplies storage by the number of times anyone
presses publish, for a feature nobody asked for. If you ever want history for
its own sake, it subsumes the fingerprint and the fingerprint can be dropped.

---

## Document model

`SET_SCHEMA_VERSION` goes **11 → 12**. One new optional field on the set:

```ts
/**
 * Where this set was copied from, if it was.
 *
 * `null` for anything authored from scratch. Never rewritten after a fork:
 * this describes an event, not a relationship, so it stays true even if the
 * original is withdrawn, renamed or deleted.
 */
export interface SetOrigin {
  /** The share token copied from. The handle a person can still click. */
  slug: string;
  /** The published row's id — what a contribution will be addressed to. */
  setId: string;
  /** The revision copied. This is the merge base, and the reason for all of it. */
  revision: number;
  /** The author's display name at the time. A credit, never an authority. */
  authorName: string;
  copiedAt: IsoDateTime;
  /**
   * Content hash per entity id, as it was at the moment of copying. Absent on
   * a fork taken before the fingerprint existed, which is why every reader of
   * it must treat it as optional rather than assume rung 1 wrote it.
   */
  fingerprint: Record<string, string>;
}
```

`sets/normalize.ts` gets a branch filling `origin: null`, as every new
persisted field must, or existing documents load without it.

Two things the field is deliberately **not**: it is not a live link (the
original may be gone, and the fork must still open), and it is not permission
to do anything (nothing about a fork is enforced by it).

---

## Database — migration `0003_forks.sql`

```sql
alter table public.sets
  add column forked_from uuid references public.sets(id) on delete set null,
  add column forked_from_revision int;
```

`on delete set null`, emphatically **not** cascade. `sets.owner_id` already
cascades from `profiles`, and that cascade has already destroyed a published
set once during a tidy-up of test accounts. An original being deleted must
orphan its forks, never take them with it.

A self-referencing foreign key also buys the gallery its embed for free, the
same way `owner_id → profiles` did:

```
forked_from:sets!forked_from(slug,name,owner_id,profiles(display_name))
```

added to `SUMMARY_COLUMNS`, so a tile can read "based on *Oz Adventure* by
*tombadil_bombadil*" without a second query per tile.

### One new function

The fork wants to know whether the original has moved on — "you copied revision
2; it is now at revision 5". That cannot go through `set_by_slug`, which
returns the whole document and would pull megabytes to compare one integer, and
it cannot go through a filtered select, because the read policy exposes public
sets only and plenty of originals are unlisted.

So: `set_summary_by_slug(share_slug text)`, `security definer`, returning the
summary columns and no document. Same shape and same reasoning as
`set_by_slug` — at most one row, knowing the token is the only way in.

Called anonymously, like every other published read. See the note in
`CLAUDE.md`: a public read that carries a user token breaks for the reader when
their session ages out.

---

## What changes on screen

**Shared set screen** — a third thing beside the exports, worded as starting
work rather than taking a copy:

> **Make a copy to work on**
> Yours to change, credited to *tombadil_bombadil* and remembering which
> version it came from. Their set is untouched.

The fineprint that currently says a set "does not go into your library" is
replaced rather than removed — the honest version of it is that changing your
copy changes nothing for anyone else.

**Set Home** — when `set.origin` is present, one line under the badges:

> Based on **Oz Adventure** by tombadil_bombadil, revision 2 · *the original is
> now at revision 5*

The italic half appears only when the summary fetch says so, and only when it
says something. This is the update signal you deferred when we built
re-publishing, and here it falls out of the lineage rather than needing its own
mechanism.

**Gallery tile** — a `based on …` line for forked sets, from the embed.

**Library** — a small badge on a forked set, so the origin is discoverable
before it is opened.

---

## Deliberately not in rung 1

- **No merge, no diff, no proposals.** All of that is rung 2. Rung 1's job is
  to make it possible, and to be independently useful in the meantime.
- **No "disable forking" flag.** It would be advisory at best — the whole
  document is in the viewer's browser the moment the page draws, and the
  `.json` export is a re-importable copy. A switch that suggests a guarantee it
  cannot keep is worse than no switch. The meaningful flag is rung 2's
  *"accepting contributions"*, which is a real statement about the author's
  intent, and it belongs there.
- **No fork counts or fork trees.** Cheap to add later from the same column;
  nothing depends on them.

---

## Open decisions

1. **Fork of a fork.** Does `origin` point at the immediate parent or the root?
   *Recommendation: the immediate parent.* A chain is reconstructible from the
   column; a root-only record loses the middle, and rung 2's merge base is the
   parent by definition.

2. **Does re-forking after the original updates replace `origin`?** Someone
   copies revision 2, works for a month, then takes a fresh copy at revision 5.
   *Recommendation: that is a new set, not an update to the old one.* Anything
   else quietly discards a month of work.

3. **Credit on the tile.** A forked set's tile currently shows one author. Two
   names on one tile touches the embed, the sort and the takedown story.
   *Recommendation: the fork's own author is the author, and lineage is a
   separate, quieter line.* Making both equal invites passing someone else's
   set off as a collaboration.

---

## Rough size

| | |
|---|---|
| `SetOrigin`, schema bump, `normalize` branch | small |
| Canonical stringify + FNV-1a, and its fingerprint walk | small, self-contained |
| Migration, `set_summary_by_slug`, gallery embed | small |
| Fork action and the four UI surfaces | medium |

Nothing here is hard. The only part that would be expensive to get wrong is the
fingerprint, because it is the one thing that cannot be reconstructed after the
fact — which is the whole reason it is in rung 1 rather than rung 2.
