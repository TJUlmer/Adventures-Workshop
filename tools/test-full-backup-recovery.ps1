[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $BackupDirectory,

    [switch] $ResetExisting,

    [string] $PostgresBin = "$env:LOCALAPPDATA\UnmatchedLabs\PostgreSQL\17.11\pgsql\bin",

    [string] $RcloneBin = "$env:LOCALAPPDATA\UnmatchedLabs\rclone\1.75.0\rclone.exe",

    [string] $HostName = 'aws-0-us-east-1.pooler.supabase.com',

    [int] $Port = 5432,

    [string] $Database = 'postgres',

    [string] $TargetProjectRef = 'jtpifbkqkoitzjfrxhhn',

    [string] $UserName = 'postgres.jtpifbkqkoitzjfrxhhn',

    [string] $StorageEndpoint = 'https://jtpifbkqkoitzjfrxhhn.storage.supabase.co/storage/v1/s3',

    [string] $StorageRegion = 'us-east-1'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'This recovery test requires PowerShell 7 or newer. Run it with pwsh, not powershell.exe.'
}

$productionProjectRef = 'kyqcvbnxfmpnbwtikzxp'
$approvedRecoveryProjectRef = 'jtpifbkqkoitzjfrxhhn'
$resolvedBackup = [System.IO.Path]::GetFullPath($BackupDirectory)

if ($TargetProjectRef -eq $productionProjectRef -or
    $UserName -match [regex]::Escape($productionProjectRef) -or
    $StorageEndpoint -match [regex]::Escape($productionProjectRef)) {
    throw 'Refusing to run a recovery test against the production Supabase project.'
}
if ($TargetProjectRef -ne $approvedRecoveryProjectRef -or
    $UserName -ne "postgres.$approvedRecoveryProjectRef" -or
    $StorageEndpoint -ne "https://$approvedRecoveryProjectRef.storage.supabase.co/storage/v1/s3") {
    throw 'This recovery test is pinned to the approved adventures-workshop-recovery project.'
}
foreach ($tool in @(
    (Join-Path $PostgresBin 'psql.exe'),
    (Join-Path $PostgresBin 'pg_restore.exe'),
    $RcloneBin
)) {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) {
        throw "Required recovery tool was not found: $tool"
    }
}

$verifier = Join-Path $PSScriptRoot 'verify-supabase-backup.ps1'
$verification = & $verifier -BackupDirectory $resolvedBackup -RequireStorage | Out-String
if ($LASTEXITCODE -ne 0) {
    throw 'The source full backup did not pass verification; recovery was not attempted.'
}

$manifestPath = Join-Path $resolvedBackup 'manifest.json'
$storageManifestPath = Join-Path $resolvedBackup 'storage\manifest.json'
$archivePath = Join-Path $resolvedBackup 'database.dump'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$storageManifest = Get-Content -LiteralPath $storageManifestPath -Raw | ConvertFrom-Json
if ($manifest.project_ref -ne $productionProjectRef -or
    $manifest.full_backup_complete -ne $true -or
    $manifest.storage_object_bytes_included -ne $true) {
    throw 'The source manifest is not a completed full production backup.'
}

