[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string] $Repository = 'coder-lulu/hive-code-next',

    [Parameter()]
    [ValidatePattern('^https://[^/?#]+$')]
    [string] $ApiUrl = 'https://api.hivekernel.com',

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string] $LocalSecretFile = (Join-Path $PSScriptRoot '..\..\mobile\.secrets\hivecloud-release.env'),

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string] $HiveCloudEnvironmentFile = (Join-Path $PSScriptRoot '..\..\..\hive-cloud\script\docker\hive-cloud-rc\.env.production-test')
)

$ErrorActionPreference = 'Stop'
$localSecretPath = [IO.Path]::GetFullPath($LocalSecretFile)
$hiveCloudEnvironmentPath = [IO.Path]::GetFullPath($HiveCloudEnvironmentFile)

function Set-GitHubValue {
    param(
        [Parameter(Mandatory)]
        [ValidateSet('secret', 'variable')]
        [string] $Kind,

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
    foreach ($argument in @($Kind, 'set', $Name, '--repo', $Repository)) {
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
        throw "Could not set GitHub $Kind $Name`: $standardError$standardOutput"
    }
}

function Set-EnvironmentValue {
    param(
        [Parameter(Mandatory)]
        [string] $Path,

        [Parameter(Mandatory)]
        [string] $Name,

        [Parameter(Mandatory)]
        [string] $Value
    )

    $lines = [Collections.Generic.List[string]]::new()
    if (Test-Path -LiteralPath $Path) {
        foreach ($line in Get-Content -LiteralPath $Path) {
            [void] $lines.Add([string] $line)
        }
    }
    $prefix = "$Name="
    $found = $false
    for ($index = 0; $index -lt $lines.Count; $index += 1) {
        if ($lines[$index].StartsWith($prefix, [StringComparison]::Ordinal)) {
            $lines[$index] = "$prefix$Value"
            $found = $true
        }
    }
    if (-not $found) {
        [void] $lines.Add("$prefix$Value")
    }
    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    [IO.File]::WriteAllLines($Path, $lines, [Text.UTF8Encoding]::new($false))
}

function Set-OwnerOnlyAcl {
    param([Parameter(Mandatory)][string] $Path)

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = [Security.AccessControl.FileSecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'Allow')
    [void] $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
}

$existingSecrets = gh secret list --repo $Repository --json name | ConvertFrom-Json
if ($existingSecrets | Where-Object name -eq 'HIVECLOUD_RELEASE_ATTESTATION_KEY') {
    throw 'HIVECLOUD_RELEASE_ATTESTATION_KEY already exists; refusing an unrecoverable key rotation'
}

$attestationKey = [Convert]::ToBase64String(
    [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
)
try {
    Set-EnvironmentValue `
        -Path $localSecretPath `
        -Name 'HIVECLOUD_API_URL' `
        -Value $ApiUrl
    Set-EnvironmentValue `
        -Path $localSecretPath `
        -Name 'HIVECLOUD_RELEASE_ATTESTATION_KEY' `
        -Value $attestationKey
    Set-OwnerOnlyAcl -Path $localSecretPath

    if (Test-Path -LiteralPath $hiveCloudEnvironmentPath) {
        Set-EnvironmentValue `
            -Path $hiveCloudEnvironmentPath `
            -Name 'HIVE_RELEASE_SIGNATURE_ATTESTATION_KEY' `
            -Value $attestationKey
    }

    Set-GitHubValue `
        -Kind variable `
        -Name 'HIVECLOUD_API_URL' `
        -Value $ApiUrl
    Set-GitHubValue `
        -Kind secret `
        -Name 'HIVECLOUD_RELEASE_ATTESTATION_KEY' `
        -Value $attestationKey

    Write-Output 'HiveCloud release CI configuration provisioned.'
    Write-Output "HIVECLOUD_API_URL=$ApiUrl"
    Write-Output 'HIVECLOUD_RELEASE_ATTESTATION_KEY=stored (value redacted)'
    Write-Output "Local recovery file: $localSecretPath"
    if (Test-Path -LiteralPath $hiveCloudEnvironmentPath) {
        Write-Output "HiveCloud deployment environment: $hiveCloudEnvironmentPath"
    }
} finally {
    $attestationKey = $null
}
