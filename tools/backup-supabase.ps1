[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $OutputDirectory,

    [string] $PostgresBin = "$env:LOCALAPPDATA\UnmatchedLabs\PostgreSQL\17.11\pgsql\bin",

    [string] $HostName = 'aws-0-us-east-1.pooler.supabase.com',

    [int] $Port = 5432,

    [string] $Database = 'postgres',

    [string] $UserName = 'postgres.kyqcvbnxfmpnbwtikzxp',

    [switch] $IncludeStorage,

    [string] $RcloneBin = "$env:LOCALAPPDATA\UnmatchedLabs\rclone\1.75.0\rclone.exe",

    [string] $StorageEndpoint = 'https://kyqcvbnxfmpnbwtikzxp.storage.supabase.co/storage/v1/s3',

    [string] $StorageRegion = 'us-east-1'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'This backup tool requires PowerShell 7 or newer. Run it with pwsh, not powershell.exe.'
}

$projectRef = 'kyqcvbnxfmpnbwtikzxp'
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
$repositoryPrefix = $repositoryRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

if ($resolvedOutput.Equals($repositoryRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    $resolvedOutput.StartsWith($repositoryPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Backups can contain private user data and must be written outside the repository.'
}

$pgDump = Join-Path $PostgresBin 'pg_dump.exe'
$pgRestore = Join-Path $PostgresBin 'pg_restore.exe'
$psql = Join-Path $PostgresBin 'psql.exe'

foreach ($tool in @($pgDump, $pgRestore, $psql)) {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) {
        throw "Required PostgreSQL client tool was not found: $tool"
    }
}

if ($IncludeStorage -and -not (Test-Path -LiteralPath $RcloneBin -PathType Leaf)) {
    throw "Full backups require rclone, which was not found at: $RcloneBin"
}

$clientVersion = (& $pgDump --version).Trim()
if ($LASTEXITCODE -ne 0 -or $clientVersion -notmatch 'PostgreSQL\) 17\.') {
    throw "Expected PostgreSQL 17 pg_dump, found: $clientVersion"
}

$password = Read-Host 'Supabase database password' -AsSecureString
$passwordPointer = [IntPtr]::Zero
$storageAccessKey = $null
$storageSecretKey = $null
$storageAccessKeyPointer = [IntPtr]::Zero
$storageSecretKeyPointer = [IntPtr]::Zero
$previousPassword = $env:PGPASSWORD
$previousSslMode = $env:PGSSLMODE
$rcloneEnvironment = @(
    'RCLONE_CONFIG_AWBACKUP_TYPE',
    'RCLONE_CONFIG_AWBACKUP_PROVIDER',
    'RCLONE_CONFIG_AWBACKUP_ACCESS_KEY_ID',
    'RCLONE_CONFIG_AWBACKUP_SECRET_ACCESS_KEY',
    'RCLONE_CONFIG_AWBACKUP_ENDPOINT',
    'RCLONE_CONFIG_AWBACKUP_REGION',
    'RCLONE_CONFIG_AWBACKUP_FORCE_PATH_STYLE'
)
$previousRcloneEnvironment = @{}
foreach ($name in $rcloneEnvironment) {
    $previousRcloneEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$backupPath = $null

try {
    $passwordPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
    $env:PGPASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $env:PGSSLMODE = 'require'

    $connectionArguments = @(
        '--host', $HostName,
        '--port', $Port.ToString(),
        '--username', $UserName,
        '--dbname', $Database
    )

    $preflightSql = @"
select json_build_object(
  'server_version', current_setting('server_version'),
  'server_version_num', current_setting('server_version_num'),
  'database_size_bytes', pg_database_size(current_database()),
  'checked_at_utc', timezone('utc', clock_timestamp())
)::text;
"@
    $preflightOutput = & $psql @connectionArguments --no-psqlrc --tuples-only --no-align --command $preflightSql 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Database preflight failed: $($preflightOutput -join [Environment]::NewLine)"
    }

    $preflightJson = ($preflightOutput | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1)
    if ([string]::IsNullOrWhiteSpace($preflightJson)) {
        throw 'Database preflight did not return version metadata.'
    }
    $preflight = $preflightJson | ConvertFrom-Json
    if (-not $preflight.server_version_num.ToString().StartsWith('17')) {
        throw "The production database is not PostgreSQL 17: $($preflight.server_version)"
    }

    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $backupPath = Join-Path $resolvedOutput "supabase-$projectRef-$timestamp"
    if (Test-Path -LiteralPath $backupPath) {
        throw "Refusing to overwrite existing backup path: $backupPath"
    }

    New-Item -ItemType Directory -Path $backupPath | Out-Null
    $partialDumpPath = Join-Path $backupPath 'database.dump.partial'
    $dumpPath = Join-Path $backupPath 'database.dump'
    $dumpLogPath = Join-Path $backupPath 'pg_dump.log'
    $contentsPath = Join-Path $backupPath 'database.contents.txt'
    $manifestPath = Join-Path $backupPath 'manifest.json'

    Write-Host "Creating logical backup at $backupPath"
    $dumpExitCode = $null
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # Windows PowerShell promotes pg_dump's normal verbose stderr to ErrorRecord objects.
        # Judge the native process by its exit code so progress messages do not abort the backup.
        $ErrorActionPreference = 'Continue'
        & $pgDump @connectionArguments `
            --format=custom `
            --no-owner `
            --no-privileges `
            --no-subscriptions `
            --verbose `
            --file=$partialDumpPath 2>&1 | Tee-Object -FilePath $dumpLogPath
        $dumpExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($dumpExitCode -ne 0) {
        throw "pg_dump failed. The incomplete archive remains at $partialDumpPath for diagnosis."
    }

    Move-Item -LiteralPath $partialDumpPath -Destination $dumpPath

    $contents = & $pgRestore --list $dumpPath 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw 'pg_restore could not read the completed archive.'
    }
    $contents | Set-Content -LiteralPath $contentsPath -Encoding utf8

    $dumpFile = Get-Item -LiteralPath $dumpPath
    $dumpHash = (Get-FileHash -LiteralPath $dumpPath -Algorithm SHA256).Hash
    $manifest = [ordered]@{
        project_ref = $projectRef
        created_at_utc = [DateTime]::UtcNow.ToString('o')
        database_host = $HostName
        database_port = $Port
        database_name = $Database
        database_user = $UserName
        server_version = $preflight.server_version
        client_version = $clientVersion
        source_database_size_bytes = [long] $preflight.database_size_bytes
        archive_file = $dumpFile.Name
        archive_size_bytes = $dumpFile.Length
        archive_sha256 = $dumpHash
        archive_contents_file = [System.IO.Path]::GetFileName($contentsPath)
        pg_dump_log_file = [System.IO.Path]::GetFileName($dumpLogPath)
        ownership_and_privileges_included = $false
        storage_object_bytes_included = $false
    }
    $manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $manifestPath -Encoding utf8

    if ($IncludeStorage) {
        $storageAccessKey = Read-Host 'Supabase Storage S3 access key ID' -AsSecureString
        $storageSecretKey = Read-Host 'Supabase Storage S3 secret access key' -AsSecureString
        $storageAccessKeyPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($storageAccessKey)
        $storageSecretKeyPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($storageSecretKey)

        $env:RCLONE_CONFIG_AWBACKUP_TYPE = 's3'
        $env:RCLONE_CONFIG_AWBACKUP_PROVIDER = 'Other'
        $env:RCLONE_CONFIG_AWBACKUP_ACCESS_KEY_ID = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($storageAccessKeyPointer)
        $env:RCLONE_CONFIG_AWBACKUP_SECRET_ACCESS_KEY = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($storageSecretKeyPointer)
        $env:RCLONE_CONFIG_AWBACKUP_ENDPOINT = $StorageEndpoint
        $env:RCLONE_CONFIG_AWBACKUP_REGION = $StorageRegion
        $env:RCLONE_CONFIG_AWBACKUP_FORCE_PATH_STYLE = 'true'

        $rcloneVersion = (& $RcloneBin version 2>&1 | Select-Object -First 1).ToString().Trim()
        if ($rcloneVersion -notmatch '^rclone v') {
            throw "Could not run the configured rclone binary: $RcloneBin"
        }

        $bucketInventorySql = @"
select coalesce(json_agg(bucket order by bucket->>'id'), '[]'::json)::text
from (
  select json_build_object(
    'id', b.id,
    'object_count', count(o.id),
    'total_bytes', coalesce(sum(
      case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint else 0 end
    ), 0)
  ) as bucket
  from storage.buckets b
  left join storage.objects o
    on o.bucket_id = b.id
   and o.archived_at is null
   and o.is_delete_marker is not true
  group by b.id
) inventory;
"@
        $bucketInventoryOutput = & $psql @connectionArguments `
            --no-psqlrc --tuples-only --no-align --command $bucketInventorySql 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Storage inventory failed: $($bucketInventoryOutput -join [Environment]::NewLine)"
        }
        $bucketInventoryJson = $bucketInventoryOutput |
            Where-Object { ([string] $_).Trim().StartsWith('[') } |
            Select-Object -Last 1
        if ([string]::IsNullOrWhiteSpace($bucketInventoryJson)) {
            throw 'Storage inventory did not return bucket metadata.'
        }
        $bucketInventory = @($bucketInventoryJson | ConvertFrom-Json)

        $storagePath = Join-Path $backupPath 'storage'
        $storageBucketsPath = Join-Path $storagePath 'buckets'
        $storageLogPath = Join-Path $storagePath 'rclone.log'
        $storageManifestPath = Join-Path $storagePath 'manifest.json'
        $storageManifestPartialPath = "$storageManifestPath.partial"
        New-Item -ItemType Directory -Path $storageBucketsPath -Force | Out-Null

        $bucketResults = @()
        foreach ($bucket in $bucketInventory) {
            $bucketId = [string] $bucket.id
            if ($bucketId -notmatch '^[a-z0-9][a-z0-9._-]{0,62}$') {
                throw "Storage bucket cannot be represented safely in this backup: $bucketId"
            }

            $localBucketPath = Join-Path $storageBucketsPath $bucketId
            New-Item -ItemType Directory -Path $localBucketPath -Force | Out-Null
            Write-Host "Downloading Storage bucket: $bucketId"
            & $RcloneBin copy "awbackup:$bucketId" $localBucketPath `
                --create-empty-src-dirs `
                --metadata `
                --transfers 4 `
                --checkers 8 `
                --retries 5 `
                --low-level-retries 10 `
                --log-file $storageLogPath `
                --log-level INFO
            if ($LASTEXITCODE -ne 0) {
                throw "Storage download failed for bucket: $bucketId"
            }

            $remoteSizeJson = & $RcloneBin size "awbackup:$bucketId" --json
            if ($LASTEXITCODE -ne 0) {
                throw "Could not measure remote Storage bucket: $bucketId"
            }
            $remoteSize = $remoteSizeJson | ConvertFrom-Json
            if ([long] $remoteSize.count -ne [long] $bucket.object_count -or
                [long] $remoteSize.bytes -ne [long] $bucket.total_bytes) {
                throw "Storage changed during backup or metadata does not match bytes for bucket: $bucketId"
            }

            & $RcloneBin check "awbackup:$bucketId" $localBucketPath `
                --one-way `
                --download `
                --checkers 8 `
                --log-file $storageLogPath `
                --log-level INFO
            if ($LASTEXITCODE -ne 0) {
                throw "Downloaded Storage verification failed for bucket: $bucketId"
            }

            $bucketResults += [ordered]@{
                id = $bucketId
                object_count = [long] $remoteSize.count
                total_bytes = [long] $remoteSize.bytes
            }
        }

        $storageFiles = @()
        $downloadedFiles = @(Get-ChildItem -LiteralPath $storageBucketsPath -Recurse -File | Sort-Object FullName)
        foreach ($file in $downloadedFiles) {
            $relativePath = [System.IO.Path]::GetRelativePath($backupPath, $file.FullName).Replace('\', '/')
            $storageFiles += [ordered]@{
                relative_path = $relativePath
                size_bytes = [long] $file.Length
                sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            }
        }

        $storageObjectCount = 0L
        $storageTotalBytes = 0L
        foreach ($bucketResult in $bucketResults) {
            $storageObjectCount += [long] $bucketResult['object_count']
            $storageTotalBytes += [long] $bucketResult['total_bytes']
        }

        $storageManifest = [ordered]@{
            format_version = 1
            project_ref = $projectRef
            created_at_utc = [DateTime]::UtcNow.ToString('o')
            endpoint = $StorageEndpoint
            rclone_version = $rcloneVersion
            buckets = $bucketResults
            object_count = $storageObjectCount
            total_bytes = $storageTotalBytes
            files = $storageFiles
        }
        $storageManifest | ConvertTo-Json -Depth 6 |
            Set-Content -LiteralPath $storageManifestPartialPath -Encoding utf8
        Move-Item -LiteralPath $storageManifestPartialPath -Destination $storageManifestPath

        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        $manifest.storage_object_bytes_included = $true
        $manifest | Add-Member -NotePropertyName full_backup_complete -NotePropertyValue $false -Force
        $manifest | Add-Member -NotePropertyName storage_manifest_file -NotePropertyValue 'storage/manifest.json' -Force
        $manifest | Add-Member -NotePropertyName storage_manifest_sha256 `
            -NotePropertyValue (Get-FileHash -LiteralPath $storageManifestPath -Algorithm SHA256).Hash -Force
        $manifest | Add-Member -NotePropertyName storage_object_count `
            -NotePropertyValue $storageManifest.object_count -Force
        $manifest | Add-Member -NotePropertyName storage_total_bytes `
            -NotePropertyValue $storageManifest.total_bytes -Force
        $manifestPartialPath = "$manifestPath.partial"
        $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPartialPath -Encoding utf8
        Move-Item -LiteralPath $manifestPartialPath -Destination $manifestPath -Force

        $verifier = Join-Path $PSScriptRoot 'verify-supabase-backup.ps1'
        $null = & $verifier -BackupDirectory $backupPath -RequireStorage -AllowIncomplete

        $manifest.full_backup_complete = $true
        $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPartialPath -Encoding utf8
        Move-Item -LiteralPath $manifestPartialPath -Destination $manifestPath -Force
        & $verifier -BackupDirectory $backupPath -RequireStorage
    }
    else {
        Write-Warning 'This logical database backup includes Storage metadata, not the object bytes stored by Supabase Storage.'
    }
    Write-Host "Backup complete: $dumpPath"
    Write-Host "SHA-256: $dumpHash"
    Write-Host 'Restore into a separate recovery project/database before treating this archive as rehearsed.'
}
finally {
    $env:PGPASSWORD = $previousPassword
    $env:PGSSLMODE = $previousSslMode
    foreach ($name in $rcloneEnvironment) {
        [Environment]::SetEnvironmentVariable($name, $previousRcloneEnvironment[$name], 'Process')
    }
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    $password = $null
    if ($storageAccessKeyPointer -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($storageAccessKeyPointer)
    }
    if ($storageSecretKeyPointer -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($storageSecretKeyPointer)
    }
    $storageAccessKey = $null
    $storageSecretKey = $null
}
