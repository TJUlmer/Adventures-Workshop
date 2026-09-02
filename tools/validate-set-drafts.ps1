[CmdletBinding()]
param(
    [string] $GrantMigrationPath = (Join-Path $PSScriptRoot '..\supabase\migrations\0013_grant_reconciliation.sql'),

    [string] $DraftMigrationPath = (Join-Path $PSScriptRoot '..\supabase\migrations\0014_set_drafts.sql'),

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
    throw 'Refusing to validate the draft migration against the production project.'
}
if ($TargetProjectRef -ne 'jtpifbkqkoitzjfrxhhn' -or $UserName -ne 'postgres.jtpifbkqkoitzjfrxhhn') {
    throw 'This rollback validation is pinned to adventures-workshop-recovery.'
}

$grantMigration = [System.IO.Path]::GetFullPath($GrantMigrationPath)
$draftMigration = [System.IO.Path]::GetFullPath($DraftMigrationPath)
foreach ($migration in @($grantMigration, $draftMigration)) {
    if (-not (Test-Path -LiteralPath $migration -PathType Leaf)) {
        throw "Migration not found: $migration"
    }
    if ((Get-Content -LiteralPath $migration -Raw) -match '(?im)^\s*(begin|commit|rollback)\s*;') {
        throw "Migration must not control its own transaction: $migration"
    }
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

    $preflightSql = @'
select json_build_object(
  'server_version_num', current_setting('server_version_num'),
  'auth_user_rows', (select count(*) from auth.users),
  'permanent_user_rows', (select count(*) from auth.users where is_anonymous is not true),
  'set_drafts_exists', to_regclass('public.set_drafts') is not null,
  'draft_bucket_exists', exists (
    select 1 from storage.buckets where id = 'draft-assets'
  ),
  'save_rpc_exists', to_regprocedure(
    'public.save_set_draft(text,text,text,text,integer,integer,jsonb,integer,integer,integer,text,bigint,text,timestamptz,integer,jsonb,bigint)'
  ) is not null,
  'moderate_set_exists', to_regprocedure('public.moderate_set(uuid,boolean,text)') is not null,
  'ledger_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(m)::text, E'\n' order by version), ''))
    from supabase_migrations.schema_migrations m
  ),
  'sets_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(s)::text, E'\n' order by id), ''))
    from public.sets s
  ),
  'storage_bucket_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(b)::text, E'\n' order by id), ''))
    from storage.buckets b
  ),
  'storage_object_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(o)::text, E'\n' order by id), ''))
    from storage.objects o
  ),
  'storage_policy_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(p)::text, E'\n' order by policyname), ''))
    from pg_policies p where schemaname = 'storage' and tablename = 'objects'
  )
)::text;
'@

    <#
     PostgreSQL sends NOTICE messages to stderr. Windows PowerShell turns
     native stderr into error records, and `Stop` would abort on an expected
     `drop ... if exists` notice before `$LASTEXITCODE` can distinguish it
     from a real SQL failure.
    #>
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
        throw "Recovery preflight failed: $($preflightOutput -join [Environment]::NewLine)"
    }
    $preflightJson = $preflightOutput | Where-Object { ([string] $_).Trim().StartsWith('{') } | Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($preflightJson)) {
        throw 'Recovery preflight did not return metadata.'
    }
    $preflight = $preflightJson | ConvertFrom-Json
    if (-not $preflight.server_version_num.ToString().StartsWith('17') -or
        [int] $preflight.auth_user_rows -lt 2 -or [int] $preflight.permanent_user_rows -lt 2 -or
        $preflight.set_drafts_exists -or
        $preflight.draft_bucket_exists -or $preflight.save_rpc_exists -or
        $preflight.moderate_set_exists) {
        throw 'Recovery project is not in the expected pre-0013/0014 state.'
    }

    $functionalSql = @'
create temp table phase1_results (
  check_name text primary key,
  text_value text,
  number_value bigint
);
grant insert, select, update on phase1_results to authenticated;

create or replace function pg_temp.phase1_document(target_local_id text, target_name text)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select jsonb_build_object(
    'format', 'adventures-workshop-set',
    'schemaVersion', 47,
    'exportedAt', '2026-09-01T00:00:00.000Z',
    'set', jsonb_build_object('id', target_local_id, 'schemaVersion', 47, 'name', target_name)
  );
$function$;

do $validation$
declare
  owners uuid[];
  first_owner uuid;
  second_owner uuid;
  result record;
