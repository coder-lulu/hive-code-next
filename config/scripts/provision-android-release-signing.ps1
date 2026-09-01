[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string] $Repository = 'coder-lulu/hive-code-next',

    [Parameter()]
    [ValidatePattern('^[A-Za-z0-9.-]+$')]
    [string] $Domain = 'hivekernel.com',

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string] $Organization = 'HiveKernel',

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string] $OrganizationalUnit = 'HiveCode Mobile',

    [Parameter()]
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string] $Alias = 'hivecode-release',

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string] $BackupDirectory = (Join-Path $PSScriptRoot '..\..\mobile\.secrets\android')
)

$ErrorActionPreference = 'Stop'
$backupRoot = [IO.Path]::GetFullPath($BackupDirectory)
$stamp = Get-Date -Format 'yyyyMMdd'
$keystorePath = Join-Path $backupRoot "hivecode-android-release-$stamp.jks"
$credentialsPath = Join-Path $backupRoot "hivecode-android-release-$stamp.credentials.txt"
$certificatePath = Join-Path $backupRoot "hivecode-android-release-$stamp.cer.tmp"
$subject = "CN=$Domain, OU=$OrganizationalUnit, O=$Organization"

function New-RandomSecret {
    $raw = [Security.Cryptography.RandomNumberGenerator]::GetBytes(36)
    return [Convert]::ToBase64String($raw).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Set-GitHubSecret {
    param(
        [Parameter(Mandatory)]
        [string] $Name,

        [Parameter(Mandatory)]
        [string] $Value
    )

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = (Get-Command gh -ErrorAction Stop).Source
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in @('secret', 'set', $Name, '--repo', $Repository)) {
        [void] $startInfo.ArgumentList.Add($argument)
    }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    [void] $process.Start()
    $process.StandardInput.Write($Value)
    $process.StandardInput.Close()
    $standardOutput = $process.StandardOutput.ReadToEnd()
    $standardError = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "Could not set GitHub secret $Name`: $standardError$standardOutput"
    }
}

function Set-OwnerOnlyAcl {
    param(
        [Parameter(Mandatory)]
        [string] $Path,

        [Parameter(Mandatory)]
        [bool] $Directory
    )

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    if ($Directory) {
        $acl = [Security.AccessControl.DirectorySecurity]::new()
        $acl.SetAccessRuleProtection($true, $false)
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            $identity,
            'FullControl',
            'ContainerInherit,ObjectInherit',
            'None',
            'Allow'
        )
    } else {
        $acl = [Security.AccessControl.FileSecurity]::new()
        $acl.SetAccessRuleProtection($true, $false)
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'Allow')
    }
    [void] $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
}

if (Test-Path -LiteralPath $keystorePath) {
    throw "Refusing to overwrite existing keystore: $keystorePath"
}
if (Test-Path -LiteralPath $credentialsPath) {
    throw "Refusing to overwrite existing credentials: $credentialsPath"
}

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
Set-OwnerOnlyAcl -Path $backupRoot -Directory $true

$storePassword = New-RandomSecret
$keyPassword = New-RandomSecret
$env:HIVECODE_GENERATED_STORE_PASSWORD = $storePassword
$env:HIVECODE_GENERATED_KEY_PASSWORD = $keyPassword
$keytool = (Get-Command keytool -ErrorAction Stop).Source

try {
    & $keytool `
        -genkeypair `
        -noprompt `
        -keystore $keystorePath `
        -storetype JKS `
        -storepass:env HIVECODE_GENERATED_STORE_PASSWORD `
        -keypass:env HIVECODE_GENERATED_KEY_PASSWORD `
        -alias $Alias `
        -keyalg RSA `
        -keysize 4096 `
        -sigalg SHA256withRSA `
        -validity 36500 `
        -dname $subject `
        -ext "SAN=dns:$Domain"
    if ($LASTEXITCODE -ne 0) {
        throw 'keytool failed to generate the Android release key'
    }

    & $keytool `
        -exportcert `
        -keystore $keystorePath `
        -storetype JKS `
        -storepass:env HIVECODE_GENERATED_STORE_PASSWORD `
        -alias $Alias `
        -file $certificatePath
    if ($LASTEXITCODE -ne 0) {
        throw 'keytool failed to export the Android release certificate'
    }

    $certificateBytes = [IO.File]::ReadAllBytes($certificatePath)
    $fingerprint = [Convert]::ToHexString(
        [Security.Cryptography.SHA256]::HashData($certificateBytes)
    ).ToLowerInvariant()
    $keystoreBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($keystorePath))

    $credentialLines = @(
        'HiveCode Android release signing identity - confidential',
        "Domain: $Domain",
        "Subject: $subject",
        "Alias: $Alias",
        "Keystore password: $storePassword",
        "Key password: $keyPassword",
        "Certificate SHA-256: $fingerprint",
        "Created: $(Get-Date -Format 'yyyy-MM-dd')",
        'Validity: 36500 days',
        'Critical: keep an offline backup; all future direct-update APKs must use this exact key.'
    )
    [IO.File]::WriteAllLines(
        $credentialsPath,
        $credentialLines,
        [Text.UTF8Encoding]::new($false)
    )
    Set-OwnerOnlyAcl -Path $keystorePath -Directory $false
    Set-OwnerOnlyAcl -Path $credentialsPath -Directory $false

    Set-GitHubSecret -Name 'HIVECODE_ANDROID_KEYSTORE_BASE64' -Value $keystoreBase64
    Set-GitHubSecret -Name 'HIVECODE_ANDROID_KEYSTORE_PASSWORD' -Value $storePassword
    Set-GitHubSecret -Name 'HIVECODE_ANDROID_KEY_ALIAS' -Value $Alias
    Set-GitHubSecret -Name 'HIVECODE_ANDROID_KEY_PASSWORD' -Value $keyPassword
    Set-GitHubSecret -Name 'HIVECODE_ANDROID_SIGNING_FINGERPRINT' -Value $fingerprint

    Write-Output 'Android release signing identity generated and uploaded.'
    Write-Output "Backup directory: $backupRoot"
    Write-Output "Keystore: $keystorePath"
    Write-Output "Credentials: $credentialsPath"
    Write-Output "Certificate SHA-256: $fingerprint"
} finally {
    Remove-Item -LiteralPath $certificatePath -Force -ErrorAction SilentlyContinue
    Remove-Item Env:HIVECODE_GENERATED_STORE_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:HIVECODE_GENERATED_KEY_PASSWORD -ErrorAction SilentlyContinue
    $storePassword = $null
    $keyPassword = $null
    $keystoreBase64 = $null
}
