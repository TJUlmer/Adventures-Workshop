[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $BackupOutputDirectory,

    [Parameter(Mandatory = $true)]
    [string] $BucketName,

    [Parameter(Mandatory = $true)]
    [string] $S3Endpoint,

    [string] $ResticBin = "$env:LOCALAPPDATA\UnmatchedLabs\restic\0.19.1\restic.exe",

    [string] $StateDirectory = "$env:LOCALAPPDATA\UnmatchedLabs\backup-automation",

    [Security.SecureString] $ProvidedDatabasePassword,

    [Security.SecureString] $ProvidedSupabaseAccessKey,

    [Security.SecureString] $ProvidedSupabaseSecretKey,

    [Security.SecureString] $ProvidedOffsiteAccessKey,

    [Security.SecureString] $ProvidedOffsiteSecretKey,

    [Security.SecureString] $ProvidedRepositoryPassword
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'This configuration tool requires PowerShell 7 or newer. Run it with pwsh.'
}

$projectRef = 'kyqcvbnxfmpnbwtikzxp'
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repositoryPrefix = $repositoryRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
    [System.IO.Path]::DirectorySeparatorChar
$resolvedOutput = [System.IO.Path]::GetFullPath($BackupOutputDirectory)
$resolvedState = [System.IO.Path]::GetFullPath($StateDirectory)
$allowedState = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'UnmatchedLabs\backup-automation'))

foreach ($path in @($resolvedOutput, $resolvedState)) {
    if ($path.Equals($repositoryRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
        $path.StartsWith($repositoryPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Backup data and credentials must be stored outside the repository.'
    }
}
if (-not $resolvedState.Equals($allowedState, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to store automation credentials outside: $allowedState"
}
if ($BucketName -notmatch '^[a-z0-9][a-z0-9-]{4,61}[a-z0-9]$') {
    throw 'The private bucket name must be 6-63 lowercase letters, digits, or hyphens.'
}

$endpoint = $S3Endpoint.TrimEnd('/')
$endpointUri = $null
if (-not [Uri]::TryCreate($endpoint, [UriKind]::Absolute, [ref] $endpointUri) -or
    $endpointUri.Scheme -ne 'https' -or
    $endpointUri.AbsolutePath -ne '/' -or
    -not [string]::IsNullOrEmpty($endpointUri.Query) -or
    -not [string]::IsNullOrEmpty($endpointUri.Fragment)) {
    throw 'The S3 endpoint must be an HTTPS URL without a query string or fragment.'
}
if (-not (Test-Path -LiteralPath $ResticBin -PathType Leaf)) {
    throw "restic was not found at: $ResticBin. Run tools/install-restic.ps1 first."
}

$reportedVersion = (& $ResticBin version 2>&1 | Select-Object -First 1).ToString().Trim()
if (-not $reportedVersion.StartsWith('restic 0.19.1 ')) {
    throw "Expected restic 0.19.1, found: $reportedVersion"
}

New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
New-Item -ItemType Directory -Path $resolvedState -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $resolvedState 'logs') -Force | Out-Null

# DPAPI already makes the ciphertext usable only by this Windows user on this machine. The
# restricted ACL is defense in depth and also keeps the non-secret configuration private.
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$aclOutput = & icacls.exe $resolvedState '/inheritance:r' '/grant:r' "*$($currentSid):(OI)(CI)F" 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Could not restrict the automation state directory: $($aclOutput -join [Environment]::NewLine)"
}

function Read-ConfirmedSecret {
    param([Parameter(Mandatory = $true)][string] $Prompt)

    $first = Read-Host $Prompt -AsSecureString
    $second = Read-Host "$Prompt (again)" -AsSecureString
    $firstPointer = [IntPtr]::Zero
    $secondPointer = [IntPtr]::Zero
    try {
        $firstPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
        $secondPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($second)
        $firstText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($firstPointer)
        $secondText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secondPointer)
        if ([string]::IsNullOrWhiteSpace($firstText) -or $firstText -ne $secondText) {
            throw 'The two encryption passwords did not match.'
        }
        return $first
    }
    finally {
        if ($firstPointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($firstPointer)
        }
        if ($secondPointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secondPointer)
        }
        $firstText = $null
        $secondText = $null
        $second = $null
    }
}

