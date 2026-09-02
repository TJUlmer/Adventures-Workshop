# Cloud-Authoritative Storage Transition Plan

**Status:** Phases 0–3.5 complete; Phase 4 implemented locally, signed-in acceptance verification pending
**Prepared:** 31 August 2026
**Revised:** 2 September 2026 after Phase 4 local implementation and verification
**Target branch/worktree:** `codex/cloud-drafts` / `Adventures_Workshop-cloud-drafts`

## 1. Outcome

Move signed-in authors from a browser-local document library to a cloud-authoritative
library so that the same sets and recent edits are available in every browser where the
author signs in.

IndexedDB should remain, but its role changes:

- Today: IndexedDB is the source of truth; Supabase receives selected publish snapshots.
- Target: Supabase is the source of truth for signed-in authors; IndexedDB is a cache,
  offline outbox, and migration source for existing local sets.

This is deliberately not a direct replacement of `saveSet()` with a request to the
existing `sets` table. Published sets, scoped publications, gallery rows, forks,
contributions, and collections all depend on `sets` being an explicit snapshot. Drafts
need a separate private storage model.

## 2. Product behaviour

### Signed-in authors

- The Home library lists the author's cloud drafts.
- Creating, duplicating, renaming, editing, deleting, and restoring a set writes to the
  cloud automatically.
- A local cache makes an already-opened set available during a temporary outage.
- The header reports one of: **Saving**, **Saved online**, **Waiting for connection**,
  **Conflict**, or **Save failed**.
- Clearing browser data does not remove the cloud copy.
- Opening another browser downloads the latest saved draft and its assets.

### Signed-out and anonymous authors

- A permanent account is required for durable cloud drafts. Supabase anonymous users
  are tied to one browser and do not solve the cross-browser problem.
- A signed-out author may still try the editor locally, but the UI must say clearly that
  the set is saved only on that device and offer permanent sign-in before the author relies
  on it. Offer an ownership-preserving upgrade only after manual identity linking exists.
- Cloud-draft creation must reject an `is_anonymous` session. `linkEmail` preserves the
  current user id, but it is not a usable upgrade path while email verification remains
  blocked. The ordinary provider sign-in route is also not an upgrade: it creates or signs
  into a different permanent user and therefore changes `owner_id`.
- Google is the verified permanent sign-in and recovery provider. Before any anonymous
  author is invited to move work online, implement Supabase manual identity linking through
  the authenticated `/auth/v1/user/identities/authorize` route and verify that linking
  Google preserves the anonymous user's id. Until that exists, describe anonymous use as
  local-only and do not offer “Upgrade with Google”.
- If the chosen Google identity is already attached to another permanent account, stop and
  explain the account conflict. Identity linking must never imply or perform an account,
  draft, asset-prefix, or publication merge.

### Publishing remains explicit

- A draft is private and editable. It is never visible in the gallery.
- **Publish** continues to produce an immutable-in-purpose snapshot in `public.sets`,
  including its scope, revision, share slug, lineage, change note, thumbnails, and public
  assets.
- Republishing updates the corresponding published snapshot. It does not change draft
  revision semantics.
- `publishSet()` continues to receive the hydrated in-memory document with embedded data
  URLs and to upload/copy those bytes into public `set-assets`. It does not read draft JSON
  directly, and no private draft reference or URL may reach a published document.
- Unpublishing a snapshot never deletes the draft.
- Contributions remain proposals against a published revision and continue to be
  accepted into the owner's open draft in the browser.

## 3. Architecture

```text
Editor / WorkshopStore
        |
        v
Persistence coordinator
  |                     |
  | immediate           | debounced, single-flight
  v                     v
IndexedDB cache      Private Supabase draft
and offline outbox   + private draft assets
                            |
                            | explicit Publish
                            v
                     Existing public sets row
                     + public set assets
```

The in-memory `AdventureSet` should continue to contain embedded data URLs. Existing
preview, PNG, print, JSON, and Tabletop Simulator exports all rely on self-contained
documents, and remote image URLs can taint canvas rendering. Cloud serialisation may
replace those data URLs with stable private asset references, but loading a draft must
re-embed the bytes before passing it to `parseSetFile()` and `WorkshopStore`.

## 4. Phase 0 record and pre-Phase 1 gate

The operational Phase 0 record and its evidence live in `CLOUD_STORAGE_PHASE0.md`. The
following work is complete: collections were kept out of scope; the live schema, policies,
functions, buckets, grants, revision trigger, and migration ledger were audited; the missing
TTS ledger entry was baselined without recreating Storage objects; the reviewed
`0013_grant_reconciliation.sql` was rollback-tested and applied; `listMyPublishedSets()` was
corrected to filter by `owner_id`; Google sign-in and same-account recovery were exercised in
a clean browser; representative real payloads and the production upload route were measured;
and a production logical backup was restored successfully into the isolated recovery project.
The feature-flag and rollback contracts are also recorded. No collections merge is required.

