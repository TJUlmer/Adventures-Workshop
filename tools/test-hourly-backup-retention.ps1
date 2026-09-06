[CmdletBinding()]
param(
    [string] $ResticExecutable = "$env:LOCALAPPDATA\UnmatchedLabs\restic\0.19.1\restic.exe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $ResticExecutable -PathType Leaf)) {
    throw "Restic is unavailable: $ResticExecutable"
}

$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$temporaryPrefix = $temporaryRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
    [System.IO.Path]::DirectorySeparatorChar
$testRoot = Join-Path $temporaryRoot "unmatched-labs-hourly-retention-$([guid]::NewGuid().ToString('N'))"
$repository = Join-Path $testRoot 'repository'
$hourlyRoot = Join-Path $testRoot 'hourly-database'
$dailyRoot = Join-Path $testRoot 'daily-full'
$hostName = 'unmatched-labs-retention-test'
$hourlyTag = 'unmatched-labs-hourly-database'
$projectTag = 'project-kyqcvbnxfmpnbwtikzxp'
$environmentNames = @('RESTIC_REPOSITORY', 'RESTIC_PASSWORD')
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

try {
    New-Item -ItemType Directory -Path $hourlyRoot,$dailyRoot -Force | Out-Null
    $env:RESTIC_REPOSITORY = $repository
    $env:RESTIC_PASSWORD = 'isolated-retention-test-password'
    $null = & $ResticExecutable init 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not initialise the isolated restic test repository.'
    }

    $baseTime = [DateTimeOffset]::UtcNow.AddMinutes(-20)
    for ($index = 0; $index -lt 4; $index += 1) {
        $snapshotTime = $baseTime.AddHours($index - 3)
        $directoryName = "supabase-kyqcvbnxfmpnbwtikzxp-$($snapshotTime.UtcDateTime.ToString('yyyyMMddTHHmmssZ'))"
        $backupPath = Join-Path $hourlyRoot $directoryName
        New-Item -ItemType Directory -Path $backupPath | Out-Null
        Set-Content -LiteralPath (Join-Path $backupPath 'database.dump') `
            -Value "isolated database archive $index" -Encoding utf8

        $backupOutput = & $ResticExecutable backup $backupPath `
            --host $hostName `
            --tag $hourlyTag `
            --tag $projectTag `
            --time $snapshotTime.UtcDateTime.ToString('yyyy-MM-dd HH:mm:ss') `
            --json 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Could not create isolated hourly snapshot $index`: $($backupOutput -join [Environment]::NewLine)"
        }
        $summary = $null
        foreach ($line in $backupOutput) {
            try {
                $record = ([string] $line) | ConvertFrom-Json -ErrorAction Stop
                if ($record.message_type -eq 'summary') {
                    $summary = $record
                }
            }
            catch {
                # Restic progress can include non-JSON warnings; its exit code is authoritative.
            }
        }
        if ($null -eq $summary) {
            throw "Isolated hourly snapshot $index did not return a summary."
        }
        [ordered]@{
            format_version = 1
            backup_kind = 'database_only'
            project_ref = 'kyqcvbnxfmpnbwtikzxp'
            offsite_snapshot_id = [string] $summary.snapshot_id
        } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backupPath 'offsite-snapshot.json') -Encoding utf8
    }

    $unmarkedPath = Join-Path $hourlyRoot 'supabase-kyqcvbnxfmpnbwtikzxp-20000101T000000Z'
    New-Item -ItemType Directory -Path $unmarkedPath | Out-Null
    Set-Content -LiteralPath (Join-Path $unmarkedPath 'database.dump.partial') -Value 'incomplete' -Encoding utf8

    Set-Content -LiteralPath (Join-Path $dailyRoot 'database.dump') -Value 'daily full backup' -Encoding utf8
    $null = & $ResticExecutable backup $dailyRoot `
        --host $hostName `
        --tag 'unmatched-labs-full' `
        --tag $projectTag `
        --time $baseTime.UtcDateTime.ToString('yyyy-MM-dd HH:mm:ss') 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not create the isolated daily snapshot.'
    }

    . (Join-Path $PSScriptRoot 'hourly-backup-retention.ps1')
    $result = Invoke-HourlyBackupRetention `
        -ResticExecutable $ResticExecutable `
        -HourlyOutputDirectory $hourlyRoot `
        -KeepHourly 2 `
        -HostName $hostName `
        -HourlyTag $hourlyTag `
        -ProjectTag $projectTag

    $hourlySnapshotsJson = & $ResticExecutable snapshots `
        --host $hostName --tag "$hourlyTag,$projectTag" --json
    $dailySnapshotsJson = & $ResticExecutable snapshots `
        --host $hostName --tag "unmatched-labs-full,$projectTag" --json
    $hourlySnapshots = @($hourlySnapshotsJson | ConvertFrom-Json)
    $dailySnapshots = @($dailySnapshotsJson | ConvertFrom-Json)
    $remainingMarkedDirectories = @(
        Get-ChildItem -LiteralPath $hourlyRoot -Directory |
            Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'offsite-snapshot.json') }
    )

    if ($hourlySnapshots.Count -ne 2 -or
        $dailySnapshots.Count -ne 1 -or
        $remainingMarkedDirectories.Count -ne 2 -or
        -not (Test-Path -LiteralPath $unmarkedPath -PathType Container) -or
        [int] $result.offsite_snapshots_planned_for_removal -ne 2 -or
        [int] $result.local_directories_removed -ne 2) {
        throw 'Hourly retention did not preserve the expected isolated recovery points.'
    }

    Write-Host 'Hourly retention test passed.'
    Write-Host 'Two oldest hourly snapshots and their marked local directories were removed.'
    Write-Host 'Two newest hourly snapshots, the daily snapshot, and an unmarked incomplete directory were preserved.'
}
finally {
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
    if ((Split-Path -Path $resolvedTestRoot -Leaf) -notlike 'unmatched-labs-hourly-retention-*' -or
        -not $resolvedTestRoot.StartsWith($temporaryPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove an unexpected test directory: $resolvedTestRoot"
    }
    if (Test-Path -LiteralPath $resolvedTestRoot) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}
