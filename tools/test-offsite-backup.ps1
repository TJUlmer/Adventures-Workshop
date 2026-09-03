[CmdletBinding()]
param(
    [string] $StateDirectory = "$env:LOCALAPPDATA\UnmatchedLabs\backup-automation",

    [string] $SnapshotId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'This restore test requires PowerShell 7 or newer. Run it with pwsh.'
}

$resolvedState = [System.IO.Path]::GetFullPath($StateDirectory)
$allowedState = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'UnmatchedLabs\backup-automation'))
if (-not $resolvedState.Equals($allowedState, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to load credentials outside: $allowedState"
}

$configPath = Join-Path $resolvedState 'config.json'
$lastSuccessPath = Join-Path $resolvedState 'last-success.json'
foreach ($file in @($configPath, $lastSuccessPath)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Required automation state was not found: $file"
    }
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$lastSuccess = Get-Content -LiteralPath $lastSuccessPath -Raw | ConvertFrom-Json
if ($config.format_version -ne 1 -or $config.project_ref -ne 'kyqcvbnxfmpnbwtikzxp') {
    throw 'The automation configuration has an unsupported format or project ref.'
}

$resolvedSnapshot = if ([string]::IsNullOrWhiteSpace($SnapshotId)) {
    [string] $lastSuccess.offsite_snapshot_id
}
else {
    $SnapshotId
}
if ($resolvedSnapshot -notmatch '^[a-f0-9]{8,64}$') {
    throw 'The off-site snapshot ID has an unexpected format.'
}

$restic = [System.IO.Path]::GetFullPath([string] $config.restic_executable)
if (-not (Test-Path -LiteralPath $restic -PathType Leaf)) {
    throw "The configured restic executable is unavailable: $restic"
}

$restoreParent = Join-Path $resolvedState 'restore-tests'
New-Item -ItemType Directory -Path $restoreParent -Force | Out-Null
$restoreRoot = [System.IO.Path]::GetFullPath((Join-Path $restoreParent (
    'restore-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N')
)))
$restorePrefix = [System.IO.Path]::GetFullPath($restoreParent).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar
) + [System.IO.Path]::DirectorySeparatorChar

$secretPointers = [System.Collections.Generic.List[IntPtr]]::new()
$environmentNames = @('RESTIC_REPOSITORY', 'RESTIC_PASSWORD', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY')
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$repositoryPassword = $null
$offsiteAccessKey = $null
$offsiteSecretKey = $null
$testPassed = $false

try {
    $repositoryPassword = ConvertTo-SecureString ([string] $config.repository_password_dpapi)
    $offsiteAccessKey = ConvertTo-SecureString ([string] $config.offsite_access_key_dpapi)
    $offsiteSecretKey = ConvertTo-SecureString ([string] $config.offsite_secret_key_dpapi)
    foreach ($secret in @($repositoryPassword, $offsiteAccessKey, $offsiteSecretKey)) {
        $secretPointers.Add([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret))
    }
    $env:RESTIC_REPOSITORY = [string] $config.restic_repository
    $env:RESTIC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointers[0])
    $env:AWS_ACCESS_KEY_ID = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointers[1])
    $env:AWS_SECRET_ACCESS_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointers[2])

    New-Item -ItemType Directory -Path $restoreRoot | Out-Null
    Write-Host "Downloading and decrypting off-site snapshot $resolvedSnapshot into an isolated temporary directory..."
    $restoreOutput = & $restic restore $resolvedSnapshot --target $restoreRoot 2>&1
    $restoreExitCode = $LASTEXITCODE
    $restoreOutput | ForEach-Object { Write-Host $_ }
    if ($restoreExitCode -ne 0) {
        # Restoring an absolute Windows path can report an ancestor-directory timestamp warning
        # even when every file was recovered. The complete hash verifier below is authoritative.
        Write-Warning 'restic reported a restore warning; continuing to byte-for-byte verification.'
    }

    $candidateManifests = @(
        Get-ChildItem -LiteralPath $restoreRoot -Recurse -File -Filter 'manifest.json' |
            Where-Object {
                $_.Directory.Name -like 'supabase-kyqcvbnxfmpnbwtikzxp-*'
            }
    )
    if ($candidateManifests.Count -ne 1) {
        throw "Expected one restored full-backup manifest, found $($candidateManifests.Count)."
    }
    $restoredBackup = $candidateManifests[0].Directory.FullName
    $verificationJson = & (Join-Path $PSScriptRoot 'verify-supabase-backup.ps1') `
        -BackupDirectory $restoredBackup `
        -RequireStorage
    $verification = ($verificationJson -join [Environment]::NewLine) | ConvertFrom-Json
    if ([string] $verification.database_archive_sha256 -ne [string] $lastSuccess.database_archive_sha256) {
        throw 'The restored database archive does not match the snapshot recorded by the automation.'
    }

    $verifiedAt = [DateTime]::UtcNow.ToString('o')
    $config.offsite_restore_verified_at_utc = $verifiedAt
    $partialConfigPath = "$configPath.partial"
    $config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $partialConfigPath -Encoding utf8
    Move-Item -LiteralPath $partialConfigPath -Destination $configPath -Force

    $testRecord = [ordered]@{
        format_version = 1
        verified_at_utc = $verifiedAt
        snapshot_id = $resolvedSnapshot
        database_archive_sha256 = [string] $verification.database_archive_sha256
        storage_objects_verified = [long] $verification.storage_objects_verified
        storage_bytes_verified = [long] $verification.storage_bytes_verified
    }
    $testRecord | ConvertTo-Json -Depth 3 |
        Set-Content -LiteralPath (Join-Path $resolvedState 'last-offsite-restore-test.json') -Encoding utf8
    $testPassed = $true

    Write-Host "Off-site restore verification passed for snapshot $resolvedSnapshot"
    Write-Host 'The restored copy passed the same database and per-object hash checks as the local backup.'
}
finally {
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
    foreach ($pointer in $secretPointers) {
        if ($pointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        }
    }
    $repositoryPassword = $null
    $offsiteAccessKey = $null
    $offsiteSecretKey = $null

    if ($testPassed -and (Test-Path -LiteralPath $restoreRoot)) {
        $resolvedRestore = [System.IO.Path]::GetFullPath($restoreRoot)
        if ($resolvedRestore.StartsWith($restorePrefix, [System.StringComparison]::OrdinalIgnoreCase) -and
            (Split-Path -Leaf $resolvedRestore).StartsWith('restore-')) {
            Remove-Item -LiteralPath $resolvedRestore -Recurse -Force
        }
    }
}
