# Cloud Storage Phase 0 Record

**Started:** 31 August 2026
**Branch:** `codex/cloud-drafts`
**Scope:** Reconcile and measure before any private-drafts migration is written or applied.

## Decisions

- Collections are not part of this transition and will not be merged as a prerequisite.
- A separately deployed collections migration, if production still contains one, remains
  relevant only to migration numbering and rollback safety. It does not make collections a
  product dependency.
- No draft table, bucket, policy, RPC, or production write is allowed until the live audit,
  backup, and rollback checks below are complete.
- IndexedDB remains authoritative throughout Phase 0. No local document is deleted or
  rewritten by this work.

## Repository audit

The current branch contains migrations `0001_sets.sql` through
`0013_grant_reconciliation.sql`, with no duplicate number inside the branch. Production also
contains separately deployed collections changes under timestamp versions; the deployed
migration ledger remains the authority.

The grant audit found a prerequisite hardening change, so `0013_grant_reconciliation.sql`
now occupies the next repository number and the drafts migration moves to
`0014_set_drafts.sql`. If collections is integrated later, its repository migration must be
numbered above the drafts migration while preserving the already-deployed production state.
Do not rerun the collections SQL merely to make filenames line up.

Relevant persistence boundaries inspected:

- `storage/library.ts` stores one self-contained serialised set per IndexedDB key and a
  lightweight library index. Soft deletion exists only on the index row.
- `state/persistence.svelte.ts` serialises the complete reactive document for deep dirty
  detection and writes it locally after a 500 ms debounce.
- `WorkshopStore.saveNow()` writes IndexedDB directly and reports only local durability.
- `cloud/assets.ts` already walks the entire document structurally, de-duplicates data URLs
  by value, hashes their decoded bytes, and can substitute stable strings without mutating
  the original document.
- `cloud/http.ts` already centralises authenticated headers and shares the current access
  token, but callers must invoke `auth.ensureFresh()` before protected requests.
- `cloud/auth.svelte.ts` supports anonymous sessions, email OTP, Google, and Discord. Draft
  writes must additionally refuse sessions whose JWT has `is_anonymous = true`.

`listMyPublishedSets()` was found to rely on RLS without an `owner_id` filter. Public-read
RLS exposes other authors' public rows, so the query was corrected on this branch as part of
Phase 0.

## Live production audit

The Supabase dashboard was inspected read-only on 31 August 2026. No SQL was run and no
configuration or data was changed.

### Migration history

- The live ledger uses timestamp versions rather than the repository's numeric filenames.
- Collections is deployed as a series of timestamped migrations from
  `collections_tables` through `collections_delete_guard_allows_trusted_actors`.
- Searching the live ledger for `tts` returns no result, even though the `tts-assets` bucket
  and all four of its policies exist. The storage objects therefore match
  `0012_tts_assets.sql`, but that change is not represented by a matching ledger entry.
- Before applying `0013_grant_reconciliation.sql` or `0014_set_drafts.sql`, record or repair
  the TTS baseline using the chosen migration workflow. Do not recreate the existing bucket
  or policies blindly.

### Tables and data

The `public` schema contains nine tables/views exposed by the table inventory:
`collection_members`, `collection_organizers`, `collections`, `gallery_characters`,
`profiles`, `set_characters`, `set_contributions`, `set_reports`, and `sets`.

- There is no `set_drafts` table.
- `sets` has the expected 31 columns, including `document jsonb`, `revision int4`, scoped
  publishing fields, lineage, gallery indexes, kind, hero count, and social image.
- Collections already contains user data: two collections, two memberships, and two
  organizers were visible in the dashboard estimates. They are out of feature scope but
  must be preserved by backup and rollback work.

### Existing revision and RLS behaviour

- `sets_bump_revision` is enabled as a `BEFORE UPDATE` row trigger on `sets`.
- Its live `bump_revision` definition increments `revision` only when `new.document is
  distinct from old.document`; otherwise it preserves the old revision.