begin
  select array_agg(id order by id) into owners
  from (
    select id from auth.users where is_anonymous is not true order by id limit 2
  ) as selected;
  if coalesce(array_length(owners, 1), 0) <> 2 then
    raise exception 'Two recovery users are required for draft isolation validation.';
  end if;
  first_owner := owners[1];
  second_owner := owners[2];
  perform set_config('phase1.first_owner', first_owner::text, true);
  perform set_config('phase1.second_owner', second_owner::text, true);

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', first_owner, 'role', 'authenticated', 'is_anonymous', false)::text,
    true
  );
  select * into result from public.save_set_draft(
    p_local_id => 'set_phase1_validation',
    p_name => 'First owner',
    p_subtitle => '',
    p_kind => 'adventure',
    p_card_count => 3,
    p_character_count => 1,
    p_characters => jsonb_build_array(
      jsonb_build_object('id', 'character_one', 'name', 'One', 'role', 'villain')
    ),
    p_blockers => 0,
    p_gaps => 1,
    p_issue_count => 2,
    p_origin_author => null,
    p_origin_revision => null,
    p_origin_slug => null,
    p_document_updated_at => '2026-08-31T12:00:00Z',
    p_schema_version => 47,
    p_document => pg_temp.phase1_document('set_phase1_validation', 'First owner'),
    p_expected_revision => null
  );
  if result.outcome <> 'saved' or result.revision <> 1 then
    raise exception 'First owner create did not return revision 1.';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', second_owner, 'role', 'authenticated', 'is_anonymous', false)::text,
    true
  );
  select * into result from public.save_set_draft(
    p_local_id => 'set_phase1_validation',
    p_name => 'Second owner',
    p_subtitle => '',
    p_kind => 'heroes',
    p_card_count => 4,
    p_character_count => 2,
    p_characters => jsonb_build_array(),
    p_blockers => 0,
    p_gaps => 0,
    p_issue_count => 0,
    p_origin_author => null,
    p_origin_revision => null,
    p_origin_slug => null,
    p_document_updated_at => '2026-08-31T13:00:00Z',
    p_schema_version => 47,
    p_document => pg_temp.phase1_document('set_phase1_validation', 'Second owner'),
    p_expected_revision => null
  );
  if result.outcome <> 'saved' or result.revision <> 1 then
    raise exception 'Second owner could not reuse the local id in their own namespace.';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', first_owner, 'role', 'authenticated', 'is_anonymous', false)::text,
    true
  );
  select * into result from public.save_set_draft(
    p_local_id => 'set_phase1_validation',
    p_name => 'Stale overwrite',
    p_subtitle => '',
    p_kind => 'adventure',
    p_card_count => 3,
    p_character_count => 1,
    p_characters => jsonb_build_array(),
    p_blockers => 0,
    p_gaps => 0,
    p_issue_count => 0,
    p_origin_author => null,
    p_origin_revision => null,
    p_origin_slug => null,
    p_document_updated_at => '2026-08-31T14:00:00Z',
    p_schema_version => 47,
    p_document => pg_temp.phase1_document('set_phase1_validation', 'Stale overwrite'),
    p_expected_revision => 99
  );
  if result.outcome <> 'conflict' or result.revision <> 1 then
    raise exception 'A stale write did not return the unchanged remote revision.';
  end if;

  select * into result from public.save_set_draft(
    p_local_id => 'set_phase1_validation',
    p_name => 'First owner updated',
    p_subtitle => 'Atomic summary',
    p_kind => 'adventure',
    p_card_count => 5,
    p_character_count => 1,
    p_characters => jsonb_build_array(
      jsonb_build_object('id', 'character_one', 'name', 'One', 'role', 'villain')
    ),
    p_blockers => 1,
    p_gaps => 2,
    p_issue_count => 4,
    p_origin_author => 'Source author',
    p_origin_revision => 3,
    p_origin_slug => 'source-slug',
    p_document_updated_at => '2026-08-31T15:00:00Z',
    p_schema_version => 47,
    p_document => pg_temp.phase1_document('set_phase1_validation', 'First owner updated'),
    p_expected_revision => 1
  );
  if result.outcome <> 'saved' or result.revision <> 2 then
    raise exception 'An exact-revision save did not advance once.';
  end if;

  if not exists (
    select 1 from public.set_drafts
    where owner_id = first_owner and local_id = 'set_phase1_validation'
      and revision = 2 and name = 'First owner updated' and card_count = 5
      and blockers = 1 and gaps = 2 and issue_count = 4
      and origin_author = 'Source author' and origin_revision = 3 and origin_slug = 'source-slug'
  ) then
    raise exception 'The document and complete summary were not updated atomically.';
  end if;

  if not exists (
    select 1 from public.set_drafts
    where owner_id = second_owner and local_id = 'set_phase1_validation'
      and revision = 1 and name = 'Second owner'
  ) then
    raise exception 'The other owner''s row changed during the first owner''s save.';
  end if;
