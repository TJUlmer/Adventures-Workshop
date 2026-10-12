[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'storage-backup-cadence.ps1')

$temporaryRoot = [System.IO.Path]::GetFullPath((Join-Path ([System.IO.Path]::GetTempPath()) (
    'unmatched-labs-storage-cadence-' + [guid]::NewGuid().ToString('N')
)))
$temporaryPrefix = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar
) + [System.IO.Path]::DirectorySeparatorChar
if (-not $temporaryRoot.StartsWith($temporaryPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Temporary cadence fixture did not resolve beneath the system temporary directory.'
}

try {
    $state = Join-Path $temporaryRoot 'state'
    $backups = Join-Path $temporaryRoot 'backups'
    New-Item -ItemType Directory -Path $state, $backups | Out-Null
    $now = [DateTimeOffset]::Parse('2026-10-12T12:00:00Z')

    if (-not (Test-FullStorageBackupDue -LatestFullBackupUtc $null -NowUtc $now)) {
        throw 'A site with no full backup was not considered due.'
    }

    $recentBackup = Join-Path $backups 'supabase-kyqcvbnxfmpnbwtikzxp-20261008T070002Z'
    New-Item -ItemType Directory -Path $recentBackup | Out-Null
    [ordered]@{
        created_at_utc = '2026-10-08T07:00:02Z'
        storage_object_bytes_included = $true
        full_backup_complete = $true
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $recentBackup 'manifest.json') -Encoding utf8

    $latest = Get-LatestFullStorageBackupUtc -StateDirectory $state -BackupOutputDirectory $backups
    if ($latest -ne [DateTimeOffset]::Parse('2026-10-08T07:00:02Z')) {
        throw 'The latest completed local full backup was not recognized.'
    }
    if (Test-FullStorageBackupDue -LatestFullBackupUtc $latest -NowUtc $now -CadenceDays 30) {
        throw 'A four-day-old full backup was incorrectly considered due.'
    }

    [ordered]@{
        format_version = 1
        completed_at_utc = '2026-09-01T00:00:00Z'
        storage_object_count = 10
        storage_total_bytes = 100
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $state 'last-success.json') -Encoding utf8
    $latest = Get-LatestFullStorageBackupUtc -StateDirectory $state -BackupOutputDirectory $backups
    if ($latest -ne [DateTimeOffset]::Parse('2026-10-08T07:00:02Z')) {
        throw 'A stale off-site marker overrode a newer completed local full backup.'
    }

    [ordered]@{
        format_version = 1
        completed_at_utc = '2026-10-12T11:00:00Z'
        backup_kind = 'database_only'
        storage_object_count = 0
        storage_total_bytes = 0
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $state 'last-success.json') -Encoding utf8
    $latest = Get-LatestFullStorageBackupUtc -StateDirectory $state -BackupOutputDirectory $backups
    if ($latest -ne [DateTimeOffset]::Parse('2026-10-08T07:00:02Z')) {
        throw 'A database-only marker was mistaken for a completed full backup.'
    }

    $future = [DateTimeOffset]::Parse('2026-11-08T07:00:03Z')
    if (-not (Test-FullStorageBackupDue -LatestFullBackupUtc $latest -NowUtc $future -CadenceDays 30)) {
        throw 'A full backup older than 30 days was not considered due.'
    }

    Write-Host 'Storage backup cadence and local-manifest fallback: 6 assertions passed.'
}
finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        $resolvedTemporary = [System.IO.Path]::GetFullPath($temporaryRoot)
        if ($resolvedTemporary.StartsWith($temporaryPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and
            (Split-Path -Leaf $resolvedTemporary).StartsWith('unmatched-labs-storage-cadence-')) {
            Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force
        }
    }
}