- RLS is enabled on `sets`. Its live policies are `sets_admin_moderate`, `sets_admin_read`,
  `sets_anon_no_public_insert`, `sets_anon_no_public_update`, `sets_owner_all`, and
  `sets_public_read`.
- `sets_owner_all` uses and checks `auth.uid() = owner_id`.
- `sets_public_read` exposes only `visibility = 'public' and not hidden`.
- The two restrictive anonymous-account policies prevent anonymous authenticated users from
  inserting or updating a row to `visibility = 'public'`.

The dashboard confirms policy names and expressions but does not expose every table/column
grant in the same view. Catalogue-level grant verification remains required before Phase 1.

### Functions and storage

The function inventory includes the expected publication, gallery, contribution, profile,
and collections helpers. No draft RPC exists.

Two buckets exist and both are public:

| Bucket | Policies | Write check |
|---|---:|---|
| `set-assets` | 4 | Bucket id plus first folder equal to `auth.uid()` |
| `tts-assets` | 4 | Bucket id plus first folder equal to `auth.uid()` |

There is no `draft-assets` bucket. The current public buckets must not be reused for private
draft material.

### Backups

The project is on Supabase's Free plan. The dashboard explicitly reports that the plan does
not include scheduled backups, and the project overview reports no last backup.

The manual PostgreSQL route is now prepared. The dashboard reports PostgreSQL `17.6.1.155`,
and portable PostgreSQL `17.11` client tools are installed under
`%LOCALAPPDATA%\UnmatchedLabs\PostgreSQL\17.11`. The production session-pooler endpoint and
non-secret connection parameters are recorded in `POSTGRES_BACKUP.md`.

`tools/backup-supabase.ps1` prompts invisibly for the database password, requires TLS,
checks the server major version, writes only outside the repository, creates a PostgreSQL
custom-format archive without ownership or privileges, verifies it with
`pg_restore --list`, and records a SHA-256 manifest. It does not place a password in command
arguments or files.

The backup/restore gate remained closed until the archive was restored against a separate
recovery project. A database export is not considered verified merely because
`pg_restore --list` can parse it.

The production logical backup was created on 2026-08-31 at:

`G:\Unmatched Labs Backups\supabase-kyqcvbnxfmpnbwtikzxp-20260831T211858Z\database.dump`

Independent verification produced the following evidence:

| Check | Result |
|---|---:|
| Archive size | 468,592 bytes |
| Source database size | 13,855,891 bytes |
| `pg_restore --list` exit | 0 |
| Archive entries | 514 |
| SHA-256 | `D7AF9E2F9BC99540F12B9B831BE6DD400524D6513CEE6B950715FA912079A045` |
| Manifest hash matches archive | Yes |
| Dump warnings or errors | 0 |

The table of contents includes `sets` and `collections` schema/data entries plus the
expected `sets` policies and triggers. This confirms archive integrity and coverage of the
Phase 0 production objects.

### Recovery rehearsal

The verified archive was restored on 1 September 2026 into the isolated Free-plan Supabase
project `adventures-workshop-recovery` (`jtpifbkqkoitzjfrxhhn`). The target preflight
confirmed PostgreSQL 17.6 and empty Auth, Storage, public, and migration-ledger data before
any restore statement ran. The script is pinned to this recovery project and refuses the
production project or a non-empty target.

`tools/restore-supabase-rehearsal.ps1` preserved the recovery project's managed Auth and
Storage schema definitions, restored only the required Auth rows and Storage metadata,
restored the complete public schema/data, and restored the eight application-owned Storage
policies. Because a new project has no migration ledger until its first migration, the
script created `supabase_migrations.schema_migrations` from the archive's exact schema,
table, data, and constraint entries. The restore ran through `psql --single-transaction`
with stop-on-error behaviour and disabled data-load triggers only for that transaction.

Verification after commit matched every expected source count:

