[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $BackupDirectory,

    [switch] $RequireStorage,

    [switch] $AllowIncomplete,

    [string] $PostgresBin = "$env:LOCALAPPDATA\UnmatchedLabs\PostgreSQL\17.11\pgsql\bin"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$backupPath = [System.IO.Path]::GetFullPath($BackupDirectory)
$manifestPath = Join-Path $backupPath 'manifest.json'
$dumpPath = Join-Path $backupPath 'database.dump'
$pgRestore = Join-Path $PostgresBin 'pg_restore.exe'

foreach ($file in @($manifestPath, $dumpPath, $pgRestore)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Required backup file or verification tool was not found: $file"
    }
}

$partialFiles = @(Get-ChildItem -LiteralPath $backupPath -Recurse -File -Filter '*.partial')
if ($partialFiles.Count -gt 0) {
    throw "Backup contains incomplete files: $($partialFiles.Name -join ', ')"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$dumpFile = Get-Item -LiteralPath $dumpPath
if ($dumpFile.Length -ne [long] $manifest.archive_size_bytes) {
    throw 'Database archive size does not match the manifest.'
}
$dumpHash = (Get-FileHash -LiteralPath $dumpPath -Algorithm SHA256).Hash
if ($dumpHash -ne [string] $manifest.archive_sha256) {
    throw 'Database archive SHA-256 does not match the manifest.'
}

$null = & $pgRestore --list $dumpPath 2>&1
if ($LASTEXITCODE -ne 0) {
    throw 'pg_restore could not read the database archive.'
}

$storageIncluded = $manifest.storage_object_bytes_included -eq $true
if ($RequireStorage -and -not $storageIncluded) {
    throw 'This is a database-only archive, not a full backup with Storage bytes.'
}

$verifiedObjects = 0L
$verifiedBytes = 0L
if ($storageIncluded) {
    if (-not $AllowIncomplete -and $manifest.full_backup_complete -ne $true) {
        throw 'Storage bytes are present but the full-backup completion marker is missing.'
    }

    $storageManifestPath = Join-Path $backupPath ([string] $manifest.storage_manifest_file)
    if (-not (Test-Path -LiteralPath $storageManifestPath -PathType Leaf)) {
        throw 'Storage manifest is missing.'
    }
    $storageManifestHash = (Get-FileHash -LiteralPath $storageManifestPath -Algorithm SHA256).Hash
    if ($storageManifestHash -ne [string] $manifest.storage_manifest_sha256) {
        throw 'Storage manifest SHA-256 does not match the database manifest.'
    }

    $storageManifest = Get-Content -LiteralPath $storageManifestPath -Raw | ConvertFrom-Json
    $storageRoot = [System.IO.Path]::GetFullPath((Join-Path $backupPath 'storage\buckets'))
    $storagePrefix = $storageRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
        [System.IO.Path]::DirectorySeparatorChar
    $seenPaths = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )

    foreach ($entry in @($storageManifest.files)) {
        $relativePath = ([string] $entry.relative_path).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
        $filePath = [System.IO.Path]::GetFullPath((Join-Path $backupPath $relativePath))
        if (-not $filePath.StartsWith($storagePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Storage manifest path escapes its backup root: $relativePath"
        }
        if (-not $seenPaths.Add($filePath)) {
            throw "Storage manifest contains a duplicate path: $relativePath"
        }
        if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
            throw "Storage object is missing from the backup: $relativePath"
        }

        $file = Get-Item -LiteralPath $filePath
        if ($file.Length -ne [long] $entry.size_bytes) {
            throw "Storage object size does not match its manifest: $relativePath"
        }
        $fileHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash
        if ($fileHash -ne [string] $entry.sha256) {
            throw "Storage object SHA-256 does not match its manifest: $relativePath"
        }
        $verifiedObjects += 1
        $verifiedBytes += $file.Length
    }

    $actualStorageFiles = @(Get-ChildItem -LiteralPath $storageRoot -Recurse -File)
    if ($actualStorageFiles.Count -ne $seenPaths.Count) {
        throw 'Storage backup contains files that are absent from its integrity manifest.'
    }
    if ($verifiedObjects -ne [long] $storageManifest.object_count -or
        $verifiedObjects -ne [long] $manifest.storage_object_count) {
        throw 'Verified Storage object count does not match the manifests.'
    }
    if ($verifiedBytes -ne [long] $storageManifest.total_bytes -or
        $verifiedBytes -ne [long] $manifest.storage_total_bytes) {
        throw 'Verified Storage byte count does not match the manifests.'
    }
}

$result = [ordered]@{
    backup_directory = $backupPath
    database_archive_sha256 = $dumpHash
    storage_included = $storageIncluded
    storage_objects_verified = $verifiedObjects
    storage_bytes_verified = $verifiedBytes
    verified_at_utc = [DateTime]::UtcNow.ToString('o')
}

Write-Host "Backup verification passed: $backupPath"
$result | ConvertTo-Json -Depth 3
