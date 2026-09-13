# Collections — handoff

For the next session picking this up cold. `COLLECTIONS.md` is the design
document and the authority on *why* any of this is shaped the way it is; read
its **Where this stands** section first. This file is the part that document
should not carry: where the work physically lives, what is safe to assume, and
what will bite.

Written 2026-09-13, at `110b239` on `collections`.

---

## Where the work is

| worktree | branch | holds |
|---|---|---|
| `Adventures_Workshop` | `main` | production. **No collections code at all** — deliberately |
| `Adventures_Workshop-collections` | `collections` | the whole feature |
| `Adventures_Workshop-cloud-drafts` | `codex/cloud-drafts` | unrelated, another session's |

`collections` is **31 commits ahead of `main` and 0 behind** — `main` was merged
in on 2026-09-13 at `8c44598`, so there is no catching-up to do before working.
Everything is pushed and the tree is clean.

Collections was on `main` once, by accident, and was reverted out at the
author's explicit request: *it is not to reach `main` until the feature is ready
to launch publicly.* Treat that as standing. The production site
(`www.unmatchedlabs.com`) therefore 404s on `/collection/...` and that is
correct, not a fault — `main`'s `vercel.json` and middleware matcher both route
only `/shared/`.

The preview deployment is
`https://adventures-workshop-git-collections-adventures-workshop.vercel.app`.
It is recorded nowhere in the repo or the database — share URLs are built from
`location.origin` at runtime, so no hostname ever reaches storage. That URL came
from the author, and is kept here for exactly that reason.

---

## What is done

Phase 1 (all eight build steps) and phase 2 (the combined box export) are
complete, and `COLLECTIONS.md` marks each. Beyond what that document already
records, this session closed the last open item on it:

**The unfurl is confirmed on a real deployment.** Vercel's array-form
`config.matcher` does attach the middleware to both `/shared/:slug*` and
`/collection/:slug*`. Bot User-Agents get the metadata; an ordinary browser
falls through to the SPA. The secrecy properties were re-measured *on the
deployment* rather than assumed to carry over from the local harness, each
against its positive control — the same row silent while private, unfurling in
full when unlisted, silent again once hidden, so a takedown kills the link and
not merely the listing.

What remains untested is Discord's own rendering, which needs a real paste.
Budget a throwaway slug for the second attempt: its per-URL unfurl cache is
aggressive enough that re-pasting the same link shows the stale card.

---

## Two hazards that are not in `COLLECTIONS.md`

### The migration numbers collide with `main`'s

Both branches independently used `0018`–`0022`:

| this branch | `main` |
|---|---|
| `0018_moderate_collection` | `0018_social_image_refresh` |
| `0019_collection_invites` | `0019_private_display_name_default` |
| `0020_collection_invite_claim` | `0020_card_preview_snapshots` |
| `0021_reusable_invite_links` | `0021_card_preview_fingerprints` |
| `0022_invitee_can_see_the_collection` | `0022_fix_card_preview_fingerprint_validation` |

Both sets are present in this worktree now, because `main` was merged in — so
the directory carries five duplicated numbers. Nothing is broken: production
orders by the timestamp version, not the filename. But a replay that sorts by
filename will interleave them in an order nobody chose, and the numbering can no
longer be read as saying what ran first. Decide whether to renumber before this
merges to `main`, and until then do not take a higher number to mean later
application.

### The migration history is not a record of what has been applied

Already true in one direction — `COLLECTIONS.md` flags `0013`/`0014` as applied
to production and absent from every branch. This session found the converse, and
it is worse: `main`'s `0018`–`0022` are **in the repo and not in production's
migration history**, while their schema effects plainly are present. Measured:
all four `card_previews`/`social_image_url` columns exist on `sets`; the only
history rows matching are `character_card_previews` and `social_image`, neither
of which is any of those five files.

So `supabase_migrations.schema_migrations` is a partial record in both
directions. **Verify against the catalogue — `information_schema`, `pg_proc`,
`pg_policy` — never against the history table or the file list.** That is how
the `0015` reconciliation recorded in `COLLECTIONS.md` was done, and the
reasoning generalises to anything else here.

---

## The bug most worth learning from