The implementation audit added the following decisions before `0014_set_drafts.sql` is
written:

1. Freeze the draft-summary contract in section 5. A cloud summary must preserve every
   semantic field Home currently reads without opening the document: character browse data,
   health counts, and fork lineage as well as names and aggregate counts.
2. Keep cover artwork out of the first summary schema. A cold cloud entry uses Home's tint
   fallback until a complete document has been hydrated and cached. Phase 4 must not download
   every cloud document merely to fill the shelf with covers. A derived private thumbnail may
   be added later only if the fallback proves inadequate.
3. Keep anonymous authenticated users outside the draft backend. Manual Google identity
   linking is required before cohort rollout, but it does not block the additive Phase 1
   backend because the table, RPCs, and bucket policies reject anonymous sessions.
4. Preserve `requestBlob()` as the anonymous public-object path. Private hydration gets a
   distinct authenticated path in Phase 2 and must fail closed when a required asset cannot
   be fetched.
5. Treat a hydrated remote generation as already acknowledged before loading it into the
   reactive store, so opening a draft cannot echo the same document into the cloud save
   queue.

There is no remaining production operation before Phase 1. Phase 1 may start once this
revised schema contract is accepted as the implementation target. The former production
upload probe and its HTML harness are no longer under `src/`, so they require no move or
build-gate action.

On 1 September 2026, `0014_set_drafts.sql` (SHA-256
`C22C14D013433A0FBEBE1FB868BE485C6AEB62C7255AAEA25DDC8C3956B99440`) passed a
stop-on-error rollback validation against the isolated recovery project. The transaction
exercised two-owner isolation, stale-revision conflicts, anonymous-session rejection, and
delete/restore/purge behaviour; confirmed the private bucket and policy catalogue; and
returned every database, Storage, and migration-ledger fingerprint to its preflight value.
Evidence is stored under the Phase 0 backup at
`set-drafts-validation-jtpifbkqkoitzjfrxhhn-20260901T211731Z`.

The same migration was then applied to production and registered as migration `0014`.
Postflight verification found the existing published-set and Storage fingerprints unchanged,
the new empty draft table and private bucket present, and only the intended grants, RPCs, and
policies added. Evidence is stored under the Phase 0 backup at
`set-drafts-production-kyqcvbnxfmpnbwtikzxp-20260901T212335Z`. A public-anon HTTP probe also
confirmed that draft reads, draft saves, and private asset uploads are denied.

Phase 1 completed on 1 September 2026 with live HTTP requests through the application's real
auth and request-header path. An anonymous authenticated session could not read drafts, invoke
the save RPC, or upload a private asset. Permanent Account A created and updated a draft,
observed a stale-revision conflict without mutation, and created/read its private asset.
Permanent Account B could neither see nor overwrite Account A's draft or asset. Account A then
confirmed the draft and asset were unchanged, exercised asset update/delete and draft
soft-delete/restore/purge, and verified that both synthetic records were gone. The temporary
anonymous Auth user may remain as an unlinked Auth row; it owns no draft or Storage object.

Phase 2 completed on 1 September 2026. `cloud/drafts.ts` now provides summary-only listing,
strict authenticated fetch/hydration, revision-safe save, and delete/restore/purge operations.
`cloud/draft-assets.ts` uploads before the document RPC, stores stable owner/set/SHA-256
references, reuses unchanged objects through authenticated upsert, downloads with six-way
bounded concurrency after one shared token refresh, verifies each content hash, and substitutes
only after every required object succeeds. The pure structural string walker, substitution, and
content hashing remain shared with publication rather than duplicated.

A production browser round trip used a factory-created v47 set containing embedded PNG artwork
and an OBJ model. The reference-form revision saved and hydrated back to an identical set
fingerprint; `parseSetFile()` and repeated `normalizeSet()` were stable; summary listing avoided
the document; revision 2 reused the same objects; a stale revision-1 save conflicted without
mutation; and one deliberately missing object rejected the whole hydration. Production Storage
reported duplicate non-upserts as HTTP 400, so the content-addressed uploader now uses explicit
upsert, matching the established public uploader. Final delete/restore/purge and exact-object
cleanup succeeded, and no synthetic Phase 2 draft or asset remains.

## 5. Supabase data model

### `public.set_drafts`

Recommended initial shape:

