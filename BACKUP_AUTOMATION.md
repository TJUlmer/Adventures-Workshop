# Encrypted off-site backup automation

The unattended backup is deliberately a two-copy process:

1. Create a complete local PostgreSQL-and-Storage backup.
2. Verify every local byte against its manifests.
3. Encrypt and deduplicate the verified directory with restic.
4. Upload only the encrypted restic data to a private off-site bucket.
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

This reads production data but does not change it. It creates a new local full backup, verifies
it, uploads encrypted chunks, checks the repository, and records the snapshot in
`%LOCALAPPDATA%\UnmatchedLabs\backup-automation\last-success.json`.

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

Create the daily schedule only after both commands above pass. The intended starting schedule
is once per day at 2:00 AM Central time. The computer must be awake, online, signed in to the
same Windows account, and able to access the local backup drive.

Every run writes a private transcript under
`%LOCALAPPDATA%\UnmatchedLabs\backup-automation\logs` and replaces `last-success.json` only
after both local verification and the off-site repository check pass. Check that file at least
weekly and run `test-offsite-backup.ps1` monthly.

Retention remains disabled in format version 1. No automatic job deletes local backups or
off-site snapshots. After at least one scheduled run and one off-site restore proof, add and
test the documented 30-daily/12-monthly retention policy as a separate change.

## First production result

The first production automation run completed on 2026-09-02:

- local backup: `supabase-kyqcvbnxfmpnbwtikzxp-20260902T214440Z`;
- database and 365 Storage objects (105,817,441 bytes) passed local verification;
- restic stored snapshot `187846d9fd2b94f42ca488dc3b8ba57c35dd97847ac7250e6af971209af4fe7d`;
- the repository structure check reported no errors; and
- the snapshot was downloaded, decrypted, and passed the independent full-backup verifier.

The off-site restore test used an isolated local temporary directory and did not connect to or
change Supabase. The temporary restored copy was removed only after its verification passed.