$psql = Join-Path $PostgresBin 'psql.exe'
$databasePassword = Read-Host 'Recovery-project database password' -AsSecureString
$storageAccessKey = Read-Host 'Recovery-project Storage S3 access key ID' -AsSecureString
$storageSecretKey = Read-Host 'Recovery-project Storage S3 secret access key' -AsSecureString
$databasePasswordPointer = [IntPtr]::Zero
$storageAccessKeyPointer = [IntPtr]::Zero
$storageSecretKeyPointer = [IntPtr]::Zero
$previousPassword = $env:PGPASSWORD
$previousSslMode = $env:PGSSLMODE
$rcloneEnvironment = @(
    'RCLONE_CONFIG_AWRESTORE_TYPE',
    'RCLONE_CONFIG_AWRESTORE_PROVIDER',
    'RCLONE_CONFIG_AWRESTORE_ACCESS_KEY_ID',
    'RCLONE_CONFIG_AWRESTORE_SECRET_ACCESS_KEY',
    'RCLONE_CONFIG_AWRESTORE_ENDPOINT',
    'RCLONE_CONFIG_AWRESTORE_REGION',
    'RCLONE_CONFIG_AWRESTORE_FORCE_PATH_STYLE'
)
$previousRcloneEnvironment = @{}
foreach ($name in $rcloneEnvironment) {
    $previousRcloneEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

try {
    $databasePasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($databasePassword)
    $storageAccessKeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($storageAccessKey)
    $storageSecretKeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($storageSecretKey)
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($databasePasswordPointer)
    $env:PGSSLMODE = 'require'
    $env:RCLONE_CONFIG_AWRESTORE_TYPE = 's3'
    $env:RCLONE_CONFIG_AWRESTORE_PROVIDER = 'Other'
    $env:RCLONE_CONFIG_AWRESTORE_ACCESS_KEY_ID = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($storageAccessKeyPointer)
    $env:RCLONE_CONFIG_AWRESTORE_SECRET_ACCESS_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($storageSecretKeyPointer)
    $env:RCLONE_CONFIG_AWRESTORE_ENDPOINT = $StorageEndpoint
    $env:RCLONE_CONFIG_AWRESTORE_REGION = $StorageRegion
    $env:RCLONE_CONFIG_AWRESTORE_FORCE_PATH_STYLE = 'true'

    $connectionArguments = @(
        '--host', $HostName,
        '--port', $Port.ToString(),
        '--username', $UserName,
        '--dbname', $Database
    )
    $preflightSql = @"
select json_build_object(
  'server_version', current_setting('server_version'),
  'public_objects', (
    select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
  ),
  'auth_users', (select count(*) from auth.users),
  'storage_buckets', (select count(*) from storage.buckets),
  'storage_objects', (select count(*) from storage.objects),
  'migration_rows', (select count(*) from supabase_migrations.schema_migrations)
)::text;
"@
    $preflightOutput = & $psql @connectionArguments --no-psqlrc --tuples-only --no-align --command $preflightSql 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Recovery preflight failed: $($preflightOutput -join [Environment]::NewLine)"
    }
    $preflightJson = $preflightOutput | Where-Object { ([string] $_).Trim().StartsWith('{') } | Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($preflightJson)) {
        throw 'Recovery preflight did not return target metadata.'
    }
    $preflight = $preflightJson | ConvertFrom-Json

    $storageProbeLog = Join-Path $resolvedBackup 'recovery-storage-probe.log'
    $existingBucketsOutput = & $RcloneBin lsf 'awrestore:' --dirs-only `
        --log-file $storageProbeLog --log-level INFO
    if ($LASTEXITCODE -ne 0) {
        throw "Could not inspect recovery Storage. See the non-secret diagnostic log: $storageProbeLog"
    }
    $existingBuckets = @($existingBucketsOutput |
        Where-Object { ([string] $_).Trim().EndsWith('/') } |
        ForEach-Object { ([string] $_).Trim().TrimEnd('/') } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    foreach ($bucketId in $existingBuckets) {
        if ($bucketId -notmatch '^[a-z0-9][a-z0-9._-]{0,62}$') {
            throw "Recovery Storage returned an unsafe bucket name: $bucketId"
        }
    }

    $targetHasData = [int] $preflight.public_objects -ne 0 -or
        [int] $preflight.auth_users -ne 0 -or
        [int] $preflight.storage_buckets -ne 0 -or
        [int] $preflight.storage_objects -ne 0 -or
        [int] $preflight.migration_rows -ne 0 -or
        $existingBuckets.Count -ne 0
    if ($targetHasData -and -not $ResetExisting) {
        throw 'Recovery project is not empty. Re-run with -ResetExisting only after approving replacement of its test data.'
    }

    if ($targetHasData) {
        $requiredConfirmation = "RESET $approvedRecoveryProjectRef"
        $confirmation = Read-Host "Type $requiredConfirmation to clear only the recovery project"
        if ($confirmation -cne $requiredConfirmation) {
            throw 'Recovery reset confirmation did not match. Nothing was cleared.'
        }

        $resetLog = Join-Path $resolvedBackup 'recovery-storage-reset.log'
        foreach ($bucketId in $existingBuckets) {
            Write-Host "Clearing recovery Storage bucket: $bucketId"
            & $RcloneBin delete "awrestore:$bucketId" --rmdirs --retries 5 --low-level-retries 10 `
                --log-file $resetLog --log-level INFO
            if ($LASTEXITCODE -ne 0) {
                throw "Could not clear recovery Storage bucket: $bucketId"
            }
        }

        $resetSql = @'
