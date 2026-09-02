[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [switch] $Apply,

    [string] $MigrationPath = (Join-Path $PSScriptRoot '..\supabase\migrations\0012_tts_assets.sql'),

    [string] $OutputDirectory = 'G:\Unmatched Labs Backups\supabase-kyqcvbnxfmpnbwtikzxp-20260831T211858Z',

    [string] $PostgresBin = "$env:LOCALAPPDATA\UnmatchedLabs\PostgreSQL\17.11\pgsql\bin",

    [string] $HostName = 'aws-0-us-east-1.pooler.supabase.com',

    [int] $Port = 5432,

    [string] $Database = 'postgres',

    [string] $TargetProjectRef = 'kyqcvbnxfmpnbwtikzxp',

    [string] $UserName = 'postgres.kyqcvbnxfmpnbwtikzxp'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $Apply) {
    throw 'The production ledger repair requires the explicit -Apply switch.'
}
if ($TargetProjectRef -ne 'kyqcvbnxfmpnbwtikzxp' -or $UserName -ne 'postgres.kyqcvbnxfmpnbwtikzxp') {
    throw 'This script is pinned to the audited Unmatched Labs production project.'
}

$migration = [System.IO.Path]::GetFullPath($MigrationPath)
if (-not (Test-Path -LiteralPath $migration -PathType Leaf)) {
    throw "TTS migration not found: $migration"
}
$expectedMigrationHash = '9CEF0132283544E0BCFEB6917B9C3C34F6841375ABE694532C8DCB839F29DCDA'
$migrationHash = (Get-FileHash -LiteralPath $migration -Algorithm SHA256).Hash
if ($migrationHash -ne $expectedMigrationHash) {
    throw "The reviewed TTS migration changed. Expected SHA-256 $expectedMigrationHash, found $migrationHash."
}

$psql = Join-Path $PostgresBin 'psql.exe'
if (-not (Test-Path -LiteralPath $psql -PathType Leaf)) {
    throw "Required PostgreSQL client tool was not found: $psql"
}
$npxCommand = Get-Command 'npx.cmd' -ErrorAction Stop
$npx = $npxCommand.Source
$cliVersion = '2.116.0'
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$dbUrl = "postgresql://$UserName@$HostName`:$Port/$Database`?sslmode=require"

$password = Read-Host 'Production database password' -AsSecureString
$passwordPointer = [IntPtr]::Zero
$previousPassword = $env:PGPASSWORD
$previousSslMode = $env:PGSSLMODE
$previousNoColour = $env:NO_COLOR

try {
    $passwordPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
    $env:PGPASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $env:PGSSLMODE = 'require'
    $env:NO_COLOR = '1'

    $connectionArguments = @(
        '--host', $HostName,
        '--port', $Port.ToString(),
        '--username', $UserName,
        '--dbname', $Database
    )

    $preflightSql = @"
select json_build_object(
  'server_version_num', current_setting('server_version_num'),
  'ledger_rows', (select count(*) from supabase_migrations.schema_migrations),
  'baseline_version_rows', (
    select count(*) from supabase_migrations.schema_migrations where version = '0012'
  ),
  'baseline_name_rows', (
    select count(*) from supabase_migrations.schema_migrations where lower(coalesce(name, '')) like '%tts%'
  ),
  'ledger_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(m)::text, E'\n' order by version), ''))
    from supabase_migrations.schema_migrations m
  ),
  'bucket_rows', (
    select count(*) from storage.buckets where id = 'tts-assets' and name = 'tts-assets'
  ),
  'bucket_is_public', (
    select public from storage.buckets where id = 'tts-assets' and name = 'tts-assets'
  ),
  'bucket_fingerprint', (
    select md5(row_to_json(b)::text) from storage.buckets b where id = 'tts-assets'
  ),
  'object_rows', (select count(*) from storage.objects where bucket_id = 'tts-assets'),
  'object_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(o)::text, E'\n' order by id), ''))
    from storage.objects o where bucket_id = 'tts-assets'
  ),
  'policy_rows', (
    select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('tts_assets_read', 'tts_assets_write', 'tts_assets_update', 'tts_assets_delete')
  ),
  'tts_expression_policy_rows', (
    select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') like '%tts-assets%' or coalesce(with_check, '') like '%tts-assets%')
  ),
  'policy_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(p)::text, E'\n' order by policyname), ''))
    from pg_policies p
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') like '%tts-assets%' or coalesce(with_check, '') like '%tts-assets%')
  ),
  'policy_shape_valid', (
    exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'tts_assets_read' and cmd = 'SELECT'
        and 'public' = any(roles) and qual like '%tts-assets%' and with_check is null
    )
    and exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'tts_assets_write' and cmd = 'INSERT'
        and 'authenticated' = any(roles) and qual is null
        and with_check like '%tts-assets%' and with_check like '%foldername%'
        and with_check like '%auth.uid%'
    )
    and exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'tts_assets_update' and cmd = 'UPDATE'
        and 'authenticated' = any(roles)
        and qual like '%tts-assets%' and qual like '%foldername%' and qual like '%auth.uid%'
        and with_check like '%tts-assets%' and with_check like '%foldername%'
        and with_check like '%auth.uid%'
    )
    and exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'tts_assets_delete' and cmd = 'DELETE'
        and 'authenticated' = any(roles)
        and qual like '%tts-assets%' and qual like '%foldername%' and qual like '%auth.uid%'
        and with_check is null
    )
  )
)::text;
"@

    $preflightOutput = & $psql @connectionArguments `
        --no-psqlrc --tuples-only --no-align --command $preflightSql 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Production preflight failed: $($preflightOutput -join [Environment]::NewLine)"
    }
    $preflightJson = $preflightOutput | Where-Object { ([string] $_).Trim().StartsWith('{') } | Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($preflightJson)) {
        throw 'Production preflight did not return metadata.'
    }
    $preflight = $preflightJson | ConvertFrom-Json
    if (-not $preflight.server_version_num.ToString().StartsWith('17') -or
        [int] $preflight.ledger_rows -ne 42 -or [int] $preflight.baseline_version_rows -ne 0 -or
        [int] $preflight.baseline_name_rows -ne 0 -or [int] $preflight.bucket_rows -ne 1 -or
        -not $preflight.bucket_is_public -or [int] $preflight.policy_rows -ne 4 -or
        [int] $preflight.tts_expression_policy_rows -ne 4 -or -not $preflight.policy_shape_valid) {
        throw 'Production is not in the audited pre-baseline TTS state; no repair was attempted.'
    }

    $repairOutput = & $npx --yes "supabase@$cliVersion" `
        --workdir $workspace `
        --output-format json `
        migration repair 0012 `
        --status applied `
        --db-url $dbUrl 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Supabase migration-history repair failed: $($repairOutput -join [Environment]::NewLine)"
    }

    $postflightSql = @"
