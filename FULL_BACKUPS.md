# Full production backups

The full backup route protects both halves of a recoverable set:

- PostgreSQL schema and rows, including application data, Auth identities, migration history,
  bucket records, and object metadata; and
- the actual bytes in every Supabase Storage bucket, including private draft artwork.

A database dump by itself is not a full backup. Supabase Storage keeps object metadata in
PostgreSQL but stores the bytes separately.

## Tools and credentials

Run these tools with PowerShell 7 (`pwsh`), not the older Windows PowerShell
(`powershell.exe`). The backup script checks this before asking for credentials or
creating an incomplete backup folder.

The existing PostgreSQL 17 tools remain at
`%LOCALAPPDATA%\UnmatchedLabs\PostgreSQL\17.11\pgsql\bin`.

Bulk Storage transfer uses the official S3-compatible endpoint through the portable rclone
executable at `%LOCALAPPDATA%\UnmatchedLabs\rclone\1.75.0\rclone.exe`. Install the pinned
version from rclone's official release archive with:

```powershell
pwsh -File .\tools\install-rclone.ps1
```

The installer downloads the release archive and its official `SHA256SUMS`, refuses a mismatch,
and installs only the verified executable. The backup script does not create an rclone
configuration file. It places the supplied credentials only in the child process environment
and restores every previous environment value when the run ends.

The operator needs:

1. The production database password.
2. A server-only Supabase Storage S3 access-key pair from **Storage → Configuration → S3**.

Both are entered through hidden prompts. Never put either credential in a command, repository,
backup manifest, log, browser application, support report, or scheduled-task argument.

## Create a full backup

Choose a directory outside the repository:

```powershell
pwsh -File .\tools\backup-supabase.ps1 `
  -OutputDirectory 'G:\Unmatched Labs Backups' `
  -IncludeStorage
```

The database archive is created first. For each Storage bucket, the script then:

1. Reads the expected current object count and byte total from PostgreSQL.
2. Downloads every object through Supabase's S3-compatible endpoint.
3. Measures the remote bucket again and rejects a backup taken across a changing inventory.
4. Uses `rclone check --download` to compare source and downloaded bytes.
5. Records an independent SHA-256 and size for every local object.
6. Runs the independent backup verifier before setting `full_backup_complete` to `true`.

If any stage fails, no manifest may truthfully claim that the directory is a complete full
backup. Existing remote objects are read only; the backup command never deletes or changes
Supabase data.

## Backup layout

Each run creates a new `supabase-<project>-<UTC timestamp>` directory containing:

```text
database.dump
database.contents.txt
pg_dump.log
manifest.json
storage/
  manifest.json
  rclone.log
  buckets/
    draft-assets/...
    set-assets/...
    tts-assets/...
```

The top-level manifest is the authority. A full backup requires both
`storage_object_bytes_included: true` and `full_backup_complete: true`.

## Verify an existing backup

Verification reads and hashes the entire local backup without contacting production:

```powershell
pwsh -File .\tools\verify-supabase-backup.ps1 `
  -BackupDirectory 'G:\Unmatched Labs Backups\supabase-...' `
  -RequireStorage
```

The verifier checks the database archive size and SHA-256, parses it with `pg_restore`, checks
the Storage-manifest hash, verifies every Storage object byte-for-byte against its SHA-256,
rejects missing or extra files, and rejects any `.partial` file.

`tools/test-backup-verifier.ps1` builds a temporary full-backup fixture, proves it passes, alters
one object without changing its length, proves that corruption is rejected, and deletes only
its uniquely named system-temporary directory.

## Recovery and retention

The first live full backup is not considered rehearsed until its database and Storage objects
have been restored into an isolated non-production Supabase project and checked against the
source manifests. Resetting the existing recovery project is destructive and requires a
separate explicit approval.

After that approval, create a server-only S3 key in the pinned recovery project and run:

```powershell
pwsh -File .\tools\test-full-backup-recovery.ps1 `
  -BackupDirectory 'G:\Unmatched Labs Backups\supabase-...' `
  -ResetExisting
```

The tool refuses the production project ref, database user, and Storage endpoint; refuses any
target other than the pinned recovery project; verifies the source backup before prompting for
credentials; and requires the exact recovery-project reset phrase before clearing test data.
Storage objects are deleted through the S3 API before their recovery metadata is reset. After
the database restore it force-uploads every saved object, downloads each one for comparison,
and checks bucket, object, and byte counts against the backup manifests.

Until off-site replication is configured, keep every verified full backup. Do not enable the
Storage cleanup deletion switch merely because a local archive exists. The intended steady
state is:

- up to 48 hourly database recovery points;
- 30 daily full recovery points;
- 12 monthly full recovery points;
- one local copy and one encrypted off-site copy; and
- a monthly restore rehearsal.

Retention deletion and unattended credential storage are intentionally not implemented in the
first pass. They require the off-site copy and a reviewed Windows credential/scheduler design
so that automation cannot silently delete the only good backup.