end;
$validation$;

do $claims$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', current_setting('phase1.first_owner'),
      'role', 'authenticated',
      'is_anonymous', false
    )::text,
    true
  );
end;
$claims$;
set local role authenticated;
insert into phase1_results (check_name, number_value)
select 'first_owner_visible_rows', count(*) from public.set_drafts;
insert into phase1_results (check_name, text_value)
select 'first_owner_visible_name', name from public.set_drafts;
reset role;

do $claims$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', current_setting('phase1.second_owner'),
      'role', 'authenticated',
      'is_anonymous', false
    )::text,
    true
  );
end;
$claims$;
set local role authenticated;
insert into phase1_results (check_name, number_value)
select 'second_owner_visible_rows', count(*) from public.set_drafts;
insert into phase1_results (check_name, text_value)
select 'second_owner_visible_name', name from public.set_drafts;
reset role;

do $claims$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', current_setting('phase1.first_owner'),
      'role', 'authenticated',
      'is_anonymous', true
    )::text,
    true
  );
end;
$claims$;
set local role authenticated;
insert into phase1_results (check_name, number_value)
select 'anonymous_visible_rows', count(*) from public.set_drafts;
reset role;

do $validation$
declare
  first_owner uuid := current_setting('phase1.first_owner')::uuid;
  result record;
  anonymous_rejected boolean := false;
begin
  if (select number_value from phase1_results where check_name = 'first_owner_visible_rows') <> 1
     or (select text_value from phase1_results where check_name = 'first_owner_visible_name') <> 'First owner updated'
     or (select number_value from phase1_results where check_name = 'second_owner_visible_rows') <> 1
     or (select text_value from phase1_results where check_name = 'second_owner_visible_name') <> 'Second owner'
     or (select number_value from phase1_results where check_name = 'anonymous_visible_rows') <> 0 then
    raise exception 'Draft read policies did not isolate permanent owners and anonymous sessions.';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', first_owner, 'role', 'authenticated', 'is_anonymous', false)::text,
    true
  );
  select * into result from public.soft_delete_set_draft('set_phase1_validation', 2);
  if result.outcome <> 'deleted' or result.revision <> 3 or result.deleted_at is null then
    raise exception 'Soft delete did not advance the revision.';
  end if;

  select * into result from public.save_set_draft(
    p_local_id => 'set_phase1_validation',
    p_name => 'Must stay deleted',
    p_subtitle => '',
    p_kind => 'adventure',
    p_card_count => 0,
    p_character_count => 0,
    p_characters => jsonb_build_array(),
    p_blockers => 0,
    p_gaps => 0,
    p_issue_count => 0,
    p_origin_author => null,
    p_origin_revision => null,
    p_origin_slug => null,
    p_document_updated_at => '2026-08-31T16:00:00Z',
    p_schema_version => 47,
    p_document => pg_temp.phase1_document('set_phase1_validation', 'Must stay deleted'),
    p_expected_revision => 3
  );
  if result.outcome <> 'conflict' or result.revision <> 3 or result.deleted_at is null then
    raise exception 'A normal save changed or restored a deleted draft.';
  end if;

  select * into result from public.restore_set_draft('set_phase1_validation', 3);
  if result.outcome <> 'restored' or result.revision <> 4 or result.deleted_at is not null then
    raise exception 'Restore did not advance the revision.';
  end if;

  select * into result from public.soft_delete_set_draft('set_phase1_validation', 4);
  select * into result from public.purge_set_draft('set_phase1_validation', 5);
  if result.outcome <> 'purged' or result.revision <> 5 then
    raise exception 'Delete forever did not require the current deleted generation.';
  end if;
  if exists (
    select 1 from public.set_drafts
    where owner_id = first_owner and local_id = 'set_phase1_validation'
  ) then
    raise exception 'Delete forever left the draft row behind.';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', first_owner, 'role', 'authenticated', 'is_anonymous', true)::text,
    true
  );
  begin
    perform public.save_set_draft(
      p_local_id => 'set_anonymous_validation',
      p_name => 'Anonymous',
      p_subtitle => '',
      p_kind => 'adventure',
      p_card_count => 0,
      p_character_count => 0,
      p_characters => jsonb_build_array(),
      p_blockers => 0,
      p_gaps => 0,
      p_issue_count => 0,
      p_origin_author => null,
      p_origin_revision => null,
      p_origin_slug => null,
      p_document_updated_at => '2026-08-31T16:00:00Z',
      p_schema_version => 47,
      p_document => pg_temp.phase1_document('set_anonymous_validation', 'Anonymous'),
      p_expected_revision => null
    );
  exception when insufficient_privilege then
    anonymous_rejected := true;
  end;
  if not anonymous_rejected then
    raise exception 'An anonymous authenticated session reached the draft backend.';
  end if;