select json_build_object(
  'ledger_rows', (select count(*) from supabase_migrations.schema_migrations),
  'baseline_version_rows', (
    select count(*) from supabase_migrations.schema_migrations
    where version = '0012' and name = 'tts_assets'
  ),
  'baseline_statement_rows', (
    select coalesce(array_length(statements, 1), 0)
    from supabase_migrations.schema_migrations where version = '0012'
  ),
  'ledger_without_baseline_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(m)::text, E'\n' order by version), ''))
    from supabase_migrations.schema_migrations m where version <> '0012'
  ),
  'ledger_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(m)::text, E'\n' order by version), ''))
    from supabase_migrations.schema_migrations m
  ),
  'bucket_fingerprint', (
    select md5(row_to_json(b)::text) from storage.buckets b where id = 'tts-assets'
  ),
  'object_rows', (select count(*) from storage.objects where bucket_id = 'tts-assets'),
  'object_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(o)::text, E'\n' order by id), ''))
    from storage.objects o where bucket_id = 'tts-assets'
  ),
  'policy_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(p)::text, E'\n' order by policyname), ''))
    from pg_policies p
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') like '%tts-assets%' or coalesce(with_check, '') like '%tts-assets%')
  )
)::text;
"@

    $postflightOutput = & $psql @connectionArguments `
        --no-psqlrc --tuples-only --no-align --command $postflightSql 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Production postflight failed after the repair: $($postflightOutput -join [Environment]::NewLine)"
    }
    $postflightJson = $postflightOutput | Where-Object { ([string] $_).Trim().StartsWith('{') } | Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($postflightJson)) {
        throw 'Production postflight did not return metadata after the repair.'
    }
    $postflight = $postflightJson | ConvertFrom-Json
    if ([int] $postflight.ledger_rows -ne ([int] $preflight.ledger_rows + 1) -or
        [int] $postflight.baseline_version_rows -ne 1 -or
        [int] $postflight.baseline_statement_rows -lt 1 -or
        $postflight.ledger_without_baseline_fingerprint -ne $preflight.ledger_fingerprint -or
        $postflight.bucket_fingerprint -ne $preflight.bucket_fingerprint -or
        [int] $postflight.object_rows -ne [int] $preflight.object_rows -or
        $postflight.object_fingerprint -ne $preflight.object_fingerprint -or
        $postflight.policy_fingerprint -ne $preflight.policy_fingerprint) {
        throw 'Production postflight did not match the approved ledger-only change. Stop before any further migration.'
    }

    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $evidencePath = Join-Path ([System.IO.Path]::GetFullPath($OutputDirectory)) `
        "tts-ledger-baseline-production-$TargetProjectRef-$timestamp"
    New-Item -ItemType Directory -Path $evidencePath -Force | Out-Null
    $logPath = Join-Path $evidencePath 'repair.log'
    $manifestPath = Join-Path $evidencePath 'manifest.json'
    $repairOutput | Set-Content -LiteralPath $logPath -Encoding utf8

    [ordered]@{
        target_project_ref = $TargetProjectRef
        completed_at_utc = [DateTime]::UtcNow.ToString('o')
        supabase_cli_version = $cliVersion
        migration_path = $migration
        migration_version = '0012'
        migration_name = 'tts_assets'
        migration_sha256 = $migrationHash
        operation = 'supabase migration repair --status applied'
        migration_sql_executed = $false
        preflight = $preflight
        postflight = $postflight
        repair_log = [System.IO.Path]::GetFileName($logPath)
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8

    Write-Host "Production TTS ledger baseline applied and verified: $evidencePath"
}
finally {
    $env:PGPASSWORD = $previousPassword
    $env:PGSSLMODE = $previousSslMode
    $env:NO_COLOR = $previousNoColour
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    $password = $null
}
