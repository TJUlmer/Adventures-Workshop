# Encrypted off-site backup automation

The unattended backup has two cadences so routine protection does not download the whole of
Supabase Storage every day:

1. Every day, create and verify a complete PostgreSQL archive.
2. Every 30 days, refresh a persistent Storage mirror with `rclone sync`, downloading only new
   or changed objects, then run one complete `rclone check --download` verification.
3. On a full run, copy the verified mirror locally into the established self-contained backup
   layout.
4. Encrypt and deduplicate the verified directory with restic and upload only its encrypted
   data to the private off-site bucket.
5. Check the off-site repository structure and record the snapshot ID.

If local verification fails, nothing is uploaded. If the upload fails, the verified local
backup remains available. No automated retention deletion is enabled until an off-site
snapshot has been downloaded, decrypted, and passed through the independent verifier.

## Why Backblaze B2 is the default

The measured 2026-09-02 production backup contains approximately 106 MB of data. Backblaze
B2 includes the first 10 GB of storage at no charge and can be opened without a billing
method. The backup uses its S3-compatible API because that is the route recommended by the
restic documentation.

Restic performs content-defined deduplication before upload. A daily snapshot can still
describe the entire backup while unchanged artwork is stored only once in the repository.
This makes 10 GB materially more useful than uploading dozens of independent 106 MB folders.
It is not unlimited: inspect usage monthly and arrange paid capacity or a second provider well
before the repository approaches 8 GB.

Cloudflare R2 is compatible with the same design and also includes 10 GB-month of Standard
storage, but enabling R2 requires completing a usage-based subscription checkout. Google
Drive includes 15 GB but shares that quota with Gmail and Photos and requires an additional
rclone/OAuth layer. Neither is the default for this first automation.

## Create the private B2 destination

Create a Backblaze account and enable B2 Cloud Storage. Then:

1. Create a **private** bucket with a globally unique name made from lowercase letters,
   digits, and hyphens. Do not enable Object Lock.
2. Set its lifecycle rule to **Keep only the last version of the file**. Restic controls its
   own recovery-point history; this B2 rule removes hidden object versions that would otherwise
   keep consuming quota after restic replaces or prunes repository files.
3. Create an application key restricted to this bucket, with **Read and Write** access and
   **Allow List All Bucket Names** enabled. The S3-compatible API requires the latter for
   integrations that issue `ListBuckets` or `HeadBucket`.
4. Copy the `keyID`, `applicationKey`, and the bucket's S3 endpoint. Backblaze shows the
   application key only once.

The restricted application key can read, write, and delete objects only in this backup bucket.
Delete access is needed for restic lock files and eventual reviewed retention; it cannot manage
the Backblaze account or any Supabase data.

## Install and configure

Install the pinned restic release from its official archive. The installer verifies the
archive against the release's official `SHA256SUMS` before installing it:

```powershell
pwsh -NoProfile -File .\tools\install-restic.ps1
```

Configure the local backup directory and private bucket. Use the endpoint displayed by
Backblaze, for example `https://s3.us-west-004.backblazeb2.com`:

```powershell
pwsh -NoProfile -File .\tools\configure-backup-automation.ps1 `
  -BackupOutputDirectory 'G:\Unmatched Labs Backups' `
  -BucketName 'your-globally-unique-private-bucket' `
  -S3Endpoint 'https://s3.your-region.backblazeb2.com'