```sql
id                  uuid primary key default gen_random_uuid()
owner_id            uuid not null references auth.users(id)
local_id            text not null
name                text not null
subtitle            text not null default ''
kind                text not null
card_count           integer not null default 0
character_count      integer not null default 0
characters           jsonb not null default '[]'::jsonb
blockers              integer not null default 0
gaps                  integer not null default 0
issue_count           integer not null default 0
origin_author         text
origin_revision       bigint
origin_slug           text
document_updated_at   timestamptz not null
schema_version       integer not null
document             jsonb not null
revision             bigint not null default 1
deleted_at           timestamptz
created_at           timestamptz not null default now()
updated_at           timestamptz not null default now()
unique (owner_id, local_id)
```

The denormalised fields form an explicit `DraftSummary` contract rather than blindly copying
every storage-specific `LibraryEntry` field. Home can render its library-health summary,
tile status, Characters view, and fork-behind indicator without downloading every
multi-megabyte document. `characters` contains only `{ id, name, role }` entries and must be
constrained to a JSON array. Health and aggregate counts must be non-negative. The three
`origin_*` columns are nullable together and mirror the draft document's fork origin for
display and revision checks; they are not publication ownership or authority.

Home's `updatedAt` maps to `document_updated_at`, copied from `AdventureSet.meta.updatedAt`.
The server-owned `updated_at` instead records when the cloud row was successfully written;
keeping both prevents a first migration from making every old set look newly edited.

`bytes` is deliberately absent. The existing local field measures a self-contained IndexedDB
serialisation, whereas a reference-form cloud document and its separately stored assets have
different sizes. Add explicit document-byte and asset-byte metrics later if the UI needs
them rather than overloading the local meaning. Cover artwork is also absent by design: an
uncached cloud tile renders its tint fallback and gains its real cover after the document is
opened and cached.

`local_id` remains the `AdventureSet.id`, preserving existing links among local drafts,
publications, forks, exports, and collections. The client supplies the display
denormalisations to the save RPC from the same normalised document it serialises. The RPC
updates summary and document fields atomically so a returned revision can never pair a new
document with stale Home metadata.

Do not put publish-only fields on this table: no publication `slug`, `visibility`, scope,
`change_note`, social image, view count, moderation flag, or publication-owner fields. The
nullable `origin_*` display columns above describe where this draft was forked from; the
complete `AdventureSet.origin` remains inside `document` and is authoritative.

### Revision-safe write RPC

Add a narrow `save_set_draft` RPC rather than permitting blind client upserts. It should:

1. Derive `owner_id` from `auth.uid()`.
2. Reject anonymous accounts.
3. Insert revision 1 when no row exists and the expected revision is `null`.
4. Update only when `revision = expected_revision`.
5. Increment the revision and stamp `updated_at` in the same transaction.
6. Return the new revision and timestamps.
7. Return an explicit conflict result when the expected revision is stale.

Pin `search_path`, restrict grants to `authenticated`, and never accept an owner id from
the client. This prevents last-write-wins data loss when two browsers edit at once.

Use similarly narrow operations for soft delete, restore, and permanent delete. A normal
update must not accidentally clear `deleted_at`.

### RLS

- Enable RLS on `set_drafts`.
- Allow select only where `owner_id = auth.uid()`.
- Route inserts/updates through the revision RPC or apply equivalent owner checks.
- Allow soft delete/restore only to the owner.
- Deny `anon` and anonymous authenticated users.
- Add no public-read policy and no slug lookup function.
- Index the owner's active/deleted library and its `document_updated_at desc` display order.

### `draft-assets` bucket

Create a new **private** bucket. Do not reuse public `set-assets`; unpublished artwork and
models must not be world-readable.

Use paths shaped like:

```text
<owner-id>/<local-set-id>/<content-hash>.<extension>
```

RLS must require the first folder to match `auth.uid()` for reads, inserts, updates, and
deletes. Content hashes preserve the current upload deduplication within a set. Keeping
the set id in the path makes permanent deletion and orphan cleanup tractable.

Cloud draft JSON should contain a stable internal reference or object path, not an
expiring signed URL. On load, authenticated requests fetch each distinct object with
bounded concurrency and replace its reference with a data URL before parsing the set.
The reference format must retain an explicit content hash so a later content-addressed
IndexedDB asset cache can be added without changing every stored draft.

Do not reuse or broaden `requestBlob()`: it intentionally sends no authorisation header for
ordinary public bucket URLs. `cloud/draft-assets.ts` must perform a separate authenticated
private-object GET after refreshing the session. Private hydration is all-or-nothing. If any
required object cannot be fetched or decoded, do not pass a partly hydrated document to the
editor and do not mark its revision clean; prefer a complete cached self-contained document
when one exists and surface a retryable error otherwise.

