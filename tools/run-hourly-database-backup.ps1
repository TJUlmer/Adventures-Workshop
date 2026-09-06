[CmdletBinding()]
param(
    [string] $StateDirectory = "$env:LOCALAPPDATA\UnmatchedLabs\backup-automation"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'This automation requires PowerShell 7 or newer. Run it with pwsh.'
}

$resolvedState = [System.IO.Path]::GetFullPath($StateDirectory)
$allowedState = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'UnmatchedLabs\backup-automation'))
if (-not $resolvedState.Equals($allowedState, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to load credentials outside: $allowedState"
}

$configPath = Join-Path $resolvedState 'config.json'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "Backup automation is not configured: $configPath"
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($config.format_version -ne 1 -or $config.project_ref -ne 'kyqcvbnxfmpnbwtikzxp') {
    throw 'The automation configuration has an unsupported format or project ref.'
}

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repositoryPrefix = $repositoryRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
    [System.IO.Path]::DirectorySeparatorChar
$backupOutput = [System.IO.Path]::GetFullPath([string] $config.backup_output_directory)
if ($backupOutput.Equals($repositoryRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    $backupOutput.StartsWith($repositoryPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The configured backup output directory is inside the repository.'
}
if (-not (Test-Path -LiteralPath $backupOutput -PathType Container)) {
    throw "The configured backup output directory is unavailable: $backupOutput"
}
$hourlyOutput = Join-Path $backupOutput 'hourly-database'
New-Item -ItemType Directory -Path $hourlyOutput -Force | Out-Null

$restic = [System.IO.Path]::GetFullPath([string] $config.restic_executable)
if (-not (Test-Path -LiteralPath $restic -PathType Leaf)) {
    throw "The configured restic executable is unavailable: $restic"
}

# Daily and hourly jobs use one lock because Task Scheduler's overlap setting only
# coordinates instances of the same task, not two different backup tasks.
$lockPath = Join-Path $resolvedState 'backup.lock'
$lock = $null
$transcriptStarted = $false
$timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$logPath = Join-Path (Join-Path $resolvedState 'logs') "hourly-database-$timestamp.log"
$secretPointers = [System.Collections.Generic.List[IntPtr]]::new()
$environmentNames = @('RESTIC_REPOSITORY', 'RESTIC_PASSWORD', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY')
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$databasePassword = $null
$repositoryPassword = $null
$offsiteAccessKey = $null
$offsiteSecretKey = $null

try {
    try {
        $lock = [System.IO.File]::Open(
            $lockPath,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )
    }
    catch [System.IO.IOException] {
        throw 'Another backup run appears to be active. Remove backup.lock only after confirming no run exists.'
    }

    Start-Transcript -LiteralPath $logPath | Out-Null
    $transcriptStarted = $true
    Write-Host "Starting verified hourly database backup at $timestamp"

    $databasePassword = ConvertTo-SecureString ([string] $config.database_password_dpapi)
    $existingDirectories = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    foreach ($directory in @(Get-ChildItem -LiteralPath $hourlyOutput -Directory -Filter 'supabase-*')) {
        $null = $existingDirectories.Add($directory.FullName)
    }

    & (Join-Path $PSScriptRoot 'backup-supabase.ps1') `
        -OutputDirectory $hourlyOutput `
        -DatabasePassword $databasePassword

    $newDirectories = @(
        Get-ChildItem -LiteralPath $hourlyOutput -Directory -Filter 'supabase-kyqcvbnxfmpnbwtikzxp-*' |
            Where-Object { -not $existingDirectories.Contains($_.FullName) }
    )
    if ($newDirectories.Count -ne 1) {
        throw "Expected exactly one new database backup directory, found $($newDirectories.Count)."
    }
    $backupPath = $newDirectories[0].FullName
    $verificationJson = & (Join-Path $PSScriptRoot 'verify-supabase-backup.ps1') `
        -BackupDirectory $backupPath
    $verification = ($verificationJson | Select-Object -Last 1) | ConvertFrom-Json
    if ($verification.storage_included -ne $false) {
        throw 'The hourly runner unexpectedly included Supabase Storage bytes.'
    }

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

    Write-Host 'Uploading encrypted, deduplicated database backup to the private off-site repository...'
    $resticOutput = & $restic backup $backupPath `
        --host 'unmatched-labs-production' `
        --tag 'unmatched-labs-hourly-database' `
        --tag 'project-kyqcvbnxfmpnbwtikzxp' `
        --json 2>&1
    $resticExitCode = $LASTEXITCODE
    $resticOutput | ForEach-Object { Write-Host $_ }
    if ($resticExitCode -ne 0) {
        throw 'The database backup passed verification, but its encrypted off-site upload failed.'
    }

    $summary = $null
    foreach ($line in $resticOutput) {
        try {
            $record = ([string] $line) | ConvertFrom-Json -ErrorAction Stop
            if ($record.message_type -eq 'summary') {
                $summary = $record
            }
        }
        catch {
            # Restic may interleave an ordinary warning with JSON progress; the exit code remains authoritative.
        }
    }
    if ($null -eq $summary -or [string]::IsNullOrWhiteSpace([string] $summary.snapshot_id)) {
        throw 'The off-site upload succeeded but did not return a snapshot identifier.'
    }

    Write-Host 'Checking the encrypted repository structure...'
    $checkOutput = & $restic check --no-cache 2>&1
    $checkExitCode = $LASTEXITCODE
    $checkOutput | ForEach-Object { Write-Host $_ }
    if ($checkExitCode -ne 0) {
        throw 'The off-site snapshot uploaded, but the repository integrity check failed.'
    }

    $manifest = Get-Content -LiteralPath (Join-Path $backupPath 'manifest.json') -Raw | ConvertFrom-Json
    $snapshotMarker = [ordered]@{
        format_version = 1
        backup_kind = 'database_only'
        project_ref = 'kyqcvbnxfmpnbwtikzxp'
        completed_at_utc = [DateTime]::UtcNow.ToString('o')
        offsite_snapshot_id = [string] $summary.snapshot_id
    }
    $snapshotMarkerPath = Join-Path $backupPath 'offsite-snapshot.json'
    $partialSnapshotMarkerPath = "$snapshotMarkerPath.partial"
    $snapshotMarker | ConvertTo-Json -Depth 3 |
        Set-Content -LiteralPath $partialSnapshotMarkerPath -Encoding utf8
    Move-Item -LiteralPath $partialSnapshotMarkerPath -Destination $snapshotMarkerPath -Force

    . (Join-Path $PSScriptRoot 'hourly-backup-retention.ps1')
    $retention = Invoke-HourlyBackupRetention `
        -ResticExecutable $restic `
        -HourlyOutputDirectory $hourlyOutput `
        -KeepHourly 48

    $runRecord = [ordered]@{
        format_version = 1
        backup_kind = 'database_only'
        completed_at_utc = [DateTime]::UtcNow.ToString('o')
        backup_directory = $backupPath
        database_archive_size_bytes = [long] $manifest.archive_size_bytes
        database_archive_sha256 = [string] $manifest.archive_sha256
        storage_included = $false
        offsite_snapshot_id = [string] $summary.snapshot_id
        offsite_repository_check_passed = $true
        retention_applied = $true
        retention_keep_hourly = [int] $retention.keep_hourly
        offsite_snapshots_removed = [int] $retention.offsite_snapshots_planned_for_removal
        offsite_snapshots_retained = [int] $retention.offsite_snapshots_retained
        local_directories_removed = [int] $retention.local_directories_removed
    }
    $runRecordPath = Join-Path $resolvedState 'last-hourly-success.json'
    $partialRunRecordPath = "$runRecordPath.partial"
    $runRecord | ConvertTo-Json -Depth 4 |
        Set-Content -LiteralPath $partialRunRecordPath -Encoding utf8
    Move-Item -LiteralPath $partialRunRecordPath -Destination $runRecordPath -Force

    Write-Host "Hourly database backup passed: $backupPath"
    Write-Host "Encrypted off-site snapshot: $($summary.snapshot_id)"
    Write-Host 'Supabase Storage object bytes were not downloaded.'
    Write-Host "Hourly retention kept the newest $($retention.keep_hourly) hourly recovery points."
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
    $databasePassword = $null
    $repositoryPassword = $null
    $offsiteAccessKey = $null
    $offsiteSecretKey = $null
    if ($transcriptStarted) {
        Stop-Transcript | Out-Null
    }
    if ($null -ne $lock) {
        $lock.Dispose()
        Remove-Item -LiteralPath $lockPath -Force
    }
}
