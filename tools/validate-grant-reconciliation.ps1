[CmdletBinding()]
param(
    [string] $MigrationPath = (Join-Path $PSScriptRoot '..\supabase\migrations\0013_grant_reconciliation.sql'),

    [string] $OutputDirectory = 'G:\Unmatched Labs Backups\supabase-kyqcvbnxfmpnbwtikzxp-20260831T211858Z',

    [string] $PostgresBin = "$env:LOCALAPPDATA\UnmatchedLabs\PostgreSQL\17.11\pgsql\bin",

    [string] $HostName = 'aws-0-us-east-1.pooler.supabase.com',

    [int] $Port = 5432,

    [string] $Database = 'postgres',

    [string] $TargetProjectRef = 'jtpifbkqkoitzjfrxhhn',

    [string] $UserName = 'postgres.jtpifbkqkoitzjfrxhhn'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$productionProjectRef = 'kyqcvbnxfmpnbwtikzxp'
if ($TargetProjectRef -eq $productionProjectRef -or $UserName -match [regex]::Escape($productionProjectRef)) {
    throw 'Refusing to validate the migration against the production project.'
}
if ($TargetProjectRef -ne 'jtpifbkqkoitzjfrxhhn' -or $UserName -ne 'postgres.jtpifbkqkoitzjfrxhhn') {
    throw 'This rollback validation is pinned to adventures-workshop-recovery.'
}

$migration = [System.IO.Path]::GetFullPath($MigrationPath)
if (-not (Test-Path -LiteralPath $migration -PathType Leaf)) {
    throw "Grant-reconciliation migration not found: $migration"
}
$migrationText = Get-Content -LiteralPath $migration -Raw
if ($migrationText -match '(?im)^\s*(begin|commit|rollback)\s*;') {
    throw 'The migration must not control its own transaction during rollback validation.'
}

$psql = Join-Path $PostgresBin 'psql.exe'
if (-not (Test-Path -LiteralPath $psql -PathType Leaf)) {
    throw "Required PostgreSQL client tool was not found: $psql"
}

$password = Read-Host 'Recovery-project database password' -AsSecureString
$passwordPointer = [IntPtr]::Zero
$previousPassword = $env:PGPASSWORD
$previousSslMode = $env:PGSSLMODE

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
  'server_version_num', current_setting('server_version_num'),
  'set_rows', (select count(*) from public.sets),
  'moderate_set_exists', to_regprocedure('public.moderate_set(uuid,boolean,text)') is not null,
  'admin_policy_exists', exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sets' and policyname = 'sets_admin_moderate'
  ),
  'anon_sets_insert', has_table_privilege('anon', 'public.sets', 'INSERT'),
  'authenticated_hidden_update', has_column_privilege('authenticated', 'public.sets', 'hidden', 'UPDATE'),
  'anon_gallery_update', has_table_privilege('anon', 'public.gallery_characters', 'UPDATE'),
  'authenticated_index_execute', has_function_privilege(
    'authenticated', 'public.index_set_characters()', 'EXECUTE'
  )
)::text;
"@
    $preflightOutput = & $psql @connectionArguments `
        --no-psqlrc --tuples-only --no-align --command $preflightSql 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Recovery preflight failed: $($preflightOutput -join [Environment]::NewLine)"
    }
    $preflightJson = $preflightOutput | Where-Object { ([string] $_).Trim().StartsWith('{') } | Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($preflightJson)) {
        throw 'Recovery preflight did not return metadata.'
    }
    $preflight = $preflightJson | ConvertFrom-Json
    if (-not $preflight.server_version_num.ToString().StartsWith('17') -or
        [int] $preflight.set_rows -ne 11 -or $preflight.moderate_set_exists -or
        -not $preflight.admin_policy_exists) {
        throw 'Recovery project is not in the expected pre-reconciliation state.'
    }

    $insideSql = @"
select json_build_object(
  'stage', 'inside_transaction',
  'set_rows', (select count(*) from public.sets),
  'moderate_set_exists', to_regprocedure('public.moderate_set(uuid,boolean,text)') is not null,
  'admin_policy_exists', exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sets' and policyname = 'sets_admin_moderate'
  ),
  'anon_sets_insert', has_table_privilege('anon', 'public.sets', 'INSERT'),
  'authenticated_relation_insert', has_table_privilege('authenticated', 'public.sets', 'INSERT'),
  'authenticated_document_insert', has_column_privilege('authenticated', 'public.sets', 'document', 'INSERT'),
  'authenticated_hidden_update', has_column_privilege('authenticated', 'public.sets', 'hidden', 'UPDATE'),
  'anon_gallery_update', has_table_privilege('anon', 'public.gallery_characters', 'UPDATE'),
  'authenticated_index_execute', has_function_privilege(
    'authenticated', 'public.index_set_characters()', 'EXECUTE'
  ),
  'anon_reporter_insert', has_column_privilege('anon', 'public.set_reports', 'reporter_id', 'INSERT')
)::text;
"@

    $afterRollbackSql = @"
select json_build_object(
  'stage', 'after_rollback',
  'set_rows', (select count(*) from public.sets),
  'moderate_set_exists', to_regprocedure('public.moderate_set(uuid,boolean,text)') is not null,
  'admin_policy_exists', exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sets' and policyname = 'sets_admin_moderate'
  ),
  'anon_sets_insert', has_table_privilege('anon', 'public.sets', 'INSERT'),
  'authenticated_hidden_update', has_column_privilege('authenticated', 'public.sets', 'hidden', 'UPDATE'),
  'anon_gallery_update', has_table_privilege('anon', 'public.gallery_characters', 'UPDATE'),
  'authenticated_index_execute', has_function_privilege(
    'authenticated', 'public.index_set_characters()', 'EXECUTE'
  )
)::text;
"@

    $validationOutput = & $psql @connectionArguments `
        --no-psqlrc `
        --variable=ON_ERROR_STOP=1 `
        --command='BEGIN;' `
        --file=$migration `
        --command=$insideSql `
        --command='ROLLBACK;' `
        --command=$afterRollbackSql 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Grant-reconciliation rollback validation failed: $($validationOutput -join [Environment]::NewLine)"
    }

    $jsonLines = @($validationOutput | Where-Object { ([string] $_).Trim().StartsWith('{') })
    if ($jsonLines.Count -ne 2) {
        throw "Expected two validation records, found $($jsonLines.Count)."
    }
    $inside = $jsonLines[0] | ConvertFrom-Json
    $afterRollback = $jsonLines[1] | ConvertFrom-Json

    if ($inside.stage -ne 'inside_transaction' -or [int] $inside.set_rows -ne 11 -or
        -not $inside.moderate_set_exists -or $inside.admin_policy_exists -or
        $inside.anon_sets_insert -or $inside.authenticated_relation_insert -or
        -not $inside.authenticated_document_insert -or $inside.authenticated_hidden_update -or
        $inside.anon_gallery_update -or $inside.authenticated_index_execute -or
        $inside.anon_reporter_insert) {
        throw 'The in-transaction privilege state did not match the reviewed design.'
    }

    if ($afterRollback.stage -ne 'after_rollback' -or [int] $afterRollback.set_rows -ne 11 -or
        $afterRollback.moderate_set_exists -or -not $afterRollback.admin_policy_exists) {
        throw 'Recovery privileges did not return to their original state after rollback.'
    }
    foreach ($property in @(
        'anon_sets_insert',
        'authenticated_hidden_update',
        'anon_gallery_update',
        'authenticated_index_execute'
    )) {
        if ([bool] $afterRollback.$property -ne [bool] $preflight.$property) {
            throw "Recovery privilege $property did not return to its preflight value after rollback."
        }
    }

    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $evidencePath = Join-Path ([System.IO.Path]::GetFullPath($OutputDirectory)) `
        "grant-reconciliation-validation-$TargetProjectRef-$timestamp"
    New-Item -ItemType Directory -Path $evidencePath -Force | Out-Null
    $logPath = Join-Path $evidencePath 'validation.log'
    $manifestPath = Join-Path $evidencePath 'manifest.json'
    $validationOutput | Set-Content -LiteralPath $logPath -Encoding utf8

    [ordered]@{
        target_project_ref = $TargetProjectRef
        completed_at_utc = [DateTime]::UtcNow.ToString('o')
        migration_path = $migration
        migration_sha256 = (Get-FileHash -LiteralPath $migration -Algorithm SHA256).Hash
        transaction_rolled_back = $true
        source_rows_preserved = [int] $afterRollback.set_rows
        preflight = $preflight
        inside_transaction = $inside
        after_rollback = $afterRollback
        validation_log = [System.IO.Path]::GetFileName($logPath)
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8

    Write-Host "Grant reconciliation validated and rolled back: $evidencePath"
}
finally {
    $env:PGPASSWORD = $previousPassword
    $env:PGSSLMODE = $previousSslMode
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    $password = $null
}
