[CmdletBinding()]
param(
    [string] $Version = '0.19.1',

    [string] $InstallRoot = "$env:LOCALAPPDATA\UnmatchedLabs\restic"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw 'restic version must use a numeric major.minor.patch format.'
}

$resolvedInstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$allowedInstallRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'UnmatchedLabs\restic'))
if (-not $resolvedInstallRoot.Equals($allowedInstallRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to install outside the approved restic tools directory: $allowedInstallRoot"
}

$temporaryRoot = [System.IO.Path]::GetFullPath((Join-Path ([System.IO.Path]::GetTempPath()) (
    'unmatched-labs-restic-' + [guid]::NewGuid().ToString('N')
)))
$temporaryPrefix = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar
) + [System.IO.Path]::DirectorySeparatorChar
$archiveName = "restic_$($Version)_windows_amd64.zip"
$releaseBase = "https://github.com/restic/restic/releases/download/v$Version"
$archivePath = Join-Path $temporaryRoot $archiveName
$sumsPath = Join-Path $temporaryRoot 'SHA256SUMS'
$extractPath = Join-Path $temporaryRoot 'extract'
$versionInstallPath = Join-Path $resolvedInstallRoot $Version
$installedExecutable = Join-Path $versionInstallPath 'restic.exe'
$installManifestPath = Join-Path $versionInstallPath 'install-manifest.json'

if ((Test-Path -LiteralPath $installedExecutable -PathType Leaf) -and
    (Test-Path -LiteralPath $installManifestPath -PathType Leaf)) {
    $installedManifest = Get-Content -LiteralPath $installManifestPath -Raw | ConvertFrom-Json
    $installedVersion = (& $installedExecutable version 2>&1 | Select-Object -First 1).ToString().Trim()
    $installedHash = (Get-FileHash -LiteralPath $installedExecutable -Algorithm SHA256).Hash
    if ($installedVersion.StartsWith("restic $Version ") -and
        $installedManifest.version -eq $Version -and
        $installedManifest.executable_sha256 -eq $installedHash) {
        Write-Host "Verified restic $Version is already installed at $installedExecutable"
        return
    }
}

try {
    New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
    Invoke-WebRequest -Uri "$releaseBase/$archiveName" -OutFile $archivePath
    Invoke-WebRequest -Uri "$releaseBase/SHA256SUMS" -OutFile $sumsPath

    $sums = Get-Content -LiteralPath $sumsPath -Raw
    $escapedArchiveName = [regex]::Escape($archiveName)
    $hashMatch = [regex]::Match($sums, "(?im)^([a-f0-9]{64})\s+\*?$escapedArchiveName\s*$")
    if (-not $hashMatch.Success) {
        throw 'The official SHA256SUMS file did not contain the requested Windows archive.'
    }
    $expectedHash = $hashMatch.Groups[1].Value.ToUpperInvariant()
    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
    if ($actualHash -ne $expectedHash) {
        throw 'The downloaded restic archive did not match its official SHA-256.'
    }

    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath
    $extractedExecutable = Join-Path $extractPath "restic_$($Version)_windows_amd64.exe"
    if (-not (Test-Path -LiteralPath $extractedExecutable -PathType Leaf)) {
        throw 'The verified archive did not contain the expected restic executable.'
    }

    New-Item -ItemType Directory -Path $versionInstallPath -Force | Out-Null
    Copy-Item -LiteralPath $extractedExecutable -Destination $installedExecutable -Force
    $reportedVersion = (& $installedExecutable version 2>&1 | Select-Object -First 1).ToString().Trim()
    if (-not $reportedVersion.StartsWith("restic $Version ")) {
        throw "Installed restic reported an unexpected version: $reportedVersion"
    }

    $executableHash = (Get-FileHash -LiteralPath $installedExecutable -Algorithm SHA256).Hash
    $installManifest = [ordered]@{
        version = $Version
        installed_at_utc = [DateTime]::UtcNow.ToString('o')
        source_url = "$releaseBase/$archiveName"
        archive_sha256 = $actualHash
        executable_sha256 = $executableHash
    }
    $installManifest | ConvertTo-Json -Depth 3 |
        Set-Content -LiteralPath $installManifestPath -Encoding utf8

    Write-Host "Installed verified restic $Version at $installedExecutable"
    Write-Host "Archive SHA-256: $actualHash"
}
finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        $resolvedTemporary = [System.IO.Path]::GetFullPath($temporaryRoot)
        if ($resolvedTemporary.StartsWith($temporaryPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and
            (Split-Path -Leaf $resolvedTemporary).StartsWith('unmatched-labs-restic-')) {
            Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force
        }
    }
}
