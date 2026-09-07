[CmdletBinding()]
param(
    [string] $OutputDirectory = 'G:\Unmatched Labs Backups\supabase-kyqcvbnxfmpnbwtikzxp-20260831T211858Z',

    [string] $PostgresBin = "$env:LOCALAPPDATA\UnmatchedLabs\PostgreSQL\17.11\pgsql\bin",

    [string] $HostName = 'aws-0-us-east-1.pooler.supabase.com',

    [int] $Port = 5432,

    [string] $Database = 'postgres',

    [string] $ProjectRef = 'kyqcvbnxfmpnbwtikzxp',

    [string] $UserName = 'postgres.kyqcvbnxfmpnbwtikzxp'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$productionProjectRef = 'kyqcvbnxfmpnbwtikzxp'
if ($ProjectRef -ne $productionProjectRef -or $UserName -ne "postgres.$productionProjectRef") {
    throw 'This read-only audit is pinned to the production Supabase project.'
}

$psql = Join-Path $PostgresBin 'psql.exe'
if (-not (Test-Path -LiteralPath $psql -PathType Leaf)) {
    throw "Required PostgreSQL client tool was not found: $psql"
}

$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
$password = Read-Host 'Production-project database password' -AsSecureString
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

    $auditSql = @"
with
target_roles(role_name) as (
  values ('anon'::text), ('authenticated'::text), ('service_role'::text)
),
table_privileges(privilege_name) as (
  values ('SELECT'::text), ('INSERT'::text), ('UPDATE'::text), ('DELETE'::text),
         ('TRUNCATE'::text), ('REFERENCES'::text), ('TRIGGER'::text)
),
column_privileges(privilege_name) as (
  values ('SELECT'::text), ('INSERT'::text), ('UPDATE'::text), ('REFERENCES'::text)
),
sequence_privileges(privilege_name) as (
  values ('USAGE'::text), ('SELECT'::text), ('UPDATE'::text)
),
scoped_relations as (
  select c.oid, n.nspname, c.relname, c.relkind, c.relowner, c.relrowsecurity,
         c.relforcerowsecurity, c.relacl
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (
      n.nspname = 'public'
      or (n.nspname = 'storage' and c.relname in ('buckets', 'objects'))
    )
),
scoped_routines as (
  select p.oid, n.nspname, p.proname, p.proowner, p.prosecdef, p.provolatile,
         p.prokind, p.proacl, p.proconfig
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where p.prokind in ('f', 'p')
    and (
      n.nspname = 'public'
      or (n.nspname = 'auth' and p.proname in ('uid', 'jwt'))
      or (n.nspname = 'storage' and p.proname = 'foldername')
    )
)
select jsonb_build_object(
  'captured_at_utc', timezone('utc', clock_timestamp()),
  'project_ref', '$productionProjectRef',
  'database', current_database(),
  'database_user', current_user,
  'server_version', current_setting('server_version'),
  'server_version_num', current_setting('server_version_num'),
  'transaction_read_only', current_setting('transaction_read_only'),
  'role_attributes', coalesce((
    select jsonb_agg(jsonb_build_object(
      'role', r.rolname,
      'superuser', r.rolsuper,
      'inherit', r.rolinherit,
      'can_login', r.rolcanlogin,
      'bypass_rls', r.rolbypassrls
    ) order by r.rolname)
    from pg_catalog.pg_roles r
    where r.rolname in (select role_name from target_roles)
  ), '[]'::jsonb),
  'schema_privileges', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', s.schema_name,
      'role', r.role_name,
      'usage', has_schema_privilege(r.role_name, s.schema_name, 'USAGE'),
      'create', has_schema_privilege(r.role_name, s.schema_name, 'CREATE')
    ) order by s.schema_name, r.role_name)
    from (values ('auth'::text), ('public'::text), ('storage'::text)) s(schema_name)
    cross join target_roles r
  ), '[]'::jsonb),
  'relations', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', rel.nspname,
      'name', rel.relname,
      'kind', case rel.relkind
        when 'r' then 'table' when 'p' then 'partitioned table'
        when 'v' then 'view' when 'm' then 'materialized view'
        when 'f' then 'foreign table' else rel.relkind::text end,
      'owner', pg_get_userbyid(rel.relowner),
      'row_security', rel.relrowsecurity,
      'force_row_security', rel.relforcerowsecurity,
      'acl', rel.relacl::text,
      'effective_privileges', (
        select jsonb_object_agg(role_access.role_name, role_access.privileges order by role_access.role_name)
        from (
          select r.role_name, coalesce(jsonb_agg(p.privilege_name order by p.privilege_name)
            filter (where p.privilege_name is not null), '[]'::jsonb) as privileges
          from target_roles r
          left join table_privileges p
            on has_table_privilege(r.role_name, rel.oid, p.privilege_name)
          group by r.role_name
        ) role_access
      )
    ) order by rel.nspname, rel.relname)
    from scoped_relations rel
  ), '[]'::jsonb),
  'columns', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', rel.nspname,
      'relation', rel.relname,
      'column', a.attname,
      'acl', a.attacl::text,
      'effective_privileges', (
        select jsonb_object_agg(role_access.role_name, role_access.privileges order by role_access.role_name)
        from (
          select r.role_name, coalesce(jsonb_agg(p.privilege_name order by p.privilege_name)
            filter (where p.privilege_name is not null), '[]'::jsonb) as privileges
          from target_roles r
          left join column_privileges p
            on has_column_privilege(r.role_name, rel.oid, a.attnum, p.privilege_name)
          group by r.role_name
        ) role_access
      )
    ) order by rel.nspname, rel.relname, a.attnum)
    from scoped_relations rel
    join pg_catalog.pg_attribute a on a.attrelid = rel.oid
    where a.attnum > 0 and not a.attisdropped
  ), '[]'::jsonb),
  'sequences', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', n.nspname,
      'name', c.relname,
      'owner', pg_get_userbyid(c.relowner),
      'acl', c.relacl::text,
      'effective_privileges', (
        select jsonb_object_agg(role_access.role_name, role_access.privileges order by role_access.role_name)
        from (
          select r.role_name, coalesce(jsonb_agg(p.privilege_name order by p.privilege_name)
            filter (where p.privilege_name is not null), '[]'::jsonb) as privileges
          from target_roles r
          left join sequence_privileges p
            on has_sequence_privilege(r.role_name, c.oid, p.privilege_name)
          group by r.role_name
        ) role_access
      )
    ) order by n.nspname, c.relname)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'S' and n.nspname = 'public'
  ), '[]'::jsonb),
  'routines', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', routine.nspname,
      'name', routine.proname,
      'identity_arguments', pg_get_function_identity_arguments(routine.oid),
      'kind', case routine.prokind when 'p' then 'procedure' else 'function' end,
      'owner', pg_get_userbyid(routine.proowner),
      'security_definer', routine.prosecdef,
      'volatility', routine.provolatile,
      'config', routine.proconfig,
      'acl', routine.proacl::text,
      'execute', (
        select jsonb_object_agg(r.role_name,
          has_function_privilege(r.role_name, routine.oid, 'EXECUTE') order by r.role_name)
        from target_roles r
      )
    ) order by routine.nspname, routine.proname, pg_get_function_identity_arguments(routine.oid))
    from scoped_routines routine
  ), '[]'::jsonb),
  'default_acls', coalesce((
    select jsonb_agg(jsonb_build_object(
      'owner', pg_get_userbyid(d.defaclrole),
      'schema', n.nspname,
      'object_type', case d.defaclobjtype
        when 'r' then 'relation' when 'S' then 'sequence' when 'f' then 'function'
        when 'T' then 'type' when 'n' then 'schema' else d.defaclobjtype::text end,
      'acl', d.defaclacl::text
    ) order by pg_get_userbyid(d.defaclrole), n.nspname nulls first, d.defaclobjtype)
    from pg_catalog.pg_default_acl d
    left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
    where n.nspname in ('public', 'auth', 'storage') or d.defaclnamespace = 0
  ), '[]'::jsonb)
)::text;
"@

    $auditOutput = & $psql @connectionArguments `
        --no-psqlrc `
        --tuples-only `
        --no-align `
        --single-transaction `
        --variable=ON_ERROR_STOP=1 `
        --command 'SET TRANSACTION READ ONLY;' `
        --command $auditSql 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Production grant audit failed: $($auditOutput -join [Environment]::NewLine)"
    }

    $auditJson = $auditOutput | Where-Object { ([string] $_).Trim().StartsWith('{') } | Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($auditJson)) {
        throw 'Production grant audit did not return catalogue metadata.'
    }
    $audit = $auditJson | ConvertFrom-Json
    if ($audit.project_ref -ne $productionProjectRef -or $audit.transaction_read_only -ne 'on') {
        throw 'Production grant audit failed its project or read-only transaction check.'
    }

    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $auditPath = Join-Path $outputRoot "catalogue-audit-$productionProjectRef-$timestamp"
    New-Item -ItemType Directory -Path $auditPath -Force | Out-Null
    $cataloguePath = Join-Path $auditPath 'catalogue.json'
    $manifestPath = Join-Path $auditPath 'manifest.json'

    $audit | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $cataloguePath -Encoding utf8
    $catalogueHash = (Get-FileHash -LiteralPath $cataloguePath -Algorithm SHA256).Hash
    [ordered]@{
        project_ref = $productionProjectRef
        captured_at_utc = $audit.captured_at_utc
        read_only_transaction = $true
        catalogue_file = [System.IO.Path]::GetFileName($cataloguePath)
        catalogue_sha256 = $catalogueHash
        relation_count = @($audit.relations).Count
        column_count = @($audit.columns).Count
        sequence_count = @($audit.sequences).Count
        routine_count = @($audit.routines).Count
    } | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8

    Write-Host "Read-only production grant audit complete: $auditPath"
}
finally {
    $env:PGPASSWORD = $previousPassword
    $env:PGSSLMODE = $previousSslMode
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    $password = $null
}
