[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [switch] $Apply,

    [string] $MigrationPath = (Join-Path $PSScriptRoot '..\supabase\migrations\0013_grant_reconciliation.sql'),

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
    throw 'The production grant reconciliation requires the explicit -Apply switch.'
}
if ($TargetProjectRef -ne 'kyqcvbnxfmpnbwtikzxp' -or $UserName -ne 'postgres.kyqcvbnxfmpnbwtikzxp') {
    throw 'This script is pinned to the audited Unmatched Labs production project.'
}

$migration = [System.IO.Path]::GetFullPath($MigrationPath)
if (-not (Test-Path -LiteralPath $migration -PathType Leaf)) {
    throw "Grant-reconciliation migration not found: $migration"
}
$migrationText = Get-Content -LiteralPath $migration -Raw
if ($migrationText -match '(?im)^\s*(begin|commit|rollback)\s*;') {
    throw 'The migration must not control its own transaction.'
}
$expectedMigrationHash = 'D4361B8131FECE7C08B93FE483C9B983E2AE45311F1E3E06291AC4283B99A9AF'
$migrationHash = (Get-FileHash -LiteralPath $migration -Algorithm SHA256).Hash
if ($migrationHash -ne $expectedMigrationHash) {
    throw "The reviewed grant migration changed. Expected SHA-256 $expectedMigrationHash, found $migrationHash."
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
  'tts_baseline_rows', (
    select count(*) from supabase_migrations.schema_migrations
    where version = '0012' and name = 'tts_assets' and array_length(statements, 1) = 9
  ),
  'grant_version_rows', (
    select count(*) from supabase_migrations.schema_migrations where version = '0013'
  ),
  'grant_name_rows', (
    select count(*) from supabase_migrations.schema_migrations
    where lower(coalesce(name, '')) like '%grant%reconcil%'
  ),
  'ledger_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(m)::text, E'\n' order by version), ''))
    from supabase_migrations.schema_migrations m
  ),
  'set_rows', (select count(*) from public.sets),
  'sets_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(s)::text, E'\n' order by id), ''))
    from public.sets s
  ),
  'storage_bucket_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(b)::text, E'\n' order by id), ''))
    from storage.buckets b
  ),
  'storage_object_rows', (select count(*) from storage.objects),
  'storage_object_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(o)::text, E'\n' order by id), ''))
    from storage.objects o
  ),
  'storage_policy_rows', (
    select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
  ),
  'storage_policy_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(p)::text, E'\n' order by policyname), ''))
    from pg_policies p where schemaname = 'storage' and tablename = 'objects'
  ),
  'moderate_set_exists', to_regprocedure('public.moderate_set(uuid,boolean,text)') is not null,
  'admin_policy_exists', exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sets' and policyname = 'sets_admin_moderate'
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
        [int] $preflight.ledger_rows -ne 43 -or [int] $preflight.tts_baseline_rows -ne 1 -or
        [int] $preflight.grant_version_rows -ne 0 -or [int] $preflight.grant_name_rows -ne 0 -or
        [int] $preflight.set_rows -lt 11 -or [int] $preflight.storage_policy_rows -ne 8 -or
        $preflight.moderate_set_exists -or -not $preflight.admin_policy_exists) {
        $safePreflight = [ordered]@{
            server_version_num = $preflight.server_version_num
            ledger_rows = $preflight.ledger_rows
            tts_baseline_rows = $preflight.tts_baseline_rows
            grant_version_rows = $preflight.grant_version_rows
            grant_name_rows = $preflight.grant_name_rows
            set_rows = $preflight.set_rows
            storage_policy_rows = $preflight.storage_policy_rows
            moderate_set_exists = $preflight.moderate_set_exists
            admin_policy_exists = $preflight.admin_policy_exists
        } | ConvertTo-Json -Compress
        throw "Production is not in the audited pre-reconciliation state; no migration was attempted. Safe preflight: $safePreflight"
    }

    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $evidencePath = Join-Path ([System.IO.Path]::GetFullPath($OutputDirectory)) `
        "grant-reconciliation-production-$TargetProjectRef-$timestamp"
    New-Item -ItemType Directory -Path $evidencePath -Force | Out-Null
    $migrationLogPath = Join-Path $evidencePath 'migration.log'
    $repairLogPath = Join-Path $evidencePath 'ledger-repair.log'
    $manifestPath = Join-Path $evidencePath 'manifest.json'

    $migrationOutput = & $psql @connectionArguments `
        --no-psqlrc `
        --single-transaction `
        --variable=ON_ERROR_STOP=1 `
        --file=$migration 2>&1
    $migrationOutput | Set-Content -LiteralPath $migrationLogPath -Encoding utf8
    if ($LASTEXITCODE -ne 0) {
        throw "Production grant reconciliation rolled back: $($migrationOutput -join [Environment]::NewLine)"
    }

    $repairOutput = & $npx --yes "supabase@$cliVersion" `
        --workdir $workspace `
        --output-format json `
        migration repair 0013 `
        --status applied `
        --db-url $dbUrl 2>&1
    $repairOutput | Set-Content -LiteralPath $repairLogPath -Encoding utf8
    if ($LASTEXITCODE -ne 0) {
        throw "Grant changes committed, but the 0013 ledger repair failed; stop and reconcile history: $($repairOutput -join [Environment]::NewLine)"
    }

    $postflightSql = @"