do $$
declare item record;
begin
  for item in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (policyname like 'draft_assets_%' or policyname like 'set_assets_%' or policyname like 'tts_assets_%')
  loop
    execute format('drop policy if exists %I on storage.objects', item.policyname);
  end loop;
end $$;
truncate table storage.objects, storage.buckets cascade;
truncate table auth.users cascade;
truncate table supabase_migrations.schema_migrations;
drop schema if exists public cascade;
create schema public authorization postgres;
grant usage on schema public to anon, authenticated, service_role;
'@
        $resetOutput = & $psql @connectionArguments --no-psqlrc --single-transaction `
            --variable=ON_ERROR_STOP=1 --command $resetSql 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Recovery database reset failed: $($resetOutput -join [Environment]::NewLine)"
        }
    }

    $beforeRehearsals = @(Get-ChildItem -LiteralPath $resolvedBackup -Directory |
        Where-Object { $_.Name -like "restore-rehearsal-$approvedRecoveryProjectRef-*" } |
        Select-Object -ExpandProperty FullName)
    $databaseRestore = Join-Path $PSScriptRoot 'restore-supabase-rehearsal.ps1'
    & $databaseRestore -ArchivePath $archivePath -PostgresBin $PostgresBin `
        -HostName $HostName -Port $Port -Database $Database `
        -TargetProjectRef $TargetProjectRef -UserName $UserName -DatabasePassword $databasePassword
    if ($LASTEXITCODE -ne 0) {
        throw 'Database recovery rehearsal failed.'
    }
    $afterRehearsals = @(Get-ChildItem -LiteralPath $resolvedBackup -Directory |
        Where-Object { $_.Name -like "restore-rehearsal-$approvedRecoveryProjectRef-*" -and $_.FullName -notin $beforeRehearsals })
    if ($afterRehearsals.Count -ne 1) {
        throw 'Could not identify the completed database rehearsal directory.'
    }
    $rehearsalPath = $afterRehearsals[0].FullName
    $storageRestoreLog = Join-Path $rehearsalPath 'storage-restore.log'

    foreach ($bucket in @($storageManifest.buckets)) {
        $bucketId = [string] $bucket.id
        if ($bucketId -notmatch '^[a-z0-9][a-z0-9._-]{0,62}$') {
            throw "Backup contains an unsafe Storage bucket name: $bucketId"
        }
        $localBucketPath = Join-Path $resolvedBackup "storage\buckets\$bucketId"
        Write-Host "Restoring Storage bytes into recovery bucket: $bucketId"
        & $RcloneBin copy $localBucketPath "awrestore:$bucketId" --ignore-times --metadata `
            --transfers 4 --checkers 8 --retries 5 --low-level-retries 10 `
            --log-file $storageRestoreLog --log-level INFO
        if ($LASTEXITCODE -ne 0) {
            throw "Storage restore failed for recovery bucket: $bucketId"
        }

        & $RcloneBin check $localBucketPath "awrestore:$bucketId" --one-way --download `
            --checkers 8 --log-file $storageRestoreLog --log-level INFO
        if ($LASTEXITCODE -ne 0) {
            throw "Recovered Storage verification failed for bucket: $bucketId"
        }
        $remoteSizeJson = & $RcloneBin size "awrestore:$bucketId" --json
        if ($LASTEXITCODE -ne 0) {
            throw "Could not measure recovered Storage bucket: $bucketId"
        }
        $remoteSize = $remoteSizeJson | ConvertFrom-Json
        if ([long] $remoteSize.count -ne [long] $bucket.object_count -or
            [long] $remoteSize.bytes -ne [long] $bucket.total_bytes) {
            throw "Recovered Storage size mismatch for bucket: $bucketId"
        }
    }

    $storageVerificationSql = @"