`touch_updated_at()` is shared by four tables. `main`'s card-preview work taught
it to clear `card_preview_fingerprints` when `card_previews` changes — correct
for `sets`, and fatal for `collections`, `collection_members` and
`collection_invites`, which have neither column. Reaching `new.card_previews` on
a row type without it raises at runtime, on write, so **every update to every
collections table was failing**: visibility, the submissions toggle, marking a
deck ready, answering an invitation, revoking a link.

It went unnoticed because the collections tables live in production while the
feature using them lives on this branch, so nothing on `main` ever touched a row
that could fail. Fixed in `0026`.

Three things to carry forward:

- **A trigger function with a generic name is a shared surface.** Teaching it
  one table's columns breaks every other table silently, at runtime, on write —
  never at deploy, never in `npm run check`.
- **The guard has to be a nested `if`, not another `and` clause.** PL/pgSQL
  evaluates the condition as SQL, and SQL does not promise to short-circuit, so
  `to_jsonb(new) ? 'card_previews' and new.card_previews ...` can still evaluate
  the unsafe half.
- `sets` behaviour was verified unchanged by driving both branches on a real row
  inside a transaction ending in `raise exception`, which carries the result out
  in the error message and rolls the write back. Worth reusing on production
  data, where there is nothing else to test against.

---

## What is left, in the order I would do it

1. **Run one real collection with real creators.** `COLLECTIONS.md` says this
   and it is still the single highest-value thing. Production holds two
   collections, two accepted memberships and two organizers — all test data, and
   **nothing has been made public**. Phase 3's four items are explicitly guesses
   until a project has run, so building them first risks a column that has to be
   unpicked rather than added.

2. **Decide the empty-description case.** Found on the deploy: with both
   `subtitle` and `blurb` empty, a collection's `og:description` is
   byte-identical to the one an unknown slug gets, so apart from the title a
   real collection unfurls exactly like a dead link. The set half never has this
   problem because it composes words from counts it already holds;
   `collection_by_slug` returns `setof collections`, and that table carries no
   deck or creator count. Two fixes: a second anonymous call inside the
   middleware (the shared path already makes two), or a denormalised counter
   column — which, by the rule this project learnt at `0010`, needs its backfill
   in the same migration. I lean to the second call: no schema change, no
   backfill, one extra edge round-trip and only on bot requests. **Not built —
   the author has not chosen.**

3. **Ordering is half-built.** `reorderMember` exists at
   `src/lib/cloud/collections.ts:721` and **nothing calls it** — there is no
   control anywhere in the UI. Either wire it up or delete it; a dead export
   reads as a feature that exists.

4. **No reporting path for collections.** Sets have one; collections have
   moderation (`moderateCollection`, admin-gated) but no way for a viewer to
   report one. Asymmetric, and the moderation route is already built to receive
   what it would send.

5. **Anonymous accounts hit the publish wall at launch.** Supabase anonymous
   users are rejected by policy from every collections write, which is correct,
   but the failure surfaces late and rawly. Two RLS errors were already mapped
   to readable text through `publishRefusalMessage`
   (`CollectionScreen.svelte:410`); check whether the rest are.

6. **A collection tile's author is not clickable**, though `AuthorProfileScreen`
   exists and sets already link to it.

---

## Verifying things here

The loop in `CLAUDE.md` applies unchanged. Four things specific to this feature:

**The middleware runs under plain Node.** It is a function of a `Request`, and
`vite dev` has no Edge Runtime — so copy `middleware.ts` beside itself, add
`.ts` to the one `./src/lib/cloud/social-metadata` import specifier (Node will
not resolve the bundler-style extensionless form; Vercel's build does, which is
proven, since `main` ships the identical import), load `.env.local` by hand, and
call the default export. That exercises the real matcher, real bot detection,
real RPCs and real markup without a deploy. **Delete the probe files
afterwards** — they are easy to leave behind, and one session did.

**Always pair a silence with a positive control.** A private collection not
unfurling and the request simply failing look identical from outside. Flip the
same row to unlisted and re-request the same URL: if it unfurls, the silence was
the filter doing its job. This has already caught one false conclusion.

**Do not truncate output you are about to report from.** This session "found" a
missing author credit in an unfurl that was never missing — a 110-character cut
in the probe's own formatting hid it, and it reached a written report before
being re-checked. Print the whole value.

**Test rows live in production.** There is no staging database, and a Supabase
branch is a paid resource this tooling cannot address. Create, measure and
delete within the same working session, and prefer an always-aborting
transaction wherever the shape of the test allows it.
