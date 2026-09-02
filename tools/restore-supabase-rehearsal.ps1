[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $ArchivePath,

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
$expectedArchiveHash = 'D7AF9E2F9BC99540F12B9B831BE6DD400524D6513CEE6B950715FA912079A045'
$archive = [System.IO.Path]::GetFullPath($ArchivePath)

if ($TargetProjectRef -eq $productionProjectRef -or $UserName -match [regex]::Escape($productionProjectRef)) {
    throw 'Refusing to run a restore against the production Supabase project.'
}
if ($TargetProjectRef -ne 'jtpifbkqkoitzjfrxhhn' -or $UserName -ne 'postgres.jtpifbkqkoitzjfrxhhn') {
    throw 'This rehearsal is pinned to the approved adventures-workshop-recovery project.'
}
if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
    throw "Backup archive was not found: $archive"
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expectedArchiveHash) {
    throw 'Backup archive hash does not match the independently verified production backup.'
}

$pgRestore = Join-Path $PostgresBin 'pg_restore.exe'
$psql = Join-Path $PostgresBin 'psql.exe'
foreach ($tool in @($pgRestore, $psql)) {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) {
        throw "Required PostgreSQL client tool was not found: $tool"
    }
}

function Assert-ColumnsPresent {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Table,

        [Parameter(Mandatory = $true)]
        [string[]] $Expected,

        [Parameter(Mandatory = $true)]
        [object[]] $Actual
    )

    $missing = @($Expected | Where-Object { $_ -notin $Actual })
    if ($missing.Count -gt 0) {
        throw "Recovery table $Table is missing source COPY columns: $($missing -join ', ')"
    }
}

function Invoke-PgRestoreFile {
    param(
        [Parameter(Mandatory = $true)]
        [string[]] $Arguments,

        [Parameter(Mandatory = $true)]
        [string] $Description
    )

    $output = & $pgRestore @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed: $($output -join [Environment]::NewLine)"
    }
}

$expectedColumns = @{
    auth_users = @(
        'instance_id', 'id', 'aud', 'role', 'email', 'encrypted_password',
        'email_confirmed_at', 'invited_at', 'confirmation_token', 'confirmation_sent_at',
        'recovery_token', 'recovery_sent_at', 'email_change_token_new', 'email_change',
        'email_change_sent_at', 'last_sign_in_at', 'raw_app_meta_data',
        'raw_user_meta_data', 'is_super_admin', 'created_at', 'updated_at', 'phone',
        'phone_confirmed_at', 'phone_change', 'phone_change_token', 'phone_change_sent_at',
        'email_change_token_current', 'email_change_confirm_status', 'banned_until',
        'reauthentication_token', 'reauthentication_sent_at', 'is_sso_user', 'deleted_at',
        'is_anonymous'
    )
    auth_identities = @(
        'provider_id', 'user_id', 'identity_data', 'provider', 'last_sign_in_at',
        'created_at', 'updated_at', 'id'
    )
    storage_buckets = @(
        'id', 'name', 'owner', 'created_at', 'updated_at', 'public',
        'avif_autodetection', 'file_size_limit', 'allowed_mime_types', 'owner_id', 'type',
        'versioning_status'
    )
    storage_objects = @(
        'id', 'bucket_id', 'name', 'owner', 'created_at', 'updated_at',
        'last_accessed_at', 'metadata', 'version', 'owner_id', 'user_metadata',
        'archived_at', 'is_delete_marker', 'is_versioned'
    )
}

$expectedRows = [ordered]@{
    'auth.identities' = 13
    'auth.users' = 20
    'public.collection_members' = 2
    'public.collection_organizers' = 2
    'public.collections' = 2
    'public.profiles' = 20
    'public.set_characters' = 27
    'public.set_contributions' = 2
    'public.set_reports' = 0
    'public.sets' = 11
    'storage.buckets' = 2
    'storage.objects' = 332
    'supabase_migrations.schema_migrations' = 42
}

