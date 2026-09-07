Set-StrictMode -Version Latest

function Invoke-HourlyBackupRetention {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $ResticExecutable,

        [Parameter(Mandatory = $true)]
        [string] $HourlyOutputDirectory,

        [ValidateRange(1, 10000)]
        [int] $KeepHourly = 48,

        [string] $HostName = 'unmatched-labs-production',

        [string] $HourlyTag = 'unmatched-labs-hourly-database',

        [string] $ProjectTag = 'project-kyqcvbnxfmpnbwtikzxp'
    )

    $hourlyRoot = [System.IO.Path]::GetFullPath($HourlyOutputDirectory)
    if ((Split-Path -Path $hourlyRoot -Leaf) -ne 'hourly-database') {
        throw "Hourly retention requires a directory named 'hourly-database': $hourlyRoot"
    }
    if (-not (Test-Path -LiteralPath $hourlyRoot -PathType Container)) {
        throw "Hourly backup directory is unavailable: $hourlyRoot"
    }
    if (-not (Test-Path -LiteralPath $ResticExecutable -PathType Leaf)) {
        throw "Restic is unavailable: $ResticExecutable"
    }

    $requiredTags = "$HourlyTag,$ProjectTag"
    $policyArguments = @(
        'forget',
        '--host', $HostName,
        '--tag', $requiredTags,
        '--group-by', 'host,tags',
        '--keep-hourly', $KeepHourly.ToString()
    )

    # Validate restic's deletion plan before applying the same policy. In particular,
    # no snapshot with a daily tag or a path outside hourly-database may be removed.
    $dryRunOutput = & $ResticExecutable @policyArguments --dry-run --json 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Could not preview hourly off-site retention: $($dryRunOutput -join [Environment]::NewLine)"
    }
    $dryRunText = ($dryRunOutput | ForEach-Object { [string] $_ }) -join [Environment]::NewLine
    try {
        $dryRunPlan = $dryRunText | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "Restic returned an unreadable hourly-retention preview: $dryRunText"
    }

    $hourlyPrefix = $hourlyRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
        [System.IO.Path]::DirectorySeparatorChar
    $plannedRemovalCount = 0
    foreach ($group in @($dryRunPlan)) {
        if ($null -eq $group) {
            continue
        }
        if ([string] $group.host -ne $HostName -or
            -not (@($group.tags) -contains $HourlyTag) -or
            -not (@($group.tags) -contains $ProjectTag)) {
            throw 'Restic proposed an hourly-retention group outside the required host and tags.'
        }
        $removeProperty = $group.PSObject.Properties['remove']
        if ($null -eq $removeProperty) {
            continue
        }
        foreach ($snapshot in @($removeProperty.Value)) {
            if ($null -eq $snapshot) {
                continue
            }
            $pathsProperty = $snapshot.PSObject.Properties['paths']
            if ($null -eq $pathsProperty) {
                throw 'Restic proposed removing a snapshot without an explicit path.'
            }
            $paths = @($pathsProperty.Value)
            if ([string] $snapshot.hostname -ne $HostName -or
                -not (@($snapshot.tags) -contains $HourlyTag) -or
                -not (@($snapshot.tags) -contains $ProjectTag) -or
                $paths.Count -ne 1) {
                throw 'Restic proposed removing a snapshot outside the hourly backup contract.'
            }
            $snapshotPath = [System.IO.Path]::GetFullPath([string] $paths[0])
            if (-not $snapshotPath.StartsWith($hourlyPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Restic proposed removing a snapshot outside hourly-database: $snapshotPath"
            }
            $plannedRemovalCount += 1
        }
    }

    if ($plannedRemovalCount -gt 0) {
        $forgetOutput = & $ResticExecutable @policyArguments --prune 2>&1
        $forgetExitCode = $LASTEXITCODE
        $forgetOutput | ForEach-Object { Write-Host $_ }
        if ($forgetExitCode -ne 0) {
            throw 'Hourly off-site retention or pruning failed.'
        }

        $checkOutput = & $ResticExecutable check --no-cache 2>&1
        $checkExitCode = $LASTEXITCODE
        $checkOutput | ForEach-Object { Write-Host $_ }
        if ($checkExitCode -ne 0) {
            throw 'The repository integrity check failed after hourly pruning.'
        }
    }
    else {
        Write-Host "Hourly retention found no snapshot older than the newest $KeepHourly hourly recovery points."
    }

    $snapshotOutput = & $ResticExecutable snapshots `
        --host $HostName `
        --tag $requiredTags `
        --json 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Could not list retained hourly snapshots: $($snapshotOutput -join [Environment]::NewLine)"
    }
    $retainedSnapshots = (($snapshotOutput | ForEach-Object { [string] $_ }) -join [Environment]::NewLine) |
        ConvertFrom-Json
    $retainedIds = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    foreach ($snapshot in @($retainedSnapshots)) {
        $null = $retainedIds.Add([string] $snapshot.id)
    }

    $localRemovalCount = 0
    $directoryPattern = '^supabase-kyqcvbnxfmpnbwtikzxp-\d{8}T\d{6}Z$'
    foreach ($directory in @(Get-ChildItem -LiteralPath $hourlyRoot -Directory)) {
        if ($directory.Name -notmatch $directoryPattern) {
            continue
        }
        $markerPath = Join-Path $directory.FullName 'offsite-snapshot.json'
        if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
            continue
        }
        try {
            $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            continue
        }
        if ($marker.format_version -ne 1 -or
            $marker.backup_kind -ne 'database_only' -or
            $marker.project_ref -ne 'kyqcvbnxfmpnbwtikzxp' -or
            [string]::IsNullOrWhiteSpace([string] $marker.offsite_snapshot_id) -or
            $retainedIds.Contains([string] $marker.offsite_snapshot_id)) {
            continue
        }

        $resolvedDirectory = [System.IO.Path]::GetFullPath($directory.FullName)
        $resolvedParent = [System.IO.Path]::GetFullPath((Split-Path -Path $resolvedDirectory -Parent))
        if (-not $resolvedParent.Equals($hourlyRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
            -not $resolvedDirectory.StartsWith($hourlyPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove an hourly backup outside its exact root: $resolvedDirectory"
        }
        Remove-Item -LiteralPath $resolvedDirectory -Recurse -Force
        Write-Host "Removed expired local hourly backup: $resolvedDirectory"
        $localRemovalCount += 1
    }

    [ordered]@{
        keep_hourly = $KeepHourly
        offsite_snapshots_planned_for_removal = $plannedRemovalCount
        offsite_snapshots_retained = $retainedIds.Count
        local_directories_removed = $localRemovalCount
    }
}
