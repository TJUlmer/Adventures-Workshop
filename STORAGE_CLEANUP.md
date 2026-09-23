# Storage cleanup runbook

This cleanup is intentionally conservative. It reduces abandoned cloud objects without
turning ordinary edits, soft deletion, publication, or conflict recovery into data loss.

## What it may clean

- `draft-assets`: individual objects not referenced by the latest saved cloud-draft document.
  The one current document remains indefinitely, including while it is soft-deleted and can be
  restored. Assets removed by a successful newer draft revision become due after three days;
  abandoned uploads that never belonged to a saved revision keep the 30-day safety period.
- `set-assets`: individual objects not referenced anywhere in either a current `sets` row
  or a `set_contributions` row. The scan considers every string in those rows so covers the
  published document, thumbnails, social images, character cards, covers, and contribution
  payloads. Assets removed by a successful republish or unpublish become due after three days;
  abandoned uploads that never reached a published row keep the 30-day safety period.
- `tts-assets`: generated files that are absent from the one retained manifest for the latest
  published revision. Files unique to a replaced published revision become due after three days.
  Unpublished exports, collection exports, and legacy objects without a retained manifest keep
  the 30-day candidate grace period. Re-exporting the exact current published snapshot replaces
  its retained manifest; shared paths stay live while any retained manifest names them.

Migration `0032_tts_export_retention.sql` adds the manifest that makes TTS cleanup provable.
Exports made before that migration have no manifest and therefore receive a fresh 30-day grace
period from the first cleanup scan after rollout. Authors can preserve the current published
revision by exporting it again from its published page during that period.

Migration `0036_superseded_revision_cleanup.sql` changes ordinary draft cleanup from whole-folder
retention to exact references in the one current `set_drafts` document. It also marks assets
removed from a committed draft, gallery, or retained TTS revision with a three-day safety period.
The ordinary 30-day grace period continues to cover uncommitted and temporary uploads, while
every deletion still uses the same live-reference proof and deletion-time recheck as the
owner-scoped cleanup path.

Online TTS exports use content-hashed object names. Re-exporting the same set with byte-identical
generated files reuses their existing Storage objects and writes only another small manifest row;
the downloaded TTS JSON stays on the author's device. A changed generated file receives a new
path, and the old path is protected only while an active retained manifest still names it.

## Gallery card image conversion

Migration `0030_webp_card_previews.sql` allows the admin refresh to store WebP card images.
Deploy that migration before the client that writes WebP. Version 4 PNG manifests remain
visible while version 5 is rolled out. Publishing a set creates WebP images for changed
faces; the admin's **Gallery card images** refresh converts older published snapshots
without changing their document revision. It can take a while for a large set, and a
failed set remains in the queue for retry.

The new images do not themselves release storage: the old PNG objects remain until they
are proven unreferenced and the cleanup grace period has elapsed. In the SQL editor,
measure the preview split without exposing any object URLs:

```sql
with live as materialized (
  select name from public.storage_cleanup_live_set_assets()
)
select
  case when live.name is null then 'unreferenced' else 'referenced' end as status,
  lower(substring(object.name from '[.](png|webp)$')) as format,
  count(*) as files,
  round(sum(coalesce((object.metadata ->> 'size')::bigint, 0)) / 1048576.0, 1) as mib
from storage.objects as object
left join live on live.name = object.name
where object.bucket_id = 'set-assets'
  and object.name ~ '/card-preview-[0-9a-f]{8}-[0-9a-f]{8}[.](png|webp)$'
group by status, format
order by status, format;
```

After the refresh, confirm the referenced WebP count and visually inspect published cards.
Use the existing dry-run cleanup workflow below to measure old unreferenced PNG bytes.
Deletion still requires its backup, grace period, and canary checks; there is no automatic
removal during publishing or refresh.

## Safety model

Migration `0015_storage_cleanup.sql` creates a service-role-only candidate ledger and planner.
The planner never deletes objects. An object must remain unreferenced across repeated scans
for at least 30 days. Shorter requests are raised to that minimum. Changing or recreating the
object resets that clock.

Immediately before deletion, the Edge Function checks the exact candidate timestamps and all
references again. It then deletes through the Storage API and removes the candidate marker.
Failures retain their marker for retry, while responses expose counts and byte totals rather
than private object paths.

There are two independent brakes:

1. Requests default to `dryRun: true`.
2. A destructive request is rejected unless the Edge Function environment contains
   `STORAGE_CLEANUP_EXECUTE=enabled`.

The one-time PNG-to-WebP migration has its own narrower switch,
`STORAGE_CLEANUP_LEGACY_PREVIEWS_EXECUTE=enabled`. That switch authorizes only the
`legacy-card-previews` mode backed by migration `0031`; it does not enable general cleanup.
The mode selects only unreferenced generated `card-preview-*.png` objects and rechecks the
object timestamp and references immediately before each Storage API deletion.