| Object | Rows |
|---|---:|
| `auth.identities` | 13 |
| `auth.users` | 20 |
| `public.collection_members` | 2 |
| `public.collection_organizers` | 2 |
| `public.collections` | 2 |
| `public.profiles` | 20 |
| `public.set_characters` | 27 |
| `public.set_contributions` | 2 |
| `public.set_reports` | 0 |
| `public.sets` | 11 |
| `storage.buckets` | 2 |
| `storage.objects` | 332 |
| `supabase_migrations.schema_migrations` | 42 |

The recovery catalogue also contains 37 public policies, 15 public triggers, 30 public
functions, and all eight application-owned Storage policies. The restore log contains no
PostgreSQL error and no rollback.

Recovery evidence is stored beside the backup at:

`G:\Unmatched Labs Backups\supabase-kyqcvbnxfmpnbwtikzxp-20260831T211858Z\restore-rehearsal-jtpifbkqkoitzjfrxhhn-20260901T030719Z`

The evidence manifest SHA-256 is
`07EA61C6B16DEC520D50A72D2DC7A0A2FF0390861588E91BC14E422E022D2446`.
Storage object bytes, Vault secrets, ownership, and grants remain explicitly outside this
logical restore. Production grants were audited separately as recorded below.

Supabase database backups contain Storage metadata, not Storage object bytes. This is
acceptable for the additive draft-schema migration only because the existing public bucket
objects are out of scope and must not be changed by Phase 0.

## Live grant catalogue audit

A credential-safe catalogue audit ran against production on 1 September 2026. The query ran
inside an explicitly read-only transaction and inspected effective privileges for `anon`,
`authenticated`, and `service_role`; it did not read application rows or change the database.
The evidence covers 11 scoped relations, 133 columns, no public sequences, and 33 public or
policy-boundary routines.

Evidence is stored at:

`G:\Unmatched Labs Backups\supabase-kyqcvbnxfmpnbwtikzxp-20260831T211858Z\catalogue-audit-kyqcvbnxfmpnbwtikzxp-20260901T032203Z`

The catalogue SHA-256 recorded by its manifest is
`E62209AEBDDBC5C47A278F858B3EBDCDDE67329C507B815FD7563F6A770B0928`.

Confirmed boundaries:

- `anon` and `authenticated` cannot create in `auth`, `public`, or `storage`; neither role
  can bypass RLS or log in directly. `service_role` can bypass RLS as expected.
- `profiles.is_admin` is readable but has no client insert/update grant. Profile writes are
  limited to id, display name, and avatar URL.
- Contributions withhold contributor id on insert, withhold identity/content fields on
  update, and leave `resolved_at` to the trigger.
- Production reports default `reporter_id` to `auth.uid()` and do not grant clients insert
  on that column. This is safer than the repository's current `0002_gallery.sql`, whose
  create/grant statements still describe the older caller-supplied form.
- `set_characters` is client read-only. The collection tables also use restricted grants,
  although collections remain outside this implementation scope.
- Intended security-definer RPCs have explicit client grants and pinned search paths. The
  Auth/collection trigger helpers are not executable by client roles.

The audit also found grant drift that must be reconciled before Phase 1:

- `public.sets` retains Supabase's broad default relation grants for both client roles.
  RLS still decides which rows are readable or writable, but an authenticated owner can
  submit values for database- or moderator-owned columns on their own row, including the
  initial `revision`, `hidden`, `hidden_reason`, `view_count`, timestamps, and derived index
  fields. The update trigger holds `revision` steady or increments it after updates, but it
  does not make the broad insert/update grant least-privilege.
- `public.gallery_characters` was granted `select` without first revoking its default
  relation privileges. Its distinct view is not normally updatable, but the excess grants
  should not remain as an implicit safety assumption.
- `public.index_set_characters()` is a security-definer trigger function that still inherits
  direct `PUBLIC` execute. Its trigger return type prevents ordinary RPC use, but the grant
  is unnecessary and inconsistent with the other protected trigger helpers.
- Default ACLs continue to grant new public relations, functions, and sequences broadly to
  both client roles. Every Phase 1 object therefore needs an immediate explicit revoke and
  narrow re-grant; relying on creation defaults is not acceptable for private drafts.