```

On Windows, the masked setup window avoids terminal-focus and clipboard mistakes. Its defaults
match the current production setup:

```powershell
pwsh -NoProfile -STA -File .\tools\configure-backup-automation-gui.ps1
```

The GUI requires the new encryption password to be at least 16 characters and confirms it
before contacting Backblaze. It passes credentials to the underlying configuration script as
in-process `SecureString` values; no secret is added to a command-line argument.

The command asks through hidden prompts for:

- the production Supabase database password;
- the production Supabase Storage S3 key ID and secret;
- the bucket-restricted Backblaze key ID and application key; and
- a new, unique restic encryption password, entered twice.

Save the restic encryption password in a password manager that is not dependent on this
computer. Backblaze cannot reset it and the repository is intentionally unrecoverable without
it.

The credentials are saved under
`%LOCALAPPDATA%\UnmatchedLabs\backup-automation\config.json` using Windows DPAPI. Only the same
Windows account on the same computer can decrypt them. The state directory also has inherited
NTFS permissions removed. Secrets never appear in the repository, scheduled command, backup
manifest, or off-site object names.

## First run and off-site recovery proof

Run one complete job manually:

```powershell
pwsh -NoProfile -File .\tools\run-backup-automation.ps1
```

This reads production data but does not change it. When no completed full backup exists, the
first run includes Storage. Otherwise, a full run is due only after 30 days. Completed local
full-backup manifests participate in that decision so a failed off-site upload cannot cause the
same Storage bytes to be downloaded again the next day.

Every successful off-site run records its database snapshot in
`%LOCALAPPDATA%\UnmatchedLabs\backup-automation\last-database-success.json`. A successful full
run also replaces `last-success.json`, which remains the default used by the full off-site
restore test.

Then prove the off-site copy can be recovered:

```powershell
pwsh -NoProfile -File .\tools\test-offsite-backup.ps1
```

The test restores the latest off-site snapshot only into a uniquely named temporary directory,
runs the complete database and per-object hash verifier, and removes the temporary copy only
after success. It does not connect to or change either Supabase project. A Windows warning
about resetting an ancestor directory timestamp is tolerated only because the independent
verifier rejects any missing, extra, or altered backup file.

## Schedule and monitor

Create the daily schedule only after both commands above pass. It runs once per day at 2:00 AM
local time; Storage is included only when its 30-day cadence is due. Install the ordinary
Microsoft PowerShell 7 package
first; do not point the task at a PowerShell executable bundled inside an editor or AI tool.
Then register the native Windows task:

```powershell
pwsh -NoProfile -File .\tools\install-windows-backup-task.ps1
```

The task retains its historical name, **Unmatched Labs Daily Full Backup**, so running the
installer with `-Replace` updates the old egress-heavy task instead of registering a second
daily task beside it:

```powershell
pwsh -NoProfile -File .\tools\install-windows-backup-task.ps1 -Replace
```

The task uses the same Windows account that configured the DPAPI-protected credentials. It
does not save the Windows account password, so that account must be logged on. Task Scheduler
wakes a sleeping computer, starts a missed run when the computer next becomes available,
waits for network availability, retries a failed start up to three times, and refuses to start
a second copy while one is running. A powered-off computer cannot be woken. The computer must
also be online and able to access the local backup drive.

To prove the scheduler itself can read the credentials and reach both destinations, start the
task once from Task Scheduler or register it with `-RunNow`. A database-only run updates
`last-database-success.json`; `last-success.json` changes only after a due full run.

Every run writes a private transcript under
`%LOCALAPPDATA%\UnmatchedLabs\backup-automation\logs`. Check
`last-database-success.json` at least weekly and run `test-offsite-backup.ps1` monthly after a
full snapshot succeeds.

The persistent mirror lives at `storage-mirror` beneath the configured local backup directory.
It is working state, not a standalone recovery point. Each monthly full run takes a local
self-contained snapshot from it, verifies that snapshot with the existing manifest verifier,
and uploads the snapshot through restic. The full downloaded-byte check happens only on that
monthly run; ordinary daily runs never request Storage object bytes.

The task still performs no automatic retention deletion. Local backups and off-site snapshots
remain until a separately reviewed retention policy is restore-tested. The legacy hourly
database scripts remain available, but the production hourly task is disabled and is not part
of this cadence.

## First production result

The first production automation run completed on 2026-09-02:

- local backup: `supabase-kyqcvbnxfmpnbwtikzxp-20260902T214440Z`;
- database and 365 Storage objects (105,817,441 bytes) passed local verification;
- restic stored snapshot `187846d9fd2b94f42ca488dc3b8ba57c35dd97847ac7250e6af971209af4fe7d`;
- the repository structure check reported no errors; and
- the snapshot was downloaded, decrypted, and passed the independent full-backup verifier.

The off-site restore test used an isolated local temporary directory and did not connect to or
change Supabase. The temporary restored copy was removed only after its verification passed.