Uploads happen before the document RPC. An interrupted save may leave unreferenced
objects but can never leave a document pointing at an object that was not uploaded.
Add age-based orphan cleanup only after measuring real usage; it is not required for the
first release.

Publications continue copying/uploading required bytes into the existing public
`set-assets` namespace. Deleting a draft must not break an already-published snapshot.

## 6. Client persistence boundary

Introduce one persistence interface so UI commands no longer know whether a document
came from IndexedDB or Supabase. Suggested modules:

- `src/lib/persistence/types.ts` — draft summary, sync state, revision, and conflict types.
- `src/lib/persistence/coordinator.svelte.ts` — cloud/cache orchestration and save queue.
- `src/lib/cloud/drafts.ts` — list, fetch, revision-safe save, delete, restore, and purge.
- `src/lib/cloud/draft-assets.ts` — private upload/download and reference substitution.
- `src/lib/storage/library.ts` — retained initially as the cache and migration reader.

Do not rename or rewrite the IndexedDB layer in the first phase. Wrap it, prove the new
flow, then simplify names once the migration is stable.

### Cache metadata

Store sync metadata outside the exported `AdventureSet`:

```ts
interface CachedDraftState {
  localId: SetId;
  cloudRevision: number | null;
  syncedHash: string | null;
  pending: boolean;
  lastCloudSaveAt: IsoDateTime | null;
}
```

The file format remains portable and unchanged. A JSON export must not contain account,
device, or Supabase state.

`syncedHash` is the exact self-contained serialisation last acknowledged by the cloud or
installed by successful cloud hydration. In-memory queue generations may optimise ordering,
but this persisted hash is the clean/dirty invariant across reloads. Register a hydrated
hash and revision with the coordinator before assigning that document to `WorkshopStore`;
the deep reactive read may observe it, but an exact acknowledged hash must not enqueue a
cloud save. This suppression applies only to the cloud queue—the hydrated document should
still be written to IndexedDB as the local cache.

## 7. Autosave and synchronisation rules

### Local cache

- Continue the current deep `serializeSet()` read so every field participates in dirty
  detection.
- Save the self-contained document to IndexedDB quickly. This is the crash/offline safety
  copy, not the cross-device authority.
- Record the pending flag and expected cloud revision atomically with the cached document
  where practical.

### Cloud save queue

- Debounce cloud saves more conservatively than the current 500 ms local write; begin
  with 1.5–2 seconds and measure payload/bandwidth.
- Permit only one document save per set in flight.
- If the author edits during a save, mark another generation pending and send the newest
  serialisation after the first completes.
- Never let an old response mark a newer local generation as saved.
- Upload only new content hashes, then submit the asset-substituted document through the
  revision RPC.
- Flush on set switch, Home navigation, page hide when feasible, and the existing manual
  Save action. Do not claim success merely because `beforeunload` started a request.

### Opening a draft

1. Read the cached document and sync metadata.
2. Fetch the owner's cloud summary/row when online.
3. If the cache is clean and the cloud revision is newer, download and hydrate cloud.
4. If the cache is pending and cloud still equals its base revision, upload the pending
   local generation.
5. If the cache is pending and cloud has advanced, stop autosave and present a conflict.
6. Parse and normalise a fully hydrated remote copy before changing the current document.
7. Compute its self-contained hash and atomically cache the document with the fetched cloud
   revision, that `syncedHash`, and `pending = false`.
8. Register the same hash/revision as the coordinator's acknowledged generation before
   calling `store.load()` or navigating into the editor.
9. Allow the ordinary local-cache save to run, but skip the cloud enqueue when the observed
   serialisation equals the acknowledged hash.

Never overwrite a pending local edit just because a remote fetch finished later.

### Conflict behaviour

Do not attempt field-level or entity-level merging in version one. A set is saved as one
document, and automatic merge rules would need to understand flat entity arrays,
deletions, ordering, styles, and singleton map/threat fields.

The conflict screen should preserve both complete documents and offer:

- **Use cloud version** — replace this device's pending copy after confirmation.
- **Keep this device's version** — explicitly overwrite from the known remote revision.
- **Keep both** — assign the local document a new `SetId`, rename it “(conflict copy)”,
  and upload it as a separate draft.

Until the author chooses, no background save may mutate either version.

## 8. Existing-library migration

Migration must be copy-first and resumable, following the safety pattern already used by
the `localStorage` to IndexedDB migration.

### First permanent sign-in

