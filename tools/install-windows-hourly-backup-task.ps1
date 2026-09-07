[CmdletBinding(SupportsShouldProcess)]
param(
    [string] $TaskName = 'Unmatched Labs Hourly Database Backup',
    [datetime] $FirstRun,
    [string] $PowerShellExecutable,
    [switch] $Replace,
    [switch] $RunNow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'Windows Task Scheduler is available only on Windows.'
}

$runner = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'run-hourly-database-backup.ps1'))
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stateDirectory = Join-Path $env:LOCALAPPDATA 'UnmatchedLabs\backup-automation'
$configPath = Join-Path $stateDirectory 'config.json'

if ([string]::IsNullOrWhiteSpace($PowerShellExecutable)) {
    $powerShellCandidates = @(
        'C:\Program Files\PowerShell\7\pwsh.exe',
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\pwsh.exe')
    )
    $PowerShellExecutable = $powerShellCandidates |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
}

if ([string]::IsNullOrWhiteSpace($PowerShellExecutable) -or
    -not (Test-Path -LiteralPath $PowerShellExecutable -PathType Leaf)) {
    throw 'PowerShell 7 was not found. Install the standard Microsoft.PowerShell package before registering the task.'
}
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) {
    throw "Hourly database runner not found: $runner"
}
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "Backup automation is not configured for this Windows account: $configPath"
}

$powerShellVersion = & $PowerShellExecutable -NoLogo -NoProfile -NonInteractive -Command '$PSVersionTable.PSVersion.Major'
if ($LASTEXITCODE -ne 0 -or [int] $powerShellVersion -lt 7) {
    throw "The scheduled executable must be PowerShell 7 or newer: $PowerShellExecutable"
}

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -ne $existing -and -not $Replace) {
    throw "A scheduled task named '$TaskName' already exists. Use -Replace only after reviewing that task."
}

if (-not $PSBoundParameters.ContainsKey('FirstRun')) {
    $now = Get-Date
    $FirstRun = $now.Date.AddHours($now.Hour).AddMinutes(15)
    if ($FirstRun -le $now) {
        $FirstRun = $FirstRun.AddHours(1)
    }
}

# InteractiveToken lets the existing DPAPI configuration decrypt without storing
# the user's Windows password in Task Scheduler.
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal `
    -UserId $userId `
    -LogonType Interactive `
    -RunLevel Limited

$arguments = '-NoLogo -NoProfile -NonInteractive -File "' + $runner + '"'
$action = New-ScheduledTaskAction `
    -Execute $PowerShellExecutable `
    -Argument $arguments `
    -WorkingDirectory $repositoryRoot
$trigger = New-ScheduledTaskTrigger `
    -Once `
    -At $FirstRun `
    -RepetitionInterval (New-TimeSpan -Hours 1)
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -WakeToRun `
    -RunOnlyIfNetworkAvailable `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 15) `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 45)

$definition = New-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Creates and verifies a database-only Supabase backup, then uploads an encrypted deduplicated restic snapshot. Supabase Storage bytes and retention deletion are excluded.'

if ($PSCmdlet.ShouldProcess($TaskName, 'Register hourly Windows database-backup task')) {
    $registrationParameters = @{
        TaskName = $TaskName
        InputObject = $definition
    }
    if ($null -ne $existing) {
        $registrationParameters['Force'] = $true
    }
    $registered = Register-ScheduledTask @registrationParameters

    Write-Host "Windows hourly database-backup task registered: $TaskName"
    Write-Host "First run: $($FirstRun.ToString('yyyy-MM-dd HH:mm'))"
    Write-Host 'Repeat interval: every hour'
    Write-Host "Windows account: $userId (runs only while this account is logged on)"
    Write-Host "PowerShell: $PowerShellExecutable"
    Write-Host "Runner: $runner"
    Write-Host 'Missed runs start when the computer is next available; overlapping runs are ignored.'

    if ($RunNow) {
        Start-ScheduledTask -InputObject $registered
        Write-Host 'A test run was started through Windows Task Scheduler.'
    }
}
