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

`tts-assets` is excluded. A Tabletop Simulator save can refer to those public URLs without
leaving a database record, so the server cannot prove that an object is unused.

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
validation, report redaction, and the permanent exclusion of `tts-assets`. Database and
Storage behaviour still require the recovery-project checks above before deployment.