An owner-requested immediate cleanup has a third independent switch,
`STORAGE_CLEANUP_OWNER_EXECUTE=enabled`. The `owner-superseded` mode added by migration
`0033` accepts one exact owner UUID and considers only that owner's `set-assets` and
`draft-assets` objects. It preserves every path referenced by any current published set,
contribution, or current cloud-draft document, and repeats the owner, timestamp, and reference
checks immediately before deletion. It excludes TTS assets so old saves can only be removed by
a separate deliberate decision. Always call this mode with `dryRun: true` first and compare its
counts and bytes with the owner-specific measurement query.

Legacy TTS exports can be reclaimed one set folder at a time with the same switch and the
`owner-tts-unretained` mode added by migration `0034`. The request requires both the exact owner
UUID and exact TTS source key. Current retained manifest paths are excluded and rechecked before
each deletion. This mode exists for pre-manifest exports that cannot wait for the ordinary grace
period; run its dry report first because deleting a legacy path can break an older saved TTS file.

Migration `0038_daily_storage_cleanup.sql` schedules the standard cleanup once per day at
09:20 UTC. It uses Supabase Cron and `pg_net` to call the Edge Function with a dedicated token;
the scheduled request never carries a project-wide secret key. The migration requires these
two values to exist first:

- `storage_cleanup_project_url` in Supabase Vault, containing the project API URL; and
- `storage_cleanup_cron_token` in both Supabase Vault and the Edge Function secrets, containing
  the same randomly generated token.

The daily request uses `{ "dryRun": false, "limit": 500 }`. The function still refuses every
standard deletion unless `STORAGE_CLEANUP_EXECUTE=enabled` is present in its environment.

## Daily reports

Migration `0039_storage_cleanup_run_history.sql` adds a service-role-only aggregate history.
Every successful dry or destructive invocation records its bucket totals, attempted and deleted
counts, failure categories, and stale-marker count. Planning failures record a small failure row.
Object paths, owner ids, and credentials are never stored in the report.

Each new report removes reports older than 90 days. This bounds database growth without adding
another scheduled task. `cron.job_run_details` still records whether Cron queued the request;
`storage_cleanup_runs` records what the Edge Function actually did.

Inspect recent results through an administrator connection:

```sql
select recorded_at, status, mode, dry_run, attempted, deleted, failed,
       stale_markers_removed, buckets
from public.storage_cleanup_runs
order by recorded_at desc
limit 30;
```

## Rollout checklist

1. Apply the migration to the recovery project and run it inside the existing rollback
   validation workflow.
2. Deploy `storage-cleanup` with platform JWT verification disabled; the function performs
   its own constant-time `apikey` check against the configured Supabase secret keys.
3. Call it with an empty JSON body or `{ "dryRun": true }`. Keep the secret key in a protected
   server or scheduler header, never source code, a browser, a URL, or a support report.
4. Record bucket object counts, candidate counts, and candidate bytes. Inspect the underlying
   candidate ledger only through an administrator connection.
5. Repeat after at least the grace period. Confirm an edited/recreated object and a newly
   referenced object are no longer due.
6. Create and verify a full database-and-Storage backup using `FULL_BACKUPS.md`, then perform a
   small manually initiated canary only after separately approving deletion and setting
   `STORAGE_CLEANUP_EXECUTE=enabled`.
7. Verify active drafts, restored soft-deleted drafts, published sets, and open/resolved
   contributions still load on two browsers and two accounts.
8. Create a random cleanup token of at least 32 bytes. Store it under
   `storage_cleanup_cron_token` in Supabase Vault and `STORAGE_CLEANUP_CRON_TOKEN` in Edge
   Function secrets. Store the project API URL under `storage_cleanup_project_url` in Vault.
9. Apply migration `0038_daily_storage_cleanup.sql`, then confirm `storage-cleanup-daily`
   appears in `cron.job` with the expected schedule and command.
10. Invoke the scheduled command once while `STORAGE_CLEANUP_EXECUTE` is absent and verify the
    Edge Function rejects deletion. Run a separate authenticated dry request and inspect its
    bucket totals.
11. Set `STORAGE_CLEANUP_EXECUTE=enabled`, invoke the job once, and verify the Edge Function
    reports zero failures. Keep the 500-object hard cap and monitor `cron.job_run_details`, the
    `pg_net` HTTP response, and Edge Function logs.

To pause cleanup, remove or change `STORAGE_CLEANUP_EXECUTE`. Dry runs remain available for
capacity measurement. Disabling the cloud-draft product flag does not itself authorise or run
cleanup.

## Local verification

```bash
node tools/verify-storage-cleanup.mjs
npm run check
npm run build
```

The helper verification covers safe defaults, bounded inputs, path encoding, candidate
validation, report redaction, and all three supported buckets. Database and Storage behaviour
still require the recovery-project checks above before deployment.