No production grant was changed by this audit. The reviewed reconciliation is now prepared
as `0013_grant_reconciliation.sql`: it aligns the canonical report default/grant, explicitly
narrows the gallery and internal-trigger grants, replaces the broad admin update policy with
the narrow `moderate_set` RPC, and grants publishing only on the columns the client sends.
`0002_gallery.sql` and `0007_gallery_browse.sql` were also corrected so a clean replay starts
from the safer definitions instead of waiting for `0013` to repair them.

The migration was executed on 1 September 2026 inside an explicit transaction against
`adventures-workshop-recovery`, passed its own catalogue assertions, and was then rolled
back. Validation confirmed that the temporary state allowed authenticated document inserts,
withheld direct hidden-field updates, removed the old broad moderation policy, and exposed
the new RPC only to `authenticated`. After rollback all 11 set rows remained, the RPC was
absent, the old recovery policy was present, and every sampled privilege exactly matched
its captured preflight value. No recovery or production grant was left changed.

Rollback-validation evidence is stored at:

`G:\Unmatched Labs Backups\supabase-kyqcvbnxfmpnbwtikzxp-20260831T211858Z\grant-reconciliation-validation-jtpifbkqkoitzjfrxhhn-20260901T131416Z`

The validated migration SHA-256 is
`D4361B8131FECE7C08B93FE483C9B983E2AE45311F1E3E06291AC4283B99A9AF`; the evidence manifest
SHA-256 is `F6096BD8CE8816500320A6E4FDD7433F66CEF271EF7CF898CEA13B73C4B81434`.

After the TTS history repair and separate explicit approval, the migration was applied to
production on 1 September 2026 as one stop-on-error PostgreSQL transaction. Supabase CLI
`2.116.0` then marked only version `0013` / `grant_reconciliation` as applied, recording its
23 parsed statements. The ledger moved from 43 to 44 rows, and the fingerprint of the prior
43 rows remained unchanged.

The live database contained 12 published-set rows by this preflight, one more than the
backup-era audit. The guard treated that as normal live data, captured the current
fingerprint, and postflight proved all 12 rows were unchanged. All 349 Storage object-metadata
rows, both bucket rows, and all eight application-owned Storage policies also retained their
preflight counts and fingerprints.

Postflight confirmed the reviewed privilege boundary: clients no longer have relation-wide
insert access to `sets`; authenticated authors retain the required document-column access;
hidden moderation columns remain unavailable directly; the broad admin update policy is
gone; `moderate_set` is a security-definer function with a closed search path and is exposed
only to `authenticated`; and the sampled internal trigger function remains unavailable to
client roles.

Production evidence is stored at:

`G:\Unmatched Labs Backups\supabase-kyqcvbnxfmpnbwtikzxp-20260831T211858Z\grant-reconciliation-production-kyqcvbnxfmpnbwtikzxp-20260901T134737Z`

The production evidence manifest SHA-256 is
`C0B85806AF93126CDD2F047FA088D3CECF2585472D45E4C3999672CE52C600D8`.

## TTS migration-history baseline

Supabase documents `migration repair --status applied` as a migration-history-only operation:
it inserts the selected version into `supabase_migrations.schema_migrations` without running
the migration SQL. The prepared production baseline therefore uses version `0012` and name
`tts_assets`, matching `supabase/migrations/0012_tts_assets.sql`; it does not create, update,
or remove the existing bucket or policies. The 42 timestamped production ledger rows remain
separate and must be preserved.

`tools/validate-tts-ledger-baseline.ps1` models that one-row history repair on the isolated
recovery project inside an explicit transaction. It refuses the production project, verifies
the reviewed TTS migration SHA-256, confirms the bucket is public and the four policy shapes
match the migration, and fingerprints the TTS bucket row, policy catalogue, object metadata,
and complete migration ledger before making any temporary change.