end;
$validation$;

do $catalogue$
declare
  save_signature regprocedure :=
    'public.save_set_draft(text,text,text,text,integer,integer,jsonb,integer,integer,integer,text,bigint,text,timestamptz,integer,jsonb,bigint)'::regprocedure;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.set_drafts'::regclass) then
    raise exception 'RLS is not enabled on set_drafts.';
  end if;

  if has_table_privilege('anon', 'public.set_drafts', 'SELECT')
     or has_table_privilege('authenticated', 'public.set_drafts', 'INSERT')
     or has_table_privilege('authenticated', 'public.set_drafts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.set_drafts', 'DELETE')
     or not has_table_privilege('authenticated', 'public.set_drafts', 'SELECT') then
    raise exception 'Draft relation grants are broader than the RPC boundary.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'set_drafts') <> 1
     or (select count(*) from pg_policies
         where schemaname = 'storage' and tablename = 'objects'
           and policyname in ('draft_assets_read', 'draft_assets_write', 'draft_assets_update', 'draft_assets_delete')) <> 4
     or (select public from storage.buckets where id = 'draft-assets') is distinct from false then
    raise exception 'Draft table or Storage policy catalogue is incomplete.';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('draft_assets_read', 'draft_assets_write', 'draft_assets_update', 'draft_assets_delete')
      and roles <> '{authenticated}'::name[]
  ) then
    raise exception 'A draft asset policy is exposed beyond authenticated callers.';
  end if;

  if not (select prosecdef from pg_proc where oid = save_signature)
     or coalesce((select array_to_string(proconfig, ',') from pg_proc where oid = save_signature), '') not like 'search_path=%'
     or coalesce((select array_to_string(proconfig, ',') from pg_proc where oid = save_signature), '') like '%public%' then
    raise exception 'The save RPC is not security-definer with a closed search path.';
  end if;

  if has_function_privilege('anon', save_signature, 'EXECUTE')
     or not has_function_privilege('authenticated', save_signature, 'EXECUTE') then
    raise exception 'The save RPC execution grant is incorrect.';
  end if;
end;
$catalogue$;

select json_build_object(
  'stage', 'inside_transaction',
  'draft_rows_after_functional_checks', (select count(*) from public.set_drafts),
  'draft_bucket_private', not (select public from storage.buckets where id = 'draft-assets'),
  'draft_table_policies', (
    select count(*) from pg_policies where schemaname = 'public' and tablename = 'set_drafts'
  ),
  'draft_asset_policies', (
    select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'draft_assets_%'
  ),
  'stale_write_conflict_verified', true,
  'owner_isolation_verified', true,
  'anonymous_rejection_verified', true,
  'delete_restore_purge_verified', true,
  'storage_policy_catalogue_verified', true,
  'storage_http_attacks_deferred', true
)::text;
'@

    $afterRollbackSql = @'
