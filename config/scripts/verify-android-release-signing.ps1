[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string] $Repository = 'coder-lulu/hive-code-next',

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string] $BackupDirectory = (Join-Path $PSScriptRoot '..\..\mobile\.secrets\android'),

    [Parameter()]
    [ValidatePattern('^[0-9]{8}$')]
    [string] $Stamp = (Get-Date -Format 'yyyyMMdd')
)

$ErrorActionPreference = 'Stop'
$backupRoot = [IO.Path]::GetFullPath($BackupDirectory)
$keystorePath = Join-Path $backupRoot "hivecode-android-release-$Stamp.jks"
$credentialsPath = Join-Path $backupRoot "hivecode-android-release-$Stamp.credentials.txt"
$certificatePath = Join-Path $backupRoot "hivecode-android-release-$Stamp.verify.cer.tmp"
$requiredSecrets = @(
    'HIVECODE_ANDROID_KEYSTORE_BASE64',
    'HIVECODE_ANDROID_KEYSTORE_PASSWORD',
    'HIVECODE_ANDROID_KEY_ALIAS',
    'HIVECODE_ANDROID_KEY_PASSWORD',
    'HIVECODE_ANDROID_SIGNING_FINGERPRINT'
)

$credentialLines = Get-Content -LiteralPath $credentialsPath
$storePasswordLine = $credentialLines | Where-Object { $_ -like 'Keystore password:*' }
$fingerprintLine = $credentialLines | Where-Object { $_ -like 'Certificate SHA-256:*' }
$aliasLine = $credentialLines | Where-Object { $_ -like 'Alias:*' }
if (-not $storePasswordLine -or -not $fingerprintLine -or -not $aliasLine) {
    throw 'The Android release credentials backup is incomplete'
}

$storePassword = $storePasswordLine.Substring('Keystore password:'.Length).Trim()
$expectedFingerprint = $fingerprintLine.Substring('Certificate SHA-256:'.Length).Trim()
$alias = $aliasLine.Substring('Alias:'.Length).Trim()
$env:HIVECODE_VERIFY_STORE_PASSWORD = $storePassword

try {
    & keytool `
        -exportcert `
        -keystore $keystorePath `
        -storetype JKS `
        -storepass:env HIVECODE_VERIFY_STORE_PASSWORD `
        -alias $alias `
        -file $certificatePath | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not open the Android release private-key entry'
    }

    $actualFingerprint = [Convert]::ToHexString(
        [Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($certificatePath))
    ).ToLowerInvariant()
    if ($actualFingerprint -ne $expectedFingerprint) {
        throw 'The Android release certificate fingerprint does not match its backup metadata'
    }

    $listedSecrets = gh secret list --repo $Repository --json name,updatedAt | ConvertFrom-Json
    foreach ($name in $requiredSecrets) {
        if (-not ($listedSecrets | Where-Object name -eq $name)) {
            throw "Missing GitHub Actions secret: $name"
        }
    }

    foreach ($path in @($backupRoot, $keystorePath, $credentialsPath)) {
        $acl = Get-Acl -LiteralPath $path
        if (-not $acl.AreAccessRulesProtected) {
            throw "Android signing backup inherits filesystem permissions: $path"
        }
    }

    Write-Output 'Android release signing verification: PASS'
    Write-Output "Subject: CN=hivekernel.com, OU=HiveCode Mobile, O=HiveKernel"
    Write-Output "Alias: $alias"
    Write-Output "Certificate SHA-256: $actualFingerprint"
    Write-Output "GitHub signing secrets: $($requiredSecrets.Count)/$($requiredSecrets.Count)"
    Write-Output "Protected backup: $backupRoot"
} finally {
    Remove-Item -LiteralPath $certificatePath -Force -ErrorAction SilentlyContinue
    Remove-Item Env:HIVECODE_VERIFY_STORE_PASSWORD -ErrorAction SilentlyContinue
    $storePassword = $null
}
