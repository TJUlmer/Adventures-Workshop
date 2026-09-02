[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [switch] $Apply,

    [string] $MigrationPath = (Join-Path $PSScriptRoot '..\supabase\migrations\0014_set_drafts.sql'),

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
    throw 'The production draft migration requires the explicit -Apply switch.'
}
if ($TargetProjectRef -ne 'kyqcvbnxfmpnbwtikzxp' -or $UserName -ne 'postgres.kyqcvbnxfmpnbwtikzxp') {
    throw 'This script is pinned to the audited Unmatched Labs production project.'
}

$migration = [System.IO.Path]::GetFullPath($MigrationPath)
if (-not (Test-Path -LiteralPath $migration -PathType Leaf)) {
    throw "Draft migration not found: $migration"
}
$migrationText = Get-Content -LiteralPath $migration -Raw
if ($migrationText -match '(?im)^\s*(begin|commit|rollback)\s*;') {
    throw 'The migration must not control its own transaction.'
}
$expectedMigrationHash = 'C22C14D013433A0FBEBE1FB868BE485C6AEB62C7255AAEA25DDC8C3956B99440'
$migrationHash = (Get-FileHash -LiteralPath $migration -Algorithm SHA256).Hash
if ($migrationHash -ne $expectedMigrationHash) {
    throw "The validated draft migration changed. Expected SHA-256 $expectedMigrationHash, found $migrationHash."
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

$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath $outputRoot -PathType Container)) {
    throw "Evidence directory does not exist: $outputRoot"
}

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

    $preflightSql = @'
select json_build_object(
  'server_version_num', current_setting('server_version_num'),
  'ledger_rows', (select count(*) from supabase_migrations.schema_migrations),
  'tts_version_rows', (
    select count(*) from supabase_migrations.schema_migrations
    where version = '0012' and name = 'tts_assets'
  ),
  'grant_version_rows', (
    select count(*) from supabase_migrations.schema_migrations
    where version = '0013' and name = 'grant_reconciliation'
  ),
  'draft_version_rows', (
    select count(*) from supabase_migrations.schema_migrations where version = '0014'
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
  'storage_bucket_rows', (select count(*) from storage.buckets),
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
  'set_drafts_exists', to_regclass('public.set_drafts') is not null,
  'draft_bucket_exists', exists (select 1 from storage.buckets where id = 'draft-assets'),
  'save_rpc_exists', to_regprocedure(
    'public.save_set_draft(text,text,text,text,integer,integer,jsonb,integer,integer,integer,text,bigint,text,timestamptz,integer,jsonb,bigint)'
  ) is not null,
  'moderate_set_exists', to_regprocedure('public.moderate_set(uuid,boolean,text)') is not null,
  'admin_policy_exists', exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sets' and policyname = 'sets_admin_moderate'
  )
)::text;
'@

    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $preflightOutput = & $psql @connectionArguments `
            --no-psqlrc --tuples-only --no-align --command $preflightSql 2>&1
        $preflightExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
    if ($preflightExitCode -ne 0) {
        throw "Production preflight failed: $($preflightOutput -join [Environment]::NewLine)"
    }
    $preflightJson = $preflightOutput | Where-Object { ([string] $_).Trim().StartsWith('{') } | Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($preflightJson)) {
        throw 'Production preflight did not return metadata.'
    }
    $preflight = $preflightJson | ConvertFrom-Json

    if (-not $preflight.server_version_num.ToString().StartsWith('17') -or
        [int] $preflight.ledger_rows -lt 44 -or [int] $preflight.tts_version_rows -ne 1 -or
        [int] $preflight.grant_version_rows -ne 1 -or [int] $preflight.draft_version_rows -ne 0 -or
        [int] $preflight.set_rows -lt 11 -or [int] $preflight.storage_bucket_rows -ne 2 -or
        [int] $preflight.storage_policy_rows -ne 8 -or $preflight.set_drafts_exists -or
        $preflight.draft_bucket_exists -or $preflight.save_rpc_exists -or
        -not $preflight.moderate_set_exists -or $preflight.admin_policy_exists) {
        $safePreflight = [ordered]@{
            server_version_num = $preflight.server_version_num
            ledger_rows = $preflight.ledger_rows
            tts_version_rows = $preflight.tts_version_rows
            grant_version_rows = $preflight.grant_version_rows
            draft_version_rows = $preflight.draft_version_rows
            set_rows = $preflight.set_rows
            storage_bucket_rows = $preflight.storage_bucket_rows
            storage_policy_rows = $preflight.storage_policy_rows
            set_drafts_exists = $preflight.set_drafts_exists
            draft_bucket_exists = $preflight.draft_bucket_exists
            save_rpc_exists = $preflight.save_rpc_exists
            moderate_set_exists = $preflight.moderate_set_exists
            admin_policy_exists = $preflight.admin_policy_exists
        } | ConvertTo-Json -Compress
        throw "Production is not in the audited pre-draft state; no migration was attempted. Safe preflight: $safePreflight"
    }

    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $evidencePath = Join-Path $outputRoot "set-drafts-production-$TargetProjectRef-$timestamp"
    New-Item -ItemType Directory -Path $evidencePath -Force | Out-Null
    $migrationLogPath = Join-Path $evidencePath 'migration.log'
    $repairLogPath = Join-Path $evidencePath 'ledger-repair.log'
    $manifestPath = Join-Path $evidencePath 'manifest.json'

    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $migrationOutput = & $psql @connectionArguments `
            --no-psqlrc `
            --single-transaction `
            --variable=ON_ERROR_STOP=1 `
            --file=$migration 2>&1
        $migrationExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
    $migrationOutput | Set-Content -LiteralPath $migrationLogPath -Encoding utf8
    if ($migrationExitCode -ne 0) {
        throw "Production draft migration rolled back: $($migrationOutput -join [Environment]::NewLine)"
    }

    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $repairOutput = & $npx --yes "supabase@$cliVersion" `
            --workdir $workspace `
            --output-format json `
            migration repair 0014 `
            --status applied `
            --db-url $dbUrl 2>&1
        $repairExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
    $repairOutput | Set-Content -LiteralPath $repairLogPath -Encoding utf8
    if ($repairExitCode -ne 0) {
        throw "Draft schema committed, but the 0014 ledger repair failed; stop and reconcile history: $($repairOutput -join [Environment]::NewLine)"
    }

    $postflightSql = @'