$databasePassword = if ($null -ne $ProvidedDatabasePassword) {
    $ProvidedDatabasePassword.Copy()
}
else {
    Read-Host 'Production Supabase database password' -AsSecureString
}
$supabaseAccessKey = if ($null -ne $ProvidedSupabaseAccessKey) {
    $ProvidedSupabaseAccessKey.Copy()
}
else {
    Read-Host 'Production Supabase Storage S3 access key ID' -AsSecureString
}
$supabaseSecretKey = if ($null -ne $ProvidedSupabaseSecretKey) {
    $ProvidedSupabaseSecretKey.Copy()
}
else {
    Read-Host 'Production Supabase Storage S3 secret access key' -AsSecureString
}
$offsiteAccessKey = if ($null -ne $ProvidedOffsiteAccessKey) {
    $ProvidedOffsiteAccessKey.Copy()
}
else {
    Read-Host 'Off-site bucket application key ID' -AsSecureString
}
$offsiteSecretKey = if ($null -ne $ProvidedOffsiteSecretKey) {
    $ProvidedOffsiteSecretKey.Copy()
}
else {
    Read-Host 'Off-site bucket application key' -AsSecureString
}
$repositoryPassword = if ($null -ne $ProvidedRepositoryPassword) {
    $ProvidedRepositoryPassword.Copy()
}
else {
    Read-ConfirmedSecret -Prompt 'New off-site backup encryption password'
}

$repository = "s3:$endpoint/$BucketName/unmatched-labs-production"
$secretPointers = [System.Collections.Generic.List[IntPtr]]::new()
$environmentNames = @('RESTIC_REPOSITORY', 'RESTIC_PASSWORD', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY')
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

try {
    foreach ($secret in @($repositoryPassword, $offsiteAccessKey, $offsiteSecretKey)) {
        $secretPointers.Add([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret))
    }
    $env:RESTIC_REPOSITORY = $repository
    $env:RESTIC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointers[0])
    $env:AWS_ACCESS_KEY_ID = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointers[1])
    $env:AWS_SECRET_ACCESS_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointers[2])

    $probeOutput = & $ResticBin cat config 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host 'The encrypted off-site repository already exists and its credentials were verified.'
    }
    else {
        Write-Host 'Initialising the encrypted off-site repository...'
        $initialiseOutput = & $ResticBin init 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Could not initialise the off-site repository: $($initialiseOutput -join [Environment]::NewLine)"
        }
    }

    $config = [ordered]@{
        format_version = 1
        project_ref = $projectRef
        configured_at_utc = [DateTime]::UtcNow.ToString('o')
        backup_output_directory = $resolvedOutput
        restic_executable = [System.IO.Path]::GetFullPath($ResticBin)
        restic_repository = $repository
        database_password_dpapi = ConvertFrom-SecureString $databasePassword
        supabase_storage_access_key_dpapi = ConvertFrom-SecureString $supabaseAccessKey
        supabase_storage_secret_key_dpapi = ConvertFrom-SecureString $supabaseSecretKey
        offsite_access_key_dpapi = ConvertFrom-SecureString $offsiteAccessKey
        offsite_secret_key_dpapi = ConvertFrom-SecureString $offsiteSecretKey
        repository_password_dpapi = ConvertFrom-SecureString $repositoryPassword
        retention_enabled = $false
        offsite_restore_verified_at_utc = $null
    }
    $configPath = Join-Path $resolvedState 'config.json'
    $partialConfigPath = "$configPath.partial"
    $config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $partialConfigPath -Encoding utf8
    Move-Item -LiteralPath $partialConfigPath -Destination $configPath -Force

    Write-Host "Encrypted automation configuration saved to $configPath"
    Write-Host 'Retention remains disabled until an off-site restore test succeeds.'
    Write-Host 'Store the encryption password in an off-computer password manager before continuing.'
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
    $supabaseAccessKey = $null
    $supabaseSecretKey = $null
    $offsiteAccessKey = $null
    $offsiteSecretKey = $null
    $repositoryPassword = $null
}
