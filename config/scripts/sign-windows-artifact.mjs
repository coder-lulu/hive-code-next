import { existsSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import {
  parseExpectedSigners,
  parseExpectedThumbprints,
  verifyWindowsInnerSignature
} from './verify-windows-inner-signature.mjs'

export const DEFAULT_SIGNING_TIMEOUT_MS = 300_000
export const MIN_SIGNING_TIMEOUT_MS = 10_000
export const MAX_SIGNING_TIMEOUT_MS = 1_800_000

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

export function parseSigningTimeout(value = process.env.HIVECODE_WINDOWS_SIGNING_TIMEOUT_MS) {
  if (value == null || value === '') {
    return DEFAULT_SIGNING_TIMEOUT_MS
  }
  if (!/^\d+$/u.test(value)) {
    throw new Error(
      'HIVECODE_WINDOWS_SIGNING_TIMEOUT_MS must be an integer number of milliseconds.'
    )
  }
  const timeout = Number(value)
  if (timeout < MIN_SIGNING_TIMEOUT_MS || timeout > MAX_SIGNING_TIMEOUT_MS) {
    throw new Error(
      `HIVECODE_WINDOWS_SIGNING_TIMEOUT_MS must be between ${MIN_SIGNING_TIMEOUT_MS} and ${MAX_SIGNING_TIMEOUT_MS}.`
    )
  }
  return timeout
}

export function signWindowsArtifact({
  artifact,
  signingExecutable = process.env.HIVECODE_WINDOWS_SIGNING_EXECUTABLE,
  signingArguments = process.env.HIVECODE_WINDOWS_SIGNING_ARGUMENTS,
  expectedSigners = process.env.HIVECODE_WINDOWS_EXPECTED_SIGNERS,
  expectedThumbprints = process.env.HIVECODE_WINDOWS_EXPECTED_THUMBPRINTS,
  signingTimeout = process.env.HIVECODE_WINDOWS_SIGNING_TIMEOUT_MS,
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
  const signerAllowlist = expectedSigners?.trim() ? parseExpectedSigners(expectedSigners) : []
  const thumbprintAllowlist = parseExpectedThumbprints(expectedThumbprints)
  if (signerAllowlist.length === 0 && thumbprintAllowlist.length === 0) {
    throw new Error('An expected Windows signer subject or thumbprint is required.')
  }
  const artifactPath = resolve(artifact ?? '')
  if (!artifact || !existsSync(artifactPath) || !statSync(artifactPath).isFile()) {
    throw new Error(`Windows signing artifact does not exist: ${artifactPath}`)
  }
  const args = parseSigningArguments(signingArguments).map((argument) =>
    argument.replaceAll('{file}', artifactPath)
  )
  const timeout = parseSigningTimeout(signingTimeout)
  const result = spawnSyncImpl(signingExecutable, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    shell: false,
    timeout,
    windowsHide: true
  })
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error(`Windows signing service exceeded the ${timeout}ms timeout.`)
    }
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`Windows signing service exited with code ${result.status ?? '<unknown>'}.`)
  }
  return verifyImpl({
    executablePath: artifactPath,
    platform,
    expectedSigners: signerAllowlist,
    expectedThumbprints: thumbprintAllowlist
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
