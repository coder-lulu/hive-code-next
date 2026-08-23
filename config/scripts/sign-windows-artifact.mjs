import { existsSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import {
  parseExpectedSigners,
  parseExpectedThumbprints,
  verifyWindowsInnerSignature
} from './verify-windows-inner-signature.mjs'

export function parseSigningArguments(value) {
  let parsed
  try {
    parsed = JSON.parse(value ?? '')
  } catch {
    throw new Error('HIVECODE_WINDOWS_SIGNING_ARGUMENTS must be a JSON string array.')
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.length > 64 ||
    parsed.some((argument) => typeof argument !== 'string' || argument.length > 4096) ||
    !parsed.some((argument) => argument.includes('{file}'))
  ) {
    throw new Error(
      'HIVECODE_WINDOWS_SIGNING_ARGUMENTS must contain 1-64 string arguments and a {file} placeholder.'
    )
  }
  return parsed
}

export function signWindowsArtifact({
  artifact,
  signingExecutable = process.env.HIVECODE_WINDOWS_SIGNING_EXECUTABLE,
  signingArguments = process.env.HIVECODE_WINDOWS_SIGNING_ARGUMENTS,
  expectedSigners = process.env.HIVECODE_WINDOWS_EXPECTED_SIGNERS,
  expectedThumbprints = process.env.HIVECODE_WINDOWS_EXPECTED_THUMBPRINTS,
  spawnSyncImpl = spawnSync,
  verifyImpl = verifyWindowsInnerSignature,
  platform = process.platform
}) {
  if (platform !== 'win32') {
    throw new Error('Windows hardware signing requires a Windows runner.')
  }
  if (!signingExecutable || !isAbsolute(signingExecutable) || !existsSync(signingExecutable)) {
    throw new Error('HIVECODE_WINDOWS_SIGNING_EXECUTABLE must reference an existing absolute path.')
  }
  if (!statSync(signingExecutable).isFile()) {
    throw new Error('HIVECODE_WINDOWS_SIGNING_EXECUTABLE must reference a file.')
  }
  if (!expectedSigners?.trim() && !expectedThumbprints?.trim()) {
    throw new Error('An expected Windows signer subject or thumbprint is required.')
  }
  const artifactPath = resolve(artifact ?? '')
  if (!artifact || !existsSync(artifactPath) || !statSync(artifactPath).isFile()) {
    throw new Error(`Windows signing artifact does not exist: ${artifactPath}`)
  }
  const args = parseSigningArguments(signingArguments).map((argument) =>
    argument.replaceAll('{file}', artifactPath)
  )
  const result = spawnSyncImpl(signingExecutable, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    shell: false,
    windowsHide: true
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`Windows signing service exited with code ${result.status ?? '<unknown>'}.`)
  }
  return verifyImpl({
    executablePath: artifactPath,
    platform,
    expectedSigners: expectedSigners?.trim() ? parseExpectedSigners(expectedSigners) : [],
    expectedThumbprints: parseExpectedThumbprints(expectedThumbprints)
  })
}

// electron-builder resolves the named `sign` export for win.signtoolOptions.sign.
// Keeping the adapter here makes the exact same fail-closed verifier available to
// both the packaging hook and the explicit one-off signing command.
export async function sign(configuration) {
  if (!configuration || configuration.hash !== 'sha256' || typeof configuration.path !== 'string') {
    throw new Error('The HiveCode Windows signing hook only accepts SHA-256 artifact tasks.')
  }
  return signWindowsArtifact({ artifact: configuration.path })
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length === 0) {
    console.error('Usage: pnpm sign:windows:hardware <artifact.exe> [artifact.exe ...]')
    process.exitCode = 1
    return
  }
  try {
    for (const artifact of argv) {
      signWindowsArtifact({ artifact })
      console.log(`Verified hardware-signed Windows artifact: ${resolve(artifact)}`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
