# Collections — handoff

For the next session picking this up cold. `COLLECTIONS.md` is the design
document and the authority on *why* any of this is shaped the way it is; read
its **Where this stands** section first. This file is the part that document
should not carry: where the work physically lives, what is safe to assume, and
what will bite.

Updated 2026-09-15. The management-workspace pass is committed, its migrations
are applied, and collection development ships through `main`. Collection creation
is open to every signed-in permanent account after the public release.

---

## Where the work is

| worktree | branch | holds |
|---|---|---|
| `Adventures_Workshop` | `main` | the saved production checkout; its local branch is stale, so compare with `origin/main` before using it |
| `Adventures_Workshop-collections` | `collections` | the collection worktree; the local branch name is historical, and all new commits push to `origin/main` |
| `Adventures_Workshop-cloud-drafts` | `codex/cloud-drafts` | unrelated, another session's |

`origin/main` is the release authority. The local `main` checkout can lag its
remote and should not be used as evidence that production lacks a change. This
worktree may retain its `collections` branch name because `main` is checked out
in the saved production worktree, but push new work explicitly to `origin/main`;
do not advance `origin/collections`. Home offers creation to every signed-in
permanent account; public reads and membership access retain separate visibility
and consent rules.

Share URLs are built from `location.origin` at runtime, so neither the old
preview hostname nor the production hostname is stored in collection rows.

---

## What is done

Phase 1, phase 2, the unfurl and the guest collection showcase are deployed on
`main`. Migration `0027_collection_characters.sql` is applied; the public page
has the collection identity, filterable character roster, creator credits, set
gallery and the existing shared-set card/component/3D explorer. The collection
founder is not presented as a public credit.

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

**The management workspace pass is implemented locally.** It adds:

- exact **Public page / Page preview** and **Project workspace** modes;
- direct workspace entry from Home, with pasted links still opening publicly;
- a single published-deck picker and clear submit, review, accept, edit,
  republish and revision-bound Ready lifecycle;
- a colored In progress / Live workspace status, a roster-first Contributions
  tab, Private link guidance and a large Ready checkbox;
- a dedicated celebratory launch card for taking the collection Public, separate
  from its ordinary working-access settings;
- a prominent organizer approval queue that refreshes after mutations, on
  focus/visibility and periodically while the page is visible;
- load-error states that cannot masquerade as an empty approval queue;
- private per-deck discussion threads for the accepted project team; and
- public projections that omit `created_by` while retaining deck-author credit;
- server-guarded membership transitions, revoked direct membership deletion and
  revision-scoped readiness, so the UI cannot manufacture consent or stale Ready
  state.

Two new migrations belong to this pass and were applied successfully to the
live catalogue on 2026-09-14, in this order:

1. `0028_collection_deck_comments.sql`
2. `0029_collection_workspace.sql`

The database is ready for the matching UI. `0029` expands the return type of
`collection_memberships`; the old client safely ignores those extra fields.

Local verification on 2026-09-14: `npm run check`, `npm run build` and
`git diff --check` pass. A signed-out browser smoke test covered Home and the
generic absent/private collection response with no console warnings or errors.
The authenticated two-account matrix below still requires the client deployment.

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

Both sets are present on `main` now, so the directory carries five duplicated
numbers. Nothing is broken: production orders by the timestamp version, not the
filename. But a replay that sorts by filename will interleave them in an order
nobody chose, and the old numbering cannot be read as saying what ran first.
Do not casually renumber migrations that have already shipped. The new `0028`
and `0029` files are ordered after the merged catalogue and must be applied in
that explicit order.

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

It went unnoticed before the collections UI reached `main`, because nothing in
the then-shipped app touched a row that could fail. Fixed in `0026` and now
deployed.

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

1. **Deploy the matching UI.** The new client expects
   the expanded `collection_memberships` result; the old client has no comments
   or revision-bound readiness. Treat the two migrations and this code as one
   rollout.

2. **Run the two-account acceptance matrix.** Use a private collection first:

   - contributor selects a published deck and submits it;
   - organizer sees the contribution after focus/refresh, opens the published
     deck, and accepts it;
   - contributor sees the accepted card, edits and republishes it, marks that
     revision Ready, then republishes once more and confirms Ready clears;
   - both team accounts can discuss the accepted deck, while a signed-out
     browser and an unrelated account cannot read or write those comments;
   - an unrelated account gets the generic absent/private result for the
     collection, and the public page never names a collection founder.

3. **Run one real collection with real creators.** This remains the
   highest-value product test. The remaining phase 3 ideas should wait until a
   project has run rather than turning guesses into schema.

5. **Decide the empty-description case.** Found on the deploy: with both
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

6. **Ordering is half-built.** `reorderMember` exists in
   `src/lib/cloud/collections.ts` and **nothing calls it** — there is no control
   anywhere in the UI. Either wire it up or delete it; a dead export reads as a
   feature that exists.

7. **No reporting path for collections.** Sets have one; collections have
   moderation (`moderateCollection`, admin-gated) but no way for a viewer to
   report one. Asymmetric, and the moderation route is already built to receive
   what it would send.

8. **Anonymous accounts hit the publish wall at launch.** Supabase anonymous
   users are rejected by policy from every collections write, which is correct,
   but the failure surfaces late and rawly. Two RLS errors were already mapped
   to readable text through `publishRefusalMessage`
   (`CollectionScreen.svelte:410`); check whether the rest are.

9. ~~**A collection tile's author is not clickable.**~~ Done in the guest
   showcase: both set and character credits, the masthead chips and the creator
   gallery open `AuthorProfileScreen`.

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