Rollback validation completed on 1 September 2026. Inside the transaction the ledger count
changed from 42 to 43 and exactly one `0012` / `tts_assets` row existed. The bucket, policy,
and object fingerprints were unchanged. After rollback the ledger returned to 42 rows with
its original fingerprint, and no `0012` or TTS-named row remained. The recovery bucket had
no object metadata rows, which is consistent with the restore evidence: PostgreSQL backup
preserves Storage metadata but not object bytes.

Rollback-validation evidence is stored at:

`G:\Unmatched Labs Backups\supabase-kyqcvbnxfmpnbwtikzxp-20260831T211858Z\tts-ledger-baseline-validation-jtpifbkqkoitzjfrxhhn-20260901T133006Z`

The validated TTS migration SHA-256 is
`9CEF0132283544E0BCFEB6917B9C3C34F6841375ABE694532C8DCB839F29DCDA`; the evidence manifest
SHA-256 is `3FFCD99219654F560FB55B162B3BEE175E498A582DE5AFC60DE004F732AC0B73`.
Nothing was committed to recovery by this validation.

After explicit approval, the production repair ran on 1 September 2026 with pinned Supabase
CLI `2.116.0`. The command marked only version `0012` as applied and did not execute the TTS
migration SQL. Production moved from 42 to 43 ledger rows; the new row is named `tts_assets`
and contains the CLI's nine parsed migration statements. Excluding `0012`, the original
ledger fingerprint is unchanged. The TTS bucket, four policies, and object-metadata
fingerprints also match their preflight values exactly.

Production evidence is stored at:

`G:\Unmatched Labs Backups\supabase-kyqcvbnxfmpnbwtikzxp-20260831T211858Z\tts-ledger-baseline-production-kyqcvbnxfmpnbwtikzxp-20260901T133841Z`

The production evidence manifest SHA-256 is
`6FFC0AAA9F5E680DF65F0E7F946CED742C0811BD771EA826CD061BCB8A2B2F57`.
That baseline cleared the migration-history prerequisite for the separately applied
`0013_grant_reconciliation.sql` recorded above.

## Authentication readiness

A read-only request to the configured production Auth settings endpoint reported:

| Capability | Enabled |
|---|---:|
| Anonymous users | Yes |
| Email | Yes |
| Google | Yes |
| Discord | Yes |
| New sign-ups | Yes |
| Email auto-confirm | No |

Provider enablement is not the same as a completed recovery test. Before Phase 1 exits, use
a permanent test account to complete at least one Google or Discord sign-in, sign out, and
recover the same account in a clean browser profile. Email OTP remains blocked by the
documented SMTP-domain problem until a real code is received and verified end to end.

### Permanent-account recovery

Google recovery was walked end to end on 1 September 2026. The first local sign-in returned
to a Vercel `404: NOT_FOUND` page. Production Auth configuration showed two independent
causes: the Site URL incorrectly contained a wildcard path, and the active port-5173 local
origins were absent from the redirect allow-list.

After explicit approval, the user corrected the production Auth settings manually. A
read-only dashboard check confirmed:

- Site URL: `https://www.unmatchedlabs.com/`
- allowed redirect: `http://localhost:5173/**`
- allowed redirect: `http://127.0.0.1:5173/**`
- all four pre-existing Vercel and port-5174 redirects preserved

The regular Workshop session was then signed out, and the same Google account was used from
a separate Microsoft Edge InPrivate profile at `http://localhost:5173/`. The callback
returned to Unmatched Labs without an error and the account control changed from the explicit
signed-out state to the signed-in state. No email address, provider identifier, token, or
profile name was read or recorded. This completes the permanent-account recovery gate;
email OTP remains a separate provider-specific issue and is not required for the Google path.

## Initial payload measurements

These measurements use the real v47 factories, `serializeSet()`, structural asset walker,
hashing, and string substitution. They are synthetic bounds, not a replacement for exported
sets from real authors.

