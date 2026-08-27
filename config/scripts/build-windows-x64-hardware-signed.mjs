import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { parseSigningArguments, parseSigningTimeout } from './sign-windows-artifact.mjs'
import {
  parseExpectedSigners,
  parseExpectedThumbprints,
  resolvePowerShellExecutable
} from './verify-windows-inner-signature.mjs'

export function preflightWindowsHardwareSigning({
  platform = process.platform,
  arch = process.arch,
  signingExecutable = process.env.HIVECODE_WINDOWS_SIGNING_EXECUTABLE,
  signingArguments = process.env.HIVECODE_WINDOWS_SIGNING_ARGUMENTS,
  expectedSigners = process.env.HIVECODE_WINDOWS_EXPECTED_SIGNERS,
  expectedThumbprints = process.env.HIVECODE_WINDOWS_EXPECTED_THUMBPRINTS,
  signingTimeout = process.env.HIVECODE_WINDOWS_SIGNING_TIMEOUT_MS,
  powershellExecutable = process.env.HIVECODE_WINDOWS_POWERSHELL_EXECUTABLE,
  environment = process.env,
  existsSyncImpl = existsSync,
  statSyncImpl = statSync
} = {}) {
  if (platform !== 'win32' || arch !== 'x64') {
    throw new Error('HiveCode hardware-signed Windows artifacts must be built on Windows x64.')
  }

  if (!signingExecutable || !isAbsolute(signingExecutable) || !existsSyncImpl(signingExecutable)) {
    throw new Error('HIVECODE_WINDOWS_SIGNING_EXECUTABLE must reference an existing absolute path.')
  }
  if (!statSyncImpl(signingExecutable).isFile()) {
    throw new Error('HIVECODE_WINDOWS_SIGNING_EXECUTABLE must reference a file.')
  }
  parseSigningArguments(signingArguments)
  const timeout = parseSigningTimeout(signingTimeout)
  const signerAllowlist = expectedSigners?.trim() ? parseExpectedSigners(expectedSigners) : []
  const thumbprintAllowlist = parseExpectedThumbprints(expectedThumbprints)
  if (signerAllowlist.length === 0 && thumbprintAllowlist.length === 0) {
    throw new Error('An expected Windows signer subject or thumbprint is required.')
  }
  const verifiedPowerShell = resolvePowerShellExecutable({
    configured: powershellExecutable,
    environment,
    existsSyncImpl,
    statSyncImpl,
    platform
  })
  return { signingExecutable, timeout, powershellExecutable: verifiedPowerShell }
}

export function main(argv = process.argv.slice(2), spawnSyncImpl = spawnSync) {
  try {
    const preflight = preflightWindowsHardwareSigning()
    if (argv.includes('--preflight-only')) {
      console.log('Windows x64 hardware signing preflight passed.')
      return
    }

    const result = spawnSyncImpl(
      'pnpm',
      [
        'exec',
        'electron-builder',
        '--config',
        'config/electron-builder.config.cjs',
        '--win',
        '--x64'
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HIVECODE_WINDOWS_HARDWARE_SIGNING: '1',
          HIVECODE_WINDOWS_POWERSHELL_EXECUTABLE: preflight.powershellExecutable
        },
        stdio: 'inherit',
        shell: false,
        windowsHide: true
      }
    )

    if (result.error) {
      throw result.error
    }
    if (result.status !== 0) {
      throw new Error(`electron-builder exited with code ${result.status ?? '<unknown>'}.`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
