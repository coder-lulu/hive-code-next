import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseSigningArguments } from './sign-windows-artifact.mjs'

if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.error('HiveCode hardware-signed Windows artifacts must be built on Windows x64.')
  process.exit(1)
}

const signingExecutable = process.env.HIVECODE_WINDOWS_SIGNING_EXECUTABLE
if (!signingExecutable || !isAbsolute(signingExecutable) || !existsSync(signingExecutable)) {
  console.error('HIVECODE_WINDOWS_SIGNING_EXECUTABLE must reference an existing absolute path.')
  process.exit(1)
}
if (!statSync(signingExecutable).isFile()) {
  console.error('HIVECODE_WINDOWS_SIGNING_EXECUTABLE must reference a file.')
  process.exit(1)
}
parseSigningArguments(process.env.HIVECODE_WINDOWS_SIGNING_ARGUMENTS)
if (
  !process.env.HIVECODE_WINDOWS_EXPECTED_SIGNERS?.trim() &&
  !process.env.HIVECODE_WINDOWS_EXPECTED_THUMBPRINTS?.trim()
) {
  console.error('An expected Windows signer subject or thumbprint is required.')
  process.exit(1)
}

const result = spawnSync(
  'pnpm',
  ['exec', 'electron-builder', '--config', 'config/electron-builder.config.cjs', '--win', '--x64'],
  {
    cwd: process.cwd(),
    env: { ...process.env, HIVECODE_WINDOWS_HARDWARE_SIGNING: '1' },
    stdio: 'inherit',
    shell: false,
    windowsHide: true
  }
)

if (result.error) {
  throw result.error
}
process.exit(result.status ?? 1)