| Sample | Result |
|---|---:|
| Empty v47 set | 7,514 bytes |
| Content-heavy set (8 characters, 240 cards, no assets) | 740,530 bytes |
| Same set with 24 unique 256 KiB embedded assets | 9,479,230 bytes |
| Decoded unique asset bytes | 6,291,456 bytes |
| Document after replacing assets with stable hash references | 742,480 bytes |

The result supports separating assets before whole-document saves: in this sample, stable
references keep the repeated JSON write under 0.75 MB instead of about 9.48 MB. It did not by
itself establish production upload duration or a safe debounce; the real production snapshots
and production timing probe below complete that evidence.

### Real production snapshots

Five currently public, non-hidden production rows were queried anonymously. The smallest,
median, and largest documents were selected by asset-referenced JSON size, every public
`set-assets` object they referenced was downloaded with six-way bounded concurrency, and the
assets were re-embedded in memory. No row or object was changed, and no document contents,
names, ids, or URLs were logged.

| Sample | Referenced JSON | Unique assets | Decoded assets | Hydrated document |
|---|---:|---:|---:|---:|
| Smallest | 71,770 bytes | 22 | 3,978,756 bytes | 5,372,388 bytes |
| Median | 116,722 bytes | 30 | 9,279,423 bytes | 12,483,342 bytes |
| Largest | 206,162 bytes | 64 | 23,548,073 bytes | 32,019,190 bytes |

All 116 asset fetches succeeded. These real snapshots reinforce the synthetic result: asset
extraction changes a multi-megabyte local document into a roughly 72–206 KiB repeated JSON
write. The largest sample supplied the byte counts for the production timing probe below. A
largest local unpublished export was also measured because public snapshots may not represent
every draft asset.

### Largest available unpublished export

The local Workshop library was inspected on 1 September 2026 and contained one unpublished
document. Its self-contained set export was measured with
`tools/measure-cloud-draft-payload.mjs`; no document contents were logged or uploaded.

| Sample | Export | Unique embedded assets | Decoded assets | Reference-form document |
|---|---:|---:|---:|---:|
| Largest available unpublished set | 11,710 bytes | 0 | 0 bytes | 11,710 bytes |

The exact export SHA-256 is
`6F42B481F07D2725B5B7A2FBD968E304C8758C0647703FB510C7C0EBCAB6AC0C`. This is an honest
largest-available sample rather than an upper bound: the draft is small and contains no
embedded artwork. The asset-heavy public snapshots above remain the stronger sizing evidence,
and therefore supplied the production timing envelope.

### Production upload timing

The browser-to-production route was measured on 1 September 2026 from the same clean Edge
InPrivate session used for permanent-account recovery. The probe used the shipped authenticated
HTTP boundary, not a service key or direct PostgreSQL connection. It uploaded deterministic
synthetic bytes through Storage, wrote a synthetic `visibility = 'private'` row through
PostgREST, and deleted all probe data after measurement. It did not upload a user document,
artwork, name, id, token, or account identity.

The payload matched the largest real production snapshot: 64 objects totalling 23,548,073
bytes, uploaded with six-way bounded concurrency, followed by a 206,162-byte reference-form
document. Five document writes were timed. This is one workstation and network connection,
not a production latency service-level objective.

| Measurement | Result |
|---|---:|
| Asset upload | 6,847.2 ms |
| Asset throughput | 27.5 Mbit/s |
| Asset request p50 / p95 / max | 546.8 / 1,014.1 / 1,077.7 ms |
| Reference write samples | 389.4, 325.0, 266.2, 378.5, 278.8 ms |
| Reference write p50 / p95 / max | 325.0 / 389.4 / 389.4 ms |
| First save, assets plus first document | 7,236.6 ms |

The current local IndexedDB autosave waits 500 ms. That remains appropriate for crash safety,
but it must not become the cloud request cadence. The measured 266–389 ms reference writes
support the planned 1.5–2 second cloud debounce with a per-set single-flight queue: ordinary
reference-only writes finish well inside that interval, while the initial asset-heavy save is
a separate, progress-reported operation that may take several seconds.

