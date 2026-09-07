[CmdletBinding()]
param(
    [string] $BackupOutputDirectory = 'G:\Unmatched Labs Backups',

    [string] $BucketName = 'unmatched-labs-offsite-backup',

    [string] $S3Endpoint = 'https://s3.us-east-005.backblazeb2.com'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'This configuration tool requires PowerShell 7 or newer. Run it with pwsh.'
}

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$form = [System.Windows.Forms.Form]::new()
$form.Text = 'Unmatched Labs encrypted backup setup'
$form.StartPosition = 'CenterScreen'
$form.ClientSize = [System.Drawing.Size]::new(690, 520)
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true

$heading = [System.Windows.Forms.Label]::new()
$heading.Text = 'Enter the saved credentials below. Every value is masked and remains on this computer.'
$heading.Location = [System.Drawing.Point]::new(24, 20)
$heading.Size = [System.Drawing.Size]::new(640, 35)
$form.Controls.Add($heading)

$fieldDefinitions = @(
    @('Production Supabase database password', 'The database password used for the manual backup.'),
    @('Supabase full-backup S3 key ID', 'Key ID for the production unmatched-labs-full-backup key.'),
    @('Supabase full-backup S3 secret', 'Secret for that same production S3 key.'),
    @('Backblaze application key ID', 'The keyID saved from Backblaze.'),
    @('Backblaze application key', 'The one-time applicationKey saved from Backblaze.'),
    @('New off-site encryption password', 'Choose a new unique password and save it in your password manager.'),
    @('Confirm encryption password', 'Enter the new encryption password again.')
)

$textboxes = [System.Collections.Generic.List[System.Windows.Forms.TextBox]]::new()
for ($index = 0; $index -lt $fieldDefinitions.Count; $index += 1) {
    $top = 65 + ($index * 57)
    $label = [System.Windows.Forms.Label]::new()
    $label.Text = $fieldDefinitions[$index][0]
    $label.Location = [System.Drawing.Point]::new(24, $top)
    $label.Size = [System.Drawing.Size]::new(275, 20)
    $form.Controls.Add($label)

    $textbox = [System.Windows.Forms.TextBox]::new()
    $textbox.Location = [System.Drawing.Point]::new(305, $top - 3)
    $textbox.Size = [System.Drawing.Size]::new(355, 25)
    $textbox.UseSystemPasswordChar = $true
    $textbox.AccessibleDescription = $fieldDefinitions[$index][1]
    $form.Controls.Add($textbox)
    $textboxes.Add($textbox)
}

$status = [System.Windows.Forms.Label]::new()
$status.Location = [System.Drawing.Point]::new(24, 468)
$status.Size = [System.Drawing.Size]::new(430, 30)
$status.ForeColor = [System.Drawing.Color]::DarkRed
$form.Controls.Add($status)

$configureButton = [System.Windows.Forms.Button]::new()
$configureButton.Text = 'Configure encrypted backup'
$configureButton.Location = [System.Drawing.Point]::new(465, 455)
$configureButton.Size = [System.Drawing.Size]::new(195, 34)
$form.Controls.Add($configureButton)
$form.AcceptButton = $configureButton

$cancelButton = [System.Windows.Forms.Button]::new()
$cancelButton.Text = 'Cancel'
$cancelButton.Location = [System.Drawing.Point]::new(365, 455)
$cancelButton.Size = [System.Drawing.Size]::new(90, 34)
$form.Controls.Add($cancelButton)
$form.CancelButton = $cancelButton

$cancelButton.Add_Click({
    $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.Close()
})
$configureButton.Add_Click({
    foreach ($textbox in $textboxes) {
        if ([string]::IsNullOrWhiteSpace($textbox.Text)) {
            $status.Text = 'Every field is required.'
            return
        }
    }
    if ($textboxes[5].Text -ne $textboxes[6].Text) {
        $status.Text = 'The two new encryption passwords do not match.'
        return
    }
    if ($textboxes[5].Text.Length -lt 16) {
        $status.Text = 'Use an encryption password at least 16 characters long.'
        return
    }
    $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.Close()
})

$dialogResult = $form.ShowDialog()
if ($dialogResult -ne [System.Windows.Forms.DialogResult]::OK) {
    foreach ($textbox in $textboxes) {
        $textbox.Clear()
    }
    $form.Dispose()
    Write-Host 'Backup configuration cancelled. No credential file was created.'
    return
}

$secureValues = [System.Collections.Generic.List[Security.SecureString]]::new()
try {
    foreach ($textbox in $textboxes) {
        $secureValues.Add((ConvertTo-SecureString $textbox.Text -AsPlainText -Force))
        $textbox.Clear()
    }
    $form.Dispose()

    & (Join-Path $PSScriptRoot 'configure-backup-automation.ps1') `
        -BackupOutputDirectory $BackupOutputDirectory `
        -BucketName $BucketName `
        -S3Endpoint $S3Endpoint `
        -ProvidedDatabasePassword $secureValues[0] `
        -ProvidedSupabaseAccessKey $secureValues[1] `
        -ProvidedSupabaseSecretKey $secureValues[2] `
        -ProvidedOffsiteAccessKey $secureValues[3] `
        -ProvidedOffsiteSecretKey $secureValues[4] `
        -ProvidedRepositoryPassword $secureValues[5]

    [System.Windows.Forms.MessageBox]::Show(
        'The encrypted repository and Windows-protected credentials were configured successfully.',
        'Unmatched Labs backup setup',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
}
catch {
    [System.Windows.Forms.MessageBox]::Show(
        $_.Exception.Message,
        'Backup configuration failed',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    throw
}
finally {
    foreach ($secureValue in $secureValues) {
        $secureValue.Dispose()
    }
}