1. Fetch the cloud draft summaries.
2. Discover IndexedDB sets without a confirmed cloud revision.
3. Show **Move your sets online** with counts and estimated upload size.
4. Offer **Upload all**, per-set selection, and **Not now**.
5. Upload assets and documents one set at a time, recording success immediately.
6. Verify the returned revision and re-fetch the summary before marking a set migrated.
7. Keep the local document as cache; do not delete it after migration.
8. A failure leaves that set pending and retryable without re-uploading known hashes.

If a cloud draft already exists with the same `(owner_id, local_id)`, compare revision and
content state. Never blind-upsert it. Use the normal conflict choices.

### Published rows are not drafts

Do not automatically reconstruct the author's library from `public.sets`:

- One local set may have full, hero, and villain publication rows.
- A publication may deliberately lag behind the author's draft.
- Published documents reference public assets and carry snapshot metadata.

A separate recovery action may later offer **Recover from last full publication** when a
user has no draft or local copy, but that is not part of automatic migration.

### Soft deletion

Mirror the current Recently Deleted model with `deleted_at` in the cloud. Delete and
restore should sync across browsers. **Delete forever** must be a second explicit action.
Only after the row is permanently removed should draft asset cleanup be scheduled.

## 9. UI changes

### Home

- Gate the signed-in cloud library behind session restoration and a loading state.
- Render names, aggregate counts, health, character browse entries, fork lineage, and
  fork-behind checks from the `DraftSummary` contract without downloading documents.
- Do not run the existing per-entry `ensureCover()` document load for an uncached cloud
  draft. Use the tint fallback until that set has been opened and cached. Treat a private,
  derived cover thumbnail as a later optimisation rather than a reason to hydrate the
  whole library.
- Distinguish online drafts, local-only sets awaiting migration, pending uploads,
  conflicts, and Recently Deleted.
- Add the one-time migration flow and retry controls.
- Keep collection and published-set shelves conceptually separate from editable drafts.

### Editor chrome

- Replace the current local `savedAt`/`saveError` wording with the sync states listed in
  section 2.
- “Saved online” is shown only after the cloud returns the matching generation's new
  revision.
- Offline success should say “Saved on this device — waiting for connection”, not
  “Saved”.
- Manual Save flushes the cloud queue and surfaces a useful retry action.

### Authentication

- Explain that sign-in is what makes sets available across browsers.
- Prompt local-only authors to sign in before publishing, clearing data, or relying on a
  guest session.
- Do not describe an anonymous session as an account-backed cloud library.
- Do not route an anonymous author through ordinary Google sign-in and call the result an
  upgrade. Implement authenticated manual identity linking before offering that action, and
  verify the user id remains unchanged across the OAuth callback.

## 10. Implementation phases

### Phase 0 — reconcile and measure (1–2 development days)

- **Complete.** Collections stayed out of scope and the deployed migration history was
  reconciled without merging the feature.
- **Complete.** The live schema, policies, functions, grants, buckets, trigger, and migration
  ledger were inspected and the required grant reconciliation was applied.
- **Complete.** Google permanent sign-in and clean-browser recovery were verified. Email OTP
  remains unavailable but is not the selected permanent path.
- **Complete.** Representative serialised documents and asset-separated production timings
  support a 1.5–2 second single-flight cloud-save cadence.
- **Complete.** Backup/restore, rollback, and feature-flag rules are recorded.
- **Resolved in this revision.** The summary contract, cold-cover fallback, authenticated
  private hydration boundary, hydration acknowledgement, and anonymous-account boundary are
  explicit before migration design begins.

**Exit:** schema history is trustworthy, permanent accounts are usable, and measured
payloads support the proposed save cadence. The `0014` implementation must match section 5;
no additional production action is required before Phase 1 starts.

### Phase 1 — private draft backend (complete 1 September 2026)

- Add `set_drafts` with the complete `DraftSummary` columns, validation constraints,
  indexes, RLS, revision RPCs, and soft-delete operations.
- Make `save_set_draft` derive document and summary ownership from the caller, accept the
  display denormalisations, and update them atomically with the reference-form document.
- Add the private `draft-assets` bucket and policies.
- Exercise policies with two permanent accounts, an anonymous authenticated session, and
  the public anon key.
- Confirm stale-revision writes fail without changing the row.

**Exit:** one owner can CRUD only their drafts/assets; another owner and the public cannot
read them; concurrent updates produce a conflict.

### Phase 2 — cloud draft client and hydration (complete 1 September 2026)

- Implement `cloud/drafts.ts` and `cloud/draft-assets.ts`.
- Reuse/refactor the pure structural walker, substitution, and content hashing from
  `cloud/assets.ts`; do not reuse its anonymous `requestBlob()` hydration endpoint.
- Add an authenticated private-object fetch with bounded concurrency, shared token refresh,
  and strict all-or-nothing hydration. A missing asset leaves the remote revision unopened
  and unacknowledged.