select json_build_object(
  'ledger_rows', (select count(*) from supabase_migrations.schema_migrations),
  'draft_version_rows', (
    select count(*) from supabase_migrations.schema_migrations
    where version = '0014' and name = 'set_drafts'
  ),
  'draft_statement_rows', (
    select coalesce(array_length(statements, 1), 0)
    from supabase_migrations.schema_migrations where version = '0014'
  ),
  'ledger_without_draft_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(m)::text, E'\n' order by version), ''))
    from supabase_migrations.schema_migrations m where version <> '0014'
  ),
  'set_rows', (select count(*) from public.sets),
  'sets_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(s)::text, E'\n' order by id), ''))
    from public.sets s
  ),
  'storage_bucket_rows', (select count(*) from storage.buckets),
  'existing_bucket_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(b)::text, E'\n' order by id), ''))
    from storage.buckets b where id <> 'draft-assets'
  ),
  'draft_bucket_private', coalesce((
    select not public from storage.buckets where id = 'draft-assets'
  ), false),
  'storage_object_rows', (select count(*) from storage.objects),
  'storage_object_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(o)::text, E'\n' order by id), ''))
    from storage.objects o
  ),
  'storage_policy_rows', (
    select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
  ),
  'existing_storage_policy_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(p)::text, E'\n' order by policyname), ''))
    from pg_policies p
    where schemaname = 'storage' and tablename = 'objects'
      and policyname not like 'draft_assets_%'
  ),
  'draft_asset_policy_rows', (
    select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('draft_assets_read', 'draft_assets_write', 'draft_assets_update', 'draft_assets_delete')
      and roles = '{authenticated}'::name[]
  ),
  'set_drafts_exists', to_regclass('public.set_drafts') is not null,
  'draft_rows', (select count(*) from public.set_drafts),
  'draft_read_policy_rows', (
    select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'set_drafts'
      and policyname = 'set_drafts_owner_read' and roles = '{authenticated}'::name[]
  ),
  'draft_active_index_exists', to_regclass('public.set_drafts_owner_active_idx') is not null,
  'draft_deleted_index_exists', to_regclass('public.set_drafts_owner_deleted_idx') is not null,
  'anon_draft_select', has_table_privilege('anon', 'public.set_drafts', 'SELECT'),
  'authenticated_draft_select', has_table_privilege('authenticated', 'public.set_drafts', 'SELECT'),
  'authenticated_draft_insert', has_table_privilege('authenticated', 'public.set_drafts', 'INSERT'),
  'authenticated_draft_update', has_table_privilege('authenticated', 'public.set_drafts', 'UPDATE'),
  'authenticated_draft_delete', has_table_privilege('authenticated', 'public.set_drafts', 'DELETE'),
  'save_rpc_exists', to_regprocedure(
    'public.save_set_draft(text,text,text,text,integer,integer,jsonb,integer,integer,integer,text,bigint,text,timestamptz,integer,jsonb,bigint)'
  ) is not null,
  'soft_delete_rpc_exists', to_regprocedure('public.soft_delete_set_draft(text,bigint)') is not null,
  'restore_rpc_exists', to_regprocedure('public.restore_set_draft(text,bigint)') is not null,
  'purge_rpc_exists', to_regprocedure('public.purge_set_draft(text,bigint)') is not null,
  'anon_save_execute', has_function_privilege(
    'anon',
    'public.save_set_draft(text,text,text,text,integer,integer,jsonb,integer,integer,integer,text,bigint,text,timestamptz,integer,jsonb,bigint)',
    'EXECUTE'
  ),
  'authenticated_save_execute', has_function_privilege(
    'authenticated',
    'public.save_set_draft(text,text,text,text,integer,integer,jsonb,integer,integer,integer,text,bigint,text,timestamptz,integer,jsonb,bigint)',
    'EXECUTE'
  ),
  'all_rpcs_security_definer_closed_path', not exists (
    select 1
    from pg_proc
    where oid in (
      'public.save_set_draft(text,text,text,text,integer,integer,jsonb,integer,integer,integer,text,bigint,text,timestamptz,integer,jsonb,bigint)'::regprocedure,
      'public.soft_delete_set_draft(text,bigint)'::regprocedure,
      'public.restore_set_draft(text,bigint)'::regprocedure,
      'public.purge_set_draft(text,bigint)'::regprocedure
    )
      and (
        not prosecdef
        or coalesce(array_to_string(proconfig, ','), '') not like 'search_path=%'
        or coalesce(array_to_string(proconfig, ','), '') like '%public%'
      )
  )
)::text;
'@

    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $postflightOutput = & $psql @connectionArguments `
            --no-psqlrc --tuples-only --no-align --command $postflightSql 2>&1
        $postflightExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
    if ($postflightExitCode -ne 0) {
        throw "Production postflight failed after applying 0014: $($postflightOutput -join [Environment]::NewLine)"
    }
    $postflightJson = $postflightOutput | Where-Object { ([string] $_).Trim().StartsWith('{') } | Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($postflightJson)) {
        throw 'Production postflight did not return metadata after applying 0014.'
    }
    $postflight = $postflightJson | ConvertFrom-Json

    if ([int] $postflight.ledger_rows -ne ([int] $preflight.ledger_rows + 1) -or
        [int] $postflight.draft_version_rows -ne 1 -or [int] $postflight.draft_statement_rows -lt 1 -or
        $postflight.ledger_without_draft_fingerprint -ne $preflight.ledger_fingerprint -or
        [int] $postflight.set_rows -ne [int] $preflight.set_rows -or
        $postflight.sets_fingerprint -ne $preflight.sets_fingerprint -or
        [int] $postflight.storage_bucket_rows -ne ([int] $preflight.storage_bucket_rows + 1) -or
        $postflight.existing_bucket_fingerprint -ne $preflight.storage_bucket_fingerprint -or
        -not $postflight.draft_bucket_private -or
        [int] $postflight.storage_object_rows -ne [int] $preflight.storage_object_rows -or
        $postflight.storage_object_fingerprint -ne $preflight.storage_object_fingerprint -or
        [int] $postflight.storage_policy_rows -ne ([int] $preflight.storage_policy_rows + 4) -or
        $postflight.existing_storage_policy_fingerprint -ne $preflight.storage_policy_fingerprint -or
        [int] $postflight.draft_asset_policy_rows -ne 4 -or -not $postflight.set_drafts_exists -or
        [int] $postflight.draft_rows -ne 0 -or [int] $postflight.draft_read_policy_rows -ne 1 -or
        -not $postflight.draft_active_index_exists -or -not $postflight.draft_deleted_index_exists -or
        $postflight.anon_draft_select -or -not $postflight.authenticated_draft_select -or
        $postflight.authenticated_draft_insert -or $postflight.authenticated_draft_update -or
        $postflight.authenticated_draft_delete -or -not $postflight.save_rpc_exists -or
        -not $postflight.soft_delete_rpc_exists -or -not $postflight.restore_rpc_exists -or
        -not $postflight.purge_rpc_exists -or $postflight.anon_save_execute -or
        -not $postflight.authenticated_save_execute -or
        -not $postflight.all_rpcs_security_definer_closed_path) {
        throw 'Production postflight did not match the validated private-draft contract. Stop before client rollout.'
    }

    [ordered]@{
        target_project_ref = $TargetProjectRef
        completed_at_utc = [DateTime]::UtcNow.ToString('o')
        supabase_cli_version = $cliVersion
        migration_path = $migration
        migration_version = '0014'
        migration_name = 'set_drafts'
        migration_sha256 = $migrationHash
        migration_single_transaction = $true
        migration_ledger_repaired = $true
        preflight = $preflight
        postflight = $postflight
        storage_http_attacks_pending = $true
        migration_log = [System.IO.Path]::GetFileName($migrationLogPath)
        ledger_repair_log = [System.IO.Path]::GetFileName($repairLogPath)
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8

    Write-Host "Production draft backend applied and verified: $evidencePath"
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
