Set-StrictMode -Version Latest

function ConvertTo-BackupUtcTimestamp {
    param([object] $Value)

    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string] $Value)) {
        return $null
    }
    $parsed = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse(
        [string] $Value,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AssumeUniversal,
        [ref] $parsed
    )) {
        return $null
    }
    return $parsed.ToUniversalTime()
}

function Get-LatestFullStorageBackupUtc {
    param(
        [Parameter(Mandatory = $true)][string] $StateDirectory,
        [Parameter(Mandatory = $true)][string] $BackupOutputDirectory
    )

    $latest = $null
    $recordPath = Join-Path $StateDirectory 'last-success.json'
    if (Test-Path -LiteralPath $recordPath -PathType Leaf) {
        try {
            $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
            $backupKindProperty = $record.PSObject.Properties['backup_kind']
            $recordDescribesFullBackup = $null -eq $backupKindProperty -or
                [string] $backupKindProperty.Value -eq 'full'
            if ($recordDescribesFullBackup -and
                $record.format_version -eq 1 -and
                $record.storage_object_count -ge 0 -and
                $record.storage_total_bytes -ge 0) {
                $latest = ConvertTo-BackupUtcTimestamp $record.completed_at_utc
            }
        }
        catch {
            # A damaged optional marker must not hide a valid completed local backup.
        }
    }

    foreach ($directory in @(Get-ChildItem -LiteralPath $BackupOutputDirectory `
        -Directory -Filter 'supabase-kyqcvbnxfmpnbwtikzxp-*')) {
        $manifestPath = Join-Path $directory.FullName 'manifest.json'
        if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
            continue
        }
        try {
            $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
            if ($manifest.storage_object_bytes_included -ne $true -or
                $manifest.full_backup_complete -ne $true) {
                continue
            }
            $candidate = ConvertTo-BackupUtcTimestamp $manifest.created_at_utc
            if ($null -ne $candidate -and ($null -eq $latest -or $candidate -gt $latest)) {
                $latest = $candidate
            }
        }
        catch {
            # Incomplete or damaged backups are deliberately ignored by the cadence decision.
        }
    }

    return $latest
}

function Test-FullStorageBackupDue {
    param(
        [AllowNull()][Nullable[DateTimeOffset]] $LatestFullBackupUtc,
        [Parameter(Mandatory = $true)][DateTimeOffset] $NowUtc,
        [ValidateRange(1, 365)][int] $CadenceDays = 30
    )

    if ($null -eq $LatestFullBackupUtc) {
        return $true
    }
    return ([DateTimeOffset] $LatestFullBackupUtc) -le $NowUtc.ToUniversalTime().AddDays(-$CadenceDays)
}