- Round-trip a real set with artwork and a model: embedded document → private references
  → database → authenticated fetch → identical embedded document.
- Confirm `parseSetFile()` and repeated `normalizeSet()` remain stable.

**Exit:** a cloud draft round-trips without changing its fingerprint or breaking export.

### Phase 3 — persistence coordinator and autosave (complete 1 September 2026)

- Add the repository/coordinator boundary.
- Retain IndexedDB as cache/outbox and add sync metadata.
- Replace `useAutosave()`'s direct `saveSet()` call with the two-tier save queue.
- Update `WorkshopStore.saveNow()`, set switching, and navigation flush behaviour.
- Implement generation tracking, retry/backoff, offline status, and stale-revision stop.
- Register successfully hydrated hashes/revisions as acknowledged before `store.load()` and
  verify opening an unchanged remote draft produces no cloud write while still refreshing
  its IndexedDB cache.

**Exit:** ordinary edits save online, offline edits queue safely, and old responses cannot
erase or falsely acknowledge newer changes.

Phase 3 completed on 1 September 2026. The coordinator now commits each observed generation
to an atomic IndexedDB document/index/outbox transaction before attempting the private cloud
draft, sends only one cloud request per set at a time, and records an acknowledgement only for
the exact content hash that response saved. Permanent-account autosave, manual save, set
switching, Home/Gallery navigation, page hiding, offline resumption, bounded exponential retry,
and stale-revision stop all pass through that boundary. Hydrated revisions are cached and marked
clean before the WorkshopStore can load them. A production synthetic draft proved real online
save and unchanged-open suppression; deterministic browser probes proved offline recovery,
HTTP 503 retry, conflict stop, and that an old response cannot erase or falsely acknowledge a
newer local generation. The same synthetic set also passed an edit, immediate Home navigation,
reopen, and manual-save flow through the real workshop UI. After explicit approval, its isolated
production row and matching local cache were deleted and the verifier confirmed neither remained.

### Phase 3.5 — asset-transfer efficiency (complete 1 September 2026)

- Persist the confirmed private Storage object manifest beside each cached draft rather than in
  the exported set document.
- Upload only referenced content hashes missing from that manifest. A new draft starts with a
  known-empty manifest; a legacy or invalid cache performs one authenticated prefix listing to
  reconcile the manifest without re-uploading its existing objects.
- Seed the manifest during cloud hydration so a fresh browser's first text-only edit remains a
  reference-only document write.
- Persist the confirmed manifest before the document RPC. If the RPC fails after asset upload,
  its retry reuses the acknowledged objects instead of transferring them again.
- On permanent purge, delete the exact owner/set Storage prefix after the database row is gone.
  Soft delete and restore retain the prefix. General age-based orphan collection remains a later
  hardening task because it requires an intentionally broader cleanup policy.

**Exit:** ordinary text-only saves transfer no asset bytes, a changed embedded asset uploads one
new content hash, legacy/fresh-browser reconciliation does not re-upload existing objects, and a
document-RPC retry reuses the manifest recorded before that RPC.

Phase 3.5 completed on 1 September 2026. The production verifier measured two uploads for a new
synthetic draft, zero for a text-only edit, one for a changed image while reusing its unchanged
model, zero after forced legacy-manifest reconciliation, and zero after fresh-browser hydration.
A deterministic post-upload HTTP 503 probe also retried with zero asset uploads. The verifier's
isolated production row, local cache, and three-object Storage prefix were then permanently deleted
after explicit approval. The verifier confirmed the row, every current and obsolete object under
the exact prefix, and the local probe were gone.

### Phase 4 — cloud library, migration, and account-upgrade UX (5–6 days)

- Source the signed-in Home library from complete cloud summaries, including health,
  characters, and lineage, without loading documents for uncached cover art.
- Add local-only/migration states, progress, retries, and Recently Deleted.
- Implement create, duplicate, delete, restore, purge, and last-open behaviour through the
  coordinator.
- Preserve signed-out local trial behaviour with explicit warnings.
- Implement authenticated Google identity linking for an anonymous session, or keep the
  upgrade action unavailable. Verify a successful link preserves the existing user id and
  therefore its future draft and asset ownership prefixes.

**Exit:** an existing user can sign in, migrate all sets without losing the local copies,
clear a second browser's cache, sign in there, and recover the same library.