select json_build_object(
  'ledger_rows', (select count(*) from supabase_migrations.schema_migrations),
  'grant_version_rows', (
    select count(*) from supabase_migrations.schema_migrations
    where version = '0013' and name = 'grant_reconciliation'
  ),
  'grant_statement_rows', (
    select coalesce(array_length(statements, 1), 0)
    from supabase_migrations.schema_migrations where version = '0013'
  ),
  'ledger_without_grant_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(m)::text, E'\n' order by version), ''))
    from supabase_migrations.schema_migrations m where version <> '0013'
  ),
  'ledger_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(m)::text, E'\n' order by version), ''))
    from supabase_migrations.schema_migrations m
  ),
  'set_rows', (select count(*) from public.sets),
  'sets_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(s)::text, E'\n' order by id), ''))
    from public.sets s
  ),
  'storage_bucket_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(b)::text, E'\n' order by id), ''))
    from storage.buckets b
  ),
  'storage_object_rows', (select count(*) from storage.objects),
  'storage_object_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(o)::text, E'\n' order by id), ''))
    from storage.objects o
  ),
  'storage_policy_rows', (
    select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
  ),
  'storage_policy_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(p)::text, E'\n' order by policyname), ''))
    from pg_policies p where schemaname = 'storage' and tablename = 'objects'
  ),
  'moderate_set_exists', to_regprocedure('public.moderate_set(uuid,boolean,text)') is not null,
  'moderate_set_security_definer', coalesce((
    select prosecdef from pg_proc where oid = 'public.moderate_set(uuid,boolean,text)'::regprocedure
  ), false),
  'moderate_set_search_path', coalesce((
    select coalesce(array_to_string(proconfig, ','), '') like 'search_path=%'
      and coalesce(array_to_string(proconfig, ','), '') not like '%public%'
    from pg_proc where oid = 'public.moderate_set(uuid,boolean,text)'::regprocedure
  ), false),
  'admin_policy_exists', exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sets' and policyname = 'sets_admin_moderate'
  ),
  'anon_sets_insert', has_table_privilege('anon', 'public.sets', 'INSERT'),
  'authenticated_relation_insert', has_table_privilege('authenticated', 'public.sets', 'INSERT'),
  'authenticated_document_insert', has_column_privilege('authenticated', 'public.sets', 'document', 'INSERT'),
  'authenticated_hidden_update', has_column_privilege('authenticated', 'public.sets', 'hidden', 'UPDATE'),
  'anon_reporter_insert', has_column_privilege('anon', 'public.set_reports', 'reporter_id', 'INSERT'),
  'anon_gallery_update', has_table_privilege('anon', 'public.gallery_characters', 'UPDATE'),
  'authenticated_moderate_execute', has_function_privilege(
    'authenticated', 'public.moderate_set(uuid,boolean,text)', 'EXECUTE'
  ),
  'anon_moderate_execute', has_function_privilege(
    'anon', 'public.moderate_set(uuid,boolean,text)', 'EXECUTE'
  ),
  'authenticated_index_execute', has_function_privilege(
    'authenticated', 'public.index_set_characters()', 'EXECUTE'
  )
)::text;
"@

    $postflightOutput = & $psql @connectionArguments `
        --no-psqlrc --tuples-only --no-align --command $postflightSql 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Production postflight failed after applying 0013: $($postflightOutput -join [Environment]::NewLine)"
    }
    $postflightJson = $postflightOutput | Where-Object { ([string] $_).Trim().StartsWith('{') } | Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($postflightJson)) {
        throw 'Production postflight did not return metadata after applying 0013.'
    }
    $postflight = $postflightJson | ConvertFrom-Json

    if ([int] $postflight.ledger_rows -ne ([int] $preflight.ledger_rows + 1) -or
        [int] $postflight.grant_version_rows -ne 1 -or [int] $postflight.grant_statement_rows -lt 1 -or
        $postflight.ledger_without_grant_fingerprint -ne $preflight.ledger_fingerprint -or
        [int] $postflight.set_rows -ne [int] $preflight.set_rows -or
        $postflight.sets_fingerprint -ne $preflight.sets_fingerprint -or
        $postflight.storage_bucket_fingerprint -ne $preflight.storage_bucket_fingerprint -or
        [int] $postflight.storage_object_rows -ne [int] $preflight.storage_object_rows -or
        $postflight.storage_object_fingerprint -ne $preflight.storage_object_fingerprint -or
        [int] $postflight.storage_policy_rows -ne [int] $preflight.storage_policy_rows -or
        $postflight.storage_policy_fingerprint -ne $preflight.storage_policy_fingerprint -or
        -not $postflight.moderate_set_exists -or -not $postflight.moderate_set_security_definer -or
        -not $postflight.moderate_set_search_path -or $postflight.admin_policy_exists -or
        $postflight.anon_sets_insert -or $postflight.authenticated_relation_insert -or
        -not $postflight.authenticated_document_insert -or $postflight.authenticated_hidden_update -or
        $postflight.anon_reporter_insert -or $postflight.anon_gallery_update -or
        -not $postflight.authenticated_moderate_execute -or $postflight.anon_moderate_execute -or
        $postflight.authenticated_index_execute) {
        throw 'Production postflight did not match the reviewed grant reconciliation. Stop before any further migration.'
    }

    [ordered]@{
        target_project_ref = $TargetProjectRef
        completed_at_utc = [DateTime]::UtcNow.ToString('o')
        supabase_cli_version = $cliVersion
        migration_path = $migration
        migration_version = '0013'
        migration_name = 'grant_reconciliation'
        migration_sha256 = $migrationHash
        migration_single_transaction = $true
        migration_ledger_repaired = $true
        preflight = $preflight
        postflight = $postflight
        migration_log = [System.IO.Path]::GetFileName($migrationLogPath)
        ledger_repair_log = [System.IO.Path]::GetFileName($repairLogPath)
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8

    Write-Host "Production grant reconciliation applied and verified: $evidencePath"
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