$password = Read-Host 'Recovery-project database password' -AsSecureString
$passwordPointer = [IntPtr]::Zero
$previousPassword = $env:PGPASSWORD
$previousSslMode = $env:PGSSLMODE
$workPath = $null

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
  'public_objects', (
    select count(*) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
  ),
  'auth_users', (select count(*) from auth.users),
  'auth_identities', (select count(*) from auth.identities),
  'storage_buckets', (select count(*) from storage.buckets),
  'storage_objects', (select count(*) from storage.objects),
  'migration_schema', to_regnamespace('supabase_migrations')::text,
  'migration_table', to_regclass('supabase_migrations.schema_migrations')::text,
  'extensions', (select json_agg(extname order by extname) from pg_extension),
  'auth_users_columns', (
    select json_agg(column_name order by ordinal_position)
    from information_schema.columns where table_schema = 'auth' and table_name = 'users'
  ),
  'auth_identities_columns', (
    select json_agg(column_name order by ordinal_position)
    from information_schema.columns where table_schema = 'auth' and table_name = 'identities'
  ),
  'storage_buckets_columns', (
    select json_agg(column_name order by ordinal_position)
    from information_schema.columns where table_schema = 'storage' and table_name = 'buckets'
  ),
  'storage_objects_columns', (
    select json_agg(column_name order by ordinal_position)
    from information_schema.columns where table_schema = 'storage' and table_name = 'objects'
  )
)::text;
"@
    $preflightOutput = & $psql @connectionArguments --no-psqlrc --tuples-only --no-align --command $preflightSql 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Recovery preflight failed: $($preflightOutput -join [Environment]::NewLine)"
    }
    $preflightJson = $preflightOutput | Where-Object { ([string] $_).Trim().StartsWith('{') } | Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($preflightJson)) {
        throw 'Recovery preflight did not return database metadata.'
    }
    $preflight = $preflightJson | ConvertFrom-Json

    if (-not $preflight.server_version_num.ToString().StartsWith('17')) {
        throw "Recovery database is not PostgreSQL 17: $($preflight.server_version)"
    }
    $migrationTableExists = $preflight.migration_table -eq 'supabase_migrations.schema_migrations'
    $migrationSchemaExists = $preflight.migration_schema -eq 'supabase_migrations'
    $migrationRows = 0
    if ($migrationTableExists) {
        $migrationCountOutput = & $psql @connectionArguments `
            --no-psqlrc --tuples-only --no-align `
            --command 'select count(*) from supabase_migrations.schema_migrations;' 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Could not inspect the recovery migration ledger: $($migrationCountOutput -join [Environment]::NewLine)"
        }
        $migrationRows = [int] (($migrationCountOutput | Select-Object -Last 1).ToString().Trim())
    }

    if ([int] $preflight.public_objects -ne 0 -or [int] $preflight.auth_users -ne 0 -or
        [int] $preflight.auth_identities -ne 0 -or [int] $preflight.storage_buckets -ne 0 -or
        [int] $preflight.storage_objects -ne 0 -or $migrationRows -ne 0) {
        throw 'Recovery project is not empty. Refusing to overwrite or merge existing data.'
    }
    foreach ($extension in @('pgcrypto', 'uuid-ossp')) {
        if ($extension -notin $preflight.extensions) {
            throw "Recovery project is missing required extension: $extension"
        }
    }

    Assert-ColumnsPresent -Table 'auth.users' -Expected $expectedColumns.auth_users -Actual $preflight.auth_users_columns
    Assert-ColumnsPresent -Table 'auth.identities' -Expected $expectedColumns.auth_identities -Actual $preflight.auth_identities_columns
    Assert-ColumnsPresent -Table 'storage.buckets' -Expected $expectedColumns.storage_buckets -Actual $preflight.storage_buckets_columns
    Assert-ColumnsPresent -Table 'storage.objects' -Expected $expectedColumns.storage_objects -Actual $preflight.storage_objects_columns

    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $archiveDirectory = Split-Path -Parent $archive
    $rehearsalPath = Join-Path $archiveDirectory "restore-rehearsal-$TargetProjectRef-$timestamp"
    $workPath = Join-Path $rehearsalPath 'private-work'
    New-Item -ItemType Directory -Path $workPath -Force | Out-Null

    $publicList = Join-Path $workPath 'public.list'
    $publicSql = Join-Path $workPath 'public.sql'
    $authSql = Join-Path $workPath 'auth-data.sql'
    $storageSql = Join-Path $workPath 'storage-data.sql'
    $migrationList = Join-Path $workPath 'migration-ledger.list'
    $migrationSql = Join-Path $workPath 'migration-data.sql'
    $policyList = Join-Path $workPath 'storage-policies.list'
    $policySql = Join-Path $workPath 'storage-policies.sql'
    $restoreLog = Join-Path $rehearsalPath 'restore.log'
    $manifestPath = Join-Path $rehearsalPath 'manifest.json'

    $selectedPublic = & $pgRestore --schema=public --list $archive 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not construct the public-schema archive list.'
    }
    $selectedPublic | ForEach-Object {
        if ($_ -match ' SCHEMA - public ') { ";$_" } else { $_ }
    } | Set-Content -LiteralPath $publicList -Encoding utf8

    $allEntries = & $pgRestore --list $archive 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not read the archive table of contents.'
    }
    $allEntries | ForEach-Object {
        if ($_.StartsWith(';') -or $_ -match ' POLICY storage objects (set_assets|tts_assets)_') {
            $_
        }
        else {
            ";$_"
        }
    } | Set-Content -LiteralPath $policyList -Encoding utf8

    Invoke-PgRestoreFile -Description 'Public schema/data SQL generation' -Arguments @(
        "--use-list=$publicList", '--no-owner', '--no-privileges', "--file=$publicSql", $archive
    )
    Invoke-PgRestoreFile -Description 'Auth data SQL generation' -Arguments @(
        '--data-only', '--schema=auth', '--table=users', '--table=identities',
        '--no-owner', '--no-privileges', "--file=$authSql", $archive
    )
    Invoke-PgRestoreFile -Description 'Storage metadata SQL generation' -Arguments @(
        '--data-only', '--schema=storage', '--table=buckets', '--table=objects',
        '--no-owner', '--no-privileges', "--file=$storageSql", $archive
    )
    if ($migrationTableExists) {
        Invoke-PgRestoreFile -Description 'Migration-ledger data SQL generation' -Arguments @(
            '--data-only', '--schema=supabase_migrations', '--table=schema_migrations',
            '--no-owner', '--no-privileges', "--file=$migrationSql", $archive
        )
    }
    else {
        $migrationObjectEntries = @($allEntries | Where-Object {
            $_ -match ' SCHEMA - supabase_migrations ' -or
            $_ -match ' (TABLE|TABLE DATA|CONSTRAINT) supabase_migrations schema_migrations '
        })
        if ($migrationObjectEntries.Count -ne 5) {
            throw "Expected 5 migration-ledger archive entries, found $($migrationObjectEntries.Count)."
        }
        $allEntries | ForEach-Object {
            if ($_.StartsWith(';')) {
                $_
            }
            elseif ($migrationSchemaExists -and $_ -match ' SCHEMA - supabase_migrations ') {
                ";$_"
            }
            elseif ($_ -match ' SCHEMA - supabase_migrations ' -or
                $_ -match ' (TABLE|TABLE DATA|CONSTRAINT) supabase_migrations schema_migrations ') {
                $_
            }
            else {
                ";$_"
            }
        } | Set-Content -LiteralPath $migrationList -Encoding utf8
        Invoke-PgRestoreFile -Description 'Migration-ledger definition/data SQL generation' -Arguments @(
            "--use-list=$migrationList", '--no-owner', '--no-privileges', "--file=$migrationSql", $archive
        )
    }
    Invoke-PgRestoreFile -Description 'Storage-policy SQL generation' -Arguments @(
        "--use-list=$policyList", '--no-owner', '--no-privileges', "--file=$policySql", $archive
    )

    Write-Host "Restoring into isolated recovery project $TargetProjectRef"
    & $psql @connectionArguments `
        --no-psqlrc `
        --single-transaction `
        --variable=ON_ERROR_STOP=1 `
        --command='SET session_replication_role = replica;' `
        --file=$authSql `
        --file=$publicSql `
        --file=$storageSql `
        --file=$migrationSql `
        --file=$policySql 2>&1 | Tee-Object -FilePath $restoreLog
    if ($LASTEXITCODE -ne 0) {
        throw 'Recovery restore failed. PostgreSQL rolled the single transaction back.'
    }

    $verificationSql = @"
select json_build_object(
  'auth.identities', (select count(*) from auth.identities),
  'auth.users', (select count(*) from auth.users),
  'public.collection_members', (select count(*) from public.collection_members),
  'public.collection_organizers', (select count(*) from public.collection_organizers),
  'public.collections', (select count(*) from public.collections),
  'public.profiles', (select count(*) from public.profiles),
  'public.set_characters', (select count(*) from public.set_characters),
  'public.set_contributions', (select count(*) from public.set_contributions),
  'public.set_reports', (select count(*) from public.set_reports),
  'public.sets', (select count(*) from public.sets),
  'storage.buckets', (select count(*) from storage.buckets),
  'storage.objects', (select count(*) from storage.objects),
  'supabase_migrations.schema_migrations', (select count(*) from supabase_migrations.schema_migrations),
  'public_policies', (select count(*) from pg_policies where schemaname = 'public'),
  'public_triggers', (
    select count(*) from information_schema.triggers where trigger_schema = 'public'
  ),
  'public_functions', (
    select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  ),
  'storage_custom_policies', (
    select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (policyname like 'set_assets_%' or policyname like 'tts_assets_%')
  )
)::text;
"@
    $verificationOutput = & $psql @connectionArguments --no-psqlrc --tuples-only --no-align --command $verificationSql 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Recovery verification query failed: $($verificationOutput -join [Environment]::NewLine)"
    }
    $verificationJson = $verificationOutput | Where-Object { ([string] $_).Trim().StartsWith('{') } | Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($verificationJson)) {
        throw 'Recovery verification did not return database metadata.'
    }
    $verification = $verificationJson | ConvertFrom-Json

    foreach ($entry in $expectedRows.GetEnumerator()) {
        if ([int] $verification.($entry.Key) -ne [int] $entry.Value) {
            throw "Recovery row-count mismatch for $($entry.Key): expected $($entry.Value), found $($verification.($entry.Key))"
        }
    }
    if ([int] $verification.storage_custom_policies -ne 8) {
        throw "Expected 8 custom Storage policies, found $($verification.storage_custom_policies)."
    }

    $manifest = [ordered]@{
        source_project_ref = $productionProjectRef
        target_project_ref = $TargetProjectRef
        completed_at_utc = [DateTime]::UtcNow.ToString('o')
        archive_path = $archive
        archive_sha256 = $expectedArchiveHash
        target_server_version = $preflight.server_version
        target_was_empty = $true
        single_transaction_restore = $true
        managed_schema_definitions_restored = $false
        migration_ledger_definition_restored = -not $migrationTableExists
        auth_tables_restored = @('auth.users', 'auth.identities')
        storage_metadata_restored = @('storage.buckets', 'storage.objects')
        storage_object_bytes_restored = $false
        vault_secrets_restored = $false
        row_counts = $expectedRows
        public_policy_count = [int] $verification.public_policies
        public_trigger_count = [int] $verification.public_triggers
        public_function_count = [int] $verification.public_functions
        storage_custom_policy_count = [int] $verification.storage_custom_policies
        restore_log = [System.IO.Path]::GetFileName($restoreLog)
    }
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8

    Write-Warning 'Storage object bytes and Vault secrets were intentionally not restored.'
    Write-Warning 'The source archive omits ownership and privileges; grants require separate catalogue verification.'
    Write-Host "Restore rehearsal complete: $rehearsalPath"
}
finally {
    $env:PGPASSWORD = $previousPassword
    $env:PGSSLMODE = $previousSslMode
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    $password = $null

    if ($null -ne $workPath -and (Test-Path -LiteralPath $workPath)) {
        $resolvedWork = [System.IO.Path]::GetFullPath($workPath)
        $resolvedArchiveDirectory = [System.IO.Path]::GetFullPath((Split-Path -Parent $archive))
        $archivePrefix = $resolvedArchiveDirectory.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
        if ($resolvedWork.StartsWith($archivePrefix, [System.StringComparison]::OrdinalIgnoreCase) -and
            (Split-Path -Leaf $resolvedWork) -eq 'private-work') {
            Remove-Item -LiteralPath $resolvedWork -Recurse -Force
        }
    }
}