select json_build_object(
  'bucket_count', (select count(*) from storage.buckets),
  'object_count', (select count(*) from storage.objects where archived_at is null and is_delete_marker is not true),
  'total_bytes', (select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::bigint else 0 end), 0)
                  from storage.objects where archived_at is null and is_delete_marker is not true)
)::text;
"@
    $storageVerificationOutput = & $psql @connectionArguments --no-psqlrc --tuples-only --no-align `
        --command $storageVerificationSql 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Could not verify recovered Storage metadata: $($storageVerificationOutput -join [Environment]::NewLine)"
    }
    $storageVerificationJson = $storageVerificationOutput |
        Where-Object { ([string] $_).Trim().StartsWith('{') } | Select-Object -Last 1
    $storageVerification = $storageVerificationJson | ConvertFrom-Json
    if ([long] $storageVerification.bucket_count -ne @($storageManifest.buckets).Count -or
        [long] $storageVerification.object_count -ne [long] $storageManifest.object_count -or
        [long] $storageVerification.total_bytes -ne [long] $storageManifest.total_bytes) {
        throw 'Recovered Storage database metadata does not match the full backup manifest.'
    }

    $rehearsalManifestPath = Join-Path $rehearsalPath 'manifest.json'
    $rehearsalManifest = Get-Content -LiteralPath $rehearsalManifestPath -Raw | ConvertFrom-Json
    $rehearsalManifest.storage_object_bytes_restored = $true
    $rehearsalManifest | Add-Member -NotePropertyName storage_hashes_verified -NotePropertyValue $true -Force
    $rehearsalManifest | Add-Member -NotePropertyName storage_object_count `
        -NotePropertyValue ([long] $storageManifest.object_count) -Force
    $rehearsalManifest | Add-Member -NotePropertyName storage_total_bytes `
        -NotePropertyValue ([long] $storageManifest.total_bytes) -Force
    $rehearsalManifest | Add-Member -NotePropertyName full_recovery_complete -NotePropertyValue $true -Force
    $rehearsalManifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $rehearsalManifestPath -Encoding utf8

    Write-Host "Full recovery rehearsal passed: $rehearsalPath"
    [ordered]@{
        recovery_project_ref = $TargetProjectRef
        source_backup = $resolvedBackup
        database_archive_sha256 = $manifest.archive_sha256
        storage_buckets_verified = @($storageManifest.buckets).Count
        storage_objects_verified = [long] $storageManifest.object_count
        storage_bytes_verified = [long] $storageManifest.total_bytes
        full_recovery_complete = $true
    } | ConvertTo-Json
}
finally {
    $env:PGPASSWORD = $previousPassword
    $env:PGSSLMODE = $previousSslMode
    foreach ($name in $rcloneEnvironment) {
        [Environment]::SetEnvironmentVariable($name, $previousRcloneEnvironment[$name], 'Process')
    }
    if ($databasePasswordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($databasePasswordPointer)
    }
    if ($storageAccessKeyPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($storageAccessKeyPointer)
    }
    if ($storageSecretKeyPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($storageSecretKeyPointer)
    }
    $databasePassword = $null
    $storageAccessKey = $null
    $storageSecretKey = $null
}
