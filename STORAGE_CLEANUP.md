# Storage cleanup runbook

This cleanup is intentionally conservative. It reduces abandoned cloud objects without
turning ordinary edits, soft deletion, publication, or conflict recovery into data loss.

## What it may clean

- `draft-assets`: a complete `<owner>/<set>/` prefix only when no `set_drafts` row exists
  for that owner and local set ID. Active and soft-deleted drafts retain every object in
  their prefix, including older content-addressed files that another browser may still know
  about.
- `set-assets`: individual objects not referenced anywhere in either a current `sets` row
  or a `set_contributions` row. The scan considers every string in those rows so covers the
  published document, thumbnails, social images, character cards, covers, and contribution
  payloads.
- `tts-assets`: generated files that are absent from the one retained manifest for the latest
  published revision. Unpublished exports, collection exports, superseded revisions, and legacy
  objects without a manifest enter the same 30-day candidate grace period. Re-exporting the
  exact current published snapshot replaces its retained manifest; shared paths stay live while
  any retained manifest names them.

Migration `0032_tts_export_retention.sql` adds the manifest that makes TTS cleanup provable.
Exports made before that migration have no manifest and therefore receive a fresh 30-day grace
period from the first cleanup scan after rollout. Authors can preserve the current published
revision by exporting it again from its published page during that period.

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

The migration does not schedule the function and does not enable deletion.

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
8. Only then schedule a weekly server-side run. Keep the 500-object hard cap and monitor the
   aggregate failure count.

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