select json_build_object(
  'stage', 'after_rollback',
  'set_drafts_exists', to_regclass('public.set_drafts') is not null,
  'draft_bucket_exists', exists (
    select 1 from storage.buckets where id = 'draft-assets'
  ),
  'save_rpc_exists', to_regprocedure(
    'public.save_set_draft(text,text,text,text,integer,integer,jsonb,integer,integer,integer,text,bigint,text,timestamptz,integer,jsonb,bigint)'
  ) is not null,
  'moderate_set_exists', to_regprocedure('public.moderate_set(uuid,boolean,text)') is not null,
  'ledger_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(m)::text, E'\n' order by version), ''))
    from supabase_migrations.schema_migrations m
  ),
  'sets_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(s)::text, E'\n' order by id), ''))
    from public.sets s
  ),
  'storage_bucket_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(b)::text, E'\n' order by id), ''))
    from storage.buckets b
  ),
  'storage_object_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(o)::text, E'\n' order by id), ''))
    from storage.objects o
  ),
  'storage_policy_fingerprint', (
    select md5(coalesce(string_agg(row_to_json(p)::text, E'\n' order by policyname), ''))
    from pg_policies p where schemaname = 'storage' and tablename = 'objects'
  )
)::text;
'@

    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $validationOutput = & $psql @connectionArguments `
            --no-psqlrc `
            --tuples-only `
            --no-align `
            --variable=ON_ERROR_STOP=1 `
            --command='BEGIN;' `
            --file=$grantMigration `
            --file=$draftMigration `
            --command=$functionalSql `
            --command='ROLLBACK;' `
            --command=$afterRollbackSql 2>&1
        $validationExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
    if ($validationExitCode -ne 0) {
        throw "Draft-backend rollback validation failed: $($validationOutput -join [Environment]::NewLine)"
    }

    $jsonLines = @($validationOutput | Where-Object {
        $line = ([string] $_).Trim()
        $line.StartsWith('{') -and $line.Contains('"stage"')
    })
    if ($jsonLines.Count -ne 2) {
        throw "Expected two validation records, found $($jsonLines.Count)."
    }
    $inside = $jsonLines[0] | ConvertFrom-Json
    $afterRollback = $jsonLines[1] | ConvertFrom-Json

    if ($inside.stage -ne 'inside_transaction' -or
        [int] $inside.draft_rows_after_functional_checks -ne 1 -or
        -not $inside.draft_bucket_private -or [int] $inside.draft_table_policies -ne 1 -or
        [int] $inside.draft_asset_policies -ne 4 -or
        -not $inside.stale_write_conflict_verified -or -not $inside.owner_isolation_verified -or
        -not $inside.anonymous_rejection_verified -or -not $inside.delete_restore_purge_verified -or
        -not $inside.storage_policy_catalogue_verified -or -not $inside.storage_http_attacks_deferred) {
        throw 'The in-transaction draft backend did not match the reviewed contract.'
    }

    if ($afterRollback.stage -ne 'after_rollback' -or $afterRollback.set_drafts_exists -or
        $afterRollback.draft_bucket_exists -or $afterRollback.save_rpc_exists -or
        $afterRollback.moderate_set_exists) {
        throw 'Recovery objects did not return to their original state after rollback.'
    }
    foreach ($property in @(
        'ledger_fingerprint',
        'sets_fingerprint',
        'storage_bucket_fingerprint',
        'storage_object_fingerprint',
        'storage_policy_fingerprint'
    )) {
        if ($afterRollback.$property -ne $preflight.$property) {
            throw "Recovery fingerprint $property did not return to its preflight value."
        }
    }

    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $evidencePath = Join-Path ([System.IO.Path]::GetFullPath($OutputDirectory)) `
        "set-drafts-validation-$TargetProjectRef-$timestamp"
    New-Item -ItemType Directory -Path $evidencePath -Force | Out-Null
    $logPath = Join-Path $evidencePath 'validation.log'
    $manifestPath = Join-Path $evidencePath 'manifest.json'
    $validationOutput | Set-Content -LiteralPath $logPath -Encoding utf8

    [ordered]@{
        target_project_ref = $TargetProjectRef
        completed_at_utc = [DateTime]::UtcNow.ToString('o')
        grant_migration_path = $grantMigration
        grant_migration_sha256 = (Get-FileHash -LiteralPath $grantMigration -Algorithm SHA256).Hash
        draft_migration_path = $draftMigration
        draft_migration_sha256 = (Get-FileHash -LiteralPath $draftMigration -Algorithm SHA256).Hash
        transaction_rolled_back = $true
        preflight = $preflight
        inside_transaction = $inside
        after_rollback = $afterRollback
        validation_log = [System.IO.Path]::GetFileName($logPath)
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8

    Write-Host "Draft backend validated and rolled back: $evidencePath"
}
finally {
    $env:PGPASSWORD = $previousPassword
    $env:PGSSLMODE = $previousSslMode
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    $password = $null
}