Phase 4's client implementation was completed on 2 September 2026. Home now composes a
permanent account's shelf from cloud summaries and joins IndexedDB only as cache metadata,
offline fallback, and an explicit migration source; uncached entries do not hydrate merely for
cover art. Create/import/fork/duplicate, last-open hydration, and revision-safe
delete/restore/purge all pass through the persistence coordinator. Existing local sets remain
opted out until the author chooses per-set or sequential **Upload all** migration, and every
successful copy is revision-verified while its local document remains intact. Signed-out and
anonymous sessions are explicitly device-only, and the unavailable ownership-preserving
anonymous upgrade is no longer presented as ordinary Google sign-in.

`npm run check`, the production build, signed-out Home inspection, and the deterministic
`tools/phase4-library.html` browser probe pass. The probe covers authoritative cloud summary
composition, uncached drafts, migration retries, same-id conflicts, cross-browser purge hiding,
Recently Deleted, and labelled offline fallback without document hydration. The exit criterion's
real signed-in migration and cleared-second-browser recovery remain to be exercised before this
phase is marked complete; this implementation pass did not create or mutate production drafts.

### Phase 5 — conflicts and collaboration integration (3–4 days)

- Add the conflict screen and its three resolution choices.
- Verify publish/unpublish remains a separate snapshot workflow.
- Verify forking creates a new draft identity while preserving entity ids and origin.
- Verify accepting a contribution mutates and autosaves the owner's draft, without
  changing the contribution row into a direct-write channel.
- Verify collections continue pointing at published sets, never drafts.

**Exit:** two-browser edits cannot silently overwrite one another, and existing cloud
collaboration semantics remain intact.

Phase 5's client implementation was completed on 2 September 2026. A whole-document
conflict now stops autosave and presents three confirmed choices: hydrate and use the
complete cloud version, advance exactly the known cloud revision with the device version,
or save the device version as a clearly labelled separate copy under a new set id before
reopening the cloud original. A
second remote advance returns to conflict instead of overwriting it. The choice can be
deferred without restarting the stopped queue.

Publishing and unpublishing still use the separate published-snapshot API. Forks still mint
only a new set id while preserving entity ids and recorded origin. Accepting contribution
entries now crosses the owner's normal draft persistence boundary before the proposal row is
marked accepted; the contributor never gains a direct draft or published-row write path.
Collections remain outside this implementation's scope, as recorded in Phase 0, and no draft
collection reference path was introduced.

`npm run check`, the production build, visual inspection of the real conflict dialog, and the
deterministic `tools/phase5-conflicts.html` browser probe pass. The probe covers all three
decisions, a second concurrent advance, and fork identity/origin preservation without touching
production drafts. The exit criterion's real two-browser acceptance remains to be exercised
before this phase is marked complete.

### Phase 6 — hardening and rollout (4–6 days)

- Drive the verification matrix below with realistic large documents.
- Add structured client diagnostics for save stage, status code, duration, byte count,
  revision, and retry count without logging document contents or tokens.
- Add an opt-in feature flag, then enable for internal accounts and a small cohort.
- Do not admit anonymous authors to that cohort until manual Google identity linking and its
  already-linked-to-another-account failure state have both been exercised end to end.
- Keep export visible as a safety action during rollout.
- Document support/recovery procedures and rollback.
- Enable by default only after error, conflict, and latency targets hold.

**Exit:** the cloud library is the default for permanent accounts and can be disabled
without making cached or exported sets unreadable.

## 11. Verification matrix

The project has no test runner, so verification should drive the real app and database.

### Core flows

- Create a set in browser A; see it in browser B after sign-in.
- Edit in A; reload B; see the latest cloud revision.
- Clear B's site data; sign in; recover the library and artwork.
- In a clean browser with no draft cache, render Home's health donut, tile status, Characters
  view, lineage badge, and fork-behind state from summaries alone; show the intentional tint
  fallback instead of downloading every document for cover art.
- Open a clean remote draft while observing network requests; hydration may refresh the
  IndexedDB cache but must not echo an unchanged document through `save_set_draft`.
- Import a JSON set; autosave it online; export it again; compare fingerprints.
- Duplicate, soft delete, restore, and permanently delete across browsers.
- Switch sets inside and outside the debounce window without losing the last edit.

### Offline and failure

- Edit while offline; confirm a durable pending cache and honest status text.
- Reconnect; confirm a single latest save reaches the cloud.
- Interrupt during asset upload and during document save; retry safely.
- Deny or interrupt one required private-asset download; confirm the partly hydrated
  document never reaches the editor or becomes the acknowledged clean revision.
- Expire the access token during a save; confirm one shared refresh and retry.
- Exhaust or block IndexedDB; cloud success must still be distinguishable from cache
  failure, and vice versa.
- Return a future `schema_version`; refuse it before downloading all assets.

### Concurrency

