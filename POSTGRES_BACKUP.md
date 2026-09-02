# Production PostgreSQL backup route

This route creates the Phase 0 logical backup without installing a local PostgreSQL
server. It uses PostgreSQL 17 command-line tools against Supabase's session pooler and
keeps the database password out of the command line, repository, dump log, and manifest.

## Prepared configuration

| Setting | Value |
|---|---|
| Supabase project | `kyqcvbnxfmpnbwtikzxp` |
| Production PostgreSQL | `17.6.1.155` |
| Local client | PostgreSQL `17.11` portable binaries |
| Client location | `%LOCALAPPDATA%\UnmatchedLabs\PostgreSQL\17.11\pgsql\bin` |
| Connection method | Supavisor session pooler |
| Host | `aws-0-us-east-1.pooler.supabase.com` |
| Port | `5432` |
| Database | `postgres` |
| User | `postgres.kyqcvbnxfmpnbwtikzxp` |
| TLS | Required |

## Create the backup

Choose a secure location outside the repository. The script refuses repository paths
because the archive contains private user data.

```powershell
pwsh -File .\tools\backup-supabase.ps1 `
  -OutputDirectory 'D:\Unmatched Labs Backups'
```

The script prompts invisibly for the Supabase database password. It temporarily provides
the password to the PostgreSQL child processes through `PGPASSWORD`, clears it immediately
afterwards, and never writes it to disk.

Each run creates a new timestamped directory containing:

- `database.dump` — the custom-format logical archive;
- `database.contents.txt` — output from `pg_restore --list`, proving the archive can be
  parsed;
- `pg_dump.log` — verbose dump output for warning review; and
- `manifest.json` — source/client versions, archive size, and SHA-256 checksum.

An interrupted or failed run leaves `database.dump.partial` instead of naming it as a
completed backup.

## Rehearse the restore

Parsing the table of contents and hashing the completed archive verifies local archive
integrity. It does not prove that the recovery procedure works. Never use the production
database as the first restore target.

The reviewed rehearsal script is pinned to the isolated recovery project
`adventures-workshop-recovery` (`jtpifbkqkoitzjfrxhhn`) and refuses the production project.
It also refuses a recovery target containing public objects or Auth, Storage, or migration
data. Run it with the verified archive:

```powershell
pwsh -File .\tools\restore-supabase-rehearsal.ps1 `
  -ArchivePath 'G:\Unmatched Labs Backups\supabase-kyqcvbnxfmpnbwtikzxp-20260831T211858Z\database.dump'
```

The script prompts invisibly for the recovery project's database password, verifies the
archive's fixed SHA-256, checks PostgreSQL and managed-table compatibility, generates an
explicit allowlist restore, and runs it as one stop-on-error transaction. It preserves the
recovery project's Auth and Storage definitions; a missing Supabase migration ledger is
created from the archive's five exact ledger entries. Temporary plaintext SQL is deleted
after the run whether the restore succeeds or fails.

The completed rehearsal evidence is at:

`G:\Unmatched Labs Backups\supabase-kyqcvbnxfmpnbwtikzxp-20260831T211858Z\restore-rehearsal-jtpifbkqkoitzjfrxhhn-20260901T030719Z`

Its manifest records an empty PostgreSQL 17.6 target, the expected archive SHA-256, a
single-transaction restore, exact source/target row-count matches, 37 public policies,
15 public triggers, 30 public functions, and all eight application-owned Storage policies.
The restore log contains no PostgreSQL error and no rollback.

## Recovery boundary

The dump deliberately omits object ownership and privileges to avoid managed-role
conflicts during recovery. Production grants were verified separately by
`tools/audit-supabase-grants.ps1`; its read-only evidence is stored under the backup's
timestamped `catalogue-audit-kyqcvbnxfmpnbwtikzxp-*` directory.

PostgreSQL contains Supabase Storage metadata, but not the actual object bytes. This route
therefore protects the database changes made by the draft migration; it is not an object
backup for the existing `set-assets` or `tts-assets` buckets. Those buckets are outside the
additive draft-schema migration and must not be modified during Phase 0.

Do not adapt this script to another destination until that target and the exact archive have
been reviewed as a separate recovery operation.
