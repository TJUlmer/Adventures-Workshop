[CmdletBinding(SupportsShouldProcess)]
param(
    [string] $TaskName = 'Unmatched Labs Daily Full Backup',
    [datetime] $DailyAt = '02:00',
    [string] $PowerShellExecutable,
    [switch] $Replace,
    [switch] $RunNow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'Windows Task Scheduler is available only on Windows.'
}

$runner = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'run-backup-automation.ps1'))
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
    throw "Backup runner not found: $runner"
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

# InteractiveToken keeps DPAPI tied to the same Windows account without storing the
# account password in Task Scheduler. The task therefore runs only while this user is logged on.
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
$trigger = New-ScheduledTaskTrigger -Daily -At $DailyAt
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -WakeToRun `
    -RunOnlyIfNetworkAvailable `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 15) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 4)

$definition = New-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Creates and verifies a full Supabase backup, then uploads an encrypted deduplicated restic snapshot. No retention or deletion is performed.'

if ($PSCmdlet.ShouldProcess($TaskName, 'Register daily Windows backup task')) {
    $registrationParameters = @{
        TaskName = $TaskName
        InputObject = $definition
    }
    if ($null -ne $existing) {
        $registrationParameters['Force'] = $true
    }
    $registered = Register-ScheduledTask @registrationParameters

    Write-Host "Windows backup task registered: $TaskName"
    Write-Host "Daily start time: $($DailyAt.ToString('HH:mm'))"
    Write-Host "Windows account: $userId (runs only while this account is logged on)"
    Write-Host "PowerShell: $PowerShellExecutable"
    Write-Host "Runner: $runner"
    Write-Host 'Missed runs start when the computer is next available; overlapping runs are ignored.'

    if ($RunNow) {
        Start-ScheduledTask -InputObject $registered
        Write-Host 'A test run was started through Windows Task Scheduler.'
    }
}
