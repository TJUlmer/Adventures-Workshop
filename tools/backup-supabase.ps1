[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $OutputDirectory,

    [string] $PostgresBin = "$env:LOCALAPPDATA\UnmatchedLabs\PostgreSQL\17.11\pgsql\bin",

    [string] $HostName = 'aws-0-us-east-1.pooler.supabase.com',

    [int] $Port = 5432,

    [string] $Database = 'postgres',

    [string] $UserName = 'postgres.kyqcvbnxfmpnbwtikzxp'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRef = 'kyqcvbnxfmpnbwtikzxp'
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
$repositoryPrefix = $repositoryRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

if ($resolvedOutput.Equals($repositoryRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    $resolvedOutput.StartsWith($repositoryPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Backups can contain private user data and must be written outside the repository.'
}

$pgDump = Join-Path $PostgresBin 'pg_dump.exe'
$pgRestore = Join-Path $PostgresBin 'pg_restore.exe'
$psql = Join-Path $PostgresBin 'psql.exe'

foreach ($tool in @($pgDump, $pgRestore, $psql)) {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) {
        throw "Required PostgreSQL client tool was not found: $tool"
    }
}

$clientVersion = (& $pgDump --version).Trim()
if ($LASTEXITCODE -ne 0 -or $clientVersion -notmatch 'PostgreSQL\) 17\.') {
    throw "Expected PostgreSQL 17 pg_dump, found: $clientVersion"
}

$password = Read-Host 'Supabase database password' -AsSecureString
$passwordPointer = [IntPtr]::Zero
$previousPassword = $env:PGPASSWORD
$previousSslMode = $env:PGSSLMODE
$backupPath = $null

try {
    $passwordPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
    $env:PGPASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $env:PGSSLMODE = 'require'

    $connectionArguments = @(
        '--host', $HostName,
        '--port', $Port.ToString(),
        '--username', $UserName,
        '--dbname', $Database
    )

    $preflightSql = @"
select json_build_object(
  'server_version', current_setting('server_version'),
  'server_version_num', current_setting('server_version_num'),
  'database_size_bytes', pg_database_size(current_database()),
  'checked_at_utc', timezone('utc', clock_timestamp())
)::text;
"@
    $preflightOutput = & $psql @connectionArguments --no-psqlrc --tuples-only --no-align --command $preflightSql 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Database preflight failed: $($preflightOutput -join [Environment]::NewLine)"
    }

    $preflightJson = ($preflightOutput | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1)
    if ([string]::IsNullOrWhiteSpace($preflightJson)) {
        throw 'Database preflight did not return version metadata.'
    }
    $preflight = $preflightJson | ConvertFrom-Json
    if (-not $preflight.server_version_num.ToString().StartsWith('17')) {
        throw "The production database is not PostgreSQL 17: $($preflight.server_version)"
    }

    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $backupPath = Join-Path $resolvedOutput "supabase-$projectRef-$timestamp"
    if (Test-Path -LiteralPath $backupPath) {
        throw "Refusing to overwrite existing backup path: $backupPath"
    }

    New-Item -ItemType Directory -Path $backupPath | Out-Null
    $partialDumpPath = Join-Path $backupPath 'database.dump.partial'
    $dumpPath = Join-Path $backupPath 'database.dump'
    $dumpLogPath = Join-Path $backupPath 'pg_dump.log'
    $contentsPath = Join-Path $backupPath 'database.contents.txt'
    $manifestPath = Join-Path $backupPath 'manifest.json'

    Write-Host "Creating logical backup at $backupPath"
    & $pgDump @connectionArguments `
        --format=custom `
        --no-owner `
        --no-privileges `
        --no-subscriptions `
        --verbose `
        --file=$partialDumpPath 2>&1 | Tee-Object -FilePath $dumpLogPath
    if ($LASTEXITCODE -ne 0) {
        throw "pg_dump failed. The incomplete archive remains at $partialDumpPath for diagnosis."
    }

    Move-Item -LiteralPath $partialDumpPath -Destination $dumpPath

    $contents = & $pgRestore --list $dumpPath 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw 'pg_restore could not read the completed archive.'
    }
    $contents | Set-Content -LiteralPath $contentsPath -Encoding utf8

    $dumpFile = Get-Item -LiteralPath $dumpPath
    $dumpHash = (Get-FileHash -LiteralPath $dumpPath -Algorithm SHA256).Hash
    $manifest = [ordered]@{
        project_ref = $projectRef
        created_at_utc = [DateTime]::UtcNow.ToString('o')
        database_host = $HostName
        database_port = $Port
        database_name = $Database
        database_user = $UserName
        server_version = $preflight.server_version
        client_version = $clientVersion
        source_database_size_bytes = [long] $preflight.database_size_bytes
        archive_file = $dumpFile.Name
        archive_size_bytes = $dumpFile.Length
        archive_sha256 = $dumpHash
        archive_contents_file = [System.IO.Path]::GetFileName($contentsPath)
        pg_dump_log_file = [System.IO.Path]::GetFileName($dumpLogPath)
        ownership_and_privileges_included = $false
        storage_object_bytes_included = $false
    }
    $manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $manifestPath -Encoding utf8

    Write-Warning 'This logical database backup includes Storage metadata, not the object bytes stored by Supabase Storage.'
    Write-Host "Backup complete: $dumpPath"
    Write-Host "SHA-256: $dumpHash"
    Write-Host 'Restore into a separate recovery project/database before treating this archive as rehearsed.'
}
finally {
    $env:PGPASSWORD = $previousPassword
    $env:PGSSLMODE = $previousSslMode
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    $password = $null
}
