[CmdletBinding()]
param(
    [string] $SourceBackupDirectory = 'G:\Unmatched Labs Backups\supabase-kyqcvbnxfmpnbwtikzxp-20260831T211858Z'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$verifier = Join-Path $PSScriptRoot 'verify-supabase-backup.ps1'
$sourceBackup = [System.IO.Path]::GetFullPath($SourceBackupDirectory)
$temporaryRoot = [System.IO.Path]::GetFullPath((Join-Path ([System.IO.Path]::GetTempPath()) (
    'unmatched-labs-backup-verifier-' + [guid]::NewGuid().ToString('N')
)))
$expectedTemporaryPrefix = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar
) + [System.IO.Path]::DirectorySeparatorChar

if (-not $temporaryRoot.StartsWith($expectedTemporaryPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Temporary verification directory did not resolve beneath the system temporary directory.'
}

try {
    New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceBackup 'database.dump') -Destination $temporaryRoot

    $storageRoot = Join-Path $temporaryRoot 'storage\buckets'
    $draftFile = Join-Path $storageRoot 'draft-assets\owner\set\draft.bin'
    $publicFile = Join-Path $storageRoot 'set-assets\owner\set\published.bin'
    New-Item -ItemType Directory -Path (Split-Path -Parent $draftFile) -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $publicFile) -Force | Out-Null
    [System.IO.File]::WriteAllBytes($draftFile, [byte[]] (1, 2, 3, 4, 5))
    [System.IO.File]::WriteAllBytes($publicFile, [byte[]] (6, 7, 8))

    $files = @($draftFile, $publicFile) | ForEach-Object {
        $file = Get-Item -LiteralPath $_
        [ordered]@{
            relative_path = [System.IO.Path]::GetRelativePath($temporaryRoot, $file.FullName).Replace('\', '/')
            size_bytes = [long] $file.Length
            sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        }
    }
    $storageBytes = 0L
    foreach ($entry in $files) {
        $storageBytes += [long] $entry['size_bytes']
    }
    $storageManifest = [ordered]@{
        format_version = 1
        project_ref = 'fixture'
        created_at_utc = [DateTime]::UtcNow.ToString('o')
        endpoint = 'https://fixture.invalid/storage/v1/s3'
        rclone_version = 'fixture'
        buckets = @(
            [ordered]@{ id = 'draft-assets'; object_count = 1; total_bytes = 5 },
            [ordered]@{ id = 'set-assets'; object_count = 1; total_bytes = 3 }
        )
        object_count = 2
        total_bytes = $storageBytes
        files = $files
    }
    $storageManifestPath = Join-Path $temporaryRoot 'storage\manifest.json'
    $storageManifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $storageManifestPath -Encoding utf8

    $dumpFile = Get-Item -LiteralPath (Join-Path $temporaryRoot 'database.dump')
    $manifest = [ordered]@{
        archive_size_bytes = [long] $dumpFile.Length
        archive_sha256 = (Get-FileHash -LiteralPath $dumpFile.FullName -Algorithm SHA256).Hash
        storage_object_bytes_included = $true
        full_backup_complete = $true
        storage_manifest_file = 'storage/manifest.json'
        storage_manifest_sha256 = (Get-FileHash -LiteralPath $storageManifestPath -Algorithm SHA256).Hash
        storage_object_count = 2
        storage_total_bytes = $storageBytes
    }
    $manifest | ConvertTo-Json -Depth 4 |
        Set-Content -LiteralPath (Join-Path $temporaryRoot 'manifest.json') -Encoding utf8

    $null = & $verifier -BackupDirectory $temporaryRoot -RequireStorage

    [System.IO.File]::WriteAllBytes($draftFile, [byte[]] (1, 2, 3, 4, 9))
    $tamperRejected = $false
    try {
        $null = & $verifier -BackupDirectory $temporaryRoot -RequireStorage
    }
    catch {
        $tamperRejected = $_.Exception.Message -match 'SHA-256 does not match'
    }
    if (-not $tamperRejected) {
        throw 'The verifier accepted a Storage object after its bytes were changed.'
    }

    Write-Host 'Full-backup verifier fixture and tamper rejection passed.'
}
finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        $resolvedTemporary = [System.IO.Path]::GetFullPath($temporaryRoot)
        if ($resolvedTemporary.StartsWith($expectedTemporaryPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and
            (Split-Path -Leaf $resolvedTemporary).StartsWith('unmatched-labs-backup-verifier-')) {
            Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force
        }
    }
}
