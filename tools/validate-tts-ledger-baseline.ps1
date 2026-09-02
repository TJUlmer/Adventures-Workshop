[CmdletBinding()]
param(
    [string] $MigrationPath = (Join-Path $PSScriptRoot '..\supabase\migrations\0012_tts_assets.sql'),

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
    throw 'Refusing to validate the TTS ledger baseline against the production project.'
}
if ($TargetProjectRef -ne 'jtpifbkqkoitzjfrxhhn' -or $UserName -ne 'postgres.jtpifbkqkoitzjfrxhhn') {
    throw 'This rollback validation is pinned to adventures-workshop-recovery.'
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

    $snapshotSql = @"
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
        and 'public' = any(roles)
        and qual like '%tts-assets%' and with_check is null
    )
    and exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'tts_assets_write' and cmd = 'INSERT'
        and 'authenticated' = any(roles)
        and qual is null and with_check like '%tts-assets%'
        and with_check like '%foldername%' and with_check like '%auth.uid%'
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
        --no-psqlrc --tuples-only --no-align --command $snapshotSql 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Recovery preflight failed: $($preflightOutput -join [Environment]::NewLine)"
    }
    $preflightJson = $preflightOutput | Where-Object { ([string] $_).Trim().StartsWith('{') } | Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($preflightJson)) {
        throw 'Recovery preflight did not return metadata.'
    }
    $preflight = $preflightJson | ConvertFrom-Json
    if (-not $preflight.server_version_num.ToString().StartsWith('17') -or
        [int] $preflight.ledger_rows -ne 42 -or [int] $preflight.baseline_version_rows -ne 0 -or
        [int] $preflight.baseline_name_rows -ne 0 -or [int] $preflight.bucket_rows -ne 1 -or
        -not $preflight.bucket_is_public -or [int] $preflight.policy_rows -ne 4 -or
        [int] $preflight.tts_expression_policy_rows -ne 4 -or -not $preflight.policy_shape_valid) {
        throw 'Recovery project is not in the expected pre-baseline TTS state.'
    }

    # This models `supabase migration repair 0012 --status applied`: it inserts
    # migration history only and deliberately never executes 0012's Storage SQL.
    $baselineSql = @"
insert into supabase_migrations.schema_migrations (version, name, statements)
values (
  '0012',
  'tts_assets',
  array['-- Ledger-only baseline for pre-existing tts-assets objects; migration SHA-256 $migrationHash.']
);
"@

    $insideSql = @"
select json_build_object(
  'stage', 'inside_transaction',
  'ledger_rows', (select count(*) from supabase_migrations.schema_migrations),
  'baseline_version_rows', (
    select count(*) from supabase_migrations.schema_migrations
    where version = '0012' and name = 'tts_assets' and array_length(statements, 1) = 1
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

    $validationOutput = & $psql @connectionArguments `
        --no-psqlrc `
        --variable=ON_ERROR_STOP=1 `
        --tuples-only `
        --no-align `
        --command='BEGIN;' `
        --command=$baselineSql `
        --command=$insideSql `
        --command='ROLLBACK;' `
        --command=$snapshotSql 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "TTS ledger-baseline rollback validation failed: $($validationOutput -join [Environment]::NewLine)"
    }

    $jsonLines = @($validationOutput | Where-Object { ([string] $_).Trim().StartsWith('{') })
    if ($jsonLines.Count -ne 2) {
        throw "Expected two validation records, found $($jsonLines.Count)."
    }
    $inside = $jsonLines[0] | ConvertFrom-Json
    $afterRollback = $jsonLines[1] | ConvertFrom-Json

    if ($inside.stage -ne 'inside_transaction' -or
        [int] $inside.ledger_rows -ne ([int] $preflight.ledger_rows + 1) -or
        [int] $inside.baseline_version_rows -ne 1 -or
        $inside.bucket_fingerprint -ne $preflight.bucket_fingerprint -or
        [int] $inside.object_rows -ne [int] $preflight.object_rows -or
        $inside.object_fingerprint -ne $preflight.object_fingerprint -or
        $inside.policy_fingerprint -ne $preflight.policy_fingerprint) {
        throw 'The in-transaction TTS baseline state did not match the reviewed design.'
    }

    foreach ($property in @(
        'ledger_rows',
        'baseline_version_rows',
        'baseline_name_rows',
        'ledger_fingerprint',
        'bucket_rows',
        'bucket_is_public',
        'bucket_fingerprint',
        'object_rows',
        'object_fingerprint',
        'policy_rows',
        'tts_expression_policy_rows',
        'policy_fingerprint',
        'policy_shape_valid'
    )) {
        if ($afterRollback.$property.ToString() -ne $preflight.$property.ToString()) {
            throw "Recovery state $property did not return to its preflight value after rollback."
        }
    }

    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $evidencePath = Join-Path ([System.IO.Path]::GetFullPath($OutputDirectory)) `
        "tts-ledger-baseline-validation-$TargetProjectRef-$timestamp"
    New-Item -ItemType Directory -Path $evidencePath -Force | Out-Null
    $logPath = Join-Path $evidencePath 'validation.log'
    $manifestPath = Join-Path $evidencePath 'manifest.json'
    $validationOutput | Set-Content -LiteralPath $logPath -Encoding utf8

    [ordered]@{
        target_project_ref = $TargetProjectRef
        completed_at_utc = [DateTime]::UtcNow.ToString('o')
        migration_path = $migration
        migration_version = '0012'
        migration_name = 'tts_assets'
        migration_sha256 = $migrationHash
        operation = 'ledger-only baseline validation'
        migration_sql_executed = $false
        transaction_rolled_back = $true
        preflight = $preflight
        inside_transaction = $inside
        after_rollback = $afterRollback
        validation_log = [System.IO.Path]::GetFileName($logPath)
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8

    Write-Host "TTS ledger baseline validated and rolled back: $evidencePath"
}
finally {
    $env:PGPASSWORD = $previousPassword
    $env:PGSSLMODE = $previousSslMode
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    $password = $null
}