- Open one set in two browser profiles at the same revision.
- Save different edits from both; confirm the second gets a conflict.
- Exercise **Use cloud**, **Keep this device**, and **Keep both**.
- Confirm no autosave continues behind the conflict screen.

### Security

- Owner can list/read/write only their drafts and asset prefix.
- A second signed-in owner cannot infer draft rows or download private assets.
- Public anon key cannot list or fetch drafts.
- Anonymous authenticated user cannot create cloud drafts.
- Private hydration succeeds only through an authenticated fetch; the existing public blob
  path still sends no user token.
- Public shared links still fetch only published unlisted/public snapshots and never send a
  visitor's stale access token.

### Authentication identity

- Ordinary Google sign-in from an anonymous session is never labelled as an account upgrade.
- When manual Google linking is enabled, capture the anonymous user id before OAuth and
  confirm the same id owns the returned permanent session.
- Attempt to link a Google identity already owned by another permanent account; preserve
  both accounts and show a recoverable explanation without moving or merging data.
- Sign out after a successful link, recover through Google in a clean browser, and confirm
  the same draft rows and private asset prefix remain reachable.

### Existing features

- Full, hero, and villain scoped publishing update the correct rows.
- Inspect a newly published document and confirm it contains public `set-assets` references,
  never a `draft-assets` path, private object URL, or draft-internal reference.
- Fork lineage and fingerprints survive a draft round-trip.
- Contributions can be offered and accepted at the expected published revision.
- Collections still contain published-set memberships only.
- PNG, print, JSON, TTS, model, map, and threat exports work after cloud hydration.
- `npm run check` passes at every phase boundary.

## 12. Rollout and rollback

Use a remote or environment feature flag with these stages:

1. Backend deployed but unused.
2. Internal opt-in shadow upload; IndexedDB remains authoritative.
3. Internal cloud-authoritative mode.
4. Small permanent-account cohort.
5. Default for signed-in accounts.
6. Guest/local mode reduced to an explicitly temporary trial.

During stages 2–4, never delete local documents. If rollout is stopped:

- Disable cloud-authoritative reads/writes with the flag.
- Leave `set_drafts` and private assets intact.
- Continue opening the self-contained IndexedDB cache.
- Offer JSON export for any pending local generation.
- Do not roll back by dropping tables or buckets containing user data.

## 13. Scope, estimate, and later work

Estimated implementation: **22–30 focused development days**, or roughly **4–6 calendar
weeks** for one developer including manual browser/database verification.

A thinner MVP can fit **10–15 development days** if it includes only permanent-account
draft CRUD, private assets, whole-document autosave, local migration, and basic
stale-revision blocking. It would defer polished conflict resolution, guest-mode changes,
cohort rollout tooling, manual anonymous-to-Google linking, and orphan cleanup. If identity
linking is deferred, anonymous authors remain explicitly local-only and cannot join the
cloud-draft cohort.

An asset-level IndexedDB cache keyed by content hash is useful later, especially when a new
cloud revision reuses most of the prior artwork or several sets share bytes. It is not a
first-release requirement because the cache already retains each complete hydrated document,
making an unchanged repeat open local. The stable draft-reference format must nevertheless
keep its content hash explicit now so this optimisation does not require rewriting stored
documents later.

A private derived cover thumbnail is also later work. Add it only if the measured cold-Home
experience makes the tint fallback inadequate; never solve that cosmetic gap by downloading
every complete draft during library listing.

Do not begin with entity-level sync, real-time subscriptions, shared live editing, or a
server-side schema migration ladder. Whole-document optimistic concurrency is simpler,
matches the existing document model, and directly solves cross-browser access and cache
loss. Revisit deltas only if measured document bandwidth or save latency proves the whole-
document approach inadequate.

## 14. Launch acceptance criteria

The transition is ready to become the default when all of the following are true:

- A permanent account can recover its complete draft library in a clean browser.
- No private draft or draft asset is readable by another account or the public anon key.
- A confirmed cloud save corresponds to the latest editor generation and revision.
- Offline work survives reload and syncs after reconnecting.
- Concurrent browsers cannot silently overwrite one another.
- Existing local sets migrate copy-first, resumably, without deleting local data.
- A remote document is acknowledged only after complete authenticated asset hydration,
  successful parse/normalisation, and a matching cached hash; merely opening it produces no
  redundant cloud write.
- Published snapshots, forks, contributions, collections, and exports retain their current
  semantics.
- The feature can be disabled without making cached or exported documents unreadable.
- The production migration history is reconciled and backed up.
- Permanent sign-in and account recovery are reliable enough to make the cloud promise
  honest.
- Anonymous authors are either linked to Google without changing their user id or remain
  clearly local-only; ordinary provider sign-in is never presented as an ownership-preserving
  upgrade.