The interruption guard stopped after uploading three synthetic objects totalling 1,048,576
bytes and confirmed that no document row existed. The complete run also confirmed that the
private row was unreadable through both anonymous table access and its share slug. Final
authenticated prefix listing and row selection found zero remaining objects and zero remaining
rows.

## Feature-flag contract

The first implementation uses one explicit mode with a fail-closed default:

- `off` — default when missing or invalid. No draft network reads or writes. IndexedDB
  behaves exactly as it does today.
- `shadow` — permanent signed-in internal accounts keep IndexedDB authoritative and upload a
  private copy for comparison. The app never opens the shadow copy as authority.
- `authoritative` — the cloud draft is authoritative for eligible permanent accounts;
  IndexedDB remains cache/outbox. This mode is forbidden until conflict handling and the
  copy-first migration are usable.

An environment flag is sufficient for internal preview stages. Cohort rollout later needs a
server-controlled eligibility decision, but an unavailable or malformed decision must
always resolve to `off`, never `authoritative`.

## Rollback rules

1. Switch the client mode to `off`; deploy the previous frontend if the flag itself is
   implicated.
2. Leave draft rows and private objects intact. Never drop a table or bucket as rollback.
3. Open the self-contained IndexedDB document and keep JSON export visible.
4. During shadow and early authoritative rollout, never remove the local document after a
   successful cloud save.
5. Preserve pending local generations. A rollback must not mark them synced or replace them
   with an older cloud revision.
6. Record the last deployed migration, client version, affected account, set id, expected
   revision, and failure stage without logging document contents, tokens, or asset bytes.
7. Restore database state only from a confirmed pre-migration backup and only as a separate,
   explicitly approved recovery operation.

## Phase 0 gate

| Check | Status | Evidence / next action |
|---|---|---|
| Collections excluded from implementation scope | Complete | Plan revised; no merge performed. |
| Repository migrations inventoried | Complete | Branch contains `0001`–`0013_grant_reconciliation`. |
| Live migration ledger and schema inspected | Complete | Timestamped collections migrations are present; the missing TTS entry was identified and has now been repaired; no draft objects exist. |
| `sets` revision trigger verified in production | Complete | Live trigger and function definition match document-only revision semantics. |
| Policies, functions, and buckets verified | Complete | Existing RLS and both public bucket policy sets inspected read-only. |
| Table/column/function grants verified | Complete | Read-only production catalogue evidence covers effective client privileges and default ACLs. |
| Repository/live grant reconciliation | Complete | `0013_grant_reconciliation.sql` passed recovery rollback validation, then applied transactionally in production with ledger and catalogue postflight evidence. |
| TTS migration represented in the live ledger | Complete | Supabase CLI `2.116.0` marked `0012` applied; postflight proved the existing ledger and TTS Storage state were otherwise unchanged. |
| Owner filter on `listMyPublishedSets` | Complete | Query now filters by the current user's encoded id. |
| Permanent provider enabled | Complete | Google and Discord are enabled in live Auth settings. |
| Permanent account recovery walked end to end | Complete | Google sign-in, sign-out, and same-account recovery succeeded from a separate Edge InPrivate profile after correcting production redirect configuration. |
| Representative real payloads measured | Complete | Small/median/largest public snapshots plus the largest available unpublished export were measured without logging contents. |
| Production upload timings measured | Complete | Largest measured envelope completed in 7.24 s; five reference-only writes were 266–389 ms, interruption created no row, public reads were denied, and verified cleanup found no remaining probe data. |
| PostgreSQL backup route prepared | Complete | PostgreSQL 17.11 portable tools, session-pooler parameters, and credential-safe wrapper are ready. |
| Backup created and restore procedure confirmed | Complete | Verified archive restored into isolated project `jtpifbkqkoitzjfrxhhn`; all expected rows and application policies matched. |
| Feature-flag and rollback rules recorded | Complete | See sections above. |

Every Phase 0 gate is complete. Phase 1 may begin with the reserved
`0014_set_drafts.sql` private draft backend.
